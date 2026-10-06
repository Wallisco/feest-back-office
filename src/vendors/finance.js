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
    const appCustomer = appMenu + num(t.appDelivery) + appMenu * num(t.appService) / 100;
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

  /**
   * In-store price check: the rep asks the manager for the 3 best sellers, takes the
   * counter price, then checks the same items on Uber Eats and Mr D through to checkout.
   * pc: {items: [{name, store, uber, mrd}] (up to 3),
   *      uber: {delivery, service, small, commission}, mrd: {…}}  — rand, commission in %.
   * Blank (null/'') means not checked; an app price of 0 or blank means not listed.
   * Returns per-app results and `use`: the measured rates the comparison runs on.
   * The comparison is against the cheaper of the two apps at checkout, so the
   * vendor's gain is never overstated.
   */
  function priceCheck(pc) {
    pc = pc || {};
    const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(parseFloat(v));
    const items = (Array.isArray(pc.items) ? pc.items : []).slice(0, 3)
      .map((it) => ({ name: String((it && it.name) || '').trim().slice(0, 80), store: num(it && it.store), uber: num(it && it.uber), mrd: num(it && it.mrd) }))
      .filter((it) => it.store > 0);
    const storeTotal = round2(items.reduce((a, it) => a + it.store, 0));
    const apps = {};
    ['uber', 'mrd'].forEach((k) => {
      const f = pc[k] || {};
      const listed = items.filter((it) => it[k] > 0);
      const sIn = listed.reduce((a, it) => a + it.store, 0), app = listed.reduce((a, it) => a + it[k], 0);
      const fees = { delivery: has(f.delivery) ? num(f.delivery) : null, service: has(f.service) ? num(f.service) : null, small: has(f.small) ? num(f.small) : null };
      apps[k] = {
        listed: listed.length, of: items.length,
        storeListed: round2(sIn), appSubtotal: round2(app),
        markup: listed.length ? round2((app / sIn - 1) * 100) : null,
        ...fees,
        feesComplete: fees.delivery !== null && fees.service !== null && fees.small !== null,
        commission: has(f.commission) ? Math.min(100, Math.max(0, num(f.commission))) : null,
        checkout: listed.length ? round2(app + (fees.delivery || 0) + (fees.service || 0) + (fees.small || 0)) : null,
      };
    });
    // Which app to compare against: the cheaper checkout among apps with prices, as a share of the counter price.
    const ratio = (k) => (apps[k].checkout === null ? Infinity : apps[k].checkout / apps[k].storeListed);
    const pick = ['uber', 'mrd'].filter((k) => apps[k].markup !== null).sort((a, b) => ratio(a) - ratio(b))[0] || null;
    let use = null;
    if (pick) {
      const a = apps[pick];
      use = {
        app: pick, markup: a.markup,
        appDelivery: a.delivery !== null || a.small !== null ? round2((a.delivery || 0) + (a.small || 0)) : null,
        appService: a.service !== null && a.appSubtotal > 0 ? round2(a.service / a.appSubtotal * 100) : null,
        commission: a.commission,
      };
    }
    return { items, storeTotal, uber: apps.uber, mrd: apps.mrd, measured: !!pick, use };
  }

  /** Toolkit inputs with any measured price-check rates laid over the typed-in ones. */
  function withPriceCheck(t) {
    const r = priceCheck(t && t.priceCheck);
    if (!r.measured) return t;
    const o = Object.assign({}, t, { markup: r.use.markup });
    if (r.use.appDelivery !== null) o.appDelivery = r.use.appDelivery;
    if (r.use.appService !== null) o.appService = r.use.appService;
    if (r.use.commission !== null) o.commission = r.use.commission;
    return o;
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

  return { DEFAULT_PRICING, DEFAULT_PRINT, MODELS, SERVICES, pricing, printList, toolkitDefaults, compare, priceCheck, withPriceCheck, printQty, packCost, defaultStartDate };
});
