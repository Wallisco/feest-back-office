'use strict';
/**
 * feest.app: the public pages the app stores require for FEEST Driver (home, privacy policy,
 * support, delete account). Served by this app when the request's host is a site host
 * (SITE_HOSTS, default feest.app and www.feest.app). Company details come from environment
 * variables so they can be filled in without a code change; until then the pages show a
 * visible "[to confirm]" marker.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'public', 'site');
const PAGES = {
  '/': { file: 'home.html', title: 'FEEST Driver: deliver for local restaurants and stores', nav: '' },
  '/privacy': { file: 'privacy.html', title: 'Privacy policy · FEEST Driver', nav: 'privacy' },
  '/support': { file: 'support.html', title: 'Support · FEEST Driver', nav: 'support' },
  '/delete-account': { file: 'delete-account.html', title: 'Delete your account · FEEST Driver', nav: 'delete' },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function details(env = process.env) {
  const tc = (v, label) => (v && v.trim() ? esc(v.trim()) : `[${label} to confirm]`);
  return {
    company: tc(env.SITE_COMPANY, 'Company name'),
    regNo: tc(env.SITE_COMPANY_REG, 'Registration number'),
    address: tc(env.SITE_COMPANY_ADDRESS, 'Physical address'),
    infoOfficer: tc(env.SITE_INFO_OFFICER, 'Information Officer'),
    privacyEmail: esc((env.SITE_PRIVACY_EMAIL || 'privacy@feest.app').trim()),
    supportEmail: esc((env.SITE_SUPPORT_EMAIL || 'support@feest.app').trim()),
    supportWhatsapp: env.SITE_SUPPORT_WHATSAPP ? esc(env.SITE_SUPPORT_WHATSAPP.trim()) : '',
    updated: '7 October 2026',
  };
}

function layout(page, body) {
  const nav = (key, href, label) => `<a href="${href}"${page.nav === key ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<!doctype html>
<html lang="en-ZA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)}</title>
<meta name="description" content="FEEST Driver is the app delivery drivers use to collect and deliver orders for local restaurants and stores on FEEST.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Albert+Sans:wght@400;600;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/site.css">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%235B2EFF'/%3E%3Ctext x='32' y='44' font-family='Arial' font-weight='900' font-size='38' text-anchor='middle' fill='%23FF5A36' transform='rotate(-34 32 32)'%3Ee%3C/text%3E%3C/svg%3E">
</head><body>
<header class="top"><div class="wrap"><a class="wm" href="/" aria-label="FEEST home">fe<span class="roll">e</span>st</a>
<nav class="links" aria-label="Pages">${nav('privacy', '/privacy', 'Privacy')}${nav('support', '/support', 'Support')}${nav('delete', '/delete-account', 'Delete account')}</nav></div></header>
<main><div class="wrap">${body}</div></main>
<footer><div class="wrap"><span>© 2026 {{company}} · FEEST Driver</span><span><a href="/privacy">Privacy</a> · <a href="/support">Support</a> · <a href="/delete-account">Delete account</a></span></div></footer>
</body></html>`;
}

/** Returns { status, html } for a site path, or null if the path isn't a site page. */
function renderSite(urlPath, env) {
  const p = urlPath.replace(/\/+$/, '') || '/';
  const page = PAGES[p];
  if (!page) return null;
  const d = details(env);
  const body = fs.readFileSync(path.join(DIR, page.file), 'utf8');
  let html = layout(page, body);
  html = html.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in d ? d[k] : m));
  html = html.replace(/\{\{#supportWhatsapp\}\}([\s\S]*?)\{\{\/supportWhatsapp\}\}/g, (m, inner) => (d.supportWhatsapp ? inner.replace(/\{\{supportWhatsapp\}\}/g, d.supportWhatsapp) : ''));
  return { status: 200, html };
}

module.exports = { renderSite, details, PAGES, DIR };
