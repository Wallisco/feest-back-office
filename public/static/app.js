/* FEEST Back Office: single-page app over /api. Money maths and the installation checklist come
   from /static/finance.js and /static/checklist.js, the same files the server uses. */
(function () {
'use strict';
const F = window.FeestFinance, CL = window.FeestChecklist;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nowIso = () => new Date().toISOString();
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
const fmtD = (iso) => { if (!iso) return ''; const d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso); return isNaN(d) ? '' : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }); };
const fmtDT = (iso) => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }); };
const R = (n, dp = 0) => 'R ' + Number(n || 0).toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp });
const num = (v, d = 0) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

/* ---------- API ---------- */
async function api(method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { throw new Error('No connection. Check your signal and try again.'); }
  if (r.status === 401) { location.href = '/login'; throw new Error('Sign in again.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; throw e; }
  return j;
}
const GET = (u) => api('GET', u), POST = (u, b) => api('POST', u, b || {}), PUT = (u, b) => api('PUT', u, b || {});

/* ---------- State ---------- */
const S = { me: null, users: [], areas: [], owners: [], vendors: [], agreements: [], categories: [], settings: null, stages: [], roles: [], mailConfigured: false, loaded: false };
const pricing = () => F.pricing(S.settings && S.settings.pricing);
const printList = () => F.printList(S.settings && S.settings.print);
const byId = (c, id) => (id ? S[c].find((x) => x.id === id) : null);
const nm = (c, id) => (byId(c, id) || {}).name || '';
const sorted = (a) => a.slice().sort((x, y) => (x.name || '').localeCompare(y.name || ''));
const agreementOf = (id) => S.agreements.find((a) => a.vendorId === id);
const stageInfo = (k) => S.stages.find((s) => s.key === k) || { key: k, label: k };
const pill = (v) => { const s = stageInfo(v.stage); return `<span class="pill st-${esc(s.key)}">${esc(s.label)}</span>`; };
const roleLabel = (k) => (S.roles.find((r) => r.key === k) || {}).label || k;
const modelLabel = (k) => (F.MODELS.find((m) => m.key === k) || {}).label || '';

async function refresh() {
  const b = await GET('/api/bootstrap');
  Object.assign(S, b, { loaded: true });
  renderNav();
  return b;
}

function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 3000); }
async function copyText(text, el) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) { if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } toast('Select the text and copy it'); }
}
function pickFile(accept) {
  return new Promise((res) => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.hidden = true;
    i.onchange = () => { res(i.files[0] || null); i.remove(); };
    document.body.appendChild(i); i.click();
  });
}
/** Downscale a phone photo before upload: fast on mobile data, small on disk. */
function shrink(file, max, type) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d');
      if (type === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); }
      x.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL(type, 0.82));
    }; img.onerror = rej; img.src = fr.result; };
    fr.onerror = rej; fr.readAsDataURL(file);
  });
}

/* ---------- Combo: dropdown with add-new (as in the ScootHero back office) ---------- */
function Combo(host, cfg) {
  const uid = 'cb_' + cfg.key;
  const self = { value: cfg.value || '' };
  host.classList.add('field');
  const fields = cfg.fields || [{ key: 'name', label: cfg.noun[0].toUpperCase() + cfg.noun.slice(1) + ' name' }];
  host.innerHTML = `<label for="${uid}">${esc(cfg.label)}</label><select id="${uid}"></select>
    <div class="addrow" hidden>
      ${fields.map((x) => `<input class="inp" data-k="${x.key}" type="${x.type || 'text'}" placeholder="${esc(x.label)}" aria-label="${esc(x.label)}">`).join('')}
      <div class="err" hidden></div>
      <div class="acts"><button type="button" class="btn btn-sm" data-a="add">Add ${esc(cfg.noun)}</button><button type="button" class="btn btn-sm btn-ghost" data-a="cancel">Cancel</button></div>
    </div><div class="readout" hidden></div>`;
  const sel = host.querySelector('select'), row = host.querySelector('.addrow'), err = row.querySelector('.err'), readout = host.querySelector('.readout');
  function refreshCombo() {
    const opts = cfg.options();
    const adding = !row.hidden;
    sel.innerHTML = `<option value="">${esc(cfg.placeholder)}</option>` + opts.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('') +
      (cfg.onAdd ? `<option value="__new">+ Add new ${esc(cfg.noun)}</option>` : '');
    sel.value = adding ? '__new' : (opts.find((o) => o.id === self.value) ? self.value : '');
    if (cfg.readout) { const r = cfg.readout(self.value); readout.hidden = !r; readout.innerHTML = r || ''; }
  }
  function closeAdd() { row.hidden = true; err.hidden = true; row.querySelectorAll('[data-k]').forEach((i) => (i.value = '')); }
  sel.addEventListener('change', () => {
    if (sel.value === '__new') { row.hidden = false; row.querySelector('[data-k]').focus(); return; }
    closeAdd(); self.value = sel.value; cfg.onChange && cfg.onChange(self.value); refreshCombo();
  });
  row.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'cancel') { closeAdd(); refreshCombo(); return; }
    const data = {}; row.querySelectorAll('[data-k]').forEach((i) => (data[i.dataset.k] = i.value.trim()));
    const badMsg = cfg.validate ? cfg.validate(data) : (!data.name ? 'Enter a name.' : '');
    if (badMsg) { err.textContent = badMsg; err.hidden = false; return; }
    a.disabled = true;
    try { const id = await cfg.onAdd(data); await refresh(); self.value = id; closeAdd(); cfg.onChange && cfg.onChange(id); toast(`${cfg.noun[0].toUpperCase() + cfg.noun.slice(1)} added`); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; }
    a.disabled = false; refreshCombo();
  });
  self.refresh = refreshCombo;
  self.set = (v) => { self.value = v || ''; refreshCombo(); };
  refreshCombo();
  return self;
}

