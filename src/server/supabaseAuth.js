// Cầu nối đăng nhập Supabase cho mặt phẳng Web (npm run web).
//
// Máy trạng thái 3 chế độ (frozen contract, xem CLAUDE.md mục 7):
//   unconfigured — chưa cấu hình env Supabase → hành vi pdb token cổ điển 100%.
//   bootstrap    — đã cấu hình, CHƯA bind chủ → pdb + tài khoản Supabase, CHỈ 1 LẦN.
//   active       — đã có owner → chỉ Supabase; pdb bị chặn 410, trừ break-glass
//                  WEB_PDB_EMERGENCY=1 (có log WARN kiểm toán).
// User Supabase hợp lệ nhưng chưa được owner duyệt sẽ rơi vào hàng đợi pending
// và bị từ chối phiên (403 {status:'pending'}).
//
// Bí mật: chỉ dùng ANON key (public theo thiết kế Supabase). KHÔNG dùng service
// key. access_token / pdb token KHÔNG BAO GIỜ được ghi vào log hay file.

const crypto = require('node:crypto');

function hostIsSupabase(hostname) {
  return /(^|\.)supabase\.(co|in)$/i.test(hostname);
}

// Chỉ nhận https + host Supabase thật + không có userinfo: chặn việc cấu hình
// trỏ anon key (và access token của người dùng) tới host lạ.
function resolveSupabaseConfig(env = {}) {
  const url = String(env.WEB_SUPABASE_URL || '').trim();
  const anonKey = String(env.WEB_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) return null;
  let parsed;
  try { parsed = new URL(url); } catch (_) { return null; }
  if (parsed.protocol !== 'https:' || !hostIsSupabase(parsed.hostname)) return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return null;
  return { url: `${parsed.protocol}//${parsed.host}`, anonKey };
}

