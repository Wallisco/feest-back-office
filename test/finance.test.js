'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/vendors/finance');

test('R180 order matches the Sales Training Manual example', () => {
  const c = F.compare(F.toolkitDefaults());
  assert.equal(c.appMenu, 225);          // 25% markup
  assert.equal(c.appCustomer, 249);      // + R15 delivery + 4% service
  assert.equal(c.appVendor, 157.5);      // 30% commission on the marked-up price
  assert.equal(c.feestCustomer, 242);    // menu price + 15% fee + R35 delivery
  assert.equal(c.feestVendor, 180);      // vendor keeps the menu price
  assert.equal(c.monthOrders, 650);      // 25 a day × 26 days
  assert.equal(c.monthGain, 14625);
  assert.equal(c.monthFeeFeest, 17550);
});

test('vendor paying the fee keeps menu price less the fee', () => {
  const c = F.compare({ ...F.toolkitDefaults(), paidBy: 'vendor', tier: 10 });
  assert.equal(c.feestVendor, 162);
  assert.equal(c.feestCustomer, 215);
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

test('price check: measured markups, cheaper app at checkout, rates laid over the toolkit', () => {
  const pc = {
    items: [
      { name: 'Full chicken and chips', store: 100, uber: 125, mrd: 130 },
      { name: 'Burger', store: 80, uber: 100, mrd: 100 },
      { name: 'Wrap', store: 60, uber: 75, mrd: '' },              // not on Mr D
    ],
    uber: { delivery: 15, service: 12, small: 0, commission: '' },
    mrd: { delivery: 20, service: 0, small: 0, commission: 28 },
  };
  const r = F.priceCheck(pc);
  assert.equal(r.storeTotal, 240);
  assert.equal(r.uber.markup, 25);                // 300 / 240
  assert.equal(r.uber.checkout, 327);             // 300 + 15 + 12 + 0
  assert.equal(r.mrd.listed, 2);
  assert.equal(r.mrd.markup, 27.78);              // 230 / 180
  assert.equal(r.mrd.checkout, 250);
  // Uber: 327/240 = 1.3625; Mr D: 250/180 = 1.3889 → compare against Uber Eats
  assert.equal(r.use.app, 'uber');
  assert.deepEqual(r.use, { app: 'uber', markup: 25, appDelivery: 15, appService: 4, commission: null });
  const t = F.withPriceCheck({ ...F.toolkitDefaults(), markup: 40, appService: 9, priceCheck: pc });
  assert.equal(t.markup, 25);
  assert.equal(t.appService, 4);
  assert.equal(t.commission, 30);                 // not given for Uber, keeps the typed rate
});

test('price check: nothing measured leaves the toolkit alone', () => {
  const r = F.priceCheck({ items: [{ name: 'Pie', store: 50 }], uber: {}, mrd: {} });
  assert.equal(r.measured, false);
  assert.equal(r.use, null);
  const t = { ...F.toolkitDefaults(), markup: 33 };
  assert.equal(F.withPriceCheck({ ...t, priceCheck: null }).markup, 33);
});
