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

function createAuth({ token, sessionTtlMs = 72 * 3600000, rateWindowMs = 60000, rateMax = 10, now = Date.now } = {}) {
  if (typeof token !== 'string' || !token.trim()) throw new TypeError('Auth token is required');
  positive(sessionTtlMs, 'sessionTtlMs');
  positive(rateWindowMs, 'rateWindowMs');
  positive(rateMax, 'rateMax');
  const expected = crypto.createHash('sha256').update(token).digest();
  const sessions = new Map();
  const attempts = new Map();
  function prune() {
    const time = now();
    for (const [id, expiry] of sessions) if (expiry <= time) sessions.delete(id);
    for (const [ip, attempt] of attempts) if (attempt.expiresAt <= time) attempts.delete(ip);
  }
  function cookie(req, id, maxAge) {
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
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
  async function login(req, res) {
    prune();
    // Socket identity prevents rate-limit bypass via spoofed X-Forwarded-For.
    const ip = req.socket?.remoteAddress || 'unknown';
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
    const supplied = crypto.createHash('sha256').update(body.token).digest();
    if (!crypto.timingSafeEqual(supplied, expected)) {
      attempts.set(ip, { count: (attempt?.count || 0) + 1, expiresAt: attempt?.expiresAt ?? now() + rateWindowMs });
      return json(res, 401, { error: 'Sai token' });
    }
    attempts.delete(ip);
    const id = crypto.randomBytes(32).toString('hex');
    sessions.delete(parseCookie(req.headers.cookie).pdb_session);
    sessions.set(id, now() + sessionTtlMs);
    res.setHeader('Set-Cookie', cookie(req, id, Math.floor(sessionTtlMs / 1000)));
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
  return { login, requireAuth, logout, session };
}

function createLease({ ttlMs = 60000, now = Date.now } = {}) {
  positive(ttlMs, 'ttlMs');
  let lease = null;
  // ponytail: process-local soft lease; use a DB for multiple server processes.
  // Client-provided owner is not a trusted identity or authorization boundary.
  function current() {
    if (lease && lease.expiresAt <= now()) lease = null;
    return lease ? { ...lease } : null;
  }
  function change(owner, action) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 256) throw new TypeError('Invalid lease owner');
    const held = current();
    if (held && held.owner !== owner) return { ok: false, holder: held.owner, expiresAt: held.expiresAt };
    if (action === 'release') { lease = null; return { ok: true }; }
    // Frozen §4ter: acquire and extend behave identically when the lease is
    // free or expired (re-acquire); conflict with another owner still fails
    // closed above, so double-send stays prevented.
    lease = { owner, expiresAt: now() + ttlMs };
    return { ok: true, ...lease };
  }
  return { acquire: owner => change(owner, 'acquire'), release: owner => change(owner, 'release'), extend: owner => change(owner, 'extend'), current };
}

module.exports = { createAuth, createLease, parseCookie };
