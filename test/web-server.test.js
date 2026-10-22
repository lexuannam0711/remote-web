const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { createAuth, createLease, parseCookie } = require('../src/server/auth');
const { createWebApp, startWebServer } = require('../src/server/web');

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdb-web-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Fixture dashboard</title>');
  const app = createWebApp({ env: { WEB_ACCESS_TOKEN: 'secret-token' }, webRoot: root, ...options });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (route, init) => fetch(url + route, init);
  const login = (token = 'secret-token', headers = {}) => request('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ token })
  });
  return { request, login, url };
}

test('web auth protects real API/static/health; login cookie; logout revokes', async t => {
  const { request, login } = await fixture(t);
  for (const route of ['/api/settings', '/api/logs', '/api/auth/session', '/health']) {
    assert.equal((await request(route)).status, 401, route);
  }
  // HTML navigations without a session get the login form (302), not raw JSON.
  for (const route of ['/', '/index.html', '/login']) {
    const page = await request(route, { redirect: 'manual' });
    assert.equal(page.status, 302, route);
    assert.equal(page.headers.get('location'), '/api/auth/login', route);
  }
  assert.equal((await request('/api/auth/login')).status, 200);
  const wrong = await login('wrong');
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), { error: 'Sai token' });
  const correct = await login();
  assert.equal(correct.status, 200);
  const header = correct.headers.get('set-cookie');
  assert.match(header, /pdb_session=[a-f0-9]{64};/);
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.doesNotMatch(header, /Secure/);
  const headers = { Cookie: header.split(';')[0] };
  assert.equal((await request('/api/settings', { headers })).status, 200);
  assert.deepEqual(await (await request('/api/auth/session', { headers })).json(), { ok: true });
  const html = await request('/', { headers });
  assert.equal(html.status, 200);
  assert.match(await html.text(), /Fixture dashboard/);
  const logout = await request('/api/auth/logout', { method: 'POST', headers });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/settings', { headers })).status, 401);
  const secure = await login('secret-token', { 'X-Forwarded-Proto': 'https' });
  assert.match(secure.headers.get('set-cookie'), /; Secure/);
});

