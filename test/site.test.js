'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSite } = require('../src/site/render');

test('feest.app pages render, with company details from the environment', () => {
  for (const p of ['/', '/privacy', '/support', '/delete-account', '/privacy/']) {
    const r = renderSite(p, {});
    assert.ok(r, p);
    assert.match(r.html, /<title>/);
    assert.doesNotMatch(r.html, /\{\{/, `${p} has an unfilled placeholder`);
  }
  assert.equal(renderSite('/nope', {}), null);
  assert.match(renderSite('/privacy', {}).html, /\[Company name to confirm\]/, 'missing details are visibly marked');
  const filled = renderSite('/privacy', { SITE_COMPANY: 'Example (Pty) Ltd', SITE_INFO_OFFICER: 'A Person' }).html;
  assert.match(filled, /Example \(Pty\) Ltd/);
  assert.doesNotMatch(renderSite('/support', {}).html, /WhatsApp<\/b>/, 'no WhatsApp card without a number');
  assert.match(renderSite('/support', { SITE_SUPPORT_WHATSAPP: '+27 00 000 0000' }).html, /\+27 00 000 0000/);
});

test('privacy policy covers what the store reviewers check', () => {
  const h = renderSite('/privacy', {}).html;
  for (const s of ['background', 'Never while you', 'proof of delivery', 'POPIA', 'Information Regulator', 'How long we keep it', '18 or older']) assert.ok(h.includes(s), s);
});
