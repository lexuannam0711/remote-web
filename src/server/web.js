require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { createAuth, createLease } = require('./auth');
const { resolveSupabaseConfig, createSupabaseAuth } = require('./supabaseAuth');

// Trang đăng nhập công cộng: tự đọc /api/auth/mode để biết kiểu xác thực.
// unconfigured → chỉ ô pdb (hành vi cổ điển); bootstrap → pdb (1 lần) +
// Supabase; active → chỉ Supabase (thêm ô pdb nếu break-glass đang bật).
//Browser gọi thẳng Supabase password grant để lấy access_token, rồi đưa
// access_token (KHÔNG bao giờ là mật khẩu) cho endpoint của ta — server verify
// phía sau và không lưu token vào bất kỳ đâu.
const loginPage = () => `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Dang nhap</title>
<style>body{font-family:system-ui;background:#0f1420;color:#e8ecf5;display:grid;place-items:center;min-height:100vh;margin:0}form{display:grid;gap:10px;width:min(340px,90vw)}input{padding:10px;border-radius:8px;border:1px solid #334;background:#151c2c;color:inherit}button{padding:10px;border-radius:8px;border:0;background:#4c8dff;color:#fff;font-weight:600}[hidden]{display:none}p.error{color:#ff8f8f;min-height:1.2em}</style>
<form id="login"><h2>Pancake Web Bot</h2>
<label id="pdbRow">Token <input name="token" type="password" required autocomplete="current-password"></label>
<label id="emailRow" hidden>Email <input name="email" type="email" autocomplete="username"></label>
<label id="passRow" hidden>Mat khau <input name="password" type="password" autocomplete="current-password"></label>
<button>Dang nhap</button><p role="alert" class="error" id="error"></p></form>
<script>
(async function () {
  var form = document.getElementById('login'), err = document.getElementById('error');
  var mode = { mode: 'unconfigured' };
  try { mode = await (await fetch('/api/auth/mode')).json(); } catch (_) {}
  var supa = mode.mode !== 'unconfigured';
  var showPdb = !supa || mode.mode === 'bootstrap' || mode.emergencyPdb;
  document.getElementById('pdbRow').hidden = !showPdb;
  document.getElementById('emailRow').hidden = !supa;
  document.getElementById('passRow').hidden = !supa;
  if (supa && mode.mode === 'bootstrap') err.textContent = 'Lan dau: dien token + tai khoan Supabase (token chi dung 1 lan).';
  form.addEventListener('submit', async function (event) {
    event.preventDefault(); err.textContent = '';
    var f = event.target.elements, token = f.token.value, accessToken = '';
    try {
      if (supa && (f.email.value || mode.mode === 'bootstrap')) {
        var r = await fetch(mode.supabaseUrl + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: mode.supabaseAnonKey }, body: JSON.stringify({ email: f.email.value.trim(), password: f.password.value }) });
        if (!r.ok) { err.textContent = 'Sai email hoac mat khau Supabase'; return; }
        accessToken = (await r.json()).access_token || '';
      }
      var route = mode.mode === 'bootstrap' ? '/api/auth/bootstrap' : accessToken ? '/api/auth/supabase-login' : '/api/auth/login';
      var body = route === '/api/auth/bootstrap' ? { token: token, accessToken: accessToken } : accessToken ? { accessToken: accessToken } : { token: token };
      var response = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (response.ok) location.assign('/');
      else { var data = await response.json().catch(function () { return {}; }); err.textContent = (data.status === 'pending' ? 'Tai khoan da ghi nhan - cho owner duyet.' : data.error) || 'Khong dang nhap duoc'; }
    } catch (_) { err.textContent = 'Khong ket noi duoc server'; }
  });
})();
</script></html>`;

