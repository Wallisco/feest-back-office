'use strict';
/** Overview dashboard API: role-checked, read-only, cached briefly so many viewers cost one query. */
const express = require('express');
const db = require('../lib/db');
const { requireUser } = require('../lib/auth');
const P = require('../vendors/permissions');
const F = require('../vendors/finance');
const { dashboard } = require('./dashboard');

const router = express.Router();

const cache = new Map(); // key → { at, body }
const TTL = 60_000;
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

router.get('/dashboard', requireUser, async (req, res, next) => {
  try {
    if (!P.canSeeOverview(req.user)) return res.status(403).json({ error: "Your role can't see the overview. Ask a sales lead or admin." });
    const f = {
      days: [7, 30, 60, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30,
      region: String(req.query.region || '').slice(0, 80),
      areaId: isUuid(req.query.area) ? req.query.area : null,
      today: new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }),
    };
    const key = JSON.stringify(f);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL && req.query.fresh === undefined) return res.json(hit.body);
    const s = (await db.query(`SELECT value FROM settings WHERE key = 'pricing'`)).rows[0];
    const body = await dashboard(db, f, F.pricing(s && s.value));
    cache.set(key, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    res.json(body);
  } catch (e) { next(e); }
});

module.exports = { router };
