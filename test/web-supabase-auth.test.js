const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createWebApp } = require('../src/server/web');
const { resolveSupabaseConfig, createSupabaseVerifier } = require('../src/server/supabaseAuth');

const SUPA_URL = 'https://demo.supabase.co';
const ANON = 'anon-public-key';
const PDB = 'secret-token';

function memoryState() {
  let data = null;
  return {
    load: async () => (data ? JSON.parse(JSON.stringify(data)) : null),
    save: async (value) => { data = JSON.parse(JSON.stringify(value)); },
    peek: () => data,
  };
}

// Mock GoTrue: chỉ /auth/v1/user; token nào nằm trong bảng users mới hợp lệ.
function mockSupabase(users) {
  const seen = [];
  const broken = { unreachable: false };
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url, apikey: options.headers?.apikey, authorization: options.headers?.Authorization });
    if (broken.unreachable) throw new TypeError('fetch failed');
    const token = String(options.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
    const user = url === `${SUPA_URL}/auth/v1/user` ? users[token] : undefined;
    if (!user) return { ok: false, status: 401, json: async () => ({ msg: 'invalid token' }) };
    return { ok: true, status: 200, json: async () => user };
  };
  return { fetchImpl, seen, broken };
}

async function fixture(t, { env = {}, state = memoryState(), users = {}, failFastWarn = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pdb-supa-'));
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>Fixture dashboard</title>');
  const mock = mockSupabase(users);
  const quiet = failFastWarn ? console : { log() {}, warn() {}, error() {} };
  const app = createWebApp({
    env: { WEB_ACCESS_TOKEN: PDB, WEB_SUPABASE_URL: SUPA_URL, WEB_SUPABASE_ANON_KEY: ANON, ...env },
    webRoot: root,
    supabaseFetch: mock.fetchImpl,
    supabaseState: state,
    logger: quiet,
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (route, init = {}) => fetch(base + route, {
    ...init,
    headers: init.headers || {},
  });
  const post = (route, body, headers = {}) => request(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const cookieOf = (response) => (response.headers.get('set-cookie') || '').split(';')[0];
  return { request, post, cookieOf, state, mock, server };
}

const USERS = {
  'tok-owner': { id: 'user-owner-01', email: 'owner@shop.vn' },
  'tok-guest': { id: 'user-guest-02', email: 'nsd@shop.vn' },
};

test('resolveSupabaseConfig: chi nhận https + host supabase + khong userinfo', () => {
  assert.equal(resolveSupabaseConfig({ WEB_SUPABASE_URL: 'http://demo.supabase.co', WEB_SUPABASE_ANON_KEY: ANON }), null);
  assert.equal(resolveSupabaseConfig({ WEB_SUPABASE_URL: 'https://evil.example.com', WEB_SUPABASE_ANON_KEY: ANON }), null);
  assert.equal(resolveSupabaseConfig({ WEB_SUPABASE_URL: 'https://user:pass@demo.supabase.co', WEB_SUPABASE_ANON_KEY: ANON }), null);
  assert.equal(resolveSupabaseConfig({ WEB_SUPABASE_URL: 'https://demo.supabase.co', WEB_SUPABASE_ANON_KEY: '' }), null);
  assert.equal(resolveSupabaseConfig({}), null);
  const ok = resolveSupabaseConfig({ WEB_SUPABASE_URL: `${SUPA_URL}/`, WEB_SUPABASE_ANON_KEY: ANON });
  assert.equal(ok.url, SUPA_URL);
});

test('verifier fail-closed: token lang/reach/định dạng sai đều bị từ chối', async () => {
  const { fetchImpl } = mockSupabase(USERS);
  const verifier = createSupabaseVerifier({ config: { url: SUPA_URL, anonKey: ANON }, fetchImpl });
  assert.deepEqual(await verifier.verify(''), { ok: false, code: 'invalid_token' });
  assert.deepEqual(await verifier.verify('tok-khong-co'), { ok: false, code: 'invalid_token' });
  const good = await verifier.verify('tok-owner');
  assert.equal(good.ok, true);
  assert.equal(good.userId, 'user-owner-01');
});

test('mode: unconfigured giu nguyen dang nhap pdb co dien', async (t) => {
  const h = await fixture(t, { env: { WEB_SUPABASE_URL: '', WEB_SUPABASE_ANON_KEY: '' } });
  const mode = await (await h.request('/api/auth/mode')).json();
  assert.deepEqual(mode, { mode: 'unconfigured', supabaseUrl: null, supabaseAnonKey: null, emergencyPdb: false });
  const ok = await h.post('/api/auth/login', { token: PDB });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /pdb_session=[a-f0-9]{64};/);
});

test('bootstrap: pdb 1 lan + tai khoan Supabase → bind owner, cap session', async (t) => {
  const h = await fixture(t, { users: USERS });
  assert.equal((await (await h.request('/api/auth/mode')).json()).mode, 'bootstrap');
  assert.equal((await h.post('/api/auth/bootstrap', { token: 'sai-token', accessToken: 'tok-owner' })).status, 401);
  assert.equal((await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-khong-co' })).status, 401);
  const done = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  assert.equal(done.status, 200);
  assert.deepEqual(await done.json(), { ok: true, mode: 'active', owner: true });
  assert.match(done.headers.get('set-cookie'), /pdb_session=[a-f0-9]{64};/);
  assert.match(done.headers.get('set-cookie'), /HttpOnly/);
  assert.match(done.headers.get('set-cookie'), /SameSite=Strict/);
  const session = await h.request('/api/auth/session', { headers: { Cookie: h.cookieOf(done) } });
  assert.equal(session.status, 200);
  // Bind xong là pdb chết (410) và bootstrap thứ hai chết luôn (410).
  assert.equal((await h.post('/api/auth/login', { token: PDB })).status, 410);
  assert.equal((await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' })).status, 410);
  assert.equal(h.state.peek().owner.userId, 'user-owner-01');
  // Server verify bang anon key (khong bao giờ là service key).
  assert.equal(h.mock.seen.at(-1).apikey, ANON);
});

test('bootstrap fail-closed: Supabase khong reachable → 503, owner KHÔNG bị bind', async (t) => {
  const h = await fixture(t, { users: USERS });
  h.mock.broken.unreachable = true;
  const down = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  assert.equal(down.status, 503);
  assert.equal(h.state.peek(), null);
});

test('CSRF gate van chan POST bootstrap voi Origin: null', async (t) => {
  const h = await fixture(t, { users: USERS });
  const blocked = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' }, { Origin: 'null' });
  assert.equal(blocked.status, 403);
});

test('đăng nhập Supabase: owner OK; user la → pending; owner duyet → OK', async (t) => {
  const state = memoryState();
  const h = await fixture(t, { users: USERS, state });
  const bound = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  const ownerCookie = { Cookie: h.cookieOf(bound) };
  assert.equal((await (await h.request('/api/auth/users', { headers: ownerCookie })).json()).pending, 0);
  const guest = await h.post('/api/auth/supabase-login', { accessToken: 'tok-guest' });
  assert.equal(guest.status, 403);
  assert.equal((await guest.json()).status, 'pending');
  assert.equal((await (await h.request('/api/auth/users', { headers: ownerCookie })).json()).pending, 1);
  // Guest chưa được duyệt thì không có phiên: mọi route auth vẫn 401.
  assert.equal((await h.request('/api/auth/session')).status, 401);
  const approve = await h.post('/api/auth/users/decide', { userId: 'user-guest-02', decision: 'approve' }, ownerCookie);
  assert.equal(approve.status, 200);
  const guest2 = await h.post('/api/auth/supabase-login', { accessToken: 'tok-guest' });
  assert.equal(guest2.status, 200);
  assert.equal((await guest2.json()).owner, false);
  // Guest không phải owner → không được quản lý user.
  const denied = await h.request('/api/auth/users', { headers: { Cookie: h.cookieOf(guest2) } });
  assert.equal(denied.status, 403);
  // reject thì pending bay khỏi danh sách.
  const h2state = memoryState();
  const h2 = await fixture(t, { users: USERS, state: h2state });
  const b2 = await h2.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  const c2 = { Cookie: h2.cookieOf(b2) };
  await h2.post('/api/auth/supabase-login', { accessToken: 'tok-guest' });
  assert.equal((await h2.post('/api/auth/users/decide', { userId: 'user-guest-02', decision: 'reject' }, c2)).status, 200);
  assert.equal(h2state.peek().users.length, 0);
});

test('owner khong the tu xoa/chinh role minh; decide bat hop le → 400', async (t) => {
  const h = await fixture(t, { users: USERS });
  const bound = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  const ownerCookie = { Cookie: h.cookieOf(bound) };
  assert.equal((await h.post('/api/auth/users/decide', { userId: 'user-owner-01', decision: 'reject' }, ownerCookie)).status, 400);
  assert.equal((await h.post('/api/auth/users/decide', { userId: 'x', decision: 'kd' }, ownerCookie)).status, 400);
  assert.equal((await h.post('/api/auth/users/decide', { userId: 'user-khong-ton-tai', decision: 'approve' }, ownerCookie)).status, 404);
});

test('break-glass WEB_PDB_EMERGENCY=1 phuc hoi dang nhap pdb sau bootstrap', async (t) => {
  const h = await fixture(t, { users: USERS, env: { WEB_PDB_EMERGENCY: '1' } });
  const bound = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  assert.equal((await (await h.request('/api/auth/mode')).json()).emergencyPdb, true);
  const rescue = await h.post('/api/auth/login', { token: PDB });
  assert.equal(rescue.status, 200);
  const ownerCookie = { Cookie: h.cookieOf(rescue) };
  // Phiên pdb break-glass được coi là quyền chủ → quản lý được user.
  assert.equal((await h.request('/api/auth/users', { headers: ownerCookie })).status, 200);
});

test('rate limit: 11 lan bootstrap sai bi chan 429 + Retry-After', async (t) => {
  const h = await fixture(t, { users: USERS });
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await h.post('/api/auth/bootstrap', { token: 'sai', accessToken: 'tok-owner' })).status, 401, `attempt ${i}`);
  }
  const limited = await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});

test('route auth mode-aware khong chan 302 HTML navigation va khong lo email trong /api/auth/mode', async (t) => {
  const h = await fixture(t, { users: USERS });
  const page = await h.request('/', { headers: { Accept: 'text/html' }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/api/auth/login');
  const form = await h.request('/api/auth/login');
  assert.equal(form.status, 200);
  assert.match(await form.text(), /id="login"/);
  await h.post('/api/auth/bootstrap', { token: PDB, accessToken: 'tok-owner' });
  const mode = await (await h.request('/api/auth/mode')).json();
  assert.equal(mode.mode, 'active');
  const text = JSON.stringify(mode);
  assert.doesNotMatch(text, /owner@shop\.vn/);
  assert.doesNotMatch(text, /tok-owner|access_token/i);
  // Anon key duoc phe cong khai (thiet ke Supabase); khong duoc co secret nao khac.
  assert.equal(mode.supabaseAnonKey, ANON);
});