test('web rate limits failed attempts, expires window and sessions', async t => {
  let time = 100;
  const auth = createAuth({ token: 'secret-token', sessionTtlMs: 1000, now: () => time });
  const { request, login } = await fixture(t, { auth });
  for (let i = 0; i < 10; i++) assert.equal((await login('wrong')).status, 401);
  const limited = await login('wrong');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.deepEqual(await limited.json(), { error: 'Qua nhieu lan thu' });
  time += 60000;
  const response = await login();
  assert.equal(response.status, 200);
  const headers = { Cookie: response.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/api/settings', { headers })).status, 200);
  time += 1000;
  assert.equal((await request('/api/settings', { headers })).status, 401);
});

test('web env, same-origin CORS and lease protocol', async t => {
  let time = 0;
  const lease = createLease({ now: () => time });
  const { request, login, url } = await fixture(t, { lease, env: { WEB_ACCESS_TOKEN: 'secret-token', PREFERRED_PANCAKE_URL: 'https://pancake.vn/' } });
  const response = await login();
  const headers = { Cookie: response.headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const env = await request('/api/env', { headers: { ...headers, Origin: url } });
  assert.equal(env.headers.get('access-control-allow-origin'), url);
  assert.deepEqual(await env.json(), { serverUrl: url, pancakeUrl: 'https://pancake.vn/' });
  assert.equal((await request('/api/settings', { headers: { ...headers, Origin: 'https://evil.example' } })).headers.get('access-control-allow-origin'), null);
  assert.equal((await login('secret-token', { Origin: 'https://evil.example' })).status, 403);
  const act = async (owner, action = 'acquire') => {
    const result = await request('/api/bot-lease', { method: 'POST', headers, body: JSON.stringify({ machineId: owner, action }) });
    return result.json();
  };
  assert.deepEqual(await act('A'), { ok: true, lease: { owner: 'A', expiresAt: '1970-01-01T00:01:00.000Z' } });
  assert.deepEqual(await act('B'), { ok: false, holder: 'A', expiresAt: '1970-01-01T00:01:00.000Z' });
  assert.deepEqual(await act('B', 'release'), { ok: false, holder: 'A', expiresAt: '1970-01-01T00:01:00.000Z' });
  time = 1000;
  assert.deepEqual(await act('A', 'extend'), { ok: true, lease: { owner: 'A', expiresAt: '1970-01-01T00:01:01.000Z' } });
  assert.deepEqual(await (await request('/api/bot-lease', { headers })).json(), { lease: { owner: 'A', expiresAt: '1970-01-01T00:01:01.000Z' } });
  assert.deepEqual(await act('A', 'release'), { ok: true });
  assert.deepEqual(await (await request('/api/bot-lease', { headers })).json(), { lease: null });
  assert.equal((await act('B')).ok, true);
  time = 61000;
  assert.equal((await act('A')).ok, true);
  for (const body of [{ owner: '' }, { owner: 42 }, { owner: 'A', action: 'bad' }]) {
    assert.equal((await request('/api/bot-lease', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  }
});

test('web start binds loopback, reports listen failures and alerts approved public binding', async t => {
  const env = { WEB_ACCESS_TOKEN: 'secret-token', PORT: '0' };
  const logger = { log() {}, warn() {} };
  const server = await startWebServer({ env, logger });
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal(server.address().address, '127.0.0.1');
  await assert.rejects(startWebServer({ env: { ...env, PORT: String(server.address().port) }, logger }), /EADDRINUSE/);
  assert.throws(() => startWebServer({ env: { ...env, PORT: 'invalid' }, logger }), /PORT/);
  let alerted;
  const publicServer = await startWebServer({ env: { ...env, WEB_BIND_HOST: '0.0.0.0', WEB_ALLOW_PUBLIC: '1' }, logger, telegramBot: {
    notifySystemAlert(value) { alerted = value; return Promise.reject(new Error('offline')); }
  } });
  t.after(() => new Promise(resolve => publicServer.close(resolve)));
  assert.equal(alerted.title, 'Public web binding');
});

test('auth handles raw Node HTTP JSON bodies without Express', async t => {
  const auth = createAuth({ token: 'secret-token' });
  const server = require('node:http').createServer(auth.login).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ token: 'secret-token' }) })).status, 200);
});

test('lease direct API validates owner; extend re-acquires free/expired leases (frozen 4ter)', () => {
  let time = 0;
  const lease = createLease({ ttlMs: 1000, now: () => time });
  // Frozen §4ter: acquire and extend behave identically when free or expired.
  assert.deepEqual(lease.extend('A'), { ok: true, owner: 'A', expiresAt: 1000 });
  assert.throws(() => lease.acquire(null), /owner/);
  time = 500;
  assert.deepEqual(lease.acquire('A'), { ok: true, owner: 'A', expiresAt: 1500 });
  time = 1500;
  assert.equal(lease.current(), null);
  // Late extend after expiry: re-acquires (conflict with another owner still fails closed).
  assert.deepEqual(lease.extend('A'), { ok: true, owner: 'A', expiresAt: 2500 });
  assert.deepEqual(lease.extend('B'), { ok: false, holder: 'A', expiresAt: 2500 });
  assert.deepEqual(lease.release('C'), { ok: false, holder: 'A', expiresAt: 2500 });
  // Scope khác (user khác) độc lập: lease của scope mặc định không chặn.
  assert.deepEqual(lease.acquire('B', 'user-1'), { ok: true, owner: 'B', expiresAt: 2500 });
  assert.equal(lease.current('').owner, 'A');
  assert.equal(lease.current('user-1').owner, 'B');
  assert.deepEqual(lease.release('A', 'user-1'), { ok: false, holder: 'B', expiresAt: 2500 });
});

