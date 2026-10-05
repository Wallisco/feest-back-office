'use strict';
/**
 * Staff login: email and password, scrypt hashes, lockout after 5 failed tries for 15 minutes.
 * Sessions live in Postgres (connect-pg-simple), so restarts and PM2 reloads don't log people out.
 */
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');
const { audit } = require('./audit');

const scrypt = promisify(crypto.scrypt);
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(pw), salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, s, k] = stored.split('$');
  const key = await scrypt(String(pw), Buffer.from(s, 'base64'), 64);
  const want = Buffer.from(k, 'base64');
  return want.length === key.length && crypto.timingSafeEqual(want, key);
}
function passwordProblem(pw) {
  if (!pw || String(pw).length < 10) return 'Use at least 10 characters.';
  return '';
}

async function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const generic = { error: 'Email or password is wrong.' };
  if (!email || !password) return res.status(400).json(generic);
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const u = rows[0];
  if (!u || !u.active) { await verifyPassword(password, 'scrypt$AAAA$AAAA').catch(() => {}); return res.status(401).json(generic); }
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    return res.status(423).json({ error: `Too many tries. Try again after ${new Date(u.locked_until).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Johannesburg' })}.` });
  }
  if (!(await verifyPassword(password, u.password_hash))) {
    const fails = u.failed_logins + 1;
    const lock = fails >= MAX_FAILS;
    await db.query(`UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE NULL END WHERE id = $1`, [u.id, lock ? 0 : fails, lock]);
    return res.status(401).json(generic);
  }
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  await new Promise((ok, bad) => req.session.regenerate((e) => (e ? bad(e) : ok())));
  req.session.userId = u.id;
  await audit(db, { actorId: u.id, action: 'login', entity: 'user', entityId: u.id, ip: req.ip });
  res.json({ ok: true });
}

function logout(req, res) {
  req.session.destroy(() => { res.clearCookie('feest.sid'); res.json({ ok: true }); });
}

/** Loads req.user or answers 401. */
async function requireUser(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Sign in again.' });
  const { rows } = await db.query('SELECT id, name, email, mobile, role, active FROM users WHERE id = $1', [req.session.userId]);
  if (!rows[0] || !rows[0].active) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Sign in again.' }); }
  req.user = rows[0];
  next();
}

module.exports = { hashPassword, verifyPassword, passwordProblem, login, logout, requireUser };
