'use strict';
/**
 * Vendors module API. Every route: load the user (requireUser), check the role on the server,
 * do the action in a transaction, write audit_log, recalculate the stage.
 */
const express = require('express');
const db = require('../lib/db');
const storage = require('../lib/storage');
const mail = require('../lib/mail');
const { audit } = require('../lib/audit');
const { requireUser, hashPassword, verifyPassword, passwordProblem } = require('../lib/auth');
const F = require('./finance');
const { installItems, missingForLive } = require('./checklist');
const { STAGES, stageFor } = require('./stages');
const P = require('./permissions');
const { shape, termsFor, packEmail } = require('./terms');
const { buildPackPdf } = require('./pack-pdf');

const router = express.Router();
router.use(requireUser);

// ---------- helpers ----------
class HttpError extends Error { constructor(status, msg, code) { super(msg); this.status = status; this.code = code; } }
const bad = (msg) => new HttpError(400, msg);
const deny = () => new HttpError(403, "Your role can't do this. Ask a sales lead or admin.");
const notFound = (what = 'Vendor') => new HttpError(404, `${what} not found.`);
const conflict = (msg) => new HttpError(409, msg);
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);

const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const int = (v, min = 0, max = 100000) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const num = (v, min = 0, max = 1e9) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; };
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const todaySA = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
const MODEL_KEYS = F.MODELS.map((m) => m.key);
const SERVICE_KEYS = F.SERVICES.map((s) => s.key);

async function settings(c = db) {
  const { rows } = await c.query(`SELECT key, value FROM settings WHERE key IN ('pricing','print')`);
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { pricing: F.pricing(m.pricing), print: F.printList(m.print && m.print.items) };
}
async function wording(c = db) {
  const { rows } = await c.query('SELECT version, text FROM agreement_wordings ORDER BY version DESC LIMIT 1');
  return rows[0];
}

const VENDOR_SQL = `
  SELECT v.*, a.name AS area_name, a.city AS area_city, u.name AS rep_name, u.email AS rep_email,
         o.name AS owner_name, o.reg_no AS owner_reg_no, o.contact_name AS owner_contact_name, o.title AS owner_title,
         o.email AS owner_email, o.mobile AS owner_mobile,
         COALESCE((SELECT array_agg(user_id) FROM area_reps ar WHERE ar.area_id = v.area_id), '{}') AS area_rep_ids
  FROM vendors v JOIN areas a ON a.id = v.area_id JOIN users u ON u.id = v.rep_id JOIN owners o ON o.id = v.owner_id`;

async function loadVendor(c, id, lock = false) {
  if (!isUuid(id)) throw notFound();
  const { rows } = await c.query(`${VENDOR_SQL} WHERE v.id = $1 ${lock ? 'FOR UPDATE OF v' : ''}`, [id]);
  if (!rows[0]) throw notFound();
  return rows[0];
}
async function activeAgreement(c, vendorId) {
  const { rows } = await c.query(`SELECT * FROM agreements WHERE vendor_id = $1 AND status = 'active'`, [vendorId]);
  return rows[0] || null;
}
/** Recalculate and store the stage from the facts. The only place vendors.stage is written. */
async function restage(c, vendorId) {
  const v = (await c.query('SELECT * FROM vendors WHERE id = $1', [vendorId])).rows[0];
  const ag = await activeAgreement(c, vendorId);
  const stage = stageFor({ closedAt: v.closed_at, liveAt: v.live_at, signedOffOn: v.signed_off_on, hasAgreement: !!ag, toolkitCompletedAt: v.toolkit_completed_at });
  await c.query('UPDATE vendors SET stage = $2, updated_at = now() WHERE id = $1', [vendorId, stage]);
  return stage;
}
const lockedByAgreement = async (c, v) => { if (await activeAgreement(c, v.id)) throw conflict('An agreement is signed on these terms. Void it first to change them.'); };

function fileUrl(key) { return key ? `/files/${key.split('/').map(encodeURIComponent).join('/')}` : ''; }
function photosOut(p) { const o = {}; for (const [k, v] of Object.entries(p || {})) if (v) o[k] = fileUrl(v); return o; }