/* ---------- Routing ---------- */
let current = { onData: null };
function route() {
  const h = location.hash.replace(/^#/, '') || 'dashboard';
  const [a, b, c] = h.split('/');
  document.querySelectorAll('nav.side a').forEach((l) => l.removeAttribute('aria-current'));
  const key = a === 'vendor' ? 'funnel/all' : a === 'setup' ? 'setup' : a === 'funnel' ? 'funnel/' + (b || 'all') : a;
  const match = document.querySelector(`nav.side a[href="#${CSS.escape(key)}"]`);
  if (match) match.setAttribute('aria-current', 'page');
  closeMenu();
  current = { onData: null };
  window.scrollTo(0, 0);
  if (a === 'new') viewDetails(null);
  else if (a === 'vendor') viewVendor(b, c || 'details');
  else if (a === 'areas') viewAreas();
  else if (a === 'funnel') viewFunnel(b || 'all');
  else if (a === 'setup') viewSetup(b || (S.me.can.manageUsers ? 'team' : 'account'));
  else viewDashboard();
}
window.addEventListener('hashchange', route);

function renderNav() {
  $('n-all').textContent = S.vendors.filter((v) => v.stage !== 'notnow').length || '';
  $('n-areas').textContent = S.areas.length || '';
  $('navStages').innerHTML = S.stages.map((s) => {
    const n = S.vendors.filter((v) => v.stage === s.key).length;
    const hot = (s.key === 'signoff' || s.key === 'install') && n;
    return `<a class="navlink" href="#funnel/${s.key}"><span>${esc(s.label)}</span><span class="n${hot ? ' hot' : ''}">${n || ''}</span></a>`;
  }).join('');
  $('navNew').hidden = !S.me.can.sell;
  $('who').innerHTML = `<b>${esc(S.me.name)}</b>${esc(roleLabel(S.me.role))}<button type="button" id="logout">Sign out</button>`;
  $('logout').onclick = async () => { await POST('/auth/logout').catch(() => {}); location.href = '/login'; };
  const h = location.hash.replace(/^#/, '');
  const m = document.querySelector(`#navStages a[href="#${CSS.escape(h)}"]`);
  if (m) m.setAttribute('aria-current', 'page');
}
function closeMenu() { $('side').classList.remove('open'); $('scrim').hidden = true; $('menuBtn').setAttribute('aria-expanded', 'false'); }
$('menuBtn').onclick = () => { $('side').classList.add('open'); $('scrim').hidden = false; $('menuBtn').setAttribute('aria-expanded', 'true'); };
$('scrim').onclick = closeMenu;

/* =========================================================
   DASHBOARD
   ========================================================= */
function viewDashboard() {
  function draw() {
    const vs = S.vendors;
    const count = (k) => vs.filter((v) => v.stage === k).length;
    const funnel = S.stages.filter((s) => s.key !== 'notnow');
    const max = Math.max(1, ...funnel.map((s) => count(s.key)));
    const month = todayStr().slice(0, 7);
    const signedMonth = S.agreements.filter((a) => (a.signedAt || '').slice(0, 7) === month).length;
    const live = vs.filter((v) => v.stage === 'live');
    const monthFees = live.reduce((a, v) => a + (v.toolkit && v.services && v.services.delivery ? F.compare(v.toolkit).monthFeeFeest : 0), 0);
    const installValue = vs.filter((v) => ['install', 'live'].includes(v.stage)).reduce((a, v) => a + F.packCost(v, S.settings.pricing, S.settings.print).sub, 0);
    const reps = sorted(S.users).map((u) => {
      const mine = vs.filter((v) => v.repId === u.id);
      return { u, cap: mine.length, signed: mine.filter((v) => agreementOf(v.id)).length, live: mine.filter((v) => v.stage === 'live').length, areas: S.areas.filter((a) => a.reps.includes(u.id)).length };
    }).filter((r) => r.cap || r.areas);
    const noRep = S.areas.filter((a) => !a.reps.length);
    const notEmailed = vs.filter((v) => v.stage === 'signoff' && !v.packEmailedAt);
    const overdue = vs.filter((v) => v.stage === 'signoff' && v.packEmailedAt && Date.now() - new Date(v.packEmailedAt) > 4 * 864e5);
    $('main').innerHTML = `<div class="wrap">
      <div class="pagehead"><div><div class="eyebrow">FEEST back office</div><h1>Dashboard</h1></div>
        ${S.me.can.sell ? '<a class="btn btn-coral" href="#new">New vendor</a>' : ''}</div>
      ${!vs.length ? `<div class="card empty"><h2>No vendors yet</h2><p>Start with Step 1: add the areas you sell in and allocate your sales reps. Then reps capture vendors from <b>New vendor</b> on their phones.</p><div class="acts"><a class="btn" href="#areas">Set up areas</a>${S.me.can.manageUsers ? '<a class="btn btn-ghost" href="#setup/team">Add the team</a>' : ''}</div></div>` : ''}
      <div class="stats">
        <div class="stat lead"><div class="k">Vendors live</div><div class="v">${live.length}</div><div class="s">${vs.filter((v) => v.stage !== 'notnow').length} open in the funnel</div></div>
        <div class="stat"><div class="k">Agreements signed this month</div><div class="v">${signedMonth}</div><div class="s">${S.agreements.length} active in total</div></div>
        <div class="stat"><div class="k">FEEST fees from live vendors</div><div class="v">${R(monthFees)}</div><div class="s">a month, on their toolkit numbers</div></div>
        <div class="stat"><div class="k">Installation packs at cost</div><div class="v">${R(installValue)}</div><div class="s">excl. VAT, signed-off vendors</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h2>Funnel</h2><div class="funnelbar">
          ${funnel.map((s) => { const n = count(s.key); return `<a class="fb ${s.key === 'live' ? 'live' : ''}" href="#funnel/${s.key}"><span>${esc(s.label)}</span><span class="track"><span class="fill" style="display:block;width:${(n / max * 100).toFixed(1)}%"></span></span><span class="num">${n}</span></a>`; }).join('')}
        </div><p class="small">${count('notnow')} closed as Not now.</p></div>
        <div class="card"><h2>Needs attention</h2>
          ${!notEmailed.length && !overdue.length && !noRep.length ? '<p class="small">Nothing waiting. Packs are out and every area has a rep.</p>' : ''}
          ${notEmailed.map((v) => `<a class="callout warnc" style="text-decoration:none" href="#vendor/${v.id}/pack"><b>${esc(v.name)}</b>: agreement signed, pack not emailed yet</a>`).join('')}
          ${overdue.map((v) => `<a class="callout warnc" style="text-decoration:none" href="#vendor/${v.id}/pack"><b>${esc(v.name)}</b>: pack emailed ${esc(fmtD(v.packEmailedAt))}, no sign-off yet</a>`).join('')}
          ${noRep.length ? `<a class="callout info" style="text-decoration:none" href="#areas">${noRep.length} area${noRep.length > 1 ? 's have' : ' has'} no sales rep allocated</a>` : ''}
        </div>
      </div>
      ${reps.length ? `<div class="card"><h2>Sales reps</h2><div class="tablewrap compact"><table><thead><tr><th>Rep</th><th class="r">Areas</th><th class="r">Captured</th><th class="r">Signed</th><th class="r">Live</th></tr></thead><tbody>
        ${reps.map((r) => `<tr><td>${esc(r.u.name)}</td><td class="r">${r.areas}</td><td class="r">${r.cap}</td><td class="r">${r.signed}</td><td class="r">${r.live}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
      <div class="card"><h2>How a vendor goes live</h2><div class="flow">
        <div><b>Areas</b><span>Reps allocated to areas</span></div>
        <div><b>Capture</b><span>Pin, owner, photos</span></div>
        <div><b>Toolkit</b><span>Model, services, numbers</span></div>
        <div><b>Agreement</b><span>Signed on screen, starts in ${pricing().startOffsetDays} days</span></div>
        <div><b>Pack</b><span>Emailed for sign-off</span></div>
        <div><b>Installation</b><span>Print at cost, WhatsApp, Pilot</span></div>
        <div><b>Live</b><span>Orders via Keychat, delivered by dispatch</span></div>
      </div></div>
    </div>`;
  }
  current.onData = draw; draw();
}

/* =========================================================
   STEP 1: AREAS AND REPS
   ========================================================= */
function viewAreas() {
  let editing = null;
  const can = S.me.can.manageAreas;
  function draw() {
    const reps = sorted(S.users.filter((u) => u.active && ['sales_rep', 'sales_lead'].includes(u.role)));
    $('main').innerHTML = `<div class="wrap">
      <div class="pagehead"><div><div class="eyebrow">Step 1</div><h1>Areas and reps</h1><p class="small" style="margin-top:4px">Each sales rep works the areas they're allocated to. New vendors pick up the area's rep automatically.</p></div></div>
      ${can ? `<div class="card"><h2>${editing ? 'Edit area' : 'Add an area'}</h2>
        <form id="areaForm" class="grid3">
          <div class="field"><label for="a_name">Area</label><input id="a_name" required placeholder="e.g. Claremont" value="${esc(editing?.name || '')}"></div>
          <div class="field"><label for="a_city">City</label><input id="a_city" list="cityList" placeholder="e.g. Cape Town" value="${esc(editing?.city || '')}">
            <datalist id="cityList">${[...new Set(S.areas.map((a) => a.city).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist></div>
          <div class="field"><label for="a_target">Vendor target</label><input id="a_target" type="number" min="0" inputmode="numeric" placeholder="e.g. 40" value="${esc(editing?.target ?? '')}"></div>
          <div class="field span2"><span class="lbl">Sales reps allocated</span>
            ${reps.length ? `<div class="chips" id="a_reps">${reps.map((u) => `<label class="chip"><input type="checkbox" value="${esc(u.id)}" ${(editing?.reps || []).includes(u.id) ? 'checked' : ''}> ${esc(u.name)}</label>`).join('')}</div>`
                          : `<p class="small">No sales reps yet. ${S.me.can.manageUsers ? '<a href="#setup/team">Add them in Setup</a>, then allocate them here.' : 'Ask an admin to add them.'}</p>`}
          </div>
          <div class="field"><label for="a_notes">Notes</label><input id="a_notes" placeholder="Precinct, main roads, malls" value="${esc(editing?.notes || '')}"></div>
          <div class="acts span2"><button class="btn" type="submit" id="a_save">${editing ? 'Save area' : 'Add area'}</button>${editing ? '<button class="btn btn-ghost" type="button" id="a_cancel">Cancel</button>' : ''}</div>
        </form></div>` : '<p class="ro">Only sales leads and admins change areas. You can see your allocation below.</p>'}
      ${S.areas.length ? `<div class="tablewrap"><table><thead><tr><th>Area</th><th>City</th><th>Reps</th><th class="r">Vendors</th><th class="r">Live</th><th class="r">Target</th>${can ? '<th></th>' : ''}</tr></thead><tbody>
        ${S.areas.map((a) => {
          const vs = S.vendors.filter((v) => v.areaId === a.id && v.stage !== 'notnow');
          const live = vs.filter((v) => v.stage === 'live').length;
          const rn = a.reps.map((id) => nm('users', id)).filter(Boolean);
          return `<tr><td class="strong">${esc(a.name)}</td><td>${esc(a.city || '')}</td><td>${rn.length ? esc(rn.join(', ')) : '<span class="pill st-notnow">No rep</span>'}</td>
            <td class="r"><a href="#funnel/all" data-area="${esc(a.id)}">${vs.length}</a></td><td class="r">${live}</td><td class="r">${a.target ? esc(a.target) : '—'}</td>
            ${can ? `<td class="r"><button class="btn btn-sm btn-ghost" data-edit="${esc(a.id)}">Edit</button></td>` : ''}</tr>`;
        }).join('')}</tbody></table></div>`
        : '<div class="card empty"><h2>No areas yet</h2><p>Add the first area, for example the precinct you\'re starting in, and allocate a rep to it.</p></div>'}
    </div>`;
    if (can) {
      $('areaForm').onsubmit = async (e) => {
        e.preventDefault();
        const data = { name: $('a_name').value.trim(), city: $('a_city').value.trim(), target: $('a_target').value === '' ? null : num($('a_target').value),
          notes: $('a_notes').value.trim(), reps: [...document.querySelectorAll('#a_reps input:checked')].map((i) => i.value) };
        $('a_save').disabled = true;
        try { if (editing) await PUT('/api/areas/' + editing.id, data); else await POST('/api/areas', data); toast(editing ? 'Area saved' : 'Area added'); editing = null; await refresh(); draw(); }
        catch (ex) { toast(ex.message); $('a_save').disabled = false; }
      };
      if ($('a_cancel')) $('a_cancel').onclick = () => { editing = null; draw(); };
      document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => { editing = S.areas.find((a) => a.id === b.dataset.edit); draw(); window.scrollTo(0, 0); }));
    }
    document.querySelectorAll('[data-area]').forEach((l) => (l.onclick = () => lsSet('feest_filter_area', l.dataset.area)));
  }
  current.onData = () => { if (!document.activeElement || !document.activeElement.closest('#areaForm')) draw(); };
  draw();
}

/* =========================================================
   FUNNEL LISTS
   ========================================================= */
function nextStep(v) {
  if (v.stage === 'captured') return v.model ? 'toolkit' : 'services';
  if (v.stage === 'ready') return 'agreement';
  if (v.stage === 'signoff') return 'pack';
  if (v.stage === 'install' || v.stage === 'live') return 'install';
  return 'details';
}
function viewFunnel(key) {
  const st = S.stages.find((s) => s.key === key);
  let fArea = lsGet('feest_filter_area') || '', fRep = lsGet('feest_filter_rep') || '', fCat = '', q = '';
  lsSet('feest_filter_area', '');
  const rows = () => S.vendors.filter((v) => (key === 'all' ? v.stage !== 'notnow' : v.stage === key))
    .filter((v) => !fArea || v.areaId === fArea).filter((v) => !fRep || v.repId === fRep).filter((v) => !fCat || v.category === fCat)
    .filter((v) => !q || (v.name + ' ' + nm('owners', v.ownerId)).toLowerCase().includes(q.toLowerCase()));
  function draw() {
    $('main').innerHTML = `<div class="wrap">
      <div class="pagehead"><div><div class="eyebrow">Vendor funnel</div><h1>${st ? esc(st.label) : 'All vendors'}</h1>${st ? `<p class="small" style="margin-top:4px">${esc(st.hint)}</p>` : ''}</div>
        ${S.me.can.sell ? '<a class="btn btn-coral" href="#new">New vendor</a>' : ''}</div>
      <div class="filters">
        <input id="fq" type="search" placeholder="Search vendor or owner" aria-label="Search" value="${esc(q)}">
        <select id="fArea" aria-label="Area"><option value="">All areas</option>${sorted(S.areas).map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}</select>
        <select id="fRep" aria-label="Sales rep"><option value="">All reps</option>${sorted(S.users).map((u) => `<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select>
        <select id="fCat" aria-label="Category"><option value="">All categories</option>${S.categories.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        <a class="btn btn-sm btn-ghost" href="#" id="mine">My vendors</a>
      </div>
      <div id="listHost"></div>
    </div>`;
    $('fArea').value = fArea; $('fRep').value = fRep; $('fCat').value = fCat;
    $('fq').oninput = (e) => { q = e.target.value; drawList(); };
    $('fArea').onchange = (e) => { fArea = e.target.value; drawList(); };
    $('fRep').onchange = (e) => { fRep = e.target.value; lsSet('feest_filter_rep', fRep); drawList(); };
    $('fCat').onchange = (e) => { fCat = e.target.value; drawList(); };
    $('mine').onclick = (e) => { e.preventDefault(); fRep = S.me.id; $('fRep').value = fRep; lsSet('feest_filter_rep', fRep); drawList(); };
    drawList();
  }
  function drawList() {
    const list = rows();
    $('listHost').innerHTML = list.length ? `<div class="tablewrap"><table><thead><tr><th>Vendor</th><th>Category</th><th>Area</th><th>Rep</th><th>Owner</th><th>Model</th><th>Stage</th><th>Updated</th></tr></thead><tbody>
      ${list.map((v) => `<tr class="click" data-id="${esc(v.id)}" tabindex="0"><td class="strong">${esc(v.name)}</td><td>${esc(v.category || '')}</td><td>${esc(nm('areas', v.areaId))}</td><td>${esc(nm('users', v.repId))}</td><td>${esc(nm('owners', v.ownerId))}</td>
        <td>${esc(modelLabel(v.model) || '—')}</td><td>${pill(v)}</td><td class="small">${esc(fmtD(v.updatedAt))}</td></tr>`).join('')}
    </tbody></table></div>` : `<div class="card empty"><h2>Nothing here</h2><p>${S.vendors.length ? 'No vendors match these filters.' : 'Capture the first vendor with New vendor.'}</p></div>`;
    document.querySelectorAll('tr[data-id]').forEach((tr) => {
      const go = () => { const v = S.vendors.find((x) => x.id === tr.dataset.id); location.hash = 'vendor/' + tr.dataset.id + '/' + nextStep(v); };
      tr.onclick = go; tr.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    });
  }
  current.onData = drawList; draw();
}

/* =========================================================
   VENDOR RECORD
   ========================================================= */
const STEPS = [
  { key: 'details', label: 'Details' }, { key: 'services', label: 'Model and services' }, { key: 'toolkit', label: 'Sales toolkit' },
  { key: 'agreement', label: 'Agreement' }, { key: 'pack', label: 'Pack and sign-off' }, { key: 'install', label: 'Installation' },
];
function stepState(v, key) {
  if (!v) return { done: false, locked: key !== 'details' };
  const ag = !!v.agreement;
  return {
    done: { details: true, services: !!v.model, toolkit: !!v.toolkitCompletedAt, agreement: ag, pack: !!v.pack.signedOffOn, install: !!v.liveAt }[key],
    locked: { details: false, services: false, toolkit: !v.model, agreement: !v.toolkitCompletedAt, pack: !ag, install: !v.pack.signedOffOn }[key],
  };
}
function vendorHead(v, step) {
  const logo = v && v.photos && v.photos.logo;
  const canSell = v ? v.can.sell : S.me.can.sell;
  return `<div class="pagehead">
    <div class="vhead"><div class="logo">${logo ? `<img src="${esc(logo)}" alt="">` : esc((v?.name || '?').slice(0, 1).toUpperCase())}</div>
      <div><div class="eyebrow">${v ? esc([v.category, nm('areas', v.areaId)].filter(Boolean).join(' · ')) : 'New vendor'}</div>
      <h1>${v ? esc(v.name) : 'Capture a vendor'}</h1>${v ? `<div style="margin-top:4px">${pill(v)}</div>` : ''}</div></div>
    ${v && canSell && !v.closed && v.stage !== 'live' ? '<button class="btn btn-sm btn-ghost" id="closeBtn">Mark not now</button>' : v && canSell && v.closed ? '<button class="btn btn-sm btn-ghost" id="reopenBtn">Reopen</button>' : ''}
  </div>
  ${v && v.closed ? `<div class="callout warnc">Closed ${esc(fmtD(v.closed.at))}: ${esc(v.closed.reason)}${v.closed.note ? '. ' + esc(v.closed.note) : ''}</div>` : ''}
  ${v && !canSell ? '<p class="ro">You can view this vendor. Changes are made by its sales rep, a sales lead or an admin.</p>' : ''}
  <nav class="stepper" aria-label="Vendor steps">${STEPS.map((s, i) => { const ss = stepState(v, s.key);
    return `<a class="step ${ss.done ? 'done' : ''} ${ss.locked ? 'locked' : ''}" ${s.key === step ? 'aria-current="step"' : ''} href="${v ? `#vendor/${v.id}/${s.key}` : '#new'}" ${ss.locked ? 'aria-disabled="true" tabindex="-1"' : ''}><i>${ss.done ? '✓' : i + 1}</i>${esc(s.label)}</a>`; }).join('')}</nav>
  <div id="closeHost"></div>`;
}
function bindHead(v) {
  if ($('closeBtn')) $('closeBtn').onclick = () => {
    $('closeHost').innerHTML = `<div class="card"><h3>Close as Not now</h3><div class="grid2">
      <div class="field"><label for="cl_reason">Reason</label><select id="cl_reason"><option>Not interested</option><option>Happy with current apps</option><option>Owner not available</option><option>Price</option><option>Not now, revisit</option><option>Other</option></select></div>
      <div class="field"><label for="cl_note">Note</label><input id="cl_note" placeholder="Optional"></div></div>
      <div class="acts"><button class="btn btn-danger" id="cl_go">Close vendor</button><button class="btn btn-ghost" id="cl_x">Cancel</button></div></div>`;
    $('cl_x').onclick = () => ($('closeHost').innerHTML = '');
    $('cl_go').onclick = () => act(v, 'close', { reason: $('cl_reason').value, note: $('cl_note').value.trim() }, 'Closed as Not now');
  };
  if ($('reopenBtn')) $('reopenBtn').onclick = () => act(v, 'reopen', {}, 'Vendor reopened');
}
/** POST an action, refresh, redraw the current step. */
async function act(v, path, body, msg, then) {
  try { await POST(`/api/vendors/${v.id}/${path}`, body); toast(msg); await refresh(); if (then) location.hash = then; else route(); }
  catch (e) { toast(e.message); }
}
async function viewVendor(id, step) {
  let v;
  try { v = await GET('/api/vendors/' + encodeURIComponent(id)); }
  catch (e) {
    $('main').innerHTML = `<div class="wrap"><div class="card empty"><h2>Vendor not found</h2><p>${esc(e.message)} <a href="#funnel/all">Back to all vendors</a></p></div></div>`;
    return;
  }
  if (location.hash.replace(/^#/, '').split('/')[1] !== id) return; // navigated away while loading
  if (stepState(v, step).locked) { location.replace('#vendor/' + id + '/' + nextStep(v)); return; }
  ({ details: viewDetails, services: viewServices, toolkit: viewToolkit, agreement: viewAgreement, pack: viewPack, install: viewInstall }[step] || viewDetails)(v);
}

/* ---------- Step: Details ---------- */
function viewDetails(existing) {
  const ro = existing && !existing.can.sell;
  const f = existing ? JSON.parse(JSON.stringify(existing)) : { name: '', category: '', areaId: '', repId: lsGet('feest_last_rep') || (S.me.role === 'sales_rep' ? S.me.id : ''), ownerId: '', address: '', storePhone: '', whatsapp: '', hours: '', notes: '', pin: null, photos: {}, photoKeys: {}, firstTouchAt: nowIso() };
  f.photos = f.photos || {}; f.photoKeys = f.photoKeys || {};
  let pinBusy = false, pinMsg = '', manual = false;
  $('main').innerHTML = `<div class="wrap">${vendorHead(existing, 'details')}
    <form id="vf" class="card" novalidate>
      <fieldset ${ro ? 'disabled' : ''} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:14px;min-width:0">
      <h2>Vendor</h2>
      <div class="grid2">
        <div class="field"><label for="v_name">Trading name</label><input id="v_name" required value="${esc(f.name)}" placeholder="As on the signage"></div>
        <div class="field"><label for="v_cat">Category</label><select id="v_cat"><option value="">Choose category</option>${S.categories.map((c) => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div id="c_area"></div>
        <div id="c_rep"></div>
      </div>
      <h2>Store location</h2>
      <div class="pinbox" id="pinBox"></div>
      <div class="field"><label for="v_addr">Street address</label><input id="v_addr" value="${esc(f.address)}" placeholder="Number, street, suburb"></div>
      <h2>Owner</h2>
      <p class="small">The company that owns the store signs the agreement, like the landlord on a site. Franchise groups own many stores, so pick them from the list.</p>
      <div class="grid2"><div id="c_owner" class="span2"></div></div>
      <h2>Store contact</h2>
      <div class="grid3">
        <div class="field"><label for="v_phone">Store phone</label><input id="v_phone" type="tel" value="${esc(f.storePhone)}"></div>
        <div class="field"><label for="v_wa">WhatsApp number for orders</label><input id="v_wa" type="tel" value="${esc(f.whatsapp)}" placeholder="If different from store phone"></div>
        <div class="field"><label for="v_hours">Trading hours</label><input id="v_hours" value="${esc(f.hours)}" placeholder="Mon–Sat 10:00–21:00"></div>
      </div>
      <h2>Photos</h2>
      <div class="photos" id="photoHost"></div>
      <div class="field"><label for="v_notes">Visit notes</label><textarea id="v_notes" placeholder="Who you spoke to, what they use today, next step">${esc(f.notes || '')}</textarea></div>
      <div class="err" id="vErr" hidden></div>
      <div class="acts">${ro ? '' : `<button class="btn" type="submit" id="vSave">${existing ? 'Save details' : 'Save and continue'}</button>`}
        ${existing ? `<a class="btn btn-ghost" href="#vendor/${existing.id}/services">Next: model and services</a>` : ''}</div>
      <p class="small">First touch ${esc(fmtDT(f.firstTouchAt))}.</p>
      </fieldset>
    </form></div>`;
  if (existing) bindHead(existing);

  const areaCombo = Combo($('c_area'), { key: 'area', label: 'Area', noun: 'area', placeholder: 'Choose area', value: f.areaId,
    options: () => sorted(S.areas).map((a) => ({ id: a.id, label: a.city ? `${a.name} · ${a.city}` : a.name })),
    fields: [{ key: 'name', label: 'Area name' }, { key: 'city', label: 'City' }],
    onAdd: S.me.can.manageAreas ? (d) => POST('/api/areas', { name: d.name, city: d.city, reps: f.repId ? [f.repId] : [] }).then((r) => r.id) : null,
    readout: (id) => { const a = byId('areas', id); if (!a) return ''; const rn = a.reps.map((x) => nm('users', x)).filter(Boolean); return rn.length ? `Allocated: <b>${esc(rn.join(', '))}</b>` : 'No rep allocated. <a href="#areas">Allocate one</a>'; },
    onChange: (id) => { f.areaId = id; const a = byId('areas', id); if (a && a.reps.length && !a.reps.includes(f.repId)) { f.repId = S.me.role === 'sales_rep' && a.reps.includes(S.me.id) ? S.me.id : a.reps[0]; repCombo.set(f.repId); } } });
  const repCombo = Combo($('c_rep'), { key: 'rep', label: 'Sales rep', noun: 'team member', placeholder: 'Choose rep', value: f.repId,
    options: () => { const a = byId('areas', f.areaId); const inArea = a ? a.reps : [];
      return sorted(S.users.filter((u) => u.active && ['sales_rep', 'sales_lead', 'ceo', 'admin'].includes(u.role))).map((u) => ({ id: u.id, label: u.name + (inArea.includes(u.id) ? ' (this area)' : '') })); },
    onChange: (id) => { f.repId = id; if (id) lsSet('feest_last_rep', id); } });
  const ownerCombo = Combo($('c_owner'), { key: 'owner', label: 'Owning company', noun: 'owner', placeholder: 'Choose owner', value: f.ownerId,
    options: () => sorted(S.owners).map((o) => ({ id: o.id, label: o.name })),
    fields: [{ key: 'name', label: 'Company name' }, { key: 'regNo', label: 'Registration number' }, { key: 'contactName', label: 'Owner or signatory name' }, { key: 'title', label: 'Title, e.g. Owner, Director' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'mobile', label: 'Mobile', type: 'tel' }],
    validate: (d) => (!d.name ? 'Enter the company name.' : !d.contactName ? 'Enter who signs for the company.' : !/^\S+@\S+\.\S+$/.test(d.email) ? 'Enter a valid email: the agreement pack goes there.' : ''),
    onAdd: (d) => POST('/api/owners', d).then((r) => r.id),
    readout: (id) => { const o = byId('owners', id); return o ? `${esc(o.contactName || '')}${o.title ? `, ${esc(o.title)}` : ''} · ${esc(o.email || 'no email')} · ${esc(o.mobile || '')}${o.regNo ? ` · Reg ${esc(o.regNo)}` : ''}` : ''; },
    onChange: (id) => { f.ownerId = id; } });

  const pinSvg = (on) => `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true"><path d="M17 2C9 2 3 8 3 16c0 10 14 26 14 26s14-16 14-26C31 8 25 2 17 2z" fill="${on ? 'var(--coral)' : 'var(--line)'}"/><circle cx="17" cy="16" r="5" fill="var(--surface)"/></svg>`;
  function drawPin() {
    const p = f.pin, acc = p && p.accuracy != null ? Math.round(p.accuracy) : null;
    $('pinBox').innerHTML = `${pinSvg(!!p)}<div style="flex:1;min-width:0">
      ${p ? `<div class="coords strong">${Number(p.lat).toFixed(6)}, ${Number(p.lng).toFixed(6)}</div><div class="small">${acc != null ? `Accurate to ±${acc} m` : 'Entered by hand'} · pinned ${esc(fmtDT(p.capturedAt))}</div>
             ${acc != null && acc > 40 ? '<div class="small warn">Weak GPS fix. Stand at the shop entrance and drop the pin again.</div>' : ''}`
          : '<div class="strong">Drop a pin at the shop entrance</div><div class="small">Drivers collect here, so stand at the door where orders are handed over.</div>'}
      ${pinMsg ? `<div class="small warn">${esc(pinMsg)}</div>` : ''}
      ${ro ? '' : `<div class="acts" style="margin-top:8px">
        <button type="button" class="btn btn-sm" id="pinBtn" ${pinBusy ? 'disabled' : ''}>${pinBusy ? 'Getting location…' : p ? 'Drop pin again' : 'Drop pin here'}</button>
        ${p ? `<a class="btn btn-sm btn-ghost" target="_blank" rel="noopener" href="https://www.google.com/maps?q=${p.lat},${p.lng}">Open in Google Maps</a>` : ''}
        <button type="button" class="linkbtn" id="manualBtn">${manual ? 'Hide' : 'Paste coordinates instead'}</button>
      </div>
      <div class="acts" id="manualRow" style="margin-top:8px" ${manual ? '' : 'hidden'}>
        <input class="inp" id="manualIn" style="flex:1 1 220px;width:auto" placeholder="-33.9806, 18.4650 or a Google Maps link" aria-label="Coordinates">
        <button type="button" class="btn btn-sm btn-ghost" id="manualSet">Set pin</button>
      </div>`}</div>`;
    if (ro) return;
    $('pinBtn').onclick = dropPin;
    $('manualBtn').onclick = () => { manual = !manual; drawPin(); };
    $('manualSet').onclick = () => {
      const m = $('manualIn').value.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
      if (!m) { pinMsg = 'Couldn\'t read coordinates. Use the form -33.9806, 18.4650.'; drawPin(); return; }
      f.pin = { lat: +m[1], lng: +m[2], accuracy: null, capturedAt: nowIso(), source: 'manual' }; pinMsg = ''; manual = false; drawPin(); toast('Pin set');
    };
  }
  function dropPin() {
    if (!navigator.geolocation) { pinMsg = 'This device can\'t share location. Paste coordinates instead.'; manual = true; drawPin(); return; }
    pinBusy = true; pinMsg = ''; drawPin();
    navigator.geolocation.getCurrentPosition((pos) => {
      pinBusy = false; f.pin = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: nowIso(), source: 'gps' }; drawPin(); toast('Pin dropped');
    }, (e) => {
      pinBusy = false;
      pinMsg = e.code === 1 ? 'Location access is blocked. Allow location for this site in your browser, or paste coordinates.' : e.code === 3 ? 'Location timed out. Try again at the entrance, or paste coordinates.' : 'Couldn\'t get a location fix. Try again, or paste coordinates.';
      manual = true; drawPin();
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }
  drawPin();

  const slots = [{ key: 'storefront', label: 'Storefront', max: 1280, type: 'image/jpeg' }, { key: 'logo', label: 'Logo', max: 600, type: 'image/png' }, { key: 'counter', label: 'Counter or till', max: 1280, type: 'image/jpeg' }];
  function drawPhotos() {
    $('photoHost').innerHTML = slots.map((s) => `<div class="ph">${f.photos[s.key] ? `<img src="${esc(f.photos[s.key])}" alt="${esc(s.label)}">` : `<span class="small">${esc(s.label)}</span>`}
      ${ro ? '' : `<div class="acts"><button type="button" class="btn btn-sm btn-ghost" data-ph="${s.key}">${f.photos[s.key] ? 'Replace' : 'Add ' + s.label.toLowerCase()}</button>${f.photos[s.key] ? `<button type="button" class="linkbtn" data-rm="${s.key}">Remove</button>` : ''}</div>`}</div>`).join('');
    $('photoHost').querySelectorAll('[data-ph]').forEach((b) => (b.onclick = async () => {
      const s = slots.find((x) => x.key === b.dataset.ph);
      const file = await pickFile('image/*'); if (!file) return;
      b.disabled = true; b.textContent = 'Uploading…';
      try { const dataUrl = await shrink(file, s.max, s.type); const up = await POST('/api/uploads', { dataUrl }); f.photos[s.key] = up.url; f.photoKeys[s.key] = up.key; toast('Photo added. Save to keep it.'); }
      catch (e) { toast(e.message || 'That image couldn\'t be read. Try a JPG or PNG.'); }
      drawPhotos();
    }));
    $('photoHost').querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => { delete f.photos[b.dataset.rm]; delete f.photoKeys[b.dataset.rm]; drawPhotos(); }));
  }
  drawPhotos();

  $('vf').onsubmit = async (e) => {
    e.preventDefault();
    if (ro) return;
    Object.assign(f, { name: $('v_name').value.trim(), category: $('v_cat').value, address: $('v_addr').value.trim(), storePhone: $('v_phone').value.trim(),
      whatsapp: $('v_wa').value.trim(), hours: $('v_hours').value.trim(), notes: $('v_notes').value.trim() });
    const missing = [!f.name && 'trading name', !f.category && 'category', !f.areaId && 'area', !f.repId && 'sales rep', !f.ownerId && 'owner', !f.pin && 'store pin'].filter(Boolean);
    if (missing.length) { $('vErr').textContent = 'Still needed: ' + missing.join(', ') + '.'; $('vErr').hidden = false; return; }
    $('vErr').hidden = true; $('vSave').disabled = true;
    const body = { name: f.name, category: f.category, areaId: f.areaId, repId: f.repId, ownerId: f.ownerId, address: f.address, storePhone: f.storePhone, whatsapp: f.whatsapp,
      hours: f.hours, notes: f.notes, pin: f.pin, photoKeys: f.photoKeys, firstTouchAt: f.firstTouchAt };
    try {
      if (existing) { await PUT(`/api/vendors/${existing.id}/details`, body); toast('Details saved'); await refresh(); $('vSave').disabled = false; }
      else { const r = await POST('/api/vendors', body); toast('Vendor saved'); await refresh(); location.hash = 'vendor/' + r.id + '/services'; }
    } catch (ex) { $('vErr').textContent = ex.message; $('vErr').hidden = false; $('vSave').disabled = false; }
  };
  current.onData = () => { areaCombo.refresh(); repCombo.refresh(); ownerCombo.refresh(); };
}

/* ---------- Step: Model and services ---------- */
function signedLock(v) { return v.agreement ? `<div class="callout info">An agreement is signed on these terms. To change them, void the agreement on the Agreement step and sign again.</div>` : ''; }
function viewServices(v) {
  const ro = !v.can.sell || !!v.agreement;
  const f = { model: v.model || '', services: Object.assign({ whatsapp: true }, v.services || {}), ownDrivers: v.ownDrivers || '', vehicles: v.vehicles || '', tables: v.tables || '' };
  const soc = R(pricing().socialSetup);
  $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'services')}${signedLock(v)}
    <form id="sf" class="card" novalidate><fieldset ${ro ? 'disabled' : ''} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:14px;min-width:0">
      <h2>Who delivers?</h2>
      <p class="small">Ask the owner whether they want to run their own drivers, with FEEST-branded boxes and vehicles, or use the FEEST open network.</p>
      <div class="tiles" role="radiogroup" aria-label="Delivery model">${F.MODELS.map((m) => `<label class="tile"><input type="radio" name="model" value="${m.key}" ${f.model === m.key ? 'checked' : ''}><b>${esc(m.label)}</b><span>${esc(m.sub)}</span></label>`).join('')}</div>
      <div class="grid3" id="fleetRow" ${f.model.startsWith('own') ? '' : 'hidden'}>
        <div class="field"><label for="s_drivers">Own drivers</label><input id="s_drivers" type="number" min="0" inputmode="numeric" value="${esc(f.ownDrivers)}"></div>
        <div class="field" id="vehField"><label for="s_veh">Vehicles to brand</label><input id="s_veh" type="number" min="0" inputmode="numeric" value="${esc(f.vehicles)}"></div>
        <p class="small" style="align-self:end">Own drivers still run on the FEEST driver app so orders, tracking and proof of delivery work the same.</p>
      </div>
      <h2>Services</h2>
      <div class="tiles">${F.SERVICES.map((s) => `<label class="tile ${s.priced ? 'price' : ''}"><input type="checkbox" data-svc="${s.key}" ${f.services[s.key] ? 'checked' : ''}><b ${s.priced ? `data-price="${esc(soc)}"` : ''}>${esc(s.label)}</b><span>${esc(s.sub)}</span></label>`).join('')}</div>
      <div class="grid3" id="tableRow" ${f.services.tableQr ? '' : 'hidden'}><div class="field"><label for="s_tables">Tables to get a QR card</label><input id="s_tables" type="number" min="0" inputmode="numeric" value="${esc(f.tables)}"></div></div>
      <div class="callout info" id="svcNote"></div>
      <div class="err" id="sErr" hidden></div>
      <div class="acts">${ro ? '' : '<button class="btn" type="submit" id="sSave">Save and continue</button>'}<a class="btn btn-ghost" href="#vendor/${v.id}/details">Back</a>${v.model ? `<a class="btn btn-ghost" href="#vendor/${v.id}/toolkit">Next: sales toolkit</a>` : ''}</div>
    </fieldset></form></div>`;
  bindHead(v);
  function note() {
    const s = f.services, bits = [];
    if (s.delivery && f.model === 'pickup_only') bits.push('Delivery is ticked but the model is No delivery. Pick a delivery model or untick Delivery.');
    if (s.delivery) bits.push('Delivery is on, so the next step is the sales toolkit comparison against Uber Eats and Mr D.');
    else bits.push('Without delivery the toolkit only confirms the fee tier; the comparison is skipped.');
    if (s.pilot) bits.push("They'll accept orders on the Pilot screen.");
    if (s.social) bits.push(`Social media setup adds ${soc} once-off to the installation invoice.`);
    $('svcNote').textContent = bits.join(' ');
  }
  document.querySelectorAll('input[name="model"]').forEach((r) => (r.onchange = () => {
    f.model = r.value; $('fleetRow').hidden = !f.model.startsWith('own'); $('vehField').hidden = f.model !== 'own_branded';
    const d = document.querySelector('[data-svc="delivery"]');
    if (f.model === 'pickup_only') { f.services.delivery = false; d.checked = false; }
    else if (!f.services.delivery) { f.services.delivery = true; d.checked = true; }
    note();
  }));
  $('vehField').hidden = f.model !== 'own_branded';
  document.querySelectorAll('[data-svc]').forEach((c) => (c.onchange = () => { f.services[c.dataset.svc] = c.checked; $('tableRow').hidden = !f.services.tableQr; note(); }));
  note();
  $('sf').onsubmit = async (e) => {
    e.preventDefault(); if (ro) return;
    $('sSave').disabled = true;
    try {
      await PUT(`/api/vendors/${v.id}/services`, { model: f.model, services: f.services, ownDrivers: $('s_drivers').value, vehicles: $('s_veh').value, tables: $('s_tables').value });
      toast('Saved'); await refresh(); location.hash = 'vendor/' + v.id + '/toolkit';
    } catch (ex) { $('sErr').textContent = ex.message; $('sErr').hidden = false; $('sSave').disabled = false; }
  };
}

/* ---------- Step: Sales toolkit ---------- */
function viewToolkit(v) {
  const ro = !v.can.sell || !!v.agreement;
  const p = pricing();
  const t = Object.assign(F.toolkitDefaults(p), v.toolkit || {});
  const delivery = !!(v.services && v.services.delivery);
  const pc0 = t.priceCheck || {};
  const pcIt = (i) => (pc0.items && pc0.items[i]) || {};
  const pcF = (k) => pc0[k] || {};
  const pv = (x) => (x === null || x === undefined ? '' : esc(x));
  const pcRow = (i) => `<tr><td><input id="pc_n${i}" type="text" maxlength="80" placeholder="Best seller ${i + 1}" aria-label="Best seller ${i + 1}" value="${pv(pcIt(i).name)}"></td>
      <td><input id="pc_s${i}" type="number" min="0" step="0.5" inputmode="decimal" aria-label="Best seller ${i + 1}, in-store price" value="${pv(pcIt(i).store)}"></td>
      <td><input id="pc_u${i}" type="number" min="0" step="0.5" inputmode="decimal" aria-label="Best seller ${i + 1}, Uber Eats price" value="${pv(pcIt(i).uber)}"></td>
      <td><input id="pc_d${i}" type="number" min="0" step="0.5" inputmode="decimal" aria-label="Best seller ${i + 1}, Mr D price" value="${pv(pcIt(i).mrd)}"></td></tr>`;
  const pcFee = (label, key, unit) => `<tr class="sub"><td>${label}</td><td class="small">–</td>
      <td><input id="pc_u_${key}" type="number" min="0" step="0.5" inputmode="decimal" aria-label="Uber Eats ${label}" value="${pv(pcF('uber')[key])}"></td>
      <td><input id="pc_d_${key}" type="number" min="0" step="0.5" inputmode="decimal" aria-label="Mr D ${label}" value="${pv(pcF('mrd')[key])}"></td></tr>`;
  const pcCard = delivery ? `<form id="pcf" class="card pc" novalidate><fieldset ${ro ? 'disabled' : ''} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:14px;min-width:0">
      <div class="pc-head"><div><div class="eyebrow">Start here, in store</div><h2>Price check on their best sellers</h2></div><span class="pc-badge" id="pcBadge">Using estimates</span></div>
      <ol class="pc-steps">
        <li><b>Ask the manager</b> for their 3 best-selling items.</li>
        <li><b>Take the in-store price</b> of each from the menu board or till.</li>
        <li><b>Check both apps</b> on your phone, delivering to a street about 3 km away. Leave a price blank if the item isn't listed.</li>
        <li><b>Go to checkout, don't pay.</b> All 3 items in the basket; enter the fees exactly as shown.</li>
        <li><b>Screenshot both checkouts</b> and show the manager their own food.</li>
        <li><b>Ask what commission</b> they pay. Enter it if they tell you.</li>
      </ol>
      <div class="tablewrap"><table class="pc-table"><thead><tr><th>Best seller</th><th class="r">In store (R)</th><th class="r">Uber Eats (R)</th><th class="r">Mr D (R)</th></tr></thead><tbody>
        ${pcRow(0)}${pcRow(1)}${pcRow(2)}
        ${pcFee('Delivery fee at checkout (R)', 'delivery')}${pcFee('Service fee at checkout (R)', 'service')}${pcFee('Small-order fee (R, 0 if none)', 'small')}${pcFee('Commission they pay (%)', 'commission')}
      </tbody><tfoot><tr><th>Basket at checkout</th><th class="r" id="pcTs">–</th><th class="r" id="pcTu">–</th><th class="r" id="pcTd">–</th></tr>
        <tr><th>Menu prices vs counter</th><th></th><th class="r" id="pcMu">–</th><th class="r" id="pcMd">–</th></tr></tfoot></table></div>
      <p class="small" id="pcNote">Measured prices and fees replace the estimates below. Anything left blank keeps the estimate.</p>
      <div class="acts"><button class="btn btn-ghost" type="button" id="pcAov" hidden>Use the basket as their average order</button>${ro ? '' : '<button class="btn btn-ghost" type="button" id="pcClear">Clear the price check</button>'}</div>
    </fieldset></form>` : '';
  $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'toolkit')}${signedLock(v)}
    ${pcCard}
    <div class="grid2" style="align-items:start">
      <form id="tf" class="card" novalidate><fieldset ${ro ? 'disabled' : ''} style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:14px;min-width:0">
        <h2>${delivery ? 'Their numbers' : 'Fee'}</h2>
        ${delivery ? `<div class="grid2">
          <div class="field"><label for="t_aov">Average order, in-store prices (R)</label><input id="t_aov" type="number" min="0" step="5" inputmode="decimal" value="${esc(t.aov)}"></div>
          <div class="field"><label for="t_opd">Delivery orders a day</label><input id="t_opd" type="number" min="0" inputmode="numeric" value="${esc(t.opd)}"></div>
          <div class="field"><label for="t_days">Trading days a month</label><input id="t_days" type="number" min="0" max="31" inputmode="numeric" value="${esc(t.days)}"></div>
          <div class="field"><label for="t_apps">On the apps today</label><select id="t_apps"><option value="both">Uber Eats and Mr D</option><option value="one">One of them</option><option value="none">Neither</option></select></div>
        </div>
        <details ${t.apps !== 'none' ? 'open' : ''}><summary class="strong" style="cursor:pointer;min-height:var(--tap);display:flex;align-items:center">What the apps charge them</summary><div class="grid2" style="margin-top:8px">
          <div class="field"><label for="t_markup">App menu markup %</label><input id="t_markup" type="number" min="0" step="1" value="${esc(t.markup)}"></div>
          <div class="field"><label for="t_comm">App commission %</label><input id="t_comm" type="number" min="0" step="1" value="${esc(t.commission)}"></div>
          <div class="field"><label for="t_appdel">App delivery fee (R)</label><input id="t_appdel" type="number" min="0" step="1" value="${esc(t.appDelivery)}"></div>
          <div class="field"><label for="t_appsvc">App service fee %</label><input id="t_appsvc" type="number" min="0" step="0.5" value="${esc(t.appService)}"></div>
        </div><p class="small" id="appNote">Defaults are press-test estimates. Run the price check above to measure them.</p></details>` : ''}
        <div class="grid2">
          <div class="field"><label for="t_tier">FEEST service fee</label><select id="t_tier">${p.tiers.map((x) => `<option value="${x}" ${num(t.tier) === x ? 'selected' : ''}>${x}% of menu price</option>`).join('')}</select></div>
          <div class="field"><label for="t_paid">Fee paid by</label><select id="t_paid"><option value="customer">Customer</option><option value="vendor">Vendor</option></select></div>
          ${delivery ? `<div class="field"><label for="t_del">FEEST delivery fee to customer (R), all to the rider</label><input id="t_del" type="number" min="0" step="1" value="${esc(t.delivery)}"></div>` : ''}
        </div>
        <div class="err" id="tErr" hidden></div>
        <div class="acts">${ro ? '' : `<button class="btn" type="submit" id="tSave">${v.toolkitCompletedAt ? 'Save toolkit' : 'Complete toolkit'}</button>`}
          <a class="btn btn-ghost" target="_blank" rel="noopener" href="/toolkit">Open brand kit renderer</a></div>
        <p class="small">The brand kit renderer puts their logo on the bike, top box, door sticker and WhatsApp status. Show it before you ask for the signature.</p>
      </fieldset></form>
      <div class="card" id="cmpHost" aria-live="polite"></div>
    </div></div>`;
  bindHead(v);
  if ($('t_apps')) $('t_apps').value = t.apps;
  $('t_paid').value = t.paidBy;
  const g = (i, d) => ($(i) ? $(i).value : d);
  const blank = (id) => { const s = $(id) ? $(id).value.trim() : ''; return s === '' ? null : s; };
  const readPC = () => delivery ? {
    items: [0, 1, 2].map((i) => ({ name: $('pc_n' + i).value, store: blank('pc_s' + i), uber: blank('pc_u' + i), mrd: blank('pc_d' + i) })),
    uber: { delivery: blank('pc_u_delivery'), service: blank('pc_u_service'), small: blank('pc_u_small'), commission: blank('pc_u_commission') },
    mrd: { delivery: blank('pc_d_delivery'), service: blank('pc_d_service'), small: blank('pc_d_small'), commission: blank('pc_d_commission') },
  } : null;
  const read = () => ({ aov: num(g('t_aov', t.aov)), opd: num(g('t_opd', t.opd)), days: num(g('t_days', t.days)), apps: g('t_apps', t.apps),
    markup: num(g('t_markup', t.markup)), commission: num(g('t_comm', t.commission)), appDelivery: num(g('t_appdel', t.appDelivery)), appService: num(g('t_appsvc', t.appService)),
    tier: num($('t_tier').value), paidBy: $('t_paid').value, delivery: num(g('t_del', t.delivery)), priceCheck: readPC() });
  // The typed-in (or default) app rates, restored when a measured value is cleared.
  const typed = { t_markup: t.markup, t_comm: t.commission, t_appdel: t.appDelivery, t_appsvc: t.appService };
  if (t.priceCheck) { const d = F.toolkitDefaults(p); Object.assign(typed, { t_markup: d.markup, t_comm: d.commission, t_appdel: d.appDelivery, t_appsvc: d.appService }); }
  const measuredIds = {};
  function setMeasured(id, val) {
    const el = $(id); if (!el) return;
    if (val === null || val === undefined) { if (measuredIds[id]) el.value = typed[id]; measuredIds[id] = false; }
    else { if (measuredIds[id] === false) typed[id] = el.value; el.value = String(val); measuredIds[id] = true; }
    el.readOnly = !!measuredIds[id]; el.classList.toggle('measured', !!measuredIds[id]);
  }
  function applyPC() {
    if (!delivery) return;
    const r = F.priceCheck(readPC()), u = r.use || {};
    setMeasured('t_markup', r.measured ? u.markup : null);
    setMeasured('t_appdel', r.measured ? u.appDelivery : null);
    setMeasured('t_appsvc', r.measured ? u.appService : null);
    setMeasured('t_comm', r.measured ? u.commission : null);
    const pct = (x) => (x === null ? '–' : (x >= 0 ? '+' : '−') + (Math.round(Math.abs(x) * 10) / 10).toLocaleString('en-ZA') + '%');
    const tot = (a) => (a.checkout === null ? '–' : R(a.checkout, 2) + (a.feesComplete ? '' : '*') + (a.listed < a.of ? ` (${a.listed} of ${a.of})` : ''));
    $('pcTs').textContent = r.storeTotal ? R(r.storeTotal, 2) : '–';
    $('pcTu').textContent = tot(r.uber); $('pcTd').textContent = tot(r.mrd);
    $('pcMu').textContent = pct(r.uber.markup); $('pcMd').textContent = pct(r.mrd.markup);
    const b = $('pcBadge'); b.textContent = r.measured ? 'Measured in store' : 'Using estimates'; b.classList.toggle('ok', r.measured);
    const appName = u.app === 'uber' ? 'Uber Eats' : 'Mr D';
    const missing = ['uber', 'mrd'].some((k) => r[k].listed && !r[k].feesComplete);
    $('pcNote').textContent = (missing ? '* Some checkout fees are still blank, so that total leaves them out. ' : '') +
      (r.measured ? `The comparison now runs on these prices, against ${appName}: the cheaper of the two apps at checkout, so the gain is never overstated.` : 'Measured prices and fees replace the estimates below. Anything left blank keeps the estimate.');
    if ($('appNote')) $('appNote').textContent = r.measured ? `Highlighted rates were measured in store on ${appName}. Clear the price check to type your own.` : 'Defaults are press-test estimates. Run the price check above to measure them.';
    if (r.measured && $('t_apps') && $('t_apps').value === 'none') $('t_apps').value = 'both';
    $('pcAov').hidden = !(r.storeTotal > 0) || ro;
  }
  function drawCmp() {
    applyPC();
    const x = read(), c = F.compare(x);
    if (!delivery) { $('cmpHost').innerHTML = `<h2>Summary</h2><p>No delivery for this vendor. FEEST charges ${x.tier}% on menu price, paid by the ${esc(x.paidBy)}, on WhatsApp, pickup and table orders.</p>`; return; }
    const appLabel = x.apps === 'none' ? 'If they joined the apps' : 'Uber Eats / Mr D';
    $('cmpHost').innerHTML = `<h2>On a ${R(x.aov)} order</h2>
      <div class="cmp">
        <div class="cmpcol"><div class="eyebrow">${esc(appLabel)}</div>
          <div class="row"><span>Menu price on the app</span><b>${R(c.appMenu, 2)}</b></div>
          <div class="row"><span>Customer pays</span><b>${R(c.appCustomer, 2)}</b></div>
          <div class="row"><span>Vendor receives</span><b>${R(c.appVendor, 2)}</b></div></div>
        <div class="cmpcol feest"><div class="eyebrow">FEEST at ${x.tier}%, fee paid by ${esc(x.paidBy)}</div>
          <div class="row"><span>Menu price</span><b>${R(x.aov, 2)}</b></div>
          <div class="row"><span>Customer pays</span><b>${R(c.feestCustomer, 2)}</b></div>
          <div class="row"><span>Vendor receives</span><b>${R(c.feestVendor, 2)}</b></div></div>
      </div>
      <div class="callout ${c.monthGain >= 0 ? 'good' : 'warnc'}"><div class="small" style="color:inherit">Vendor keeps more each month</div><div class="big">${R(c.monthGain)}</div>
        <div class="small" style="color:inherit">${R(c.vendorGainPerOrder, 2)} an order × ${c.monthOrders.toLocaleString('en-ZA')} orders. Customer saves ${R(c.customerSavePerOrder, 2)} an order.</div></div>
      <div class="tablewrap compact"><table><thead><tr><th></th><th class="r">${esc(appLabel)}</th><th class="r">FEEST</th></tr></thead><tbody>
        <tr><td>Who owns the customer</td><td class="r">The app</td><td class="r">The vendor</td></tr>
        <tr><td>Brand on the delivery</td><td class="r">The app's</td><td class="r">${v.model === 'own_branded' ? "Vendor's, on own fleet" : "Vendor's, order on FEEST"}</td></tr>
        <tr><td>Loyalty and promotions</td><td class="r">The app's</td><td class="r">${v.services.loyalty || v.services.promos ? "Vendor's own, included" : 'Available'}</td></tr>
      </tbody></table></div>
      <p class="small">An estimate on the owner's own numbers. Never promise order volumes.</p>`;
  }
  $('tf').addEventListener('input', drawCmp); $('tf').addEventListener('change', drawCmp);
  if ($('pcf')) {
    $('pcf').addEventListener('input', drawCmp);
    $('pcf').onsubmit = (e) => e.preventDefault();
    $('pcAov').onclick = () => { const r = F.priceCheck(readPC()); if (r.storeTotal > 0 && $('t_aov')) { $('t_aov').value = r.storeTotal; drawCmp(); toast('Average order set to the basket'); } };
    if ($('pcClear')) $('pcClear').onclick = () => { $('pcf').querySelectorAll('input').forEach((el) => { el.value = ''; }); drawCmp(); };
  }
  drawCmp();
  $('tf').onsubmit = async (e) => {
    e.preventDefault(); if (ro) return;
    $('tSave').disabled = true;
    try { await PUT(`/api/vendors/${v.id}/toolkit`, read()); toast('Toolkit saved'); await refresh(); location.hash = 'vendor/' + v.id + '/agreement'; }
    catch (ex) { $('tErr').textContent = ex.message; $('tErr').hidden = false; $('tSave').disabled = false; }
  };
}

/* ---------- Agreement ---------- */
function termsHtml(T, startDate) {
  return `<dl>
    <dt>Vendor</dt><dd><b>${esc(T.vendorName)}</b>${T.category ? ` · ${esc(T.category)}` : ''}<br><span class="small">${esc(T.address)}</span></dd>
    <dt>Owner</dt><dd>${esc(T.ownerCompany)}${T.ownerReg ? ` (Reg ${esc(T.ownerReg)})` : ''}<br><span class="small">${esc(T.ownerContact)}${T.ownerTitle ? `, ${esc(T.ownerTitle)}` : ''} · ${esc(T.ownerEmail)}</span></dd>
    <dt>Start date</dt><dd><b>${esc(fmtD(startDate))}</b></dd>
    <dt>Delivery model</dt><dd>${esc(T.model)}${T.ownDrivers ? ` · ${T.ownDrivers} own driver${T.ownDrivers > 1 ? 's' : ''}` : ''}${T.vehicles ? `, ${T.vehicles} vehicle${T.vehicles > 1 ? 's' : ''} branded` : ''}</dd>
    <dt>Services</dt><dd>${esc(T.services.join(', '))}</dd>
    <dt>FEEST service fee</dt><dd>${T.tier}% of menu price, paid by the ${esc(T.paidBy)}${T.delivery ? `. Delivery fee ${R(T.deliveryFee)} charged to the customer.` : '.'}</dd>
    <dt>Installation pack</dt><dd>${T.pack.rows.length ? `${R(T.pack.printTotal, 2)} print at cost` : 'No print items'}${T.social ? ` + ${R(T.pack.social, 2)} social media setup` : ''}. Total ${R(T.pack.total, 2)} incl. ${T.pack.vatPct}% VAT.</dd>
    ${T.toolkit ? `<dt>Estimate shown</dt><dd>Vendor keeps about ${R(T.toolkit.monthGain)} more a month than on the apps, on ${T.toolkit.opd} orders a day at ${R(T.toolkit.aov)}. An estimate, not a promise.</dd>` : ''}
  </dl>`;
}
function SigPad(host, label) {
  host.classList.add('sigpad');
  host.innerHTML = `<span class="lbl">${esc(label)}</span><canvas aria-label="${esc(label)}, sign with finger or mouse"></canvas><div class="acts"><button type="button" class="linkbtn">Clear</button><span class="small">Sign inside the box</span></div>`;
  const c = host.querySelector('canvas'), x = c.getContext('2d');
  let drawing = false, dirty = false, last = null;
  function size() { const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1; c.width = r.width * d; c.height = r.height * d; x.setTransform(d, 0, 0, d, 0, 0); x.lineWidth = 2.2; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#170B3B'; dirty = false; }
  requestAnimationFrame(size);
  const pt = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.addEventListener('pointerdown', (e) => { drawing = true; last = pt(e); c.setPointerCapture(e.pointerId); });
  c.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pt(e); x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(p.x, p.y); x.stroke(); last = p; dirty = true; });
  const end = () => { drawing = false; };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  host.querySelector('.linkbtn').onclick = () => { x.clearRect(0, 0, c.width, c.height); dirty = false; };
  return {
    isEmpty: () => !dirty,
    data: () => { const o = document.createElement('canvas'), w = 600, h = Math.round(600 * c.height / c.width);
      o.width = w; o.height = h; const ox = o.getContext('2d'); ox.fillStyle = '#fff'; ox.fillRect(0, 0, w, h); ox.drawImage(c, 0, 0, w, h); return o.toDataURL('image/png'); },
  };
}
async function viewAgreement(v) {
  const ag = v.agreement;
  if (ag) {
    $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'agreement')}
      <div class="card"><div class="pagehead"><h2>Signed agreement</h2><span class="pill st-live">Signed ${esc(fmtD(ag.signedAt))}</span></div>
        <div class="terms">${termsHtml(ag.terms, ag.startDate)}</div>
        <div class="grid2">
          <div class="sigdone"><span class="small strong">For ${esc(ag.terms.ownerCompany)}</span><img src="${esc(ag.ownerSig)}" alt="Owner signature"><span class="small">${esc(ag.ownerName)}${ag.ownerTitle ? ', ' + esc(ag.ownerTitle) : ''} · ${esc(fmtDT(ag.signedAt))}</span></div>
          <div class="sigdone"><span class="small strong">For FEEST</span><img src="${esc(ag.repSig)}" alt="FEEST signature"><span class="small">${esc(ag.repName)} · ${esc(fmtDT(ag.signedAt))}</span></div>
        </div>
        <p class="small">Agreement wording v${esc(ag.wordingVersion)}. To change terms, void this agreement and sign again.</p>
        <div class="acts"><a class="btn" href="#vendor/${v.id}/pack">Next: email the pack</a>${v.can.sell && !v.pack.signedOffOn ? '<button class="btn btn-ghost" id="voidBtn">Void agreement</button>' : ''}</div>
      </div></div>`;
    bindHead(v);
    let armed = false;
    if ($('voidBtn')) $('voidBtn').onclick = () => {
      if (!armed) { armed = true; $('voidBtn').textContent = 'Confirm void'; $('voidBtn').classList.add('btn-danger'); setTimeout(() => { armed = false; if ($('voidBtn')) { $('voidBtn').textContent = 'Void agreement'; $('voidBtn').classList.remove('btn-danger'); } }, 4000); return; }
      act(v, 'agreement/void', {}, 'Agreement voided');
    };
    return;
  }
  $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'agreement')}<div class="card"><p class="small">Preparing the terms…</p></div></div>`;
  let pv;
  try { pv = await GET(`/api/vendors/${v.id}/terms`); } catch (e) { toast(e.message); return; }
  const owner = byId('owners', v.ownerId) || {};
  const ro = !v.can.sell;
  $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'agreement')}
    <form id="af" class="card" novalidate>
      <h2>Agreement</h2>
      <p class="small">Go through the terms with the owner, then both sign on this screen. The start date is set ${pricing().startOffsetDays} days out to give installation time.</p>
      <div class="terms" id="termsHost">${termsHtml(pv.terms, pv.startDate)}</div>
      ${!pv.terms.ownerEmail ? '<div class="callout warnc">The owner has no email on file. Add it on the Details step first: the pack goes there.</div>' : ''}
      <div class="grid3">
        <div class="field"><label for="g_start">Start date</label><input id="g_start" type="date" value="${pv.startDate}" min="${pv.today}"></div>
        <div class="field"><label for="g_name">Owner signing</label><input id="g_name" value="${esc(owner.contactName || '')}"></div>
        <div class="field"><label for="g_title">Title</label><input id="g_title" value="${esc(owner.title || 'Owner')}"></div>
      </div>
      <div class="field"><span class="lbl">Agreement wording v${esc(pv.wording.version)}</span><div class="wording">${esc(pv.wording.text)}</div></div>
      <label class="check"><input type="checkbox" id="g_ok"><span>The owner has read the terms above and agrees on behalf of ${esc(pv.terms.ownerCompany || 'the owning company')}. The agreement takes effect when they confirm the emailed pack.</span></label>
      <div class="grid2"><div id="sigOwner"></div><div id="sigRep"></div></div>
      <p class="small">Signing for FEEST: <b>${esc(S.me.name)}</b> (signed in).</p>
      <div class="err" id="gErr" hidden></div>
      <div class="acts">${ro ? '' : '<button class="btn btn-coral" type="submit" id="gSave">Sign agreement</button>'}<a class="btn btn-ghost" href="#vendor/${v.id}/toolkit">Back to toolkit</a></div>
    </form></div>`;
  bindHead(v);
  const so = SigPad($('sigOwner'), 'Owner signature'), sr = SigPad($('sigRep'), 'FEEST signature');
  $('g_start').onchange = () => { $('termsHost').innerHTML = termsHtml(pv.terms, $('g_start').value || pv.startDate); };
  $('af').onsubmit = async (e) => {
    e.preventDefault(); if (ro) return;
    const err = !$('g_name').value.trim() ? "Enter the owner's name." : !$('g_ok').checked ? 'Tick that the owner agrees to the terms.' :
      so.isEmpty() ? 'The owner needs to sign.' : sr.isEmpty() ? 'Sign for FEEST.' : !$('g_start').value ? 'Choose a start date.' : '';
    if (err) { $('gErr').textContent = err; $('gErr').hidden = false; return; }
    $('gSave').disabled = true;
    try {
      await POST(`/api/vendors/${v.id}/agreement`, { startDate: $('g_start').value, ownerName: $('g_name').value.trim(), ownerTitle: $('g_title').value.trim(), agree: true, ownerSig: so.data(), repSig: sr.data() });
      toast('Agreement signed'); await refresh(); location.hash = 'vendor/' + v.id + '/pack';
    } catch (ex) { $('gErr').textContent = ex.message; $('gErr').hidden = false; $('gSave').disabled = false; }
  };
}

/* ---------- Step: Pack and sign-off ---------- */
async function viewPack(v) {
  const pk = v.pack;
  let E;
  try { E = await GET(`/api/vendors/${v.id}/pack/email`); } catch (e) { toast(e.message); return; }
  const ro = !v.can.sell;
  $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'pack')}
    <div class="card">
      <h2>1. Send the pack to the owner</h2>
      <p>The PDF has the deal, their toolkit numbers, the installation pack at cost and the signed agreement.</p>
      ${pk.emailedAt ? `<div class="callout good">${pk.method === 'sent' ? 'Emailed' : 'Marked as emailed'} to ${esc(pk.emailedTo || E.to)} on ${esc(fmtDT(pk.emailedAt))}.</div>` : ''}
      <div class="acts">
        ${!ro && E.mailConfigured ? `<button class="btn" id="sendBtn">${pk.emailedAt ? 'Send again' : 'Email pack to'} ${esc(E.to)}</button>` : ''}
        <a class="btn ${E.mailConfigured ? 'btn-ghost' : ''}" href="/api/vendors/${v.id}/pack.pdf">Download pack (PDF)</a>
      </div>
      ${E.mailConfigured ? `<p class="small">Sent from the FEEST mailbox with you in copy; replies come to you.</p>` : `
        <p class="small">Email isn't set up on this server yet. Download the PDF, send it from your own mailbox with the text below, then mark it as emailed.</p>
        <div class="grid2">
          <div class="field"><span class="lbl">To</span><div class="codebox" id="eTo">${esc(E.to || 'No owner email on file')}</div></div>
          <div class="field"><span class="lbl">Subject</span><div class="codebox" id="eSub">${esc(E.subject)}</div></div>
        </div>
        <div class="field"><span class="lbl">Message</span><div class="codebox" id="eBody">${esc(E.text)}</div></div>
        <div class="acts"><button class="btn btn-ghost btn-sm" data-copy="eTo">Copy address</button><button class="btn btn-ghost btn-sm" data-copy="eSub">Copy subject</button><button class="btn btn-ghost btn-sm" data-copy="eBody">Copy message</button>
          <a class="btn btn-ghost btn-sm" href="mailto:${encodeURIComponent(E.to)}?subject=${encodeURIComponent(E.subject)}&body=${encodeURIComponent(E.text)}">Open in mail app</a></div>
        ${!pk.emailedAt && !ro ? '<div class="acts"><button class="btn" id="emBtn">I\'ve emailed the pack</button></div>' : ''}`}
    </div>
    <div class="card">
      <h2>2. Record the owner's sign-off</h2>
      ${pk.signedOffOn ? `<div class="callout good">Signed off ${esc(fmtD(pk.signedOffOn))} by ${esc(pk.signedOffBy || '')} (${esc(pk.signoffMethod || '')}).${pk.signoffNote ? ' ' + esc(pk.signoffNote) : ''}</div>
          <div class="acts"><a class="btn" href="#vendor/${v.id}/install">Next: installation</a></div>`
      : ro ? '<p class="small">Waiting for the owner to confirm.</p>' : `<p class="small">When the owner replies to confirm, record it here. That moves the vendor to Installation.</p>
        <div class="grid3">
          <div class="field"><label for="p_date">Confirmed on</label><input id="p_date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
          <div class="field"><label for="p_by">Confirmed by</label><input id="p_by" value="${esc(v.agreement.ownerName)}"></div>
          <div class="field"><label for="p_how">How</label><select id="p_how"><option>Email reply</option><option>Signed PDF returned</option><option>WhatsApp message</option></select></div>
          <div class="field span2"><label for="p_note">Note</label><input id="p_note" placeholder="Optional, e.g. asked for 1,000 seals instead of 500"></div>
        </div>
        <div class="err" id="pErr" hidden></div>
        <div class="acts"><button class="btn btn-coral" id="soBtn" ${pk.emailedAt ? '' : 'disabled'}>Record sign-off</button>${pk.emailedAt ? '' : '<span class="small">Send the pack first.</span>'}</div>`}
    </div></div>`;
  bindHead(v);
  document.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = () => { const el = $(b.dataset.copy); copyText(el.textContent, el); }));
  if ($('sendBtn')) $('sendBtn').onclick = async () => { $('sendBtn').disabled = true; $('sendBtn').textContent = 'Sending…'; await act(v, 'pack/send', {}, `Pack emailed to ${E.to}`); };
  if ($('emBtn')) $('emBtn').onclick = () => act(v, 'pack/emailed', {}, 'Marked as emailed');
  if ($('soBtn')) $('soBtn').onclick = async () => {
    try { await POST(`/api/vendors/${v.id}/signoff`, { date: $('p_date').value, by: $('p_by').value.trim(), method: $('p_how').value, note: $('p_note').value.trim() });
      toast('Sign-off recorded'); await refresh(); location.hash = 'vendor/' + v.id + '/install'; }
    catch (e) { $('pErr').textContent = e.message; $('pErr').hidden = false; }
  };
}

/* ---------- Step: Installation ---------- */
function viewInstall(v) {
  const ins = Object.assign({}, v.install);
  const ro = !v.can.install;
  const pc = F.packCost(v, S.settings.pricing, S.settings.print);
  const items = CL.installItems(v);
  const live = !!v.liveAt;
  const done = items.filter((i) => ins[i.key]).length;
  const missing = CL.missingForLive(v, ins);
  const beforeStart = v.agreement && v.agreement.startDate > todayStr();
  $('main').innerHTML = `<div class="wrap">${vendorHead(v, 'install')}
    <div class="grid2" style="align-items:start">
      <div class="card">
        <div class="pagehead"><h2>Installation checklist</h2><span class="small strong">${done} of ${items.length} done</span></div>
        <div class="checklist">${items.map((i) => `<div class="ci"><input type="checkbox" id="ci_${i.key}" data-ci="${i.key}" ${ins[i.key] ? 'checked' : ''} ${live || ro ? 'disabled' : ''}>
          <div><label for="ci_${i.key}" class="strong">${esc(i.label)}</label><div class="small">${esc(i.sub)}</div>
            ${ins[i.key] ? `<div class="small">Done ${esc(fmtD(ins[i.key]))}</div>` : ''}
            ${i.field ? `<div class="sub"><input class="inp" data-f="${i.field.key}" placeholder="${esc(i.field.ph)}" aria-label="${esc(i.field.ph)}" value="${esc(ins[i.field.key] ?? i.field.def ?? '')}" ${live || ro ? 'disabled' : ''}></div>` : ''}
          </div></div>`).join('')}</div>
        <div class="err" id="iErr" hidden></div>
        ${live ? `<div class="callout good"><b>Live since ${esc(fmtD(v.liveAt))}.</b> Orders come in through Keychat${v.services.pilot ? ', the vendor accepts them on Pilot' : ''}${v.services.delivery ? ', and accepted delivery orders go to dispatch' : ''}.</div>
                 ${ro ? '' : '<div class="acts"><button class="btn btn-ghost" id="unliveBtn">Take offline</button></div>'}`
          : ro ? '' : `<div class="acts"><button class="btn" id="iSave">Save progress</button><button class="btn btn-coral" id="goLive" ${missing.length ? 'disabled' : ''}>Go live</button></div>
             ${missing.length ? `<p class="small">Still to do: ${esc(missing.join('; '))}.</p>` : beforeStart ? `<p class="small warn">The agreement starts ${esc(fmtD(v.agreement.startDate))}. Going live earlier is fine; fees start on the start date.</p>` : ''}`}
      </div>
      <div style="display:flex;flex-direction:column;gap:18px;min-width:0">
        <div class="card"><h2>Installation pack at cost</h2>
          ${pc.rows.length || pc.social ? `<div class="tablewrap compact"><table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Total</th></tr></thead><tbody>
            ${pc.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${r.q.toLocaleString('en-ZA')}</td><td class="r">${R(r.total, 2)}</td></tr>`).join('')}
            ${pc.social ? `<tr><td>Social media setup</td><td class="r">1</td><td class="r">${R(pc.social, 2)}</td></tr>` : ''}
          </tbody><tfoot><tr><td>Total incl. VAT</td><td></td><td class="r">${R(pc.total, 2)}</td></tr></tfoot></table></div>` : '<p class="small">No print items.</p>'}
          <p class="small">Invoiced to the vendor at cost. The signed agreement shows ${R(v.agreement.terms.pack.total, 2)}; change quantities only at the owner's request. Unit costs are set in Setup.</p>
          ${ro ? '' : `<details><summary class="strong" style="cursor:pointer;min-height:var(--tap);display:flex;align-items:center">Change quantities</summary>
            <div class="grid2" style="margin-top:8px">${printList().map((it) => { const q = F.printQty(it, v); const off = (it.when === 'tableQr' && !v.services.tableQr) || (it.when === 'own_branded' && v.model !== 'own_branded');
              return off ? '' : `<div class="field"><label for="pq_${it.key}">${esc(it.label)}</label><input id="pq_${it.key}" data-pq="${it.key}" type="number" min="0" value="${q}"></div>`; }).join('')}</div>
            <div class="acts" style="margin-top:8px"><button class="btn btn-sm btn-ghost" id="pqSave">Save quantities</button></div>
          </details>`}
        </div>
        <div class="card"><h2>Order path once live</h2><div class="flow">
          <div><b>Customer orders</b><span>On WhatsApp via Keychat${v.services.tableQr ? ' or table QR' : ''}</span></div>
          <div><b>Vendor accepts</b><span>${v.services.pilot ? 'On the Pilot screen' : 'In their WhatsApp chat'}</span></div>
          ${v.services.delivery ? `<div><b>Dispatch</b><span>${v.model === 'open' ? 'Ready gate, then offered to FEEST riders' : "Assigned to the vendor's own drivers"}</span></div><div><b>Delivered</b><span>Customer code confirms the handover</span></div>`
                                 : '<div><b>Collected</b><span>Customer collects in store</span></div>'}
        </div>${ins.keychatStoreId ? `<p class="small">Keychat store ID <b>${esc(ins.keychatStoreId)}</b> · pickup pin ${Number(v.pin.lat).toFixed(5)}, ${Number(v.pin.lng).toFixed(5)}</p>` : ''}</div>
      </div>
    </div></div>`;
  bindHead(v);
  const collect = () => { const checks = {}, fields = {};
    document.querySelectorAll('[data-ci]').forEach((c) => (checks[c.dataset.ci] = c.checked));
    document.querySelectorAll('[data-f]').forEach((i) => (fields[i.dataset.f] = i.value.trim()));
    return { checks, fields }; };
  const save = async (msg) => { await PUT(`/api/vendors/${v.id}/install`, collect()); if (msg) toast(msg); };
  document.querySelectorAll('[data-ci]').forEach((c) => (c.onchange = async () => { try { await save(); await refresh(); route(); } catch (e) { toast(e.message); c.checked = !c.checked; } }));
  if ($('iSave')) $('iSave').onclick = async () => { try { await save('Progress saved'); await refresh(); route(); } catch (e) { toast(e.message); } };
  if ($('goLive')) $('goLive').onclick = async () => { try { await save(); await act(v, 'live', {}, `${v.name} is live`); } catch (e) { $('iErr').textContent = e.message; $('iErr').hidden = false; } };
  if ($('unliveBtn')) $('unliveBtn').onclick = () => act(v, 'offline', {}, 'Taken offline');
  if ($('pqSave')) $('pqSave').onclick = async () => {
    const qty = {}; document.querySelectorAll('[data-pq]').forEach((i) => (qty[i.dataset.pq] = num(i.value)));
    try { await save(); await PUT(`/api/vendors/${v.id}/print`, { qty }); toast('Quantities saved'); await refresh(); route(); } catch (e) { toast(e.message); }
  };
}

/* =========================================================
   SETUP
   ========================================================= */
function viewSetup(tab) {
  const can = S.me.can;
  const tabs = [can.manageUsers && ['team', 'Team'], can.editSettings && ['fees', 'Fees'], can.editSettings && ['print', 'Print price list'],
    can.editSettings && ['categories', 'Categories'], can.editSettings && ['wording', 'Agreement wording'], ['owners', 'Owners'], ['account', 'My account']].filter(Boolean);
  if (!tabs.find((t) => t[0] === tab)) { location.replace('#setup/' + tabs[0][0]); return; }
  function shell(inner) {
    $('main').innerHTML = `<div class="wrap"><div class="pagehead"><div><div class="eyebrow">Setup</div><h1>${esc(tabs.find((t) => t[0] === tab)[1])}</h1></div></div>
      <nav class="setupnav">${tabs.map((t) => `<a href="#setup/${t[0]}" ${t[0] === tab ? 'aria-current="page"' : ''}>${esc(t[1])}</a>`).join('')}</nav>${inner}</div>`;
  }
  const done = async (p, msg) => { try { await p; toast(msg); await refresh(); route(); } catch (e) { toast(e.message); } };

  if (tab === 'team') {
    shell(`<div class="card"><h2>Add a team member</h2><form id="uf" class="grid3" novalidate>
        <div class="field"><label for="u_name">Name</label><input id="u_name" required></div>
        <div class="field"><label for="u_role">Role</label><select id="u_role">${S.roles.map((r) => `<option value="${r.key}">${esc(r.label)}</option>`).join('')}</select></div>
        <div class="field"><label for="u_email">Email (their login)</label><input id="u_email" type="email"></div>
        <div class="field"><label for="u_mobile">Mobile</label><input id="u_mobile" type="tel"></div>
        <div class="field"><label for="u_pw">First password</label><input id="u_pw" type="text" autocomplete="off" placeholder="At least 10 characters"></div>
        <div class="acts" style="align-self:end"><button class="btn" type="submit">Add</button></div></form>
        <p class="small">Give them the password in person; they change it under Setup → My account.</p></div>
      ${S.users.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Areas</th><th class="r">Vendors</th><th>Status</th><th></th></tr></thead><tbody>
        ${sorted(S.users).map((u) => `<tr><td class="strong">${esc(u.name)}</td>
          <td><select class="inp" data-role="${esc(u.id)}" aria-label="Role for ${esc(u.name)}">${S.roles.map((r) => `<option value="${r.key}" ${r.key === u.role ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select></td>
          <td>${esc(u.email || '')}</td><td>${esc(S.areas.filter((a) => a.reps.includes(u.id)).map((a) => a.name).join(', '))}</td><td class="r">${S.vendors.filter((v) => v.repId === u.id).length}</td>
          <td>${u.active ? 'Active' : '<span class="pill st-notnow">Inactive</span>'}</td>
          <td class="r"><button class="btn btn-sm btn-ghost" data-pw="${esc(u.id)}">Set password</button> <button class="btn btn-sm btn-ghost" data-act="${esc(u.id)}">${u.active ? 'Deactivate' : 'Reactivate'}</button></td></tr>`).join('')}</tbody></table></div><div id="pwHost"></div>` : ''}`);
    $('uf').onsubmit = (e) => { e.preventDefault();
      done(POST('/api/users', { name: $('u_name').value.trim(), role: $('u_role').value, email: $('u_email').value.trim(), mobile: $('u_mobile').value.trim(), password: $('u_pw').value }), 'Team member added'); };
    document.querySelectorAll('[data-role]').forEach((s) => (s.onchange = () => done(PUT('/api/users/' + s.dataset.role, { role: s.value }), 'Role saved')));
    document.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => { const u = byId('users', b.dataset.act); done(PUT('/api/users/' + u.id, { active: !u.active }), u.active ? 'Deactivated' : 'Reactivated'); }));
    document.querySelectorAll('[data-pw]').forEach((b) => (b.onclick = () => {
      const u = byId('users', b.dataset.pw);
      $('pwHost').innerHTML = `<div class="card"><h3>New password for ${esc(u.name)}</h3><div class="acts"><input class="inp" id="npw" style="max-width:280px" placeholder="At least 10 characters" aria-label="New password"><button class="btn btn-sm" id="npwGo">Set password</button></div></div>`;
      $('npwGo').onclick = () => done(PUT('/api/users/' + u.id, { password: $('npw').value }), 'Password set');
    }));
    return;
  }
  if (tab === 'fees') {
    const p = pricing();
    shell(`<form id="pf" class="card" novalidate><h2>Fees and defaults</h2><div class="grid3">
      <div class="field"><label for="p_tiers">Service fee tiers %</label><input id="p_tiers" value="${esc(p.tiers.join(', '))}"></div>
      <div class="field"><label for="p_def">Default tier %</label><input id="p_def" type="number" value="${esc(p.defaultTier)}"></div>
      <div class="field"><label for="p_paid">Default fee paid by</label><select id="p_paid"><option value="customer">Customer</option><option value="vendor">Vendor</option></select></div>
      <div class="field"><label for="p_del">FEEST delivery fee to customer (R)</label><input id="p_del" type="number" value="${esc(p.feestDelivery)}"></div>
      <div class="field"><label for="p_soc">Social media setup, once-off (R)</label><input id="p_soc" type="number" value="${esc(p.socialSetup)}"></div>
      <div class="field"><label for="p_start">Agreement starts after (days)</label><input id="p_start" type="number" value="${esc(p.startOffsetDays)}"></div>
      <div class="field"><label for="p_vat">VAT %</label><input id="p_vat" type="number" value="${esc(p.vat)}"></div>
      </div><h2>App benchmarks (toolkit defaults)</h2><div class="grid3">
      <div class="field"><label for="p_mk">App menu markup %</label><input id="p_mk" type="number" value="${esc(p.appMarkup)}"></div>
      <div class="field"><label for="p_cm">App commission %</label><input id="p_cm" type="number" value="${esc(p.appCommission)}"></div>
      <div class="field"><label for="p_ad">App delivery fee (R)</label><input id="p_ad" type="number" value="${esc(p.appDelivery)}"></div>
      <div class="field"><label for="p_as">App service fee %</label><input id="p_as" type="number" step="0.5" value="${esc(p.appService)}"></div>
      </div><div class="acts"><button class="btn" type="submit">Save fees</button></div>
      <p class="small">Changes apply to new toolkits and agreements. Signed agreements keep the terms they were signed on.</p></form>`);
    $('p_paid').value = p.paidBy;
    $('pf').onsubmit = (e) => { e.preventDefault();
      done(PUT('/api/settings/pricing', { tiers: $('p_tiers').value.split(/[,\s]+/).map(Number).filter((x) => x > 0), defaultTier: num($('p_def').value), paidBy: $('p_paid').value,
        feestDelivery: num($('p_del').value), socialSetup: num($('p_soc').value), startOffsetDays: num($('p_start').value), vat: num($('p_vat').value),
        appMarkup: num($('p_mk').value), appCommission: num($('p_cm').value), appDelivery: num($('p_ad').value), appService: num($('p_as').value) }), 'Fees saved'); };
    return;
  }
  if (tab === 'print') {
    const list = JSON.parse(JSON.stringify(printList()));
    shell(`<form id="prf" class="card" novalidate><h2>Print price list</h2><p class="small">Unit costs charged to the vendor at cost, excl. VAT. Default quantities fill each new pack; reps can change them per vendor.<span class="tag">Placeholders until supplier quote</span></p>
      <div class="tablewrap compact"><table><thead><tr><th>Item</th><th class="r">Unit cost (R)</th><th>Default quantity</th></tr></thead><tbody>
      ${list.map((it, i) => `<tr><td><input class="inp" data-i="${i}" data-k="label" value="${esc(it.label)}" aria-label="Item name"></td><td class="r"><input class="inp" style="max-width:120px;text-align:right" data-i="${i}" data-k="unit" type="number" step="0.01" value="${esc(it.unit)}" aria-label="Unit cost"></td>
        <td>${typeof it.qty === 'number' ? `<input class="inp" style="max-width:120px" data-i="${i}" data-k="qty" type="number" value="${esc(it.qty)}" aria-label="Default quantity">` : `<span class="small">${esc({ tables: 'One per table', drivers: 'One per own driver', vehicles: 'One per branded vehicle' }[it.qty] || it.qty)}</span>`}</td></tr>`).join('')}
      </tbody></table></div><div class="acts"><button class="btn" type="submit">Save price list</button></div></form>`);
    $('prf').onsubmit = (e) => { e.preventDefault();
      document.querySelectorAll('#prf [data-i]').forEach((inp) => { const it = list[+inp.dataset.i]; it[inp.dataset.k] = inp.dataset.k === 'label' ? inp.value.trim() : num(inp.value); });
      done(PUT('/api/settings/print', { items: list }), 'Price list saved'); };
    return;
  }
  if (tab === 'categories') {
    const cats = S.categories.slice();
    shell(`<div class="card"><h2>Vendor categories</h2><p class="small">Anyone who needs their menu or catalogue in front of customers: food, grocery, hardware, pharmacy, courier and more. Categories in use can't be removed.</p>
      <div class="chips">${cats.map((c, i) => `<span class="chip">${esc(c)}<button type="button" data-rm="${i}" aria-label="Remove ${esc(c)}">×</button></span>`).join('')}</div>
      <form id="catf" class="acts"><input class="inp" id="cat_in" style="max-width:280px" placeholder="New category" aria-label="New category"><button class="btn btn-sm" type="submit">Add</button></form></div>`);
    $('catf').onsubmit = (e) => { e.preventDefault(); const c = $('cat_in').value.trim(); if (!c || cats.includes(c)) return; done(PUT('/api/settings/categories', { items: [...cats.filter((x) => x !== 'Other'), c, ...(cats.includes('Other') ? ['Other'] : [])] }), 'Category added'); };
    document.querySelectorAll('[data-rm]').forEach((b) => (b.onclick = () => done(PUT('/api/settings/categories', { items: cats.filter((_, i) => i !== +b.dataset.rm) }), 'Category removed')));
    return;
  }
  if (tab === 'wording') {
    const W = S.settings.wording;
    shell(`<form id="wf" class="card" novalidate><h2>Agreement wording</h2><p class="small">Saving creates a new version. Signed agreements keep the wording they were signed on. Legal to approve before go-live.</p>
      <div class="field"><label for="w_text">Wording (current v${esc(W.version)})</label><textarea id="w_text" style="min-height:340px;font-size:var(--fs-meta);line-height:1.5">${esc(W.text)}</textarea></div>
      <div class="acts"><button class="btn" type="submit">Save as v${W.version + 1}</button></div></form>`);
    $('wf').onsubmit = (e) => { e.preventDefault(); done(POST('/api/settings/wording', { text: $('w_text').value }), `Saved as v${W.version + 1}`); };
    return;
  }
  if (tab === 'owners') {
    shell(S.owners.length ? `<div class="tablewrap"><table><thead><tr><th>Company</th><th>Reg no</th><th>Signatory</th><th>Email</th><th>Mobile</th><th class="r">Stores</th></tr></thead><tbody>
      ${sorted(S.owners).map((o) => `<tr><td class="strong">${esc(o.name)}</td><td>${esc(o.regNo || '')}</td><td>${esc(o.contactName || '')}${o.title ? `, ${esc(o.title)}` : ''}</td><td>${esc(o.email || '')}</td><td>${esc(o.mobile || '')}</td><td class="r">${S.vendors.filter((v) => v.ownerId === o.id).length}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="card empty"><h2>No owners yet</h2><p>Owners are added from the vendor form when a rep captures a store.</p></div>');
    return;
  }
  // account
  shell(`<form id="mf" class="card" novalidate style="max-width:520px"><h2>Change your password</h2>
    <div class="field"><label for="m_cur">Current password</label><input id="m_cur" type="password" autocomplete="current-password"></div>
    <div class="field"><label for="m_new">New password</label><input id="m_new" type="password" autocomplete="new-password" placeholder="At least 10 characters"></div>
    <div class="acts"><button class="btn" type="submit">Change password</button></div></form>`);
  $('mf').onsubmit = (e) => { e.preventDefault(); done(POST('/api/me/password', { current: $('m_cur').value, next: $('m_new').value }), 'Password changed'); };
}

/* =========================================================
   BOOT
   ========================================================= */
(async function boot() {
  try { await refresh(); }
  catch (e) { $('main').innerHTML = `<div class="wrap"><div class="card empty"><h2>Back office unavailable</h2><p>${esc(e.message)}</p></div></div>`; return; }
  route();
  // Keep lists fresh while the tab is open; vendor screens redraw only on their own actions.
  setInterval(async () => { if (document.hidden) return; try { await refresh(); if (current.onData) current.onData(); } catch (e) { /* offline: try again next tick */ } }, 30000);
})();
})();
