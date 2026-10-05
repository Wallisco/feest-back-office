'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stageFor } = require('../src/vendors/stages');
const { installItems, missingForLive } = require('../src/vendors/checklist');
const P = require('../src/vendors/permissions');

test('stage follows the facts, in order', () => {
  assert.equal(stageFor({}), 'captured');
  assert.equal(stageFor({ toolkitCompletedAt: 1 }), 'ready');
  assert.equal(stageFor({ toolkitCompletedAt: 1, hasAgreement: true }), 'signoff');
  assert.equal(stageFor({ toolkitCompletedAt: 1, hasAgreement: true, signedOffOn: '2026-10-05' }), 'install');
  assert.equal(stageFor({ toolkitCompletedAt: 1, hasAgreement: true, signedOffOn: '2026-10-05', liveAt: 1 }), 'live');
  assert.equal(stageFor({ toolkitCompletedAt: 1, hasAgreement: true, closedAt: 1 }), 'notnow');
});

test('checklist adds items for the services chosen', () => {
  const base = installItems({ model: 'open', services: {} }).map((i) => i.key);
  assert.ok(!base.includes('pilot') && !base.includes('dispatch'));
  const full = installItems({ model: 'own_branded', ownDrivers: 2, services: { delivery: true, pilot: true, social: true, tableQr: true, loyalty: true, gbp: true } }).map((i) => i.key);
  for (const k of ['pilot', 'social', 'tableQr', 'loyalty', 'gbp', 'dispatch']) assert.ok(full.includes(k), k);
});

test('go-live needs every item and the Keychat store ID', () => {
  const v = { model: 'open', services: { delivery: true } };
  const all = Object.fromEntries(installItems(v).map((i) => [i.key, '2026-10-05']));
  assert.deepEqual(missingForLive(v, all), ['Menu loaded in Keychat: Keychat store ID']);
  assert.deepEqual(missingForLive(v, { ...all, keychatStoreId: 'KC-123' }), []);
});

test('reps sell only their own vendors or vendors in their areas', () => {
  const rep = { id: 'r1', role: 'sales_rep', active: true };
  assert.equal(P.canSell(rep, { rep_id: 'r1' }, []), true);
  assert.equal(P.canSell(rep, { rep_id: 'r2' }, ['r1']), true);
  assert.equal(P.canSell(rep, { rep_id: 'r2' }, ['r3']), false);
  assert.equal(P.canSell({ id: 'x', role: 'finance', active: true }, { rep_id: 'r2' }, []), false);
  assert.equal(P.canInstall({ id: 'x', role: 'installation', active: true }, { rep_id: 'r2' }, []), true);
  assert.equal(P.canSell({ id: 'x', role: 'sales_lead', active: false }, null), false);
  assert.equal(P.canEditSettings({ id: 'x', role: 'sales_lead', active: true }), false);
});