/** Vendor for the browser: camelCase, files as URLs. */
function vendorOut(v, ag, user) {
  const areaReps = v.area_rep_ids || [];
  return {
    id: v.id, name: v.name, category: v.category, areaId: v.area_id, repId: v.rep_id, ownerId: v.owner_id, stage: v.stage,
    address: v.address, pin: { lat: Number(v.lat), lng: Number(v.lng), accuracy: v.pin_accuracy_m === null ? null : Number(v.pin_accuracy_m), source: v.pin_source, capturedAt: v.pin_captured_at },
    storePhone: v.store_phone, whatsapp: v.whatsapp, hours: v.hours, notes: v.notes, photos: photosOut(v.photos), photoKeys: v.photos || {},
    firstTouchAt: v.first_touch_at, model: v.model, services: v.services || {}, ownDrivers: v.own_drivers, vehicles: v.vehicles, tables: v.tables,
    toolkit: v.toolkit, toolkitCompletedAt: v.toolkit_completed_at, printQty: v.print_qty || {},
    pack: { emailedAt: v.pack_emailed_at, emailedTo: v.pack_emailed_to, method: v.pack_email_method, signedOffOn: v.signed_off_on, signedOffBy: v.signed_off_by, signoffMethod: v.signoff_method, signoffNote: v.signoff_note },
    install: v.install || {}, liveAt: v.live_at,
    closed: v.closed_at ? { at: v.closed_at, reason: v.closed_reason, note: v.closed_note } : null,
    createdAt: v.created_at, updatedAt: v.updated_at,
    agreement: ag ? { id: ag.id, terms: ag.terms, startDate: ag.start_date, ownerName: ag.owner_name, ownerTitle: ag.owner_title,
      ownerSig: fileUrl(ag.owner_sig_key), repName: ag.rep_name, repSig: fileUrl(ag.rep_sig_key), signedAt: ag.signed_at, wordingVersion: ag.wording_version } : null,
    can: user ? { sell: P.canSell(user, v, areaReps), install: P.canInstall(user, v, areaReps) } : undefined,
  };
}

async function saveImage(dataUrl, folder, maxBytes) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw bad('That image could not be read. Use a JPG or PNG.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw bad(`That image is too large. Keep it under ${Math.round(maxBytes / 1e6)} MB.`);
  return storage.put(buf, { folder, ext: m[1] === 'jpeg' ? 'jpg' : m[1] });
}

// ---------- bootstrap ----------
router.get('/bootstrap', h(async (req, res) => {
  const u = req.user;
  const [users, areas, reps, owners, cats, set, w, vendors, ags] = await Promise.all([
    db.query('SELECT id, name, email, mobile, role, active FROM users ORDER BY name'),
    db.query('SELECT * FROM areas ORDER BY city, name'),
    db.query('SELECT area_id, user_id FROM area_reps'),
    db.query('SELECT id, name, reg_no, contact_name, title, email, mobile FROM owners ORDER BY name'),
    db.query('SELECT name FROM categories ORDER BY sort, name'),
    settings(), wording(),
    db.query(`SELECT id, name, category, area_id, rep_id, owner_id, stage, model, services, own_drivers, vehicles, tables, toolkit, print_qty,
                     pack_emailed_at, signed_off_on, live_at, closed_at, created_at, updated_at FROM vendors ORDER BY updated_at DESC`),
    db.query(`SELECT vendor_id, signed_at, start_date FROM agreements WHERE status = 'active'`),
  ]);
  const repsBy = {};
  reps.rows.forEach((r) => (repsBy[r.area_id] = repsBy[r.area_id] || []).push(r.user_id));
  res.json({
    me: { ...u, can: { manageAreas: P.canManageAreas(u), manageUsers: P.canManageUsers(u), editSettings: P.canEditSettings(u), sell: P.canSell(u, null) } },
    roles: P.ROLES.map((k) => ({ key: k, label: P.ROLE_LABELS[k] })),
    stages: STAGES,
    users: users.rows,
    areas: areas.rows.map((a) => ({ id: a.id, name: a.name, city: a.city, target: a.target, notes: a.notes, reps: repsBy[a.id] || [] })),
    owners: owners.rows.map((o) => ({ id: o.id, name: o.name, regNo: o.reg_no, contactName: o.contact_name, title: o.title, email: o.email, mobile: o.mobile })),
    categories: cats.rows.map((c) => c.name),
    settings: { pricing: set.pricing, print: set.print, wording: w },
    mailConfigured: mail.configured(),
    vendors: vendors.rows.map((v) => ({
      id: v.id, name: v.name, category: v.category, areaId: v.area_id, repId: v.rep_id, ownerId: v.owner_id, stage: v.stage,
      model: v.model, services: v.services, ownDrivers: v.own_drivers, vehicles: v.vehicles, tables: v.tables, toolkit: v.toolkit, printQty: v.print_qty,
      packEmailedAt: v.pack_emailed_at, signedOffOn: v.signed_off_on, liveAt: v.live_at, closedAt: v.closed_at, updatedAt: v.updated_at,
    })),
    agreements: ags.rows.map((a) => ({ vendorId: a.vendor_id, signedAt: a.signed_at, startDate: a.start_date })),
  });
}));

router.get('/vendors/:id', h(async (req, res) => {
  const v = await loadVendor(db, req.params.id);
  res.json(vendorOut(v, await activeAgreement(db, v.id), req.user));
}));

// ---------- uploads (photos) ----------
router.post('/uploads', h(async (req, res) => {
  if (!P.canSell(req.user, null) && !P.canInstall(req.user, null)) throw deny();
  const key = await saveImage(req.body.dataUrl, 'vendor-photos', 4e6);
  res.json({ key, url: fileUrl(key) });
}));

