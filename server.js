'use strict';
// FEEST Back Office: app entry. Same shape as the ScootHero Back Office:
// Express, Postgres, sessions in Postgres, staff login, role-checked API, files from storage.
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const path = require('path');

const required = ['DATABASE_URL', 'SESSION_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exit(1); }

const db = require('./src/lib/db');
const storage = require('./src/lib/storage');
const { login, logout } = require('./src/lib/auth');
const { router: vendorApi } = require('./src/vendors/routes');
const { router: metricsApi } = require('./src/metrics/routes');

const app = express();
app.set('trust proxy', 1); // behind Nginx
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  next();
});

// Public: the FEEST Sales Toolkit (no login, no data stored server-side).
app.get(['/toolkit', '/toolkit/'], (req, res) => res.sendFile(path.join(__dirname, 'public/toolkit/index.html'), { headers: { 'Cache-Control': 'public, max-age=300' } }));

// Static: shared maths and checklist (the same files the server uses), styles, app scripts.
const pub = (dir) => express.static(dir, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, index: false });
app.use('/static', pub(path.join(__dirname, 'public/static')));
app.use('/static/styles', pub(path.join(__dirname, 'src/styles')));
app.get('/static/finance.js', (req, res) => res.type('js').sendFile(path.join(__dirname, 'src/vendors/finance.js')));
app.get('/static/checklist.js', (req, res) => res.type('js').sendFile(path.join(__dirname, 'src/vendors/checklist.js')));

app.use(session({
  store: new PgSession({ pool: db.pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  name: 'feest.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 12 * 60 * 60 * 1000 },
}));

app.get('/healthz', async (req, res) => {
  try {
    const r = await db.query('SELECT (SELECT count(*) FROM schema_migrations) AS migrations');
    res.json({ ok: true, migrations: Number(r.rows[0].migrations), version: process.env.APP_VERSION || 'dev' });
  } catch (e) {
    res.status(503).json({ ok: false });
  }
});

// Login
const loginLimiter = new Map(); // ip → [timestamps]; Nginx rate-limits too
app.post('/auth/login', express.json({ limit: '10kb' }), (req, res, next) => {
  const now = Date.now(), hits = (loginLimiter.get(req.ip) || []).filter((t) => now - t < 60_000);
  hits.push(now); loginLimiter.set(req.ip, hits);
  if (hits.length > 10) return res.status(429).json({ error: 'Too many tries from this device. Wait a minute.' });
  login(req, res).catch(next);
});
app.post('/auth/logout', logout);
app.get('/login', (req, res) => (req.session.userId ? res.redirect('/') : res.sendFile(path.join(__dirname, 'public/login.html'))));

// Files: staff only, streamed from storage (never served straight off disk).
app.get(/^\/files\/(.+)$/, async (req, res) => {
  const key = decodeURIComponent(req.params[0]);
  const signed = req.query.sig && storage.verifySignature(key, req.query.exp, req.query.sig);
  if (!signed && !(req.session && req.session.userId)) return res.status(401).send('Sign in to see this file.');
  if (!/^(vendor-photos|signatures)\//.test(key)) return res.status(404).end();
  try {
    const buf = await storage.get(key);
    const ext = path.extname(key).slice(1).toLowerCase();
    res.type({ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' }[ext] ? `image/${{ jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp' }[ext]}` : 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=86400').send(buf);
  } catch (e) {
    res.status(404).send('File not found.');
  }
});

// API (JSON). Photos and signatures arrive as data URLs, so allow a few MB.
app.use('/api', metricsApi);
app.use('/api', express.json({ limit: '8mb' }), vendorApi);

// The app shell: every other page is the single-page back office.
app.get(['/', '/app'], (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.set('Cache-Control', 'no-store').sendFile(path.join(__dirname, 'public/app.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error(`[app] ${req.method} ${req.path}: ${err.message}`);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT) || 3100;
const host = process.env.HOST || '127.0.0.1';
const server = app.listen(port, host, () => console.log(`FEEST back office listening on ${host}:${port}`));

const close = () => new Promise((resolve) => server.close(() => db.pool.end().then(resolve)));
const shutdown = () => close().then(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { app, server, close };
