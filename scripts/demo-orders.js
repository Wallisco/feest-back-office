#!/usr/bin/env node
'use strict';
/**
 * Loads clearly flagged DEMO data for the Overview dashboard on a TEST server, until dispatch
 * sends real orders (playbook step 7). Every row it writes has demo = true, every demo store is
 * named "Sample: …", and the dashboard shows a "Demo data" banner while any demo row exists.
 *
 *   node scripts/demo-orders.js --test-server            load 150 days of sample orders
 *   node scripts/demo-orders.js --test-server --remove   delete every demo row
 *
 * Refuses to run without --test-server. Never run it on production.
 */
const { Client } = require('pg');
const F = require('../src/vendors/finance');

const args = new Set(process.argv.slice(2));
if (!args.has('--test-server')) {
  console.error('Refusing to run: add --test-server to confirm this is a test server. Never load demo data on production.');
  process.exit(1);
}

// Deterministic randomness, so two loads look the same.
let seed = 20261006;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => a + rnd() * (b - a);
const normal = (mean, sd) => { const u = 1 - rnd(), v = rnd(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const poisson = (l) => { if (l > 30) return Math.max(0, Math.round(normal(l, Math.sqrt(l)))); let k = 0, p = 1; const L = Math.exp(-l); do { k++; p *= rnd(); } while (p > L); return k - 1; };
const r2 = (n) => Math.round(n * 100) / 100;
const addMin = (d, m) => new Date(d.getTime() + m * 60000);

const AREAS = [
  ['Claremont', 'Cape Town', 'Western Cape', -33.980, 18.465], ['Sea Point', 'Cape Town', 'Western Cape', -33.917, 18.389],
  ['Bellville', 'Cape Town', 'Western Cape', -33.900, 18.630], ['Kempton Park', 'Johannesburg', 'Gauteng', -26.100, 28.233],
  ['Sandton', 'Johannesburg', 'Gauteng', -26.107, 28.056], ['Edenvale', 'Johannesburg', 'Gauteng', -26.141, 28.152],
];
const STORES = ['Chicken Shack', 'Biryani House', 'Burger Joint', 'Pizza Corner', 'Sushi Bar', 'Grill House', 'Curry Pot', 'Wrap Co', 'Fish & Chips',
  'Taco Spot', 'Shawarma King', 'Pasta Place', 'Bakery Café', 'Noodle Bar', 'Steakhouse', 'Gatsby Co', 'Bunny Chow', 'Salad Kitchen'];
const LOST = { cancelled: ['Customer cancelled', 'Store out of stock', 'Store closed early'], failed: ['Customer not reachable', 'Wrong address'], unassigned: ['No driver accepted'] };

async function remove(db) {
  await db.query('BEGIN');
  await db.query('DELETE FROM driver_offers WHERE demo');
  await db.query('DELETE FROM order_facts WHERE demo');
  await db.query('DELETE FROM drivers WHERE demo');
  const owners = (await db.query('SELECT DISTINCT owner_id FROM vendors WHERE demo')).rows.map((r) => r.owner_id);
  await db.query('DELETE FROM vendors WHERE demo');
  if (owners.length) await db.query('DELETE FROM owners WHERE id = ANY($1) AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.owner_id = owners.id)', [owners]);
  await db.query('DELETE FROM areas WHERE demo AND NOT EXISTS (SELECT 1 FROM vendors v WHERE v.area_id = areas.id)');
  await db.query('COMMIT');
}

async function insertMany(db, table, cols, rows) {
  for (let i = 0; i < rows.length; i += 800) {
    const chunk = rows.slice(i, i + 800), vals = [], ph = [];
    chunk.forEach((r, j) => { ph.push('(' + cols.map((_, k) => `$${j * cols.length + k + 1}`).join(',') + ')'); vals.push(...r); });
    await db.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${ph.join(',')}`, vals);
  }
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  await remove(db);
  if (args.has('--remove')) { console.log('Demo data removed.'); await db.end(); return; }

  const rep = (await db.query(`SELECT id FROM users WHERE active ORDER BY (role IN ('ceo','admin')) DESC, created_at LIMIT 1`)).rows[0];
  if (!rep) { console.error('Create a user first (scripts/create-user.js).'); process.exit(1); }
  const DAYS = 150, now = new Date(), today0 = new Date(now.toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }) + 'T00:00:00+02:00');

  await db.query('BEGIN');
  const areas = [];
  for (const [name, city, region, lat, lng] of AREAS) {
    const a = (await db.query('INSERT INTO areas (name, city, region, notes, demo) VALUES ($1,$2,$3,$4,true) RETURNING id', [`${name} (sample)`, city, region, 'Demo data'])).rows[0];
    areas.push({ id: a.id, lat, lng, region });
  }
  const stores = [];
  for (let i = 0; i < STORES.length; i++) {
    const area = areas[i % areas.length];
    const own = (await db.query(`INSERT INTO owners (name, contact_name) VALUES ($1, 'Sample owner') RETURNING id`, [`Sample ${STORES[i]} (Pty) Ltd`])).rows[0];
    const liveDaysAgo = Math.round(i < 14 ? between(70, DAYS) : between(8, 25)); // most established, a few new
    const tier = pick([15, 15, 15, 10, 20]), aov = Math.round(between(150, 270) / 5) * 5, opd = Math.round(between(14, 42));
    const toolkit = Object.assign(F.toolkitDefaults(), { aov, opd, days: 26, tier, delivery: 35 });
    const v = (await db.query(`INSERT INTO vendors (name, category, area_id, rep_id, owner_id, stage, lat, lng, address, model, services, toolkit, toolkit_completed_at, live_at, demo)
      VALUES ($1,'Restaurant',$2,$3,$4,'live',$5,$6,'Demo data','open',$7,$8,now(),$9,true) RETURNING id`,
    [`Sample: ${STORES[i]}`, area.id, rep.id, own.id, area.lat + between(-0.01, 0.01), area.lng + between(-0.01, 0.01),
      { whatsapp: true, delivery: true, pickup: true, loyalty: true }, toolkit, new Date(today0.getTime() - liveDaysAgo * 864e5)])).rows[0];
    stores.push({ id: v.id, area, tier, aov, opd, liveDaysAgo });
  }

  const drivers = [];
  for (let i = 0; i < 64; i++) {
    const area = areas[i % areas.length], status = i < 56 ? 'active' : 'onboarding';
    const id = `DEMO-DRV-${String(i + 1).padStart(3, '0')}`;
    drivers.push({ id, area, status });
  }
  await insertMany(db, 'drivers', ['id', 'area_id', 'status', 'vehicle', 'joined_on', 'demo'],
    drivers.map((d) => [d.id, d.area.id, d.status, pick(['scoothero_bike', 'scoothero_bike', 'own_bike']), new Date(today0.getTime() - between(10, 200) * 864e5), true]));

  const orders = [], offers = []; let n = 0;
  for (let day = DAYS - 1; day >= 0; day--) {
    const d0 = new Date(today0.getTime() - day * 864e5), dow = new Date(d0.getTime() + 12 * 36e5).getUTCDay();
    const weekday = [1.25, 0.85, 0.9, 0.95, 1.05, 1.35, 1.4][dow];
    for (const s of stores) {
      const age = s.liveDaysAgo - day; if (age < 0) continue;
      const ramp = Math.min(1, 0.35 + age / 45); // stores grow into their volume
      const count = poisson(s.opd * weekday * ramp);
      const pool = drivers.filter((x) => x.status === 'active' && x.area.id === s.area.id);
      const improve = 1 - 0.25 * Math.min(1, (DAYS - day) / DAYS); // ops get faster over time
      for (let k = 0; k < count; k++) {
        n++;
        const hour = pick([11, 12, 12, 13, 13, 17, 18, 18, 19, 19, 19, 20, 20, 21]);
        const created = addMin(d0, hour * 60 + between(0, 59));
        const value = r2(Math.max(60, normal(s.aov, s.aov * 0.28)));
        const fee = r2(value * s.tier / 100), del = 35, card = r2((value + fee + del) * 0.03);
        const roll = rnd();
        const status = roll < 0.025 ? 'cancelled' : roll < 0.04 ? 'failed' : roll < 0.058 * improve + 0.0165 ? 'unassigned' : 'delivered';
        const paid = addMin(created, between(1, 4));
        const ready = addMin(paid, Math.max(8, normal(16, 3)));
        const driver = pick(pool);
        // offer cascade: rounds of up to 5 drivers until one accepts
        let accepted = status !== 'unassigned' && status !== 'cancelled', t = addMin(ready, -between(4, 8));
        const rounds = accepted ? (rnd() < 0.95 ? 1 : 2) : 3;
        for (let r = 0; r < rounds; r++) {
          const shown = Math.min(5, pool.length);
          for (let j = 0; j < shown; j++) {
            const lastRound = accepted && r === rounds - 1, isTaker = lastRound && j === 0;
            const other = lastRound ? (rnd() < 0.05 ? 'declined' : 'withdrawn') : (rnd() < 0.55 ? 'declined' : 'expired');
            offers.push([`DEMO-${n}`, isTaker ? driver.id : pick(pool).id, s.area.id, addMin(t, j * 0.1), isTaker ? 'accepted' : other, true]);
          }
          t = addMin(t, 1.5);
        }
        const row = { id: `DEMO-${n}`, created, paid, value, fee, del, card, status, store: s, driver: accepted ? driver.id : null };
        if (status === 'delivered' || status === 'failed') {
          row.assigned = t; row.atStore = addMin(ready, normal(-1, 2.5));
          row.collected = addMin(row.atStore < ready ? ready : row.atStore, Math.max(0.5, normal(4.2 * improve + 1, 1.6)));
          row.delivered = status === 'delivered' ? addMin(row.collected, Math.max(4, normal(12.5, 3))) : null;
        }
        row.promised = addMin(created, 45);
        row.lost = status === 'delivered' ? null : pick(LOST[status]);
        row.stacked = status === 'delivered' && rnd() < 0.13;
        orders.push([row.id, s.id, s.area.id, pick(['whatsapp', 'whatsapp', 'whatsapp', 'web', 'phone']), status, row.lost,
          value, status === 'delivered' ? fee : 0, del, status === 'delivered' ? card : 0, row.driver, row.stacked, created, paid,
          status === 'cancelled' ? null : ready, row.assigned || null, row.atStore || null, row.collected || null, row.delivered || null, row.promised, true]);
      }
    }
  }
  await insertMany(db, 'order_facts', ['id', 'vendor_id', 'area_id', 'channel', 'status', 'lost_reason', 'order_value', 'feest_fee', 'delivery_fee', 'processing_cost',
    'driver_id', 'stacked', 'created_at', 'paid_at', 'ready_at', 'assigned_at', 'at_store_at', 'collected_at', 'delivered_at', 'promised_at', 'demo'], orders);
  await insertMany(db, 'driver_offers', ['order_id', 'driver_id', 'area_id', 'offered_at', 'response', 'demo'], offers);
  await db.query('COMMIT');
  console.log(`Demo data loaded: ${areas.length} areas, ${stores.length} stores, ${drivers.length} drivers, ${orders.length.toLocaleString('en-ZA')} orders, ${offers.length.toLocaleString('en-ZA')} offers.`);
  console.log('Remove it with: node scripts/demo-orders.js --test-server --remove');
  await db.end();
})().catch(async (e) => { console.error(e.message); process.exit(1); });
