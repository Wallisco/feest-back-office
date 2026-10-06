/**
 * FEEST vendor money maths: the one place these numbers are calculated.
 * Loaded by the server (require) and served unchanged to the browser at /static/finance.js
 * (window.FeestFinance), so the toolkit screen, the agreement, the PDF pack and the
 * dashboard always agree. Pure functions only: no I/O.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeestFinance = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Setup → Fees overrides these. Benchmarks are press-test estimates (MyBroadband, Financial Mail).
  const DEFAULT_PRICING = {
    tiers: [10, 15, 20], defaultTier: 15, paidBy: 'customer',
    feestDelivery: 35,           // customer pays it; all of it goes to the rider
    appMarkup: 25, appCommission: 30, appDelivery: 15, appService: 4,
    socialSetup: 3000, vat: 15, startOffsetDays: 30,
  };

  // Setup → Print price list overrides these. Unit costs are placeholders until a supplier quote.
  // qty: a number, or 'tables' | 'drivers' | 'vehicles' to follow the vendor's answers.
  const DEFAULT_PRINT = [
    { key: 'doorSticker', label: 'Door / window sticker, 120 mm round', unit: 35,   qty: 2,          when: 'always' },
    { key: 'seal',        label: 'Packaging seals, 150 x 50 mm',        unit: 0.65, qty: 500,        when: 'always' },
    { key: 'flyer',       label: 'Promo flyers, A5',                     unit: 1.4,  qty: 250,        when: 'always' },
    { key: 'counter',     label: 'Counter card',                         unit: 18,   qty: 1,          when: 'always' },
    { key: 'tableQr',     label: 'Table QR tent cards, A6',              unit: 12,   qty: 'tables',   when: 'tableQr' },
    { key: 'boxWrap',     label: 'Delivery top box, branded wrap',       unit: 380,  qty: 'drivers',  when: 'own_branded' },
    { key: 'vehicle',     label: 'Vehicle side panels (pair)',           unit: 650,  qty: 'vehicles', when: 'own_branded' },
  ];

  const MODELS = [
    { key: 'open',        label: 'FEEST open network',     sub: 'FEEST riders from the shared pool deliver the orders.' },
    { key: 'own_branded', label: 'Own drivers, branded',   sub: "Vendor's own drivers with branded top boxes and vehicles." },
    { key: 'own_plain',   label: 'Own drivers, unbranded', sub: "Vendor's own drivers, no FEEST print on boxes or vehicles." },
    { key: 'pickup_only', label: 'No delivery',            sub: 'In-store pickup and table ordering only.' },
  ];

  const SERVICES = [
    { key: 'whatsapp',  label: 'WhatsApp ordering',       sub: 'Menu in the chat; customers order and pay on WhatsApp.' },
    { key: 'delivery',  label: 'Delivery',                sub: 'Orders delivered to the customer. Opens the sales toolkit.' },
    { key: 'pickup',    label: 'In-store pickup',         sub: 'Order ahead, collect at the counter.' },
    { key: 'tableQr',   label: 'Table QR menu',           sub: 'Scan at the table to see the menu, order or book.' },
    { key: 'loyalty',   label: 'Loyalty stamps',          sub: 'Stamps on every WhatsApp order; reward on a full card.' },
    { key: 'promos',    label: 'Promotions',              sub: 'Specials and win-back messages to opted-in customers.' },
    { key: 'bookings',  label: 'Bookings',                sub: 'Table or appointment bookings in the same chat.' },
    { key: 'scheduled', label: 'Scheduled orders',        sub: 'Order now for a later time.' },
    { key: 'pilot',     label: 'Pilot order screen',      sub: 'Vendor accepts incoming orders on the Pilot screen.' },
    { key: 'gbp',       label: 'Google Business Profile', sub: 'Order link and WhatsApp number on their Google listing.' },
    { key: 'social',    label: 'Social media setup',      sub: "Once-off setup; accounts stay in the vendor's name.", priced: true },
  ];

  const num = (v, d) => { const x = parseFloat(v); return Number.isFinite(x) ? x : (d === undefined ? 0 : d); };
  const round2 = (n) => Math.round(n * 100) / 100;

  function pricing(overrides) { return Object.assign({}, DEFAULT_PRICING, overrides || {}); }
  function printList(overrides) { return Array.isArray(overrides) && overrides.length ? overrides : DEFAULT_PRINT; }

  function toolkitDefaults(p) {
    p = pricing(p);
    return { aov: 180, opd: 25, days: 26, apps: 'both', markup: p.appMarkup, commission: p.appCommission,
             appDelivery: p.appDelivery, appService: p.appService, tier: p.defaultTier, paidBy: p.paidBy, delivery: p.feestDelivery };
  }

  /** One order on the apps vs on FEEST, and the month at the vendor's volumes. */
  function compare(t) {
    const aov = num(t.aov), markup = num(t.markup) / 100, comm = num(t.commission) / 100;
    const appMenu = aov * (1 + markup);
    const appCustomer = appMenu + num(t.appDelivery) + appMenu * num(t.appService) / 100 + num(t.appSmallOrder);
    const appVendor = appMenu * (1 - comm);
    const fee = aov * num(t.tier) / 100;
    const custPays = t.paidBy !== 'vendor';
    const feestCustomer = aov + (custPays ? fee : 0) + num(t.delivery);
    const feestVendor = aov - (custPays ? 0 : fee);
    const monthOrders = num(t.opd) * num(t.days);
    return {
      appMenu: round2(appMenu), appCustomer: round2(appCustomer), appVendor: round2(appVendor),
      fee: round2(fee), feestCustomer: round2(feestCustomer), feestVendor: round2(feestVendor),
      vendorGainPerOrder: round2(feestVendor - appVendor), customerSavePerOrder: round2(appCustomer - feestCustomer),
      monthOrders, monthGain: round2((feestVendor - appVendor) * monthOrders), monthFeeFeest: round2(fee * monthOrders),
    };
  }


  /* ---------- in-store price check ----------
   * The rep asks the manager for their 3 best sellers, takes the counter price, and checks
   * each on Uber Eats and Mr D through to checkout (without paying). Measured numbers replace
   * the press estimates, per app. pc: { items: [{name, store, ue, mrd}] x3,
   *   ue: {del, svc, sof, com}, mrd: {del, svc, sof, com}, useBasket }
   * Fees are rand amounts from the checkout screen; com is the % the manager says they pay.
   */
  const APPS = [{ key: 'ue', label: 'Uber Eats' }, { key: 'mrd', label: 'Mr D' }];
  const val = (v) => { if (v === '' || v === null || v === undefined) return null; const x = parseFloat(v); return Number.isFinite(x) ? x : null; };
  const round1 = (n) => Math.round(n * 10) / 10;

  function priceCheck(pc) {
    pc = pc || {};
    const items = (Array.isArray(pc.items) ? pc.items : []).slice(0, 3);
    let storeTotal = 0;
    items.forEach((i) => { const s = val(i && i.store); if (s > 0) storeTotal += s; });
    const apps = {};
    APPS.forEach(({ key, label }) => {
      let sIn = 0, app = 0, cnt = 0, listedOf = 0;
      items.forEach((i) => {
        const s = val(i && i.store), a = val(i && i[key]);
        if (s > 0) listedOf++;
        if (s > 0 && a > 0) { sIn += s; app += a; cnt++; }
      });
      const f = pc[key] || {};
      const del = val(f.del), svc = val(f.svc), sof = val(f.sof), com = val(f.com);
      const total = cnt ? app + (del || 0) + (svc || 0) + (sof || 0) : null;
      apps[key] = {
        key, label, cnt, listedOf, storeSub: round2(sIn), appSub: round2(app),
        markup: cnt ? round1((app / sIn - 1) * 100) : null,
        del, svc, sof, com,
        servicePct: svc !== null && app > 0 ? round2(svc / app * 100) : null,
        total: total === null ? null : round2(total),
        feesComplete: del !== null && svc !== null && sof !== null,
      };
    });
    const measured = APPS.some((a) => apps[a.key].cnt > 0);
    return { storeTotal: round2(storeTotal), apps, measured, useBasket: !!pc.useBasket && storeTotal > 0, checkedOn: pc.checkedOn || null,
             items: items.map((i) => ({ name: String((i && i.name) || '').trim(), store: val(i && i.store), ue: val(i && i.ue), mrd: val(i && i.mrd) })) };
  }

  /** The toolkit for one app: measured values where the rep has them, the estimate otherwise. */
  function appToolkit(t, a) {
    return Object.assign({}, t, {
      markup: a.markup !== null ? a.markup : t.markup,
      commission: a.com !== null ? a.com : t.commission,
      appDelivery: a.del !== null ? a.del : t.appDelivery,
      appService: a.servicePct !== null ? a.servicePct : t.appService,
      appSmallOrder: a.sof !== null ? a.sof : 0,
    });
  }

  /**
   * The toolkit result used everywhere (screen, agreement terms, PDF, dashboard).
   * Without a price check: compare(t) on the estimates. With one: compare against each measured
   * app, and the headline takes the smaller vendor gain and the smaller customer saving, so
   * neither number is ever overstated.
   */
  function toolkitResult(t) {
    const pc = priceCheck(t && t.priceCheck);
    const base = Object.assign({}, t);
    if (pc.useBasket) base.aov = pc.storeTotal;
    const head = { aov: num(base.aov), opd: num(base.opd), days: num(base.days) };
    if (!pc.measured) {
      const c = compare(base);
      return Object.assign(head, c, { measured: false, priceCheck: null, apps: [{ key: 'est', label: 'Uber Eats / Mr D', estimate: true, c }],
                                      gainApp: 'Uber Eats / Mr D', saveApp: 'Uber Eats / Mr D' });
    }
    const rows = APPS.filter((a) => pc.apps[a.key].cnt > 0).map((a) => {
      const x = appToolkit(base, pc.apps[a.key]);
      return { key: a.key, label: a.label, estimate: false, c: compare(x), t: x };
    });
    const gain = rows.reduce((b, r) => (r.c.vendorGainPerOrder < b.c.vendorGainPerOrder ? r : b));
    const save = rows.reduce((b, r) => (r.c.customerSavePerOrder < b.c.customerSavePerOrder ? r : b));
    return Object.assign(head, gain.c, {
      customerSavePerOrder: save.c.customerSavePerOrder, appCustomer: save.c.appCustomer,
      measured: true, priceCheck: pc, apps: rows.map((r) => ({ key: r.key, label: r.label, estimate: false, c: r.c })),
      gainApp: gain.label, saveApp: save.label,
    });
  }

  /** v: {model, services, ownDrivers, vehicles, tables, printQty} */
  function printQty(item, v) {
    const s = v.services || {};
    if (item.when === 'tableQr' && !s.tableQr) return 0;
    if (item.when === 'own_branded' && v.model !== 'own_branded') return 0;
    const set = v.printQty || {};
    if (set[item.key] !== undefined && set[item.key] !== null && set[item.key] !== '') return Math.max(0, Math.floor(num(set[item.key])));
    if (item.qty === 'tables') return Math.max(0, num(v.tables));
    if (item.qty === 'drivers') return Math.max(0, num(v.ownDrivers));
    if (item.qty === 'vehicles') return Math.max(0, num(v.vehicles));
    return Math.max(0, num(item.qty));
  }

  /** Installation pack charged to the vendor at cost, plus social setup if chosen. */
  function packCost(v, pricingOverrides, printOverrides) {
    const p = pricing(pricingOverrides);
    const rows = printList(printOverrides)
      .map((it) => Object.assign({}, it, { q: printQty(it, v) }))
      .filter((r) => r.q > 0)
      .map((r) => Object.assign(r, { unit: num(r.unit), total: round2(r.q * num(r.unit)) }));
    const printTotal = round2(rows.reduce((a, r) => a + r.total, 0));
    const social = (v.services && v.services.social) ? num(p.socialSetup) : 0;
    const sub = round2(printTotal + social);
    const vat = round2(sub * num(p.vat) / 100);
    return { rows, printTotal, social, sub, vat, total: round2(sub + vat), vatPct: num(p.vat) };
  }

  /** Start date: today + offset, as YYYY-MM-DD (South African calendar day). */
  function defaultStartDate(today, p) {
    const d = new Date(today + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + num(pricing(p).startOffsetDays, 30));
    return d.toISOString().slice(0, 10);
  }

  return { DEFAULT_PRICING, DEFAULT_PRINT, MODELS, SERVICES, APPS, pricing, printList, toolkitDefaults, compare, priceCheck, appToolkit, toolkitResult, printQty, packCost, defaultStartDate };
});