// ---------- Step 1: areas ----------
async function writeArea(req, res, id) {
  if (!P.canManageAreas(req.user)) throw deny();
  const name = str(req.body.name, 120), city = str(req.body.city, 120);
  if (!name) throw bad('Enter the area name.');
  const reps = (Array.isArray(req.body.reps) ? req.body.reps : []).filter(isUuid);
  const target = req.body.target === null || req.body.target === '' || req.body.target === undefined ? null : int(req.body.target, 0, 100000);
  const out = await db.tx(async (c) => {
    let before = null, row;
    if (id) {
      before = (await c.query('SELECT * FROM areas WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!before) throw notFound('Area');
      row = (await c.query('UPDATE areas SET name=$2, city=$3, target=$4, notes=$5, updated_at=now() WHERE id=$1 RETURNING *', [id, name, city, target, str(req.body.notes)])).rows[0];
      await c.query('DELETE FROM area_reps WHERE area_id = $1', [id]);
    } else {
      row = (await c.query('INSERT INTO areas (name, city, target, notes) VALUES ($1,$2,$3,$4) RETURNING *', [name, city, target, str(req.body.notes)])).rows[0];
    }
    for (const r of reps) await c.query('INSERT INTO area_reps (area_id, user_id) SELECT $1, id FROM users WHERE id = $2 ON CONFLICT DO NOTHING', [row.id, r]);
    await audit(c, { actorId: req.user.id, action: id ? 'area.update' : 'area.create', entity: 'area', entityId: row.id, before, after: { ...row, reps }, ip: req.ip });
    return row;
  }).catch((e) => { if (e.code === '23505') throw conflict('That area already exists in this city.'); throw e; });
  res.json({ id: out.id });
}
router.post('/areas', h((req, res) => writeArea(req, res, null)));
router.put('/areas/:id', h((req, res) => { if (!isUuid(req.params.id)) throw notFound('Area'); return writeArea(req, res, req.params.id); }));

// ---------- owners ----------
router.post('/owners', h(async (req, res) => {
  if (!P.canSell(req.user, null) && !P.canManageAreas(req.user)) throw deny();
  const o = { name: str(req.body.name, 200), regNo: str(req.body.regNo, 60), contactName: str(req.body.contactName, 120), title: str(req.body.title, 80), email: str(req.body.email, 200).toLowerCase(), mobile: str(req.body.mobile, 40) };
  if (!o.name) throw bad('Enter the company name.');
  if (!o.contactName) throw bad('Enter who signs for the company.');
  if (!isEmail(o.email)) throw bad('Enter a valid email: the agreement pack goes there.');
  const id = await db.tx(async (c) => {
    const r = (await c.query('INSERT INTO owners (name, reg_no, contact_name, title, email, mobile, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [o.name, o.regNo, o.contactName, o.title, o.email, o.mobile, req.user.id])).rows[0].id;
    await audit(c, { actorId: req.user.id, action: 'owner.create', entity: 'owner', entityId: r, after: o, ip: req.ip });
    return r;
  });
  res.json({ id });
}));

// ---------- Step 2: capture / details ----------
async function detailsFrom(req, c, existing) {
  const b = req.body;
  const d = {
    name: str(b.name, 200), category: str(b.category, 80), areaId: b.areaId, repId: b.repId, ownerId: b.ownerId,
    address: str(b.address, 300), storePhone: str(b.storePhone, 40), whatsapp: str(b.whatsapp, 40), hours: str(b.hours, 120), notes: str(b.notes, 4000),
    lat: Number(b.pin && b.pin.lat), lng: Number(b.pin && b.pin.lng),
    accuracy: b.pin && b.pin.accuracy !== null && b.pin.accuracy !== undefined ? num(b.pin.accuracy, 0, 100000) : null,
    pinSource: b.pin && b.pin.source === 'manual' ? 'manual' : 'gps',
    pinCapturedAt: b.pin && b.pin.capturedAt && !isNaN(Date.parse(b.pin.capturedAt)) ? b.pin.capturedAt : new Date().toISOString(),
    photos: {},
  };
  const missing = [!d.name && 'trading name', !d.category && 'category', !isUuid(d.areaId) && 'area', !isUuid(d.repId) && 'sales rep', !isUuid(d.ownerId) && 'owner',
    !(Number.isFinite(d.lat) && Number.isFinite(d.lng) && Math.abs(d.lat) <= 90 && Math.abs(d.lng) <= 180) && 'store pin'].filter(Boolean);
  if (missing.length) throw bad(`Still needed: ${missing.join(', ')}.`);
  for (const k of ['storefront', 'logo', 'counter']) {
    const key = b.photoKeys && b.photoKeys[k];
    if (key && /^vendor-photos\/[\w\-./]+$/.test(key) && !key.includes('..')) d.photos[k] = key;
  }
  const area = (await c.query('SELECT id FROM areas WHERE id = $1', [d.areaId])).rows[0];
  if (!area) throw bad('Choose an area from the list.');
  const reps = (await c.query('SELECT user_id FROM area_reps WHERE area_id = $1', [d.areaId])).rows.map((r) => r.user_id);
  const rep = (await c.query(`SELECT id, role, active FROM users WHERE id = $1`, [d.repId])).rows[0];
  if (!rep || !rep.active) throw bad('Choose an active sales rep.');
  if (req.user.role === 'sales_rep' && d.repId !== req.user.id && !reps.includes(d.repId)) throw bad('Reps can only assign themselves or a rep allocated to this area.');
  if (!(await c.query('SELECT 1 FROM owners WHERE id = $1', [d.ownerId])).rows[0]) throw bad('Choose an owner from the list.');
  if (!(await c.query('SELECT 1 FROM categories WHERE name = $1', [d.category])).rows[0]) throw bad('Choose a category from the list.');
  return d;
}

router.post('/vendors', h(async (req, res) => {
  if (!P.canSell(req.user, null)) throw deny();
  const id = await db.tx(async (c) => {
    const d = await detailsFrom(req, c, null);
    const first = req.body.firstTouchAt && !isNaN(Date.parse(req.body.firstTouchAt)) ? req.body.firstTouchAt : new Date().toISOString();
    const r = (await c.query(`INSERT INTO vendors (name, category, area_id, rep_id, owner_id, address, lat, lng, pin_accuracy_m, pin_source, pin_captured_at,
        store_phone, whatsapp, hours, notes, photos, first_touch_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [d.name, d.category, d.areaId, d.repId, d.ownerId, d.address, d.lat, d.lng, d.accuracy, d.pinSource, d.pinCapturedAt, d.storePhone, d.whatsapp, d.hours, d.notes, d.photos, first, req.user.id])).rows[0];
    await audit(c, { actorId: req.user.id, action: 'vendor.create', entity: 'vendor', entityId: r.id, after: r, ip: req.ip });
    await restage(c, r.id);
    return r.id;
  });
  res.json({ id });
}));

router.put('/vendors/:id/details', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    const d = await detailsFrom(req, c, v);
    const r = (await c.query(`UPDATE vendors SET name=$2, category=$3, area_id=$4, rep_id=$5, owner_id=$6, address=$7, lat=$8, lng=$9, pin_accuracy_m=$10, pin_source=$11,
        pin_captured_at=$12, store_phone=$13, whatsapp=$14, hours=$15, notes=$16, photos=$17, updated_at=now() WHERE id=$1 RETURNING *`,
      [v.id, d.name, d.category, d.areaId, d.repId, d.ownerId, d.address, d.lat, d.lng, d.accuracy, d.pinSource, d.pinCapturedAt, d.storePhone, d.whatsapp, d.hours, d.notes, d.photos])).rows[0];
    await audit(c, { actorId: req.user.id, action: 'vendor.details', entity: 'vendor', entityId: v.id, before: v, after: r, ip: req.ip });
  });
  res.json({ ok: true });
}));

// ---------- model and services ----------
router.put('/vendors/:id/services', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    await lockedByAgreement(c, v);
    const model = req.body.model;
    if (!MODEL_KEYS.includes(model)) throw bad('Choose who delivers.');
    const services = {};
    for (const k of SERVICE_KEYS) services[k] = !!(req.body.services && req.body.services[k]);
    if (model === 'pickup_only') services.delivery = false;
    if (model !== 'pickup_only' && !services.delivery) throw bad('Delivery is off but a delivery model is chosen. Tick Delivery or choose No delivery.');
    if (!Object.values(services).some(Boolean)) throw bad('Pick at least one service.');
    const own = model === 'own_branded' || model === 'own_plain';
    const ownDrivers = own ? int(req.body.ownDrivers, 0, 500) : 0;
    if (own && !ownDrivers) throw bad('Enter how many own drivers they have.');
    const vehicles = model === 'own_branded' ? int(req.body.vehicles, 0, 500) : 0;
    const tables = services.tableQr ? int(req.body.tables, 0, 1000) : 0;
    if (services.tableQr && !tables) throw bad('Enter how many tables get a QR card.');
    // A delivery change invalidates a completed toolkit; the rep runs it again.
    const deliveryChanged = !!(v.services && v.services.delivery) !== services.delivery && v.toolkit_completed_at;
    const r = (await c.query(`UPDATE vendors SET model=$2, services=$3, own_drivers=$4, vehicles=$5, tables=$6,
        toolkit_completed_at = CASE WHEN $7 THEN NULL ELSE toolkit_completed_at END, updated_at=now() WHERE id=$1 RETURNING *`,
      [v.id, model, services, ownDrivers, vehicles, tables, !!deliveryChanged])).rows[0];
    await audit(c, { actorId: req.user.id, action: 'vendor.services', entity: 'vendor', entityId: v.id, before: v, after: r, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

// ---------- sales toolkit ----------
/** In-store price check from the toolkit screen: 3 items and each app's checkout fees. Blank stays blank (null). */
function cleanPriceCheck(pc) {
  const n = (v, max) => { if (v === '' || v === null || v === undefined) return null; const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x * 100) / 100 : null; };
  const items = (Array.isArray(pc.items) ? pc.items : []).slice(0, 3).map((i) => ({
    name: String((i && i.name) || '').trim().slice(0, 60), store: n(i && i.store, 100000), ue: n(i && i.ue, 100000), mrd: n(i && i.mrd, 100000),
  }));
  while (items.length < 3) items.push({ name: '', store: null, ue: null, mrd: null });
  const fees = (f) => ({ del: n(f && f.del, 1000), svc: n(f && f.svc, 1000), sof: n(f && f.sof, 1000), com: n(f && f.com, 100) });
  return { items, ue: fees(pc.ue), mrd: fees(pc.mrd), useBasket: !!pc.useBasket, checkedOn: new Date().toISOString().slice(0, 10) };
}

router.put('/vendors/:id/toolkit', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    if (!v.model) throw conflict('Choose the delivery model and services first.');
    await lockedByAgreement(c, v);
    const set = await settings(c);
    const b = req.body;
    const delivery = !!(v.services && v.services.delivery);
    const tier = Number(b.tier);
    if (!set.pricing.tiers.includes(tier)) throw bad(`Choose a fee tier: ${set.pricing.tiers.join(', ')}%.`);
    const t = {
      aov: num(b.aov, 0, 100000), opd: num(b.opd, 0, 10000), days: num(b.days, 0, 31), apps: ['both', 'one', 'none'].includes(b.apps) ? b.apps : 'both',
      markup: num(b.markup, 0, 200), commission: num(b.commission, 0, 100), appDelivery: num(b.appDelivery, 0, 1000), appService: num(b.appService, 0, 100),
      tier, paidBy: b.paidBy === 'vendor' ? 'vendor' : 'customer', delivery: num(b.delivery, 0, 1000),
    };
    if (delivery && b.priceCheck) t.priceCheck = cleanPriceCheck(b.priceCheck);
    if (delivery && (!t.aov || !t.opd || !t.days)) throw bad('Enter the average order, orders a day and trading days.');
    const r = (await c.query(`UPDATE vendors SET toolkit=$2, toolkit_completed_at=COALESCE(toolkit_completed_at, now()), updated_at=now() WHERE id=$1 RETURNING *`, [v.id, t])).rows[0];
    await audit(c, { actorId: req.user.id, action: 'vendor.toolkit', entity: 'vendor', entityId: v.id, before: v.toolkit, after: { ...t, result: delivery ? F.toolkitResult(t) : null }, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

// ---------- agreement: preview, sign, void ----------
router.get('/vendors/:id/terms', h(async (req, res) => {
  const v = await loadVendor(db, req.params.id);
  const set = await settings();
  const w = await wording();
  res.json({ terms: termsFor(v, set), wording: w, startDate: F.defaultStartDate(todaySA(), set.pricing), today: todaySA() });
}));

router.post('/vendors/:id/agreement', h(async (req, res) => {
  const b = req.body;
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSignForFeest(req.user, v, v.area_rep_ids)) throw deny();
    if (v.closed_at) throw conflict('This vendor is closed. Reopen it first.');
    if (!v.toolkit_completed_at) throw conflict('Complete the sales toolkit first.');
    if (await activeAgreement(c, v.id)) throw conflict('This vendor already has a signed agreement.');
    if (!v.owner_email) throw conflict("The owner has no email on file. Add it before signing: the pack goes there.");
    const start = str(b.startDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || start < todaySA()) throw bad('Choose a start date from today onward.');
    const ownerName = str(b.ownerName, 120), ownerTitle = str(b.ownerTitle, 80);
    if (!ownerName) throw bad("Enter the owner's name.");
    if (b.agree !== true) throw bad('The owner needs to agree to the terms.');
    const set = await settings(c), w = await wording(c);
    const terms = termsFor(v, set);
    const ownerSig = await saveImage(b.ownerSig, 'signatures', 600e3);
    const repSig = await saveImage(b.repSig, 'signatures', 600e3);
    const ag = (await c.query(`INSERT INTO agreements (vendor_id, terms, start_date, owner_name, owner_title, owner_sig_key, rep_user_id, rep_name, rep_sig_key, wording_version, signed_ip)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [v.id, terms, start, ownerName, ownerTitle, ownerSig, req.user.id, req.user.name, repSig, w.version, req.ip])).rows[0];
    await c.query(`UPDATE vendors SET pack_emailed_at=NULL, pack_emailed_to=NULL, pack_emailed_by=NULL, pack_email_method=NULL, updated_at=now() WHERE id=$1`, [v.id]);
    await audit(c, { actorId: req.user.id, action: 'agreement.sign', entity: 'vendor', entityId: v.id, after: { agreementId: ag.id, startDate: start, ownerName, terms }, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

router.post('/vendors/:id/agreement/void', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    if (v.signed_off_on) throw conflict("The owner has signed off. The agreement can't be voided now.");
    const ag = await activeAgreement(c, v.id);
    if (!ag) throw conflict('There is no signed agreement to void.');
    await c.query(`UPDATE agreements SET status='void', voided_at=now(), voided_by=$2, void_reason=$3 WHERE id=$1`, [ag.id, req.user.id, str(req.body.reason, 300)]);
    await c.query(`UPDATE vendors SET pack_emailed_at=NULL, pack_emailed_to=NULL, pack_emailed_by=NULL, pack_email_method=NULL WHERE id=$1`, [v.id]);
    await audit(c, { actorId: req.user.id, action: 'agreement.void', entity: 'vendor', entityId: v.id, before: { agreementId: ag.id }, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

// ---------- pack: PDF, email, sign-off ----------
async function packPdfFor(c, v) {
  const ag = await activeAgreement(c, v.id);
  if (!ag) throw conflict('Sign the agreement first.');
  const w = (await c.query('SELECT text FROM agreement_wordings WHERE version = $1', [ag.wording_version])).rows[0];
  const [owner, rep] = await Promise.all([storage.get(ag.owner_sig_key), storage.get(ag.rep_sig_key)]);
  const pdf = await buildPackPdf({ ...ag, wording_text: w ? w.text : '' }, { owner, rep });
  return { ag, pdf };
}
const pdfName = (v) => `FEEST agreement pack - ${v.name.replace(/[^\w .-]+/g, '').trim() || 'vendor'}.pdf`;

router.get('/vendors/:id/pack.pdf', h(async (req, res) => {
  const v = await loadVendor(db, req.params.id);
  const { pdf } = await packPdfFor(db, v);
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdfName(v)}"`, 'Cache-Control': 'no-store' }).send(pdf);
}));

router.get('/vendors/:id/pack/email', h(async (req, res) => {
  const v = await loadVendor(db, req.params.id);
  const ag = await activeAgreement(db, v.id);
  if (!ag) throw conflict('Sign the agreement first.');
  res.json({ ...packEmail(ag), cc: v.rep_email || '', mailConfigured: mail.configured() });
}));

router.post('/vendors/:id/pack/send', h(async (req, res) => {
  const v = await loadVendor(db, req.params.id);
  if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
  if (!mail.configured()) throw conflict('Email is not set up on this server yet. Download the pack and send it from your mailbox, then mark it as emailed.');
  const { ag, pdf } = await packPdfFor(db, v);
  const e = packEmail(ag);
  if (!isEmail(e.to)) throw conflict("The owner's email isn't valid. Fix it on the owner record first.");
  await mail.send({ template: 'vendor_pack', to: e.to, cc: [req.user.email, v.rep_email].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', '),
    replyTo: req.user.email || undefined, subject: e.subject, text: e.text, attachments: [{ filename: pdfName(v), content: pdf, contentType: 'application/pdf' }],
    relatedType: 'vendor', relatedId: v.id });
  await db.tx(async (c) => {
    await c.query(`UPDATE vendors SET pack_emailed_at=now(), pack_emailed_to=$2, pack_emailed_by=$3, pack_email_method='sent', updated_at=now() WHERE id=$1`, [v.id, e.to, req.user.id]);
    await audit(c, { actorId: req.user.id, action: 'pack.sent', entity: 'vendor', entityId: v.id, after: { to: e.to }, ip: req.ip });
  });
  res.json({ ok: true, to: e.to });
}));

router.post('/vendors/:id/pack/emailed', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    if (!(await activeAgreement(c, v.id))) throw conflict('Sign the agreement first.');
    await c.query(`UPDATE vendors SET pack_emailed_at=now(), pack_emailed_to=$2, pack_emailed_by=$3, pack_email_method='manual', updated_at=now() WHERE id=$1`, [v.id, v.owner_email, req.user.id]);
    await audit(c, { actorId: req.user.id, action: 'pack.marked_emailed', entity: 'vendor', entityId: v.id, ip: req.ip });
  });
  res.json({ ok: true });
}));

router.post('/vendors/:id/signoff', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    if (!(await activeAgreement(c, v.id))) throw conflict('Sign the agreement first.');
    if (!v.pack_emailed_at) throw conflict('Email the pack before recording sign-off.');
    if (v.signed_off_on) throw conflict('Sign-off is already recorded.');
    const on = str(req.body.date, 10) || todaySA();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on) || on > todaySA()) throw bad("The sign-off date can't be in the future.");
    const by = str(req.body.by, 120);
    if (!by) throw bad('Enter who confirmed.');
    const method = ['Email reply', 'Signed PDF returned', 'WhatsApp message'].includes(req.body.method) ? req.body.method : 'Email reply';
    await c.query(`UPDATE vendors SET signed_off_on=$2, signed_off_by=$3, signoff_method=$4, signoff_note=$5, updated_at=now() WHERE id=$1`, [v.id, on, by, method, str(req.body.note, 500)]);
    await audit(c, { actorId: req.user.id, action: 'pack.signed_off', entity: 'vendor', entityId: v.id, after: { on, by, method }, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

// ---------- installation ----------
router.put('/vendors/:id/install', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canInstall(req.user, v, v.area_rep_ids)) throw deny();
    if (!v.signed_off_on) throw conflict('Installation opens once the owner has signed off.');
    if (v.live_at) throw conflict('This vendor is live. Take it offline to change the checklist.');
    const items = installItems(shape(v));
    const next = { ...(v.install || {}) };
    const checks = req.body.checks || {}, fields = req.body.fields || {};
    for (const it of items) {
      if (it.key in checks) next[it.key] = checks[it.key] ? (next[it.key] || todaySA()) : null;
      if (it.field && it.field.key in fields) next[it.field.key] = str(fields[it.field.key], 200);
    }
    await c.query('UPDATE vendors SET install=$2, updated_at=now() WHERE id=$1', [v.id, next]);
    await audit(c, { actorId: req.user.id, action: 'install.update', entity: 'vendor', entityId: v.id, before: v.install, after: next, ip: req.ip });
  });
  res.json({ ok: true });
}));

router.put('/vendors/:id/print', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canInstall(req.user, v, v.area_rep_ids)) throw deny();
    const set = await settings(c);
    const keys = set.print.map((p) => p.key);
    const q = {};
    for (const [k, val] of Object.entries(req.body.qty || {})) if (keys.includes(k)) q[k] = int(val, 0, 100000);
    await c.query('UPDATE vendors SET print_qty=$2, updated_at=now() WHERE id=$1', [v.id, q]);
    await audit(c, { actorId: req.user.id, action: 'install.print_qty', entity: 'vendor', entityId: v.id, before: v.print_qty, after: q, ip: req.ip });
  });
  res.json({ ok: true });
}));