test('bot lease is scoped per authenticated user, shared only inside one user', async t => {
  const auth = createAuth({ token: 'secret-token' });
  const lease = createLease();
  const { request } = await fixture(t, { auth, lease });
  const asUser = (userId) => {
    const id = auth.issue({ headers: {}, secure: false }, { setHeader() {} }, { kind: 'supabase', userId, email: `${userId}@example.com`, owner: false });
    return { Cookie: `pdb_session=${id}`, 'Content-Type': 'application/json' };
  };
  const user1 = asUser('user-1');
  const user2 = asUser('user-2');
  const act = async (headers, machineId, action = 'acquire') => (await request('/api/bot-lease', { method: 'POST', headers, body: JSON.stringify({ machineId, action }) })).json();
  assert.equal((await act(user1, 'machine-1')).ok, true);
  assert.equal((await act(user2, 'machine-2')).ok, true);
  const conflict = await act(user1, 'machine-2');
  assert.equal(conflict.ok, false);
  assert.equal(conflict.holder, 'machine-1');
  assert.equal((await (await request('/api/bot-lease', { headers: user1 })).json()).lease.owner, 'machine-1');
  assert.equal((await (await request('/api/bot-lease', { headers: user2 })).json()).lease.owner, 'machine-2');
  assert.equal((await act(user2, 'machine-2', 'release')).ok, true);
  assert.equal((await (await request('/api/bot-lease', { headers: user2 })).json()).lease, null);
  assert.equal((await (await request('/api/bot-lease', { headers: user1 })).json()).lease.owner, 'machine-1');
});

test('web validates login input and JSON body', async t => {
  const { request, login } = await fixture(t);
  assert.equal((await login(42)).status, 400);
  const malformed = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const large = await request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'x'.repeat(5000) }) });
  assert.equal(large.status, 413);
});

test('web honors x-forwarded-proto for same-origin Origin behind an HTTPS proxy', async t => {
  const { request, login, url } = await fixture(t);
  const host = new URL(url).host;
  const proxied = { 'X-Forwarded-Proto': 'https', Origin: `https://${host}` };
  // The CSRF 403 gate must accept the scheme the client actually saw (T5a MAJOR).
  const response = await login('secret-token', proxied);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /; Secure/);
  // Without the proxy header the same https Origin stays rejected.
  assert.equal((await login('secret-token', { Origin: `https://${host}` })).status, 403);
  // Comma-lists (chained proxies) resolve to the first entry.
  assert.equal((await login('secret-token', { 'X-Forwarded-Proto': 'https, http', Origin: `https://${host}` })).status, 200);
});

test('web refuses empty token and unapproved public binding before listen', () => {
  assert.throws(() => createWebApp({ env: {} }), /WEB_ACCESS_TOKEN/);
  assert.throws(() => startWebServer({ env: { WEB_ACCESS_TOKEN: 'secret-token', WEB_BIND_HOST: '0.0.0.0' }, logger: { warn() {} } }), /WEB_ALLOW_PUBLIC/);
  assert.throws(() => createAuth({ token: '' }), /token/);
  assert.throws(() => createAuth({ token: 'test', sessionTtlMs: NaN }), /sessionTtlMs/);
});

test('cookie parsing handles malformed and duplicate input safely', () => {
  assert.deepEqual(parseCookie(undefined), {});
  assert.deepEqual(parseCookie('a=b=c; pdb_session=abc; bad=%zz; __proto__=evil'), { a: 'b=c', pdb_session: 'abc', bad: '%zz' });
  assert.deepEqual(parseCookie('pdb_session=first; pdb_session=second'), { pdb_session: 'first' });
});

test('web hardens origin: rejects null Origin and untrusted Host reflection, adds framing headers', async t => {
  const { login, url } = await fixture(t);
  const cookie = (await login()).headers.get('set-cookie').split(';')[0];
  const port = new URL(url).port;
  const rawPost = (headers) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/settings', method: 'POST', headers: { ...headers, 'Content-Length': 0 } }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
  // `Origin: null` (sandboxed iframe / data: page) must not pass the CSRF gate.
  assert.equal((await rawPost({ Origin: 'null', Cookie: cookie })).status, 403);
  // A spoofed Host must not satisfy the reflected same-origin check (T3 HIGH #4).
  assert.equal((await rawPost({ Host: 'bot.evil.example', Origin: 'https://bot.evil.example', Cookie: cookie })).status, 403);
  // An explicitly allowed origin still passes even with a foreign Host header.
  const allowedEnv = { WEB_ACCESS_TOKEN: 'secret-token', WEB_ALLOWED_ORIGIN: 'https://bot.trusted.example' };
  const { login: allowedLogin } = await fixture(t, { env: allowedEnv });
  assert.equal((await allowedLogin('secret-token', { Origin: 'https://bot.trusted.example' })).status, 200);
  // Clickjacking / sniffing hardening headers on the web surface.
  const page = await fetch(url + '/', { headers: { Cookie: cookie } });
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
});

