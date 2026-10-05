/**
 * Installation checklist. Shared by server (go-live check) and browser (the screen).
 * Every listed item is required before a vendor can go live.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FeestChecklist = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  /** v: {model, services, ownDrivers, whatsapp, storePhone} */
  function installItems(v) {
    const s = v.services || {};
    const own = v.model === 'own_branded' || v.model === 'own_plain';
    const items = [
      { key: 'printOrdered',   label: 'Print ordered at cost', sub: 'Labels, stickers, seals and flyers from the pack.', field: { key: 'printRef', ph: 'Supplier order or invoice number' } },
      { key: 'printInstalled', label: 'Stickers and print installed', sub: 'Door sticker up, counter card at the till, seals and flyers handed over.' },
      { key: 'waba',           label: 'WhatsApp Business account set up', sub: "In the vendor's name, on the orders number.", field: { key: 'wabaNumber', ph: 'Orders WhatsApp number', def: v.whatsapp || v.storePhone || '' } },
      { key: 'menu',           label: 'Menu loaded in Keychat', sub: 'Categories, in-store prices, top 10 photos, hours, radius. Owner approves in the demo chat.', field: { key: 'keychatStoreId', ph: 'Keychat store ID', required: true } },
      { key: 'tableQr',        label: 'Table QR cards placed', sub: 'One per table, linked to the vendor\'s chat.', show: !!s.tableQr },
      { key: 'loyalty',        label: 'Loyalty card configured', sub: 'Reward and number of stamps chosen with the owner.', show: !!s.loyalty },
      { key: 'pilot',          label: 'Pilot order screen installed', sub: 'Staff accept incoming orders on the Pilot screen.', show: !!s.pilot, field: { key: 'pilotDevice', ph: 'Device or login' } },
      { key: 'social',         label: 'Social media set up', sub: "Accounts created in the vendor's name and handed over. Invoiced at the once-off fee.", show: !!s.social, field: { key: 'socialHandles', ph: 'Instagram / Facebook handles' } },
      { key: 'gbp',            label: 'Google Business Profile updated', sub: 'Order link and WhatsApp number on their listing.', show: !!s.gbp },
      { key: 'dispatch',
        label: own ? 'Own drivers onboarded on the FEEST driver app' : 'Store added to the open network',
        sub: own ? `${v.ownDrivers || 0} driver(s) signed in, tied to this store.${v.model === 'own_branded' ? ' Boxes and vehicles branded.' : ''}`
                 : 'Pickup pin and zone set in dispatch so accepted orders go to riders.',
        show: !!s.delivery },
      { key: 'staff',          label: 'Staff trained', sub: 'Accepting orders, packing, sealing, handing over to drivers.' },
      { key: 'testOrder',      label: 'Test order placed with the owner', sub: s.delivery ? 'Ordered on WhatsApp, accepted, delivered and confirmed.' : 'Ordered on WhatsApp, accepted and collected.' },
    ];
    return items.filter((i) => i.show !== false);
  }

  /** Returns the labels still missing before go-live; empty means ready. */
  function missingForLive(v, install) {
    const ins = install || {};
    const out = [];
    for (const i of installItems(v)) {
      if (!ins[i.key]) out.push(i.label);
      else if (i.field && i.field.required && !String(ins[i.field.key] || '').trim()) out.push(`${i.label}: ${i.field.ph}`);
    }
    return out;
  }

  return { installItems, missingForLive };
});
