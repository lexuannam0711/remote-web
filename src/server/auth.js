const crypto = require('node:crypto');

function parseCookie(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const i = part.indexOf('=');
    if (i < 1) return cookies;
    const name = part.slice(0, i).trim();
    if (!name || ['__proto__', 'constructor', 'prototype'].includes(name) || Object.hasOwn(cookies, name)) return cookies;
    return { ...cookies, [name]: part.slice(i + 1).trim() };
  }, {});
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${name} must be positive`);
}

function createAuth({ token, sessionTtlMs = 72 * 3600000, rateWindowMs = 60000, rateMax = 10, now = Date.now, ipOf = (req) => req.socket?.remoteAddress || 'unknown' } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('Auth token is required');
  positive(sessionTtlMs, 'sessionTtlMs');
  positive(rateWindowMs, 'rateWindowMs');
  positive(rateMax, 'rateMax');
  const expected = crypto.createHash('sha256').update(token).digest();
  // Phiên mang theo principal ({kind:'pdb'} cho token cổ điển, hoặc Supabase
  // {kind:'supabase', userId, email, owner}) để các route owner-only biết ai
  // đang giữ cookie; bản thân Map vẫn là nội bộ, không lộ ra response nào.
  const sessions = new Map();
  const attempts = new Map();
  function prune() {
    const time = now();
    for (const [id, entry] of sessions) if (entry.expiresAt <= time) sessions.delete(id);
    for (const [ip, attempt] of attempts) if (attempt.expiresAt <= time) attempts.delete(ip);
  }
  function cookie(req, id, maxAge) {
    const secure = req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    return `pdb_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
  async function readBody(req) {
    if (req.body !== undefined) return req.body;
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 4096) throw Object.assign(new Error('Body too large'), { status: 413 });
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function verifyToken(candidate) {
    if (typeof candidate !== 'string' || !candidate) return false;
    const supplied = crypto.createHash('sha256').update(candidate).digest();
    return crypto.timingSafeEqual(supplied, expected);
  }
  // Cấp phiên cho principal đã xác thực (pdb hoặc Supabase); thay phiên cũ của
  // cùng cookie để chống fixation, giữ nguyên flag cookie HttpOnly/Strict.
  function issue(req, res, principal) {
    prune();
    const id = crypto.randomBytes(32).toString('hex');
    sessions.delete(parseCookie(req.headers.cookie).pdb_session);
    sessions.set(id, { expiresAt: now() + sessionTtlMs, principal });
    res.setHeader('Set-Cookie', cookie(req, id, Math.floor(sessionTtlMs / 1000)));
    return id;
  }
  function principal(req) {
    prune();
    const entry = sessions.get(parseCookie(req.headers.cookie).pdb_session);
    return entry ? entry.principal : null;
  }
  async function login(req, res) {
    prune();
    // ipOf isolates buckets (per-socket by default; X-Forwarded-For when TRUST_PROXY=1).
    const ip = ipOf(req);
    const attempt = attempts.get(ip);
    if (attempt && attempt.count >= rateMax) {
      res.setHeader('Retry-After', Math.max(1, Math.ceil((attempt.expiresAt - now()) / 1000)));
      return json(res, 429, { error: 'Qua nhieu lan thu' });
    }
    let body;
    try { body = await readBody(req); } catch (error) {
      return json(res, error.status || 400, { error: 'JSON khong hop le' });
    }
    if (!body || typeof body.token !== 'string') return json(res, 400, { error: 'Token khong hop le' });
    if (!verifyToken(body.token)) {
      attempts.set(ip, { count: (attempt?.count || 0) + 1, expiresAt: attempt?.expiresAt ?? now() + rateWindowMs });
      return json(res, 401, { error: 'Sai token' });
    }
    attempts.delete(ip);
    issue(req, res, { kind: 'pdb' });
    return json(res, 200, { ok: true });
  }
  function session(req) {
    prune();
    return sessions.has(parseCookie(req.headers.cookie).pdb_session);
  }
  function requireAuth(req, res, next) {
    return session(req) ? next() : json(res, 401, { error: 'Chua dang nhap' });
  }
  function logout(req, res) {
    sessions.delete(parseCookie(req.headers.cookie).pdb_session);
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    return json(res, 200, { ok: true });
  }
  return { login, requireAuth, logout, session, issue, principal, verifyToken };
}

function createLease({ ttlMs = 60000, now = Date.now } = {}) {
  positive(ttlMs, 'ttlMs');
  // Mỗi user (scope do server xác định từ session) giữ lease riêng, nên nhiều
  // user có thể chạy bot trên máy/trình duyệt của mình. Trong cùng một scope,
  // machineId vẫn loại trừ lẫn nhau để chống double-send.
  // ponytail: process-local soft lease; use a DB for multiple server processes.
  // Client-provided owner is not a trusted identity or authorization boundary.
  const leases = new Map();
  function current(scope = '') {
    const lease = leases.get(scope);
    if (!lease) return null;
    if (lease.expiresAt <= now()) { leases.delete(scope); return null; }
    return { ...lease };
  }
  function change(scope, owner, action) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 256) throw new TypeError('Invalid lease owner');
    const held = current(scope);
    if (held && held.owner !== owner) return { ok: false, holder: held.owner, expiresAt: held.expiresAt };
    if (action === 'release') { leases.delete(scope); return { ok: true }; }
    // Frozen §4ter: acquire and extend behave identically when the lease is
    // free or expired (re-acquire); conflict with another owner still fails
    // closed above, so double-send stays prevented.
    const lease = { owner, expiresAt: now() + ttlMs };
    leases.set(scope, lease);
    return { ok: true, ...lease };
  }
  return {
    acquire: (owner, scope = '') => change(scope, owner, 'acquire'),
    release: (owner, scope = '') => change(scope, owner, 'release'),
    extend: (owner, scope = '') => change(scope, owner, 'extend'),
    current
  };
}

module.exports = { createAuth, createLease, parseCookie };