function createWebApp({ env = process.env, auth, lease = createLease(), webRoot = path.resolve(__dirname, '../../web/public'), telegramBot, appFactory, store, supabaseFetch, supabaseState, logger = console } = {}) {
  if (typeof env.WEB_ACCESS_TOKEN !== 'string' || !env.WEB_ACCESS_TOKEN.trim()) throw new Error('WEB_ACCESS_TOKEN is required for web mode');
  const ipOf = String(env.TRUST_PROXY || '') === '1' ? (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket?.remoteAddress || 'unknown') : undefined;
  const webAuth = auth || createAuth({ token: env.WEB_ACCESS_TOKEN, sessionTtlMs: Number(env.SESSION_TTL_HOURS || 72) * 3600000, ipOf });
  // Trạng thái Supabase nằm ở server/data/supabase.json — file này đã bị
  // .gitignore chặn theo luật "server/data/*.json" (kho public không lộ owner).
  const supabaseConfig = resolveSupabaseConfig(env);
  const supabase = createSupabaseAuth({
    config: supabaseConfig,
    auth: webAuth,
    env,
    logger,
    ipOf,
    fetchImpl: supabaseFetch,
    state: supabaseState || {
      load: async () => {
        const storeModule = store || require('./store');
        // readJson tự khởi tạo file thiếu bằng fallback (thói quen của store.js);
        // fallback {} có nghĩa "chưa bind owner" → mode bootstrap.
        const data = await storeModule.readJson('supabase.json', {});
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      },
      save: async (data) => { const storeModule = store || require('./store'); await storeModule.writeJson('supabase.json', data); },
    },
  });
  const app = express();
  app.disable('x-powered-by');
  // Behind an HTTPS reverse proxy req.protocol stays 'http' unless the proxy
  // header is honored; compare the Origin against the scheme the CLIENT saw.
  // Take only the first entry of a comma-list. Spoofing this header only
  // widens which origins we echo back — the 403 CSRF gate still matches
  // scheme+host exactly — and the server binds loopback by default, so the
  // proxy is the only reachable path in production.
  const scheme = (req) => String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http';
  // Host header must resolve to a name we actually serve; reflecting an
  // arbitrary Host would let a spoofed header satisfy the same-origin test.
  const hostNameOf = (value) => {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return '';
    if (text.startsWith('[')) return text.slice(1, text.indexOf(']')) || text;
    const colons = (text.match(/:/g) || []).length;
    if (colons === 0) return text;
    if (colons === 1) return text.replace(/:\d+$/, '') || text;
    return text;
  };
  const trustedHosts = new Set(['127.0.0.1', 'localhost', '::1', hostNameOf(env.WEB_BIND_HOST)]);
  for (const entry of String(env.WEB_ALLOWED_HOSTS || '').split(',')) {
    const name = hostNameOf(entry);
    if (name) trustedHosts.add(name);
  }
  if (env.WEB_ALLOWED_ORIGIN) {
    try { trustedHosts.add(hostNameOf(new URL(env.WEB_ALLOWED_ORIGIN).host)); } catch (_) { /* ignore malformed */ }
  }
  const explicitOrigin = (origin) => Boolean(env.WEB_ALLOWED_ORIGIN && origin === env.WEB_ALLOWED_ORIGIN);
  // `Origin: null` (sandboxed iframe, data: page) is no longer trusted — a real
  // dashboard visit always carries the page origin. Requests with no Origin at
  // all (curl, server-to-server, same-origin GET) still pass; they carry no
  // ambient cookie, so authentication remains the actual gate.
  const allowed = (req, origin) => !origin || explicitOrigin(origin)
    || (trustedHosts.has(hostNameOf(req.get('host'))) && origin === `${scheme(req)}://${String(req.get('host') || '').trim()}`);
  app.use(cors((req, callback) => callback(null, { origin: allowed(req, req.get('origin')), credentials: true })));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Clickjacking / MIME-sniffing hardening for the whole web surface.
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "frame-ancestors 'none'");
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !allowed(req, req.get('origin'))) return res.status(403).json({ error: 'Origin khong duoc phep' });
    next();
  });
  // Public login form; dashboard assets remain authenticated.
  app.get('/api/auth/login', (_req, res) => res.type('html').send(loginPage()));
  // Cho phép chọn kiểu xác thực: mode công khai (không lộ bí mật — anon key
  // Supabase là public theo thiết kế), bootstrap pdb 1 lần, và đăng nhập
  // Supabase thường. Tất cả đều đi qua CSRF gate + security headers phía trên.
  app.get('/api/auth/mode', supabase.modeHandler);
  app.post('/api/auth/bootstrap', express.json({ limit: '4kb' }), supabase.bootstrapHandler);
  app.post('/api/auth/supabase-login', express.json({ limit: '4kb' }), supabase.loginHandler);
  // Đường pdb cổ điển: còn sống ở unconfigured/bootstrap, chết ở active
  // (410) trừ break-glass WEB_PDB_EMERGENCY=1.
  app.post('/api/auth/login', express.json({ limit: '4kb' }), supabase.legacyLoginHandler);
  // Human visitors hitting the dashboard without a session get the login form
  // (302) instead of raw JSON; API clients still receive 401 JSON.
  app.use((req, res, next) => {
    const htmlNavigation = req.method === 'GET' && (req.path === '/' || req.path === '/index.html' || req.path === '/login');
    if (htmlNavigation && !webAuth.session(req)) return res.redirect('/api/auth/login');
    next();
  });
  // Parent middleware protects every route in the unmodified desktop app.
  app.use(webAuth.requireAuth);
  // Secret masking on the web surface (T3 security review, HIGH #2). Applied to
  // EVERY json response, recursively, because the keys travel under several
  // shapes: /api/settings and /health return them directly, /api/ai/config
  // returns the resolved key from summarizeAIConfig, /api/ai/test nests it in
  // result.config, and /api/logs replays entries whose data captured a config.
  // The web entry keeps the desktop contract but blanks the secrets and adds
  // `<key>Masked` (same naming as summarizeAIConfig). A POST that re-sends an
  // empty secret means "keep the stored value"; the literal 'CLEAR' clears it.
  const SENSITIVE_KEYS = ['aiApiKey', 'ttsApiKey'];
  const SECRET_PATHS = ['/api/settings', '/api/ai/config'];
  const maskSecretValue = (value) => {
    const text = String(value || '');
    return text ? `••••${text.slice(-4)}` : '';
  };
  const maskSecrets = (value, depth = 0) => {
    if (Array.isArray(value)) return depth >= 4 ? value : value.map((entry) => maskSecrets(entry, depth + 1));
    if (!value || typeof value !== 'object' || depth >= 4) return value;
    const clone = { ...value };
    for (const key of SENSITIVE_KEYS) {
      if (typeof clone[key] === 'string') {
        if (clone[key] && !clone[`${key}Masked`]) clone[`${key}Masked`] = maskSecretValue(clone[key]);
        clone[key] = '';
      }
    }
    for (const [key, child] of Object.entries(clone)) {
      if (child && typeof child === 'object') clone[key] = maskSecrets(child, depth + 1);
    }
    return clone;
  };
  app.use((req, res, next) => {
    const respond = res.json.bind(res);
    res.json = (payload) => respond(maskSecrets(payload));
    next();
  });
  app.use(SECRET_PATHS, express.json({ limit: '2mb' }));
  app.use(SECRET_PATHS, async (req, res, next) => {
    if (req.method !== 'POST' || !req.body || typeof req.body !== 'object') return next();
    for (const key of SENSITIVE_KEYS) {
      if (!(key in req.body)) continue;
      const value = req.body[key];
      if (value === 'CLEAR') { req.body[key] = ''; continue; }
      if (value !== '' && value !== null && value !== undefined) continue;
      if (req.baseUrl === '/api/settings') { delete req.body[key]; continue; }
      // /api/ai/config always writes an explicit patch, so dropping the field is
      // not enough: substitute the stored value instead of wiping it. If the
      // store cannot be read, fail closed rather than clearing the key.
      try {
        const stored = await (store || require('./store')).getSettings();
        req.body[key] = String(stored?.[key] || '');
      } catch (error) {
        return res.status(500).json({ error: 'Khong doc duoc settings de giu key' });
      }
    }
    next();
  });
  app.use((req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (payload) => originalJson(maskSecrets(payload));
    next();
  });
  app.post('/api/auth/logout', webAuth.logout);
  app.get('/api/auth/session', (_req, res) => res.json({ ok: true }));
  // Quản lý người dùng Supabase: chỉ owner (hoặc phiên pdb break-glass) mới vào được.
  app.get('/api/auth/users', supabase.requireOwner, supabase.listHandler);
  app.post('/api/auth/users/decide', supabase.requireOwner, express.json({ limit: '4kb' }), supabase.decideHandler);
  app.get('/api/env', (req, res) => res.json({ serverUrl: env.WEB_ALLOWED_ORIGIN || `${scheme(req)}://${req.get('host')}`, pancakeUrl: env.PREFERRED_PANCAKE_URL || 'https://pages.fm/' }));
  const leaseView = value => value ? { lease: { owner: value.owner, expiresAt: new Date(value.expiresAt).toISOString() } } : { lease: null };
  app.get('/api/bot-lease', (_req, res) => res.json(leaseView(lease.current())));
  app.post('/api/bot-lease', express.json({ limit: '4kb' }), (req, res) => {
    const { machineId, action = 'acquire' } = req.body || {};
    if (typeof machineId !== 'string' || !machineId.trim() || machineId.length > 256 || !['acquire', 'release', 'extend'].includes(action)) return res.status(400).json({ error: 'Lease khong hop le' });
    const result = lease[action](machineId);
    if (!result.ok) return res.json({ ok: false, holder: result.holder, expiresAt: result.expiresAt ? new Date(result.expiresAt).toISOString() : undefined });
    return res.json(action === 'release' ? { ok: true } : { ok: true, lease: { owner: result.owner, expiresAt: new Date(result.expiresAt).toISOString() } });
  });
  app.use(express.static(webRoot));
  app.get('/', (_req, res) => res.sendFile(path.resolve(webRoot, 'index.html')));
  const { createApp } = require('./index');
  app.use(appFactory ? appFactory({ telegramBot }) : createApp({ authToken: '', telegramBot }));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    res.status(error.status === 413 ? 413 : error.status === 400 ? 400 : 500).json({ error: 'Yeu cau khong hop le' });
  });
  return app;
}