function createSupabaseVerifier({ config, fetchImpl, timeoutMs = 6000 } = {}) {
  const fetchFn = fetchImpl || ((...args) => fetch(...args));
  async function verify(accessToken) {
    if (typeof accessToken !== 'string' || !accessToken.trim() || accessToken.length > 8192) {
      return { ok: false, code: 'invalid_token' };
    }
    let response;
    try {
      response = await fetchFn(`${config.url}/auth/v1/user`, {
        method: 'GET',
        headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}` },
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(timeoutMs)
          : undefined,
      });
    } catch (_) {
      return { ok: false, code: 'unreachable' };
    }
    if (response.status === 401 || response.status === 403) return { ok: false, code: 'invalid_token' };
    if (!response.ok) return { ok: false, code: 'unreachable' };
    let user;
    try { user = await response.json(); } catch (_) { return { ok: false, code: 'invalid_response' }; }
    const userId = String(user?.id || '').trim();
    if (!userId || userId.length > 64) return { ok: false, code: 'invalid_response' };
    return { ok: true, userId, email: String(user?.email || '').slice(0, 320) };
  }
  return { verify };
}

// Bộ đếm giới hạn thô theo IP, đồng nhất luật với createAuth.login
// (chống brute-force token/accessToken; hỗ trợ ipOf khi đứng sau proxy).
function createGuard({ windowMs = 60000, max = 10, now = Date.now, ipOf = (req) => req.socket?.remoteAddress || 'unknown' } = {}) {
  const attempts = new Map();
  function prune() {
    const time = now();
    for (const [ip, entry] of attempts) if (entry.expiresAt <= time) attempts.delete(ip);
  }
  function remaining(req) {
    const entry = attempts.get(ipOf(req));
    return entry && entry.count >= max ? Math.max(1, Math.ceil((entry.expiresAt - now()) / 1000)) : 0;
  }
  function fail(req) {
    const ip = ipOf(req);
    prune();
    const entry = attempts.get(ip);
    attempts.set(ip, { count: (entry?.count || 0) + 1, expiresAt: entry?.expiresAt ?? now() + windowMs });
  }
  function clear(req) { attempts.delete(ipOf(req)); }
  return { remaining, fail, clear, prune };
}

function createSupabaseAuth({ config, auth, env = {}, state, fetchImpl, timeoutMs, now = Date.now, logger = console, ipOf } = {}) {
  const verifier = createSupabaseVerifier({ config, fetchImpl, timeoutMs });
  const guard = createGuard({ now, ipOf });
  const emergencyEnabled = () => String(env.WEB_PDB_EMERGENCY || '') === '1';

  async function loadState() {
    try { return await state.load(); } catch (_) { return null; }
  }

  function modeOf(current) {
    if (!config) return 'unconfigured';
    return current?.status === 'active' && current?.owner?.userId ? 'active' : 'bootstrap';
  }

  function publicUser(entry) {
    return { userId: entry.userId, email: entry.email || '', status: entry.status || 'pending', addedAt: entry.addedAt || null, decidedAt: entry.decidedAt || null };
  }

  // Owner = người bind ở bootstrap; pdb principal (login cổ điển / break-glass)
  // cũng được quản lý user vì nó là quyền tối cao của máy chủ này.
  function isOwner(req) {
    const principal = auth.principal(req);
    if (!principal) return false;
    return principal.kind === 'pdb' || principal.owner === true;
  }

  function readCredentials(req) {
    const body = req.body;
    if (!body || typeof body !== 'object') return null;
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
    const token = typeof body.token === 'string' ? body.token : '';
    if (body.token !== undefined && typeof body.token !== 'string') return null;
    if (body.accessToken !== undefined && typeof body.accessToken !== 'string') return null;
    return { accessToken, token };
  }

  function denied(res, status, error, extra = {}) {
    return res.status(status).json({ ok: false, error, ...extra });
  }

  async function modeHandler(_req, res) {
    if (!config) return res.json({ mode: 'unconfigured', supabaseUrl: null, supabaseAnonKey: null, emergencyPdb: false });
    const current = await loadState();
    return res.json({
      mode: modeOf(current),
      supabaseUrl: config.url,
      supabaseAnonKey: config.anonKey,
      emergencyPdb: modeOf(current) === 'active' && emergencyEnabled(),
    });
  }

  // Đăng nhập đầu tiên & duy nhất dùng pdb: bind chủ máy (owner) từ tài khoản
  // Supabase vừa verify. Sau bước này pdb không còn đường vào thường.
  async function bootstrapHandler(req, res, next) {
    if (!config) return denied(res, 404, 'Chua bat dang nhap Supabase');
    const wait = guard.remaining(req);
    if (wait) { res.set('Retry-After', String(wait)); return denied(res, 429, 'Qua nhieu lan thu'); }
    const credentials = readCredentials(req);
    if (!credentials || !credentials.token || !credentials.accessToken) { guard.fail(req); return denied(res, 400, 'Thieu token hoac accessToken'); }
    const current = await loadState();
    if (modeOf(current) === 'active') return denied(res, 410, 'Da bind owner');
    if (!auth.verifyToken(credentials.token)) { guard.fail(req); return denied(res, 401, 'Sai token'); }
    const verified = await verifier.verify(credentials.accessToken);
    if (!verified.ok) { guard.fail(req); return verified.code === 'unreachable' ? denied(res, 503, 'Khong ket noi duoc Supabase') : denied(res, 401, 'Tai khoan Supabase khong hop le'); }
    guard.clear(req);
    const boundAt = new Date(now()).toISOString();
    const next_ = { version: 1, status: 'active', owner: { userId: verified.userId, email: verified.email, boundAt }, users: [] };
    await state.save(next_);
    auth.issue(req, res, { kind: 'supabase', userId: verified.userId, email: verified.email, owner: true });
    logger.log('[web] Supabase owner bound — WEB_ACCESS_TOKEN khong con dung cho dang nhap thuong');
    return res.json({ ok: true, mode: 'active', owner: true });
  }

  // Đăng nhập thường sau bootstrap: chỉ cần tài khoản Supabase đã được duyệt.
  async function loginHandler(req, res, next) {
    if (!config) return denied(res, 404, 'Chua bat dang nhap Supabase');
    const wait = guard.remaining(req);
    if (wait) { res.set('Retry-After', String(wait)); return denied(res, 429, 'Qua nhieu lan thu'); }
    const credentials = readCredentials(req);
    if (!credentials || !credentials.accessToken) { guard.fail(req); return denied(res, 400, 'Thieu accessToken'); }
    const current = await loadState();
    if (modeOf(current) === 'bootstrap') return denied(res, 409, 'Can dang nhap lan dau (bootstrap) voi pdb');
    const verified = await verifier.verify(credentials.accessToken);
    if (!verified.ok) { guard.fail(req); return verified.code === 'unreachable' ? denied(res, 503, 'Khong ket noi duoc Supabase') : denied(res, 401, 'Tai khoan Supabase khong hop le'); }
    guard.clear(req);
    const owner = verified.userId === current.owner.userId;
    const record = (current.users || []).find((entry) => entry.userId === verified.userId);
    if (!owner) {
      if (!record) {
        const users = [...(current.users || []), { userId: verified.userId, email: verified.email, status: 'pending', addedAt: new Date(now()).toISOString(), decidedAt: null }].slice(-200);
        await state.save({ ...current, users });
        return denied(res, 403, 'Cho owner duyet', { status: 'pending' });
      }
      if (record.status !== 'approved') return denied(res, 403, 'Cho owner duyet', { status: record.status });
    }
    auth.issue(req, res, { kind: 'supabase', userId: verified.userId, email: verified.email, owner });
    return res.json({ ok: true, owner });
  }

  function requireOwnerMiddleware(req, res, next) {
    return isOwner(req) ? next() : denied(res, 403, 'Chi owner duoc phep');
  }

  async function listHandler(_req, res) {
    const current = await loadState();
    return res.json({
      mode: modeOf(current),
      owner: current?.owner ? { userId: current.owner.userId, email: current.owner.email || '' } : null,
      users: (current?.users || []).map(publicUser),
      pending: (current?.users || []).filter((entry) => entry.status === 'pending').length,
    });
  }

  async function decideHandler(req, res) {
    const body = req.body;
    const userId = String(body?.userId || '').trim();
    const decision = body?.decision;
    if (!userId || userId.length > 64 || !['approve', 'reject'].includes(decision)) return denied(res, 400, 'Yeu cau khong hop le');
    const current = await loadState();
    if (modeOf(current) !== 'active') return denied(res, 409, 'Chua bind owner');
    if (userId === current.owner.userId) return denied(res, 400, 'Khong doi duoc owner');
    const users = [];
    let touched = false;
    for (const entry of current.users || []) {
      if (entry.userId !== userId) { users.push(entry); continue; }
      touched = true;
      if (decision === 'approve') users.push({ ...entry, status: 'approved', decidedAt: new Date(now()).toISOString() });
    }
    if (!touched) return denied(res, 404, 'Khong thay user cho duyet');
    await state.save({ ...current, users });
    return res.json({ ok: true, users: users.map(publicUser) });
  }

  // Login pdb cổ điển: còn sống ở chế độ unconfigured (toàn bộ hành vi cũ) và
  // bootstrap (làm bước verify chủ); ở chế độ active thì chết trừ break-glass.
  async function legacyLoginHandler(req, res, next) {
    const current = await loadState();
    const mode = modeOf(current);
    if (mode === 'active' && !emergencyEnabled()) {
      return denied(res, 410, 'Dang nhap bang WEB_ACCESS_TOKEN da ngung; dung Supabase');
    }
    if (mode === 'active' && emergencyEnabled()) {
      logger.warn('[web] Break-glass WEB_PDB_EMERGENCY=1: phien dang nhap bang pdb token');
    }
    return auth.login(req, res, next);
  }

  return {
    get mode() { return modeOf; },
    modeHandler,
    bootstrapHandler,
    loginHandler,
    listHandler,
    decideHandler,
    requireOwner: requireOwnerMiddleware,
    legacyLoginHandler,
    isOwner,
  };
}

module.exports = { resolveSupabaseConfig, createSupabaseVerifier, createSupabaseAuth, createGuard, hostIsSupabase };
