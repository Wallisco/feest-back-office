'use strict';
/**
 * The agreement and setup pack PDF: cover, parties, channel, toolkit estimate,
 * installation pack at cost, next steps, agreement wording and both signatures.
 * Built with PDFKit (pure JS, no LibreOffice needed).
 */
const PDFDocument = require('pdfkit');
const { R, fmtD } = require('./terms');

const C = { ink: '#170B3B', violet: '#5B2EFF', coral: '#FF5A36', muted: '#5B5470', soft: '#ECE6FF', line: '#E4DFF0' };

/** ag: agreement row {terms, start_date, signed_at, owner_name, owner_title, rep_name, wording_text, wording_version}
 *  sigs: {owner: Buffer, rep: Buffer} PNGs. Returns a Buffer. */
function buildPackPdf(ag, sigs) {
  return new Promise((resolve, reject) => {
    const T = ag.terms;
    const doc = new PDFDocument({ size: 'A4', margins: { top: 56, bottom: 60, left: 51, right: 51 }, bufferPages: true,
      info: { Title: `FEEST agreement pack: ${T.vendorName}`, Author: 'FEEST' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const W = doc.page.width, M = 51, IW = W - 2 * M;

    // Break the page before a block that won't fit, so multi-column rows never split across pages.
    const ensure = (h) => { if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); doc.x = M; } };
    const h2 = (s) => {
      ensure(80);
      doc.moveDown(0.8);
      const y = doc.y; doc.save().lineWidth(1.6).strokeColor(C.violet).moveTo(M, y).lineTo(M + 34, y).stroke().restore();
      doc.moveDown(0.35).font('Helvetica-Bold').fontSize(13).fillColor(C.ink).text(s, M, doc.y); doc.moveDown(0.3);
    };
    const kv = (k, v) => {
      ensure(30);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.muted).text(k.toUpperCase(), M, y + 1, { width: 130 });
      doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(String(v || '—'), M + 140, y, { width: IW - 140 });
      doc.y = Math.max(doc.y, y + 14) + 3; doc.x = M;
    };
    const row = (cells, xs, opts = {}) => {
      ensure((opts.h || 15) + 12);
      const y = doc.y;
      doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.size || 9.5).fillColor(opts.color || C.ink);
      cells.forEach((c, i) => {
        const [x, w, align] = xs[i];
        doc.text(c, x, y, { width: w, align: align || 'left' });
      });
      doc.y = y + (opts.h || 15); doc.x = M;
    };

    // Cover band
    doc.rect(0, 0, W, 132).fill(C.ink);
    doc.font('Helvetica-Bold').fontSize(40);
    const fe = doc.widthOfString('fe'), ew = doc.widthOfString('e');
    doc.fillColor('#FFFFFF').text('fe', M, 46, { lineBreak: false });
    // The tilted coral "e" of the FEEST Roll wordmark, rotated about its own centre.
    doc.save().rotate(-34, { origin: [M + fe + ew / 2, 46 + 24] }).fillColor(C.coral).text('e', M + fe, 46, { lineBreak: false }).restore();
    doc.fillColor('#FFFFFF').text('st', M + fe + ew, 46, { lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#C8BEF0').text('VENDOR AGREEMENT AND SETUP PACK', M, 98, { characterSpacing: 1 });
    for (let i = 0; i < 14; i++) doc.circle(M + 2 + i * 17, 118, 2.4).fill(C.coral);

    doc.y = 160; doc.x = M;
    doc.font('Helvetica-Bold').fontSize(24).fillColor(C.ink).text(T.vendorName);
    doc.font('Helvetica').fontSize(10.5).fillColor(C.muted).text([T.category, T.area].filter(Boolean).join(' · '));
    doc.text(`Prepared ${fmtD(ag.signed_at)} by ${ag.rep_name} for ${ag.owner_name}, ${T.ownerCompany}.`);
    doc.moveDown(0.8);
    const by = doc.y;
    doc.roundedRect(M, by, IW, 62, 6).fill(C.soft);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.violet).text('WHAT WE NEED FROM YOU', M + 14, by + 12, { characterSpacing: 0.6 });
    doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(`Reply to the email this pack came with to confirm you accept the agreement. It starts on ${fmtD(ag.start_date)}. We will print your installation pack and set up your channel before then.`, M + 14, by + 26, { width: IW - 28 });
    doc.y = by + 74; doc.x = M;

    h2('Parties');
    kv('Vendor', `${T.vendorName}, ${T.address}`);
    kv('Owning company', `${T.ownerCompany}${T.ownerReg ? ` (Reg ${T.ownerReg})` : ''}`);
    kv('Signatory', `${ag.owner_name}${ag.owner_title ? ', ' + ag.owner_title : ''} · ${T.ownerEmail} · ${T.ownerMobile}`);
    kv('Orders WhatsApp', T.whatsapp);
    kv('Store pin', `${T.pin.lat.toFixed(6)}, ${T.pin.lng.toFixed(6)}`);
    kv('FEEST', `${ag.rep_name}, sales`);
    kv('Start date', fmtD(ag.start_date));

    h2('Your channel');
    kv('Delivery model', `${T.model}${T.ownDrivers ? `, ${T.ownDrivers} own driver(s)` : ''}${T.vehicles ? `, ${T.vehicles} vehicle(s) branded` : ''}`);
    kv('Services', T.services.join(', '));
    kv('Service fee', `${T.tier}% of menu price, paid by the ${T.paidBy}`);
    if (T.delivery) kv('Delivery fee', `${R(T.deliveryFee)} per order, charged to the customer`);

    if (T.toolkit) {
      const k = T.toolkit;
      if (k.measured) {
        const pc = k.priceCheck;
        h2('Prices we checked together');
        doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(`Your best sellers at your counter and on the apps${pc.checkedOn ? `, checked on ${fmtD(pc.checkedOn)}` : ''} (delivery address about 3 km away, taken to checkout without paying):`, M, doc.y, { width: IW });
        doc.moveDown(0.4);
        const px = [[M, 200], [M + 205, 95, 'right'], [M + 305, 95, 'right'], [M + 405, IW - 405, 'right']];
        row(['Item', 'In store', 'Uber Eats', 'Mr D'], px, { bold: true, color: C.muted, size: 9 });
        const cell = (x) => (x > 0 ? R(x, 2) : 'not listed');
        pc.items.filter((i) => i.store > 0).forEach((i) => row([i.name || 'Item', R(i.store, 2), cell(i.ue), cell(i.mrd)], px));
        const A = pc.apps, mk = (a) => (a.cnt ? `${a.markup >= 0 ? '+' : ''}${a.markup}%` : '–');
        row(['Menu prices vs your counter', '', mk(A.ue), mk(A.mrd)], px, { bold: true });
        const bt = (a) => (a.total === null ? '–' : R(a.total, 2) + (a.cnt < a.listedOf ? ` (${a.cnt} of ${a.listedOf})` : ''));
        row(['Basket at checkout, with fees', R(pc.storeTotal, 2), bt(A.ue), bt(A.mrd)], px, { bold: true });
        if (A.ue.cnt < A.ue.listedOf || A.mrd.cnt < A.mrd.listedOf) doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text('(1 of 2) means not every item is listed on that app, so its basket covers fewer items.', M, doc.y, { width: IW });
      }
      ensure(130);
      h2('Your numbers (estimate)');
      doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(`On a ${R(k.aov)} order at in-store prices, ${k.opd} delivery orders a day, ${k.days} trading days a month${k.measured ? ', using the app prices and fees above' : ''}:`, M, doc.y, { width: IW });
      doc.moveDown(0.4);
      const cols = k.apps.length + 1, first = 170, cw = (IW - first) / cols;
      const xs = [[M, first]].concat(Array.from({ length: cols }, (_, j) => [M + first + j * cw, cw - 6, 'right']));
      row([''].concat(k.apps.map((a) => a.label), ['FEEST']), xs, { bold: true, color: C.muted, size: 9 });
      row(['Customer pays'].concat(k.apps.map((a) => R(a.c.appCustomer, 2)), [R(k.feestCustomer, 2)]), xs);
      row(['You receive'].concat(k.apps.map((a) => R(a.c.appVendor, 2)), [R(k.feestVendor, 2)]), xs);
      doc.moveDown(0.3).font('Helvetica-Bold').fontSize(10.5).fillColor(C.violet)
        .text(`You keep about ${R(k.monthGain)} more a month than on ${k.gainApp}. This is an estimate on your own numbers, not a promise of order volumes.`, M, doc.y, { width: IW });
    }

    h2('Installation pack, at cost');
    const P = T.pack;
    if (P.rows.length || P.social) {
      const xs = [[M, 250], [M + 255, 50, 'right'], [M + 310, 80, 'right'], [M + 395, IW - 395, 'right']];
      row(['Item', 'Qty', 'Unit', 'Total'], xs, { bold: true, color: C.muted, size: 9 });
      P.rows.forEach((r) => row([r.label, r.q.toLocaleString('en-ZA').replace(/ /g, ' '), R(r.unit, 2), R(r.total, 2)], xs));
      if (P.social) row(['Social media setup (accounts in your name)', '1', R(P.social, 2), R(P.social, 2)], xs);
      doc.save().lineWidth(0.5).strokeColor(C.line).moveTo(M + 255, doc.y).lineTo(W - M, doc.y).stroke().restore(); doc.y += 4;
      const tx = [[M + 255, 135, 'right'], [M + 395, IW - 395, 'right']];
      row(['Subtotal, excl. VAT', R(P.sub, 2)], tx);
      row([`VAT ${P.vatPct}%`, R(P.vat, 2)], tx);
      row(['Total', R(P.total, 2)], tx, { bold: true });
    } else {
      doc.font('Helvetica').fontSize(10).fillColor(C.ink).text('No print items selected.');
    }

    h2('After you confirm');
    [
      'We order your print and set up your WhatsApp Business account and menu.',
      T.services.includes('Pilot order screen') ? 'We install the Pilot screen: you accept each order there.' : 'Orders arrive in your WhatsApp chat for you to accept.',
      T.delivery ? (T.modelKey === 'open' ? 'Accepted delivery orders go to the FEEST rider network automatically.' : 'Accepted delivery orders go to your own drivers on the FEEST driver app.') : 'Customers collect in store.',
      'An onboarder visits to put up stickers, train staff and place a test order with you.',
    ].forEach((s) => { ensure(30); doc.font('Helvetica').fontSize(10).fillColor(C.ink).text(`•  ${s}`, M, doc.y, { width: IW }).moveDown(0.15); });

    doc.addPage();
    h2(`Agreement (wording v${ag.wording_version})`);
    doc.font('Helvetica').fontSize(9).fillColor(C.ink).text(ag.wording_text, M, doc.y, { width: IW, lineGap: 2 });
    doc.moveDown(1.5);
    ensure(120);
    const sy = doc.y, colW = (IW - 24) / 2;
    [[sigs.owner, `For ${T.ownerCompany}`, `${ag.owner_name}${ag.owner_title ? ', ' + ag.owner_title : ''}`],
     [sigs.rep, 'For FEEST', ag.rep_name]].forEach(([img, head, who], i) => {
      const x = M + i * (colW + 24);
      try { doc.image(img, x, sy, { fit: [colW, 60] }); } catch (e) { /* signature image unreadable */ }
      doc.save().lineWidth(0.6).strokeColor(C.muted).moveTo(x, sy + 66).lineTo(x + colW, sy + 66).stroke().restore();
      doc.font('Helvetica-Bold').fontSize(9).fillColor(C.ink).text(head, x, sy + 72, { width: colW });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.muted).text(`${who} · signed ${fmtD(ag.signed_at)}`, x, sy + 85, { width: colW });
    });
    doc.y = sy + 110; doc.x = M;
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('Signed on screen at the vendor\'s premises. Takes effect when the vendor confirms this pack.', M, doc.y, { width: IW });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // footer sits in the margin; stop PDFKit adding a page for it
      doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(`FEEST · ${T.vendorName} · page ${i + 1} of ${range.count}`, M, doc.page.height - 40, { width: IW, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { buildPackPdf };