function startWebServer({ env = process.env, logger = console, telegramBot, ...options } = {}) {
  const host = env.WEB_BIND_HOST || '127.0.0.1';
  const publicBind = !['127.0.0.1', 'localhost', '::1'].includes(host);
  if (publicBind && env.WEB_ALLOW_PUBLIC !== '1') {
    const message = 'Public web binding requires Admin-confirmed HTTPS/reverse proxy and WEB_ALLOW_PUBLIC=1';
    logger.warn(message);
    throw new Error(message);
  }
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  const app = createWebApp({ ...options, env, telegramBot });
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      logger.log(`[web] listening on ${host}:${server.address().port}`);
      if (publicBind) {
        logger.warn('[web] Public binding enabled; configure HTTPS reverse proxy');
        try {
          Promise.resolve((telegramBot || require('./telegram')).notifySystemAlert({ title: 'Public web binding', message: `Web server on ${host}:${server.address().port}; verify HTTPS reverse proxy` })).catch(() => logger.warn('[web] Telegram alert failed'));
        } catch (_) { logger.warn('[web] Telegram alert failed'); }
      }
      // Telegram remote-control parity (/status, /baocao, duyet review-queue):
      // same wiring as startServer in index.js. Do NOT run the desktop app and
      // `npm run web` at the same time on one Telegram token (long-poll clash
      // and duplicate daily reports) — set WEB_TELEGRAM_POLLING=0 on the web
      // side when the desktop app owns the token.
      if (String(env.WEB_TELEGRAM_POLLING ?? '1') !== '0') {
        try {
          const telegram = telegramBot || require('./telegram');
          const store = require('./store');
          telegram.notifyServerUp(port).catch(() => {});
          telegram.scheduleDailyReport(store.getLogs);
          const stopPolling = telegram.startTelegramPolling({
            getSettings: store.getSettings,
            saveSettings: store.saveSettings,
            getLogs: store.getLogs,
            markReviewItemDone: store.markReviewItemDone,
            deleteReviewItem: store.deleteReviewItem,
            appendLog: store.appendLog
          });
          server.on('close', () => { if (typeof stopPolling === 'function') stopPolling(); });
        } catch (error) { logger.warn('[web] Telegram wiring skipped:', error.message); }
      } else {
        logger.log('[web] WEB_TELEGRAM_POLLING=0 — remote control stays with the desktop app');
      }
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  try { startWebServer().catch(() => { console.error('[web] Startup failed'); process.exitCode = 1; }); }
  catch (error) { console.error(`[web] ${error.message}`); process.exitCode = 1; }
}
module.exports = { startWebServer, createWebApp };