test('web masks secrets in settings/health responses; empty keeps stored key, CLEAR clears it', async t => {
  const express = require('express');
  let state = { theme: 'light', aiApiKey: 'sk-test-1234', ttsApiKey: 'tts-key-9999' };
  let aiConfigPatch = null;
  const appFactory = () => {
    const inner = express();
    inner.get('/health', (_req, res) => res.json({ ok: true, settings: { ...state } }));
    inner.get('/api/settings', (_req, res) => res.json({ ...state }));
    inner.post('/api/settings', (req, res) => { state = { ...state, ...req.body }; res.json({ ...state }); });
    inner.get('/api/ai/config', (_req, res) => res.json({ aiBaseUrl: 'https://api.example', aiApiKey: 'sk-resolved-4321', aiApiKeyMasked: '••••4321', aiModel: 'm' }));
    inner.post('/api/ai/config', (req, res) => { aiConfigPatch = { ...req.body }; res.json({ aiApiKey: String(req.body?.aiApiKey || ''), aiBaseUrl: 'https://api.example' }); });
    inner.post('/api/ai/test', (_req, res) => res.json({ message: 'ok', config: { aiApiKey: 'sk-nested-7777', aiModel: 'm' } }));
    inner.get('/api/logs', (_req, res) => res.json([{ level: 'INFO', type: 'AI_TEST', data: { ttsApiKey: 'tts-in-log-5555' } }]));
    return inner;
  };
  const store = { getSettings: async () => ({ aiApiKey: 'sk-stored-8888', ttsApiKey: '' }) };
  const { request, login } = await fixture(t, { appFactory, store });
  const headers = { Cookie: (await login()).headers.get('set-cookie').split(';')[0], 'Content-Type': 'application/json' };
  const settings = await (await request('/api/settings', { headers })).json();
  assert.equal(settings.aiApiKey, '');
  assert.equal(settings.ttsApiKey, '');
  assert.equal(settings.aiApiKeyMasked, '••••1234');
  assert.equal(settings.ttsApiKeyMasked, '••••9999');
  assert.equal(settings.theme, 'light');
  const health = await (await request('/health', { headers })).json();
  assert.equal(health.settings.aiApiKey, '');
  assert.equal(health.settings.aiApiKeyMasked, '••••1234');
  // Re-sending the (now empty) secret keeps the stored key.
  await request('/api/settings', { method: 'POST', headers, body: JSON.stringify({ theme: 'dark', aiApiKey: '' }) });
  assert.equal(state.aiApiKey, 'sk-test-1234');
  assert.equal(state.theme, 'dark');
  // The literal CLEAR clears it.
  await request('/api/settings', { method: 'POST', headers, body: JSON.stringify({ ttsApiKey: 'CLEAR' }) });
  assert.equal(state.ttsApiKey, '');
  // A typed key is stored verbatim and only ever returned masked.
  const saved = await (await request('/api/settings', { method: 'POST', headers, body: JSON.stringify({ aiApiKey: 'sk-new-7777' }) })).json();
  assert.equal(state.aiApiKey, 'sk-new-7777');
  assert.equal(saved.aiApiKey, '');
  assert.equal(saved.aiApiKeyMasked, '••••7777');
  // /api/ai/config resolves keys from env/settings, so its response leaks too —
  // masking must be recursive, not path-by-path.
  const config = await (await request('/api/ai/config', { headers })).json();
  assert.equal(config.aiApiKey, '');
  assert.equal(config.aiApiKeyMasked, '••••4321');
  assert.equal(config.aiModel, 'm');
  // Empty aiApiKey on this route must NOT wipe the stored key (handler always patches).
  await request('/api/ai/config', { method: 'POST', headers, body: JSON.stringify({ aiBaseUrl: 'https://api.example', aiApiKey: '', aiModel: 'm' }) });
  assert.equal(aiConfigPatch.aiApiKey, 'sk-stored-8888');
  assert.equal(aiConfigPatch.aiModel, 'm');
  await request('/api/ai/config', { method: 'POST', headers, body: JSON.stringify({ aiApiKey: 'CLEAR' }) });
  assert.equal(aiConfigPatch.aiApiKey, '');
  await request('/api/ai/config', { method: 'POST', headers, body: JSON.stringify({ aiApiKey: 'sk-user-1111' }) });
  assert.equal(aiConfigPatch.aiApiKey, 'sk-user-1111');
  // Nested config in an unrelated response, and secrets replayed through logs.
  const aiTest = await (await request('/api/ai/test', { method: 'POST', headers, body: '{}' })).json();
  assert.equal(aiTest.config.aiApiKey, '');
  assert.equal(aiTest.config.aiApiKeyMasked, '••••7777');
  const logs = await (await request('/api/logs', { headers })).json();
  assert.equal(logs[0].data.ttsApiKey, '');
  assert.equal(logs[0].data.ttsApiKeyMasked, '••••5555');
});

