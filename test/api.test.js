'use strict';
// End-to-end: a vendor from capture to live through the API, on a fresh database.
// Runs only when TEST_DATABASE_URL is set (CI sets it). It wipes that database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const URL_ = process.env.TEST_DATABASE_URL;
const skip = !URL_ && 'set TEST_DATABASE_URL to run';

test('vendor journey: areas → capture → toolkit → agreement → pack → sign-off → install → live', { skip }, async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: URL_ }); await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
  execFileSync('node', [path.join(__dirname, '../scripts/migrate.js')], { env: { ...process.env, DATABASE_URL: URL_ }, stdio: 'pipe' });
  execFileSync('node', [path.join(__dirname, '../scripts/create-user.js'), '--name', 'Test Admin', '--email', 'admin@test.local', '--role', 'admin', '--password', 'correct-horse-1'], { env: { ...process.env, DATABASE_URL: URL_ }, stdio: 'pipe' });

  Object.assign(process.env, { DATABASE_URL: URL_, SESSION_SECRET: 'test-secret', PORT: '3999', STORAGE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'feest-')) });
  delete process.env.SMTP_HOST;
  const srv = require('../server');
  const base = 'http://127.0.0.1:3999';
  let cookie = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await call('GET', '/api/bootstrap')).status, 401);
    assert.equal((await call('POST', '/auth/login', { email: 'admin@test.local', password: 'wrong-password' })).status, 401);
    assert.equal((await call('POST', '/auth/login', { email: 'ADMIN@test.local', password: 'correct-horse-1' })).status, 200);

    // Team and Step 1
    const rep = (await call('POST', '/api/users', { name: 'Aziz Rep', role: 'sales_rep', email: 'aziz@test.local', password: 'rep-password-1' })).body.id;
    const area = (await call('POST', '/api/areas', { name: 'Claremont', city: 'Cape Town', reps: [rep], target: 40 })).body.id;
    const owner = (await call('POST', '/api/owners', { name: 'Biryani House (Pty) Ltd', contactName: 'Yusuf Adams', title: 'Owner', email: 'yusuf@test.local', mobile: '082 000 0000' })).body.id;
    assert.ok(area && owner && rep);

    // Capture
    const missing = await call('POST', '/api/vendors', { name: 'Biryani House' });
    assert.equal(missing.status, 400);
    const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000100ffff03000006000557bfabd40000000049454e44ae426082', 'hex').toString('base64');
    const up = (await call('POST', '/api/uploads', { dataUrl: png })).body;
    assert.match(up.key, /^vendor-photos\//);
    const vid = (await call('POST', '/api/vendors', { name: 'Biryani House', category: 'Restaurant', areaId: area, repId: rep, ownerId: owner,
      pin: { lat: -33.9806, lng: 18.465, accuracy: 8, source: 'gps' }, address: '1 Main Rd, Claremont', whatsapp: '021 000 0000', photoKeys: { logo: up.key } })).body.id;
    let v = (await call('GET', `/api/vendors/${vid}`)).body;
    assert.equal(v.stage, 'captured');
    assert.equal((await call('GET', v.photos.logo)).status, 200);

    // Toolkit before services is refused; then services + toolkit
    assert.equal((await call('PUT', `/api/vendors/${vid}/toolkit`, { tier: 15 })).status, 409);
    assert.equal((await call('PUT', `/api/vendors/${vid}/services`, { model: 'own_branded', ownDrivers: 2, vehicles: 2, services: { whatsapp: true, delivery: true, pilot: true, social: true } })).status, 200);
    assert.equal((await call('PUT', `/api/vendors/${vid}/toolkit`, { aov: 180, opd: 25, days: 26, markup: 25, commission: 30, appDelivery: 15, appService: 4, tier: 15, paidBy: 'customer', delivery: 25 })).status, 200);
    v = (await call('GET', `/api/vendors/${vid}`)).body;
    assert.equal(v.stage, 'ready');

    // Agreement
    const pv = (await call('GET', `/api/vendors/${vid}/terms`)).body;
    assert.equal(pv.terms.toolkit.monthGain, 14625);
    assert.equal(pv.terms.pack.social, 3000);
    assert.equal((await call('POST', `/api/vendors/${vid}/agreement`, { startDate: pv.startDate, ownerName: 'Yusuf Adams', ownerTitle: 'Owner', agree: false, ownerSig: png, repSig: png })).status, 400);
    assert.equal((await call('POST', `/api/vendors/${vid}/agreement`, { startDate: pv.startDate, ownerName: 'Yusuf Adams', ownerTitle: 'Owner', agree: true, ownerSig: png, repSig: png })).status, 200);
    assert.equal((await call('PUT', `/api/vendors/${vid}/services`, { model: 'open', services: { delivery: true } })).status, 409, 'terms are locked once signed');
    v = (await call('GET', `/api/vendors/${vid}`)).body;
    assert.equal(v.stage, 'signoff');

    // Pack: PDF, email (not configured here), manual mark, sign-off
    const pdf = await call('GET', `/api/vendors/${vid}/pack.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    fs.writeFileSync(path.join(os.tmpdir(), 'feest-test-pack.pdf'), pdf.body);
    assert.equal((await call('POST', `/api/vendors/${vid}/pack/send`)).status, 409);
    assert.equal((await call('POST', `/api/vendors/${vid}/signoff`, { by: 'Yusuf Adams' })).status, 409, 'pack must be emailed first');
    assert.equal((await call('POST', `/api/vendors/${vid}/pack/emailed`)).status, 200);
    assert.equal((await call('POST', `/api/vendors/${vid}/signoff`, { by: 'Yusuf Adams', method: 'Email reply' })).status, 200);
    assert.equal((await call('POST', `/api/vendors/${vid}/agreement/void`)).status, 409, 'no void after sign-off');

    // Installation and go-live
    assert.equal((await call('POST', `/api/vendors/${vid}/live`)).status, 409);
    const keys = ['printOrdered', 'printInstalled', 'waba', 'menu', 'pilot', 'social', 'dispatch', 'staff', 'testOrder'];
    assert.equal((await call('PUT', `/api/vendors/${vid}/install`, { checks: Object.fromEntries(keys.map((k) => [k, true])), fields: { keychatStoreId: 'KC-001' } })).status, 200);
    assert.equal((await call('POST', `/api/vendors/${vid}/live`)).status, 200);
    v = (await call('GET', `/api/vendors/${vid}`)).body;
    assert.equal(v.stage, 'live');

    // A rep from another area can't change it; the vendor's rep can see it
    const other = (await call('POST', '/api/users', { name: 'Other Rep', role: 'sales_rep', email: 'other@test.local', password: 'rep-password-2' })).body.id;
    assert.ok(other);
    await call('POST', '/auth/logout'); cookie = '';
    await call('POST', '/auth/login', { email: 'other@test.local', password: 'rep-password-2' });
    assert.equal((await call('POST', `/api/vendors/${vid}/close`, { reason: 'Price' })).status, 403);
    assert.equal((await call('PUT', '/api/settings/pricing', { tiers: [5], defaultTier: 5 })).status, 403);
    const boot = (await call('GET', '/api/bootstrap')).body;
    assert.equal(boot.vendors.length, 1);

    // Audit trail
    const a = new Client({ connectionString: URL_ }); await a.connect();
    const actions = (await a.query(`SELECT action FROM audit_log WHERE entity='vendor' AND entity_id=$1 ORDER BY id`, [vid])).rows.map((r) => r.action);
    await a.end();
    assert.deepEqual(actions, ['vendor.create', 'vendor.services', 'vendor.toolkit', 'agreement.sign', 'pack.marked_emailed', 'pack.signed_off', 'install.update', 'vendor.live']);

    // Public toolkit
    const tk = await fetch(base + '/toolkit');
    assert.equal(tk.status, 200);
  } finally {
    await srv.close();
  }
});
