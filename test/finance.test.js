'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/vendors/finance');

test('R180 order matches the Sales Training Manual example', () => {
  const c = F.compare(F.toolkitDefaults());
  assert.equal(c.appMenu, 225);          // 25% markup
  assert.equal(c.appCustomer, 249);      // + R15 delivery + 4% service
  assert.equal(c.appVendor, 157.5);      // 30% commission on the marked-up price
  assert.equal(c.feestCustomer, 232);    // menu price + 15% fee + R25 delivery
  assert.equal(c.feestVendor, 180);      // vendor keeps the menu price
  assert.equal(c.monthOrders, 650);      // 25 a day × 26 days
  assert.equal(c.monthGain, 14625);
  assert.equal(c.monthFeeFeest, 17550);
});

test('vendor paying the fee keeps menu price less the fee', () => {
  const c = F.compare({ ...F.toolkitDefaults(), paidBy: 'vendor', tier: 10 });
  assert.equal(c.feestVendor, 162);
  assert.equal(c.feestCustomer, 205);
});

test('pack: own branded fleet with table QR and social setup', () => {
  const p = F.packCost({ model: 'own_branded', ownDrivers: 3, vehicles: 3, tables: 10, services: { tableQr: true, social: true } });
  assert.deepEqual(p.rows.map((r) => [r.key, r.q, r.total]), [
    ['doorSticker', 2, 70], ['seal', 500, 325], ['flyer', 250, 350], ['counter', 1, 18],
    ['tableQr', 10, 120], ['boxWrap', 3, 1140], ['vehicle', 3, 1950]]);
  assert.equal(p.printTotal, 3973);
  assert.equal(p.social, 3000);
  assert.equal(p.vat, 1045.95);
  assert.equal(p.total, 8018.95);
});

test('pack: open network has no box or vehicle print, and rep overrides win', () => {
  const p = F.packCost({ model: 'open', ownDrivers: 4, services: {}, printQty: { seal: 1000 } });
  assert.ok(!p.rows.find((r) => r.key === 'boxWrap' || r.key === 'vehicle'));
  assert.equal(p.rows.find((r) => r.key === 'seal').q, 1000);
});

test('start date is 30 days out by default', () => {
  assert.equal(F.defaultStartDate('2026-10-05'), '2026-11-04');
  assert.equal(F.defaultStartDate('2026-12-15', { startOffsetDays: 30 }), '2027-01-14');
});