router.post('/vendors/:id/live', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canInstall(req.user, v, v.area_rep_ids)) throw deny();
    if (!v.signed_off_on) throw conflict('The owner has not signed off yet.');
    if (v.closed_at) throw conflict('This vendor is closed. Reopen it first.');
    const missing = missingForLive(shape(v), v.install);
    if (missing.length) throw conflict(`Still to do: ${missing.join('; ')}.`);
    await c.query('UPDATE vendors SET live_at=now(), updated_at=now() WHERE id=$1', [v.id]);
    await audit(c, { actorId: req.user.id, action: 'vendor.live', entity: 'vendor', entityId: v.id, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

router.post('/vendors/:id/offline', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canInstall(req.user, v, v.area_rep_ids)) throw deny();
    await c.query('UPDATE vendors SET live_at=NULL, updated_at=now() WHERE id=$1', [v.id]);
    await audit(c, { actorId: req.user.id, action: 'vendor.offline', entity: 'vendor', entityId: v.id, before: { liveAt: v.live_at }, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

// ---------- close / reopen ----------
router.post('/vendors/:id/close', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    if (v.live_at) throw conflict('Take the vendor offline before closing it.');
    const reason = str(req.body.reason, 80) || 'Not interested';
    await c.query('UPDATE vendors SET closed_at=now(), closed_reason=$2, closed_note=$3, updated_at=now() WHERE id=$1', [v.id, reason, str(req.body.note, 500)]);
    await audit(c, { actorId: req.user.id, action: 'vendor.close', entity: 'vendor', entityId: v.id, after: { reason }, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));
router.post('/vendors/:id/reopen', h(async (req, res) => {
  await db.tx(async (c) => {
    const v = await loadVendor(c, req.params.id, true);
    if (!P.canSell(req.user, v, v.area_rep_ids)) throw deny();
    await c.query('UPDATE vendors SET closed_at=NULL, closed_reason=NULL, closed_note=\'\', updated_at=now() WHERE id=$1', [v.id]);
    await audit(c, { actorId: req.user.id, action: 'vendor.reopen', entity: 'vendor', entityId: v.id, ip: req.ip });
    await restage(c, v.id);
  });
  res.json({ ok: true });
}));

// ---------- team ----------
router.post('/users', h(async (req, res) => {
  if (!P.canManageUsers(req.user)) throw deny();
  const name = str(req.body.name, 120), email = str(req.body.email, 200).toLowerCase(), role = req.body.role;
  if (!name) throw bad('Enter a name.');
  if (!P.ROLES.includes(role)) throw bad('Choose a role.');
  if (email && !isEmail(email)) throw bad('Enter a valid email or leave it blank.');
  let hash = null;
  if (req.body.password) { const p = passwordProblem(req.body.password); if (p) throw bad(p); if (!email) throw bad('A login needs an email.'); hash = await hashPassword(req.body.password); }
  const id = await db.tx(async (c) => {
    const r = (await c.query('INSERT INTO users (name, email, mobile, role, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id', [name, email || null, str(req.body.mobile, 40), role, hash])).rows[0].id;
    await audit(c, { actorId: req.user.id, action: 'user.create', entity: 'user', entityId: r, after: { name, email, role, login: !!hash }, ip: req.ip });
    return r;
  }).catch((e) => { if (e.code === '23505') throw conflict('Someone already uses that email.'); throw e; });
  res.json({ id });
}));
router.put('/users/:id', h(async (req, res) => {
  if (!P.canManageUsers(req.user)) throw deny();
  if (!isUuid(req.params.id)) throw notFound('Team member');
  await db.tx(async (c) => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [req.params.id])).rows[0];
    if (!u) throw notFound('Team member');
    const role = req.body.role !== undefined ? req.body.role : u.role;
    if (!P.ROLES.includes(role)) throw bad('Choose a role.');
    const active = req.body.active !== undefined ? !!req.body.active : u.active;
    if (u.id === req.user.id && (!active || !['ceo', 'admin'].includes(role))) throw bad("You can't remove your own admin access.");
    let hash = u.password_hash;
    if (req.body.password) { const p = passwordProblem(req.body.password); if (p) throw bad(p); if (!u.email) throw bad('Add an email before setting a password.'); hash = await hashPassword(req.body.password); }
    await c.query('UPDATE users SET role=$2, active=$3, password_hash=$4, failed_logins=0, locked_until=NULL, updated_at=now() WHERE id=$1', [u.id, role, active, hash]);
    await audit(c, { actorId: req.user.id, action: 'user.update', entity: 'user', entityId: u.id, before: { role: u.role, active: u.active }, after: { role, active, passwordReset: !!req.body.password }, ip: req.ip });
  });
  res.json({ ok: true });
}));
router.post('/me/password', h(async (req, res) => {
  const u = (await db.query('SELECT * FROM users WHERE id=$1', [req.user.id])).rows[0];
  if (!(await verifyPassword(req.body.current || '', u.password_hash))) throw bad('Your current password is wrong.');
  const p = passwordProblem(req.body.next); if (p) throw bad(p);
  await db.tx(async (c) => {
    await c.query('UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1', [u.id, await hashPassword(req.body.next)]);
    await audit(c, { actorId: u.id, action: 'user.password', entity: 'user', entityId: u.id, ip: req.ip });
  });
  res.json({ ok: true });
}));

// ---------- setup ----------
router.put('/settings/pricing', h(async (req, res) => {
  if (!P.canEditSettings(req.user)) throw deny();
  const b = req.body;
  const tiers = (Array.isArray(b.tiers) ? b.tiers : []).map(Number).filter((x) => x > 0 && x < 100);
  if (!tiers.length) throw bad('Enter at least one fee tier.');
  const def = Number(b.defaultTier);
  if (!tiers.includes(def)) throw bad('The default tier must be one of the tiers.');
  const v = { tiers, defaultTier: def, paidBy: b.paidBy === 'vendor' ? 'vendor' : 'customer', feestDelivery: num(b.feestDelivery, 0, 1000),
    socialSetup: num(b.socialSetup, 0, 1e6), startOffsetDays: int(b.startOffsetDays, 0, 365), vat: num(b.vat, 0, 50),
    appMarkup: num(b.appMarkup, 0, 200), appCommission: num(b.appCommission, 0, 100), appDelivery: num(b.appDelivery, 0, 1000), appService: num(b.appService, 0, 100) };
  await saveSetting(req, 'pricing', v);
  res.json({ ok: true });
}));
router.put('/settings/print', h(async (req, res) => {
  if (!P.canEditSettings(req.user)) throw deny();
  const known = Object.fromEntries(F.DEFAULT_PRINT.map((p) => [p.key, p]));
  const items = (Array.isArray(req.body.items) ? req.body.items : []).filter((i) => known[i.key]).map((i) => ({
    key: i.key, label: str(i.label, 120) || known[i.key].label, unit: num(i.unit, 0, 1e6),
    qty: typeof known[i.key].qty === 'string' ? known[i.key].qty : int(i.qty, 0, 100000), when: known[i.key].when }));
  if (!items.length) throw bad('The price list is empty.');
  await saveSetting(req, 'print', { items });
  res.json({ ok: true });
}));
async function saveSetting(req, key, value) {
  await db.tx(async (c) => {
    const before = (await c.query('SELECT value FROM settings WHERE key=$1', [key])).rows[0];
    await c.query(`INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_by=$3, updated_at=now()`, [key, value, req.user.id]);
    await audit(c, { actorId: req.user.id, action: `settings.${key}`, entity: 'settings', before: before && before.value, after: value, ip: req.ip });
  });
}
router.put('/settings/categories', h(async (req, res) => {
  if (!P.canEditSettings(req.user)) throw deny();
  const items = [...new Set((Array.isArray(req.body.items) ? req.body.items : []).map((x) => str(x, 80)).filter(Boolean))];
  if (!items.length) throw bad('Keep at least one category.');
  await db.tx(async (c) => {
    const inUse = (await c.query('SELECT DISTINCT category FROM vendors')).rows.map((r) => r.category).filter((x) => !items.includes(x));
    if (inUse.length) throw conflict(`In use by vendors, so it can't be removed: ${inUse.join(', ')}.`);
    await c.query('DELETE FROM categories');
    for (let i = 0; i < items.length; i++) await c.query('INSERT INTO categories (name, sort) VALUES ($1,$2)', [items[i], (i + 1) * 10]);
    await audit(c, { actorId: req.user.id, action: 'settings.categories', entity: 'settings', after: items, ip: req.ip });
  });
  res.json({ ok: true });
}));
router.post('/settings/wording', h(async (req, res) => {
  if (!P.canEditSettings(req.user)) throw deny();
  const text = String(req.body.text || '').trim().slice(0, 20000);
  if (text.length < 50) throw bad('The agreement wording looks empty.');
  const version = await db.tx(async (c) => {
    const v = ((await c.query('SELECT COALESCE(max(version),0)+1 AS v FROM agreement_wordings')).rows[0].v);
    await c.query('INSERT INTO agreement_wordings (version, text, created_by) VALUES ($1,$2,$3)', [v, text, req.user.id]);
    await audit(c, { actorId: req.user.id, action: 'settings.wording', entity: 'settings', after: { version: v }, ip: req.ip });
    return v;
  });
  res.json({ version });
}));

// ---------- errors ----------
router.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That upload is too large.' });
  console.error(`[api] ${req.method} ${req.path}: ${err.message}`); // no personal data in logs (POPIA)
  res.status(500).json({ error: 'Something went wrong on the server. Try again; if it keeps happening, tell the admin.' });
});

module.exports = { router, fileUrl };
