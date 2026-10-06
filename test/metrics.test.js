'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/metrics/dashboard');
const F = require('../src/vendors/finance');
const P = require('../src/vendors/permissions');

test('moving average is null until the window is full, then the trailing mean', () => {
  assert.deepEqual(M.movingAverage([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
});

test('moving take rate is weighted (Σfee ÷ Σorder value), not an average of daily rates', () => {
  // day 1: R10 on R100 (10%); day 2: R40 on R200 (20%) → weighted 16.67%, not 15%
  assert.deepEqual(M.movingRatio([10, 40], [100, 200], 2), [null, 16.67]);
  assert.deepEqual(M.movingRatio([0, 0], [0, 0], 2), [null, null], 'no orders is not 0%');
});

test('a signed store counts only the months it trades in the next 12', () => {
  assert.equal(M.monthsInNext12('2026-11-04', '2026-10-06'), 11);
  assert.equal(M.monthsInNext12('2026-10-01', '2026-10-06'), 12);
  assert.equal(M.monthsInNext12('2028-01-01', '2026-10-06'), 0);
});

test('12-month projection: run rate once a store has 30 days, toolkit estimate before', () => {
  const t = F.toolkitDefaults();
  const est = F.feestMarginMonth(t);
  assert.equal(est, 12831); // (R27 fee − 3% card on R242) × 650 orders
  const p = M.project12([
    { live: true, daysWithOrders: 45, margin30: 20000, toolkit: t, delivery: true },
    { live: true, daysWithOrders: 10, margin30: 3000, toolkit: t, delivery: true },
    { live: false, startDate: '2026-11-04', toolkit: t, delivery: true },
  ], '2026-10-06');
  assert.equal(p.total, 20000 * 12 + est * 12 + est * 11);
  assert.equal(p.fromRunRate, 1);
  assert.equal(p.fromEstimate, 2);
});

test('only leads, finance and the exec see the overview', () => {
  const u = (role) => ({ role, active: true });
  assert.equal(P.canSeeOverview(u('sales_rep')), false);
  assert.equal(P.canSeeOverview(u('installation')), false);
  for (const r of ['sales_lead', 'finance', 'ceo', 'admin']) assert.equal(P.canSeeOverview(u(r)), true, r);
});