test('web gates Telegram wiring behind WEB_TELEGRAM_POLLING (avoid token clash with desktop)', async t => {
  const calls = [];
  const telegramBot = {
    notifyServerUp() { calls.push('up'); return Promise.resolve(); },
    scheduleDailyReport() { calls.push('daily'); },
    startTelegramPolling() { calls.push('poll'); return () => calls.push('stop'); },
    notifySystemAlert() { return Promise.resolve(); }
  };
  const logger = { log() {}, warn() {} };
  const offline = await startWebServer({ env: { WEB_ACCESS_TOKEN: 'secret-token', PORT: '0', WEB_TELEGRAM_POLLING: '0' }, logger, telegramBot });
  t.after(() => new Promise(resolve => offline.close(resolve)));
  assert.deepEqual(calls, []);
  const online = await startWebServer({ env: { WEB_ACCESS_TOKEN: 'secret-token', PORT: '0' }, logger, telegramBot });
  t.after(() => new Promise(resolve => online.close(resolve)));
  assert.ok(calls.includes('poll') && calls.includes('daily') && calls.includes('up'));
});

test('TRUST_PROXY=1 giới hạn theo X-Forwarded-For, không theo socket của proxy', async t => {
  const { login } = await fixture(t, { env: { WEB_ACCESS_TOKEN: 'secret-token', TRUST_PROXY: '1' } });
  for (let i = 0; i < 10; i++) {
    assert.equal((await login('wrong', { 'X-Forwarded-For': '10.0.0.1' })).status, 401);
  }
  const limited = await login('wrong', { 'X-Forwarded-For': '10.0.0.1' });
  assert.equal(limited.status, 429);
  const otherIp = await login('wrong', { 'X-Forwarded-For': '10.0.0.2' });
  assert.equal(otherIp.status, 401);
});

test('mặc định không TRUST_PROXY: mọi XFF vẫn chung một bucket (back-compat)', async t => {
  const { login } = await fixture(t);
  for (let i = 0; i < 10; i++) {
    assert.equal((await login('wrong', { 'X-Forwarded-For': '10.0.0.1' })).status, 401);
  }
  const limited = await login('wrong', { 'X-Forwarded-For': '10.0.0.2' });
  assert.equal(limited.status, 429);
});

test('x-forwarded-proto chuỗi phẩy vẫn gắn cookie Secure', async t => {
  const { login, url } = await fixture(t);
  const host = new URL(url).host;
  const res = await login('secret-token', {
    'X-Forwarded-Proto': 'https, http',
    Origin: `https://${host}`,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') || '', /; Secure/);
});

test('WEB_ALLOWED_HOSTS mở CSRF gate cho host sau proxy', async t => {
  const env = { WEB_ACCESS_TOKEN: 'secret-token', WEB_ALLOWED_HOSTS: 'bot.hosts.example' };
  const { url } = await fixture(t, { env });
  const port = new URL(url).port;
  const rawLogin = (headers) => new Promise((resolve, reject) => {
    const payload = JSON.stringify({ token: 'secret-token' });
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-Forwarded-Proto': 'https',
        ...headers,
      },
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });

  const ok = await rawLogin({ Host: 'bot.hosts.example', Origin: 'https://bot.hosts.example' });
  assert.equal(ok.status, 200);

  const evil = await rawLogin({ Host: 'bot.evil.example', Origin: 'https://bot.evil.example' });
  assert.equal(evil.status, 403);
});
