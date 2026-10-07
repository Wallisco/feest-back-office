'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib/permissions');
const P = require('../src/vendors/permissions');

const as = (role, id = role) => ({ id, role, active: true });
const mods = (role) => L.modulesFor(as(role)).map((m) => m.key);

test('every role has a label, and the vendor rules see the same roles', () => {
  for (const r of L.ROLES) assert.ok(L.ROLE_LABELS[r], r);
  assert.deepEqual(P.ROLES, L.ROLES);
  for (const r of ['dispatcher', 'ops_lead', 'driver_support']) assert.ok(L.ROLES.includes(r), r);
});

test('each role sees only its modules', () => {
  assert.deepEqual(mods('sales_rep'), ['vendors']);
  assert.deepEqual(mods('onboarding'), ['vendors']);
  assert.deepEqual(mods('installation'), ['vendors']);
  assert.deepEqual(mods('sales_lead'), ['overview', 'vendors']);
  assert.deepEqual(mods('dispatcher'), ['overview', 'operations', 'drivers', 'metrics']);
  assert.deepEqual(mods('ops_lead'), ['overview', 'operations', 'drivers', 'pricing', 'metrics', 'integration']);
  assert.deepEqual(mods('driver_support'), ['drivers']);
  assert.deepEqual(mods('finance'), ['overview', 'vendors', 'operations', 'drivers', 'pricing', 'payouts', 'metrics', 'integration']);
  assert.deepEqual(mods('ceo'), L.MODULES.map((m) => m.key));
  assert.deepEqual(mods('admin'), L.MODULES.map((m) => m.key));
});

test('driver support gets no pricing and no payouts', () => {
  const ds = as('driver_support');
  assert.equal(L.canUseModule(ds, 'pricing'), false);
  assert.equal(L.canUseModule(ds, 'payouts'), false);
  assert.equal(L.canPreparePayout(ds), false);
  assert.equal(L.canSavePricing(ds), false);
  assert.equal(L.canSupportDrivers(ds), true);
});

test('inactive users, unknown roles and unknown modules are refused', () => {
  assert.deepEqual(L.modulesFor({ id: 'x', role: 'ceo', active: false }), []);
  assert.deepEqual(L.modulesFor({ id: 'x', role: 'intern', active: true }), []);
  assert.deepEqual(L.modulesFor(null), []);
  assert.equal(L.canUseModule(as('ceo'), 'nope'), false);
  assert.equal(L.canDispatch({ id: 'x', role: 'dispatcher', active: false }), false);
  assert.equal(P.canView(as('dispatcher')), false, 'vendors are not for dispatchers');
});

test('the margin overview stays with leads, finance and the exec', () => {
  assert.equal(P.canSeeOverview(as('dispatcher')), false);
  assert.equal(P.canSeeOverview(as('ops_lead')), false);
  assert.equal(P.canSeeOverview(as('finance')), true);
});

test('dispatch actions: dispatchers, ops leads and the exec; not finance or driver support', () => {
  for (const r of ['dispatcher', 'ops_lead', 'ceo', 'admin']) assert.equal(L.canDispatch(as(r)), true, r);
  for (const r of ['finance', 'driver_support', 'sales_lead']) assert.equal(L.canDispatch(as(r)), false, r);
});

test('driver onboarding decisions and suspensions: ops lead and the exec only', () => {
  for (const r of ['ops_lead', 'ceo', 'admin']) { assert.equal(L.canDecideOnboarding(as(r)), true, r); assert.equal(L.canSuspendDriver(as(r)), true, r); }
  for (const r of ['dispatcher', 'driver_support', 'finance']) { assert.equal(L.canDecideOnboarding(as(r)), false, r); assert.equal(L.canSuspendDriver(as(r)), false, r); }
});

test('pricing: ops lead, CEO and admin preview and save; finance only looks', () => {
  for (const r of ['ops_lead', 'ceo', 'admin']) { assert.equal(L.canPreviewPricing(as(r)), true, r); assert.equal(L.canSavePricing(as(r)), true, r); }
  for (const r of ['finance', 'dispatcher', 'sales_lead']) assert.equal(L.canSavePricing(as(r)), false, r);
  assert.equal(L.canUseModule(as('finance'), 'pricing'), true);
});

test("the person who prepares a payout can't approve it", () => {
  const f1 = as('finance', 'f1'), f2 = as('finance', 'f2'), ceo = as('ceo', 'c1'), admin = as('admin', 'a1');
  assert.equal(L.canPreparePayout(f1), true);
  const run = { prepared_by: 'f1' };
  assert.equal(L.canApprovePayout(f1, run), false, 'preparer');
  assert.equal(L.canApprovePayout(f2, run), true, 'another finance user');
  assert.equal(L.canApprovePayout(ceo, run), true, 'CEO');
  assert.equal(L.canApprovePayout(admin, run), false, 'approval is finance or CEO');
  assert.equal(L.canApprovePayout(as('ceo', 'c1'), { prepared_by: 'c1' }), false, 'CEO who prepared it');
  assert.equal(L.canApprovePayout(f2, {}), false, 'a run with no preparer');
  assert.equal(L.canApprovePayout(as('ops_lead', 'o1'), run), false);
});

test('ledger adjustments over R500 need a second, different approver', () => {
  assert.equal(L.needsSecondApprover(500), false);
  assert.equal(L.needsSecondApprover(500.01), true);
  assert.equal(L.needsSecondApprover(-750), true, 'debits count too');
  const entry = { amount: 900, created_by: 'f1' };
  assert.equal(L.canApproveLedger(as('finance', 'f1'), entry), false);
  assert.equal(L.canApproveLedger(as('finance', 'f2'), entry), true);
  assert.equal(L.canApproveLedger(as('driver_support', 'd1'), entry), false);
  assert.equal(L.canAdjustLedger(as('dispatcher')), false);
});

test('requireModule answers 403 with what to do next, or lets the request through', () => {
  let status = 0, body = null, passed = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; } };
  L.requireModule('payouts')({ user: as('dispatcher') }, res, () => (passed = true));
  assert.equal(status, 403); assert.equal(passed, false); assert.match(body.error, /Payouts.*Ask an admin/);
  L.requireModule('payouts')({ user: as('finance') }, res, () => (passed = true));
  assert.equal(passed, true);
});
