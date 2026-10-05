'use strict';
/** Builds the terms snapshot stored with a signed agreement, and the pack email. */
const F = require('./finance');

/** DB row → the shape finance.js and checklist.js expect. */
function shape(v) {
  return {
    model: v.model, services: v.services || {}, ownDrivers: v.own_drivers || 0, vehicles: v.vehicles || 0,
    tables: v.tables || 0, printQty: v.print_qty || {}, whatsapp: v.whatsapp, storePhone: v.store_phone,
  };
}

/** vendor row joined with owner_*, area_name, rep_name; settings {pricing, print} */
function termsFor(v, settings) {
  const p = F.pricing(settings.pricing);
  const t = Object.assign(F.toolkitDefaults(p), v.toolkit || {});
  const s = v.services || {};
  const pack = F.packCost(shape(v), settings.pricing, settings.print);
  const model = (F.MODELS.find((m) => m.key === v.model) || {}).label || '';
  return {
    vendorName: v.name, category: v.category, address: v.address, area: v.area_name || '',
    pin: { lat: Number(v.lat), lng: Number(v.lng) }, whatsapp: v.whatsapp || v.store_phone || '',
    ownerCompany: v.owner_name || '', ownerReg: v.owner_reg_no || '', ownerContact: v.owner_contact_name || '',
    ownerTitle: v.owner_title || '', ownerEmail: v.owner_email || '', ownerMobile: v.owner_mobile || '',
    rep: v.rep_name || '',
    modelKey: v.model, model, ownDrivers: v.own_drivers || 0, vehicles: v.model === 'own_branded' ? (v.vehicles || 0) : 0,
    services: F.SERVICES.filter((x) => s[x.key]).map((x) => x.label),
    tier: Number(t.tier), paidBy: t.paidBy === 'vendor' ? 'vendor' : 'customer',
    delivery: !!s.delivery, deliveryFee: Number(t.delivery) || 0,
    toolkit: s.delivery ? Object.assign({ aov: Number(t.aov), opd: Number(t.opd), days: Number(t.days) }, F.compare(t)) : null,
    pack, social: !!s.social,
  };
}

const R = (n, dp = 0) => 'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace(/ /g, ' ');
const fmtD = (d) => { if (!d) return ''; const x = new Date(typeof d === 'string' && d.length === 10 ? d + 'T12:00:00Z' : d); return x.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' }); };

function packEmail(ag) {
  const T = ag.terms;
  const first = (ag.owner_name || '').split(' ')[0] || 'there';
  const lines = [
    `Hi ${first},`, '',
    `Thank you for signing up ${T.vendorName} with FEEST today.`, '',
    'Attached is your agreement and setup pack: your deal, your numbers from the sales toolkit, and your installation pack at cost.', '',
    'In short:',
    `- Start date: ${fmtD(ag.start_date)}`,
    `- Service fee: ${T.tier}% of menu price, paid by the ${T.paidBy}`,
    T.delivery ? `- Delivery: ${T.model}, ${R(T.deliveryFee)} delivery fee charged to the customer` : '- No delivery: pickup and in-store ordering',
    `- Services: ${T.services.join(', ')}`,
    `- Installation pack: ${R(T.pack.total, 2)} incl. VAT${T.social ? `, including ${R(T.pack.social)} social media setup` : ''}`,
    T.toolkit ? `- Estimate: you keep about ${R(T.toolkit.monthGain)} more a month than on the apps` : null, '',
    'Please reply "I confirm" to accept the agreement. We will then order your print and set up your WhatsApp ordering before the start date.', '',
    'Kind regards,', ag.rep_name, 'FEEST',
  ].filter((x) => x !== null);
  return { to: T.ownerEmail, subject: `FEEST agreement and setup pack: ${T.vendorName}`, text: lines.join('\n') };
}

module.exports = { shape, termsFor, packEmail, R, fmtD };
