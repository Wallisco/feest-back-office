'use strict';
/**
 * The Overview dashboard: every number's definition lives here, once.
 * Reads Postgres only (order_facts, driver_offers, drivers, vendors), never live dispatch.
 *
 * Definitions (period = the last N days, South African days):
 *   Stores              vendors live now (signed-not-live shown as "starting")
 *   Orders delivered    status delivered, by created day
 *   GMV / AOV           food at menu prices; AOV = GMV ÷ delivered orders
 *   Take rate           FEEST fee ÷ GMV (weighted, never an average of daily ratios)
 *   FEEST margin        FEEST fee − card processing FEEST pays (delivery fee is the rider's)
 *   Avg store margin    FEEST margin over the last 30 days ÷ stores live for all 30 days
 *   Projected 12 months per live or signed store: last-30-day margin × 12 when it has 30 days
 *                       of orders; otherwise its toolkit estimate × the months it trades in the
 *                       next 12 (a signed store counts from its start date)
 *   Lost orders         cancelled, failed or never assigned, ÷ all orders created
 *   JAR                 offers accepted ÷ offers answered or left to expire (withdrawn offers,
 *                       when another driver took the job first, don't count)
 *   Store wait          driver at store → order collected
 *   Delivery lead time  collected → delivered
 *   Order to delivered  paid (or created) → delivered
 *   On time             delivered by the promised time, of delivered orders with a promise
 *   Moving averages     trailing 30 and 60 days, shown only once the window is full
 */
const F = require('../vendors/finance');

const TZ = 'Africa/Johannesburg';
// Targets from the project brief's segment table (docs/feest-spec.md section 4); Setup → Segment targets later.
const TARGETS = { storeWait: 4, deliveryLead: 12, orderToDelivered: 36 };
const round = (n, dp = 2) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);
const nn = (x) => (x === null || x === undefined ? null : Number(x));
const ratio = (a, b) => (b > 0 ? a / b : null);
const pct = (a, b) => (b > 0 ? a / b * 100 : null);

/** Trailing mean over `w` days of a daily series; null until the window is full. */
function movingAverage(values, w) {
  const out = []; let sum = 0;
  values.forEach((v, i) => {
    sum += v; if (i >= w) sum -= values[i - w];
    out.push(i >= w - 1 ? round(sum / w, 2) : null);
  });
  return out;
}

/** Trailing weighted ratio (Σnum ÷ Σden) over `w` days, as a %; null until the window is full. */
function movingRatio(nums, dens, w) {
  const out = []; let n = 0, d = 0;
  nums.forEach((v, i) => {
    n += v; d += dens[i];
    if (i >= w) { n -= nums[i - w]; d -= dens[i - w]; }
    out.push(i >= w - 1 && d > 0 ? round(n / d * 100, 2) : null);
  });
  return out;
}

/** Whole months a store trades in the next 12, from its start date (0–12). */
function monthsInNext12(startDate, today) {
  if (!startDate || startDate <= today) return 12;
  const a = new Date(today + 'T12:00:00Z'), b = new Date(String(startDate).slice(0, 10) + 'T12:00:00Z');
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() > a.getUTCDate() ? 1 : 0);
  return Math.max(0, 12 - months);
}

/** Projected FEEST margin for the next 12 months, store by store. */
function project12(stores, today, pricing) {
  let total = 0, runRate = 0, estimated = 0;
  stores.forEach((s) => {
    const months = s.live ? 12 : monthsInNext12(s.startDate, today);
    if (!months) return;
    let monthly;
    if (s.live && s.daysWithOrders >= 30) { monthly = s.margin30; runRate++; }
    else if (s.toolkit && s.delivery) { monthly = F.feestMarginMonth(s.toolkit, pricing); estimated++; }
    else return;
    total += monthly * months;
  });
  return { total: round(total, 0), fromRunRate: runRate, fromEstimate: estimated };
}

function scope(f, alias, params) {
  const w = [];
  if (f.areaId) { params.push(f.areaId); w.push(`${alias}.area_id = $${params.length}`); }
  else if (f.region) { params.push(f.region); w.push(`${alias}.area_id IN (SELECT id FROM areas WHERE region = $${params.length})`); }
  return w;
}

/**
 * f: { days: 30|60|90, region, areaId, today: 'YYYY-MM-DD' }
 */
async function dashboard(db, f, pricing) {
  const days = [7, 30, 60, 90].includes(Number(f.days)) ? Number(f.days) : 30;
  const today = f.today;
  const seriesDays = days + 59; // room for a full 60-day average across the whole period
  const p = F.pricing(pricing);

  // ---------- period totals ----------
  const P = []; const ws = scope(f, 'o', P);
  P.push(days); const dIdx = P.length; P.push(today); const tIdx = P.length;
  const inPeriod = `(o.created_at AT TIME ZONE '${TZ}')::date > $${tIdx}::date - $${dIdx}::int AND (o.created_at AT TIME ZONE '${TZ}')::date <= $${tIdx}::date`;
  const where = ['TRUE', inPeriod].concat(ws).join(' AND ');
  const t = (await db.query(`
    SELECT count(*)::int AS created,
      count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      count(*) FILTER (WHERE status IN ('cancelled','failed','unassigned'))::int AS lost,
      coalesce(sum(order_value) FILTER (WHERE status = 'delivered'), 0)::float AS gmv,
      coalesce(sum(feest_fee) FILTER (WHERE status = 'delivered'), 0)::float AS fee,
      coalesce(sum(processing_cost) FILTER (WHERE status = 'delivered'), 0)::float AS card,
      coalesce(sum(delivery_fee) FILTER (WHERE status = 'delivered'), 0)::float AS rider_pay,
      avg(extract(epoch FROM collected_at - at_store_at) / 60) FILTER (WHERE status = 'delivered' AND at_store_at IS NOT NULL AND collected_at IS NOT NULL) AS store_wait,
      count(*) FILTER (WHERE status = 'delivered' AND at_store_at IS NOT NULL AND collected_at IS NOT NULL)::int AS store_wait_n,
      avg(extract(epoch FROM delivered_at - collected_at) / 60) FILTER (WHERE status = 'delivered' AND collected_at IS NOT NULL) AS delivery_lead,
      count(*) FILTER (WHERE status = 'delivered' AND collected_at IS NOT NULL)::int AS delivery_lead_n,
      avg(extract(epoch FROM delivered_at - coalesce(paid_at, created_at)) / 60) FILTER (WHERE status = 'delivered') AS order_to_delivered,
      count(*) FILTER (WHERE status = 'delivered' AND promised_at IS NOT NULL)::int AS promised_n,
      count(*) FILTER (WHERE status = 'delivered' AND promised_at IS NOT NULL AND delivered_at <= promised_at)::int AS on_time_n,
      count(*) FILTER (WHERE status = 'delivered' AND stacked)::int AS stacked_n,
      count(DISTINCT driver_id) FILTER (WHERE status = 'delivered')::int AS drivers_delivering,
      bool_or(demo) AS any_demo
    FROM order_facts o WHERE ${where}`, P)).rows[0];

  const lostReasons = (await db.query(`
    SELECT coalesce(lost_reason, status) AS reason, count(*)::int AS n FROM order_facts o
    WHERE ${where} AND status IN ('cancelled','failed','unassigned') GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, P)).rows;

  // ---------- JAR ----------
  const OP = []; const ows = scope(f, 'x', OP);
  OP.push(days); const od = OP.length; OP.push(today); const ot = OP.length;
  const offers = (await db.query(`
    SELECT count(*) FILTER (WHERE response <> 'withdrawn')::int AS offers, count(*) FILTER (WHERE response = 'accepted')::int AS accepted,
           count(*) FILTER (WHERE response = 'expired')::int AS expired
    FROM driver_offers x WHERE (x.offered_at AT TIME ZONE '${TZ}')::date > $${ot}::date - $${od}::int
      AND (x.offered_at AT TIME ZONE '${TZ}')::date <= $${ot}::date ${ows.length ? 'AND ' + ows.join(' AND ') : ''}`, OP)).rows[0];

  // ---------- drivers ----------
  const DP = []; const dws = scope(f, 'd', DP);
  const drv = (await db.query(`
    SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'onboarding')::int AS onboarding
    FROM drivers d ${dws.length ? 'WHERE ' + dws.join(' AND ') : ''}`, DP)).rows[0];
  const RP = []; const rws = scope(f, 'o', RP); RP.push(today);
  const active7 = (await db.query(`
    SELECT count(DISTINCT driver_id)::int AS n FROM order_facts o
    WHERE status = 'delivered' AND (created_at AT TIME ZONE '${TZ}')::date > $${RP.length}::date - 7
      AND (created_at AT TIME ZONE '${TZ}')::date <= $${RP.length}::date ${rws.length ? 'AND ' + rws.join(' AND ') : ''}`, RP)).rows[0].n;

  // ---------- stores and margin ----------
  const VP = []; const vws = scope(f, 'v', VP); VP.push(today); const vt = VP.length;
  const stores = (await db.query(`
    SELECT v.id, v.name, v.area_id, v.live_at, v.toolkit, v.services,
      (v.live_at IS NOT NULL AND v.closed_at IS NULL) AS live,
      ag.start_date,
      coalesce(m.margin30, 0)::float AS margin30, coalesce(m.days_with_orders, 0)::int AS days_with_orders
    FROM vendors v
    LEFT JOIN LATERAL (SELECT start_date FROM agreements a WHERE a.vendor_id = v.id AND a.status = 'active' ORDER BY a.signed_at DESC LIMIT 1) ag ON TRUE
    LEFT JOIN LATERAL (
      SELECT sum(feest_fee - processing_cost) FILTER (WHERE status = 'delivered' AND (created_at AT TIME ZONE '${TZ}')::date > $${vt}::date - 30) AS margin30,
             ($${vt}::date - min((created_at AT TIME ZONE '${TZ}')::date)) + 1 AS days_with_orders
      FROM order_facts o WHERE o.vendor_id = v.id) m ON TRUE
    WHERE v.closed_at IS NULL AND (v.live_at IS NOT NULL OR ag.start_date IS NOT NULL) ${vws.length ? 'AND ' + vws.join(' AND ') : ''}`, VP)).rows;
  const live = stores.filter((s) => s.live);
  const full30 = live.filter((s) => s.days_with_orders >= 30);
  const proj = project12(stores.map((s) => ({ live: s.live, startDate: s.start_date && new Date(s.start_date).toISOString().slice(0, 10),
    daysWithOrders: s.days_with_orders, margin30: s.margin30, toolkit: s.toolkit, delivery: !!(s.services && s.services.delivery) })), today, p);

  // ---------- daily series for moving averages ----------
  const SP = []; const sws = scope(f, 'o', SP); SP.push(seriesDays); const sd = SP.length; SP.push(today); const st = SP.length;
  const daily = (await db.query(`
    SELECT to_char(g.day, 'YYYY-MM-DD') AS day,
      coalesce(count(o.id) FILTER (WHERE o.status = 'delivered'), 0)::int AS orders,
      coalesce(sum(o.order_value) FILTER (WHERE o.status = 'delivered'), 0)::float AS gmv,
      coalesce(sum(o.feest_fee) FILTER (WHERE o.status = 'delivered'), 0)::float AS fee
    FROM generate_series($${st}::date - ($${sd}::int - 1), $${st}::date, interval '1 day') g(day)
    LEFT JOIN order_facts o ON (o.created_at AT TIME ZONE '${TZ}')::date = g.day::date ${sws.length ? 'AND ' + sws.join(' AND ') : ''}
    GROUP BY 1 ORDER BY 1`, SP)).rows;
  const orders = daily.map((d) => d.orders), fee = daily.map((d) => d.fee), gmv = daily.map((d) => d.gmv);
  const ma = { orders30: movingAverage(orders, 30), orders60: movingAverage(orders, 60), take30: movingRatio(fee, gmv, 30), take60: movingRatio(fee, gmv, 60) };
  const cut = daily.length - days;
  const series = daily.slice(cut).map((d, i) => ({
    day: d.day,
    orders: d.orders, take: d.gmv > 0 ? round(d.fee / d.gmv * 100, 2) : null,
    orders30: ma.orders30[cut + i], orders60: ma.orders60[cut + i], take30: ma.take30[cut + i], take60: ma.take60[cut + i],
  }));

  // ---------- by area ----------
  const AP = []; AP.push(days); const ad = AP.length; AP.push(today); const at = AP.length;
  const areaFilter = f.areaId ? (AP.push(f.areaId), `AND a.id = $${AP.length}`) : f.region ? (AP.push(f.region), `AND a.region = $${AP.length}`) : '';
  const byArea = (await db.query(`
    SELECT a.id, a.name, a.city, a.region,
      (SELECT count(*) FROM vendors v WHERE v.area_id = a.id AND v.live_at IS NOT NULL AND v.closed_at IS NULL)::int AS stores,
      count(o.id) FILTER (WHERE o.status = 'delivered')::int AS delivered,
      count(o.id)::int AS created,
      count(o.id) FILTER (WHERE o.status IN ('cancelled','failed','unassigned'))::int AS lost,
      coalesce(sum(o.order_value) FILTER (WHERE o.status = 'delivered'), 0)::float AS gmv,
      coalesce(sum(o.feest_fee) FILTER (WHERE o.status = 'delivered'), 0)::float AS fee,
      coalesce(sum(o.feest_fee - o.processing_cost) FILTER (WHERE o.status = 'delivered'), 0)::float AS margin,
      avg(extract(epoch FROM o.delivered_at - coalesce(o.paid_at, o.created_at)) / 60) FILTER (WHERE o.status = 'delivered') AS o2d
    FROM areas a
    LEFT JOIN order_facts o ON o.area_id = a.id AND (o.created_at AT TIME ZONE '${TZ}')::date > $${at}::date - $${ad}::int AND (o.created_at AT TIME ZONE '${TZ}')::date <= $${at}::date
    WHERE TRUE ${areaFilter}
    GROUP BY a.id ORDER BY a.region, a.name`, AP)).rows
    .map((r) => ({ id: r.id, name: r.name, city: r.city, region: r.region, stores: r.stores, delivered: r.delivered,
      aov: round(ratio(r.gmv, r.delivered), 2), takeRate: round(pct(r.fee, r.gmv), 2), margin: round(r.margin, 0),
      lostPct: round(pct(r.lost, r.created), 1), orderToDelivered: round(nn(r.o2d), 1) }))
    .filter((r) => r.stores || r.delivered);

  const signed = stores.filter((s) => !s.live).length;
  return {
    period: { days, today }, demo: !!t.any_demo || (await db.query('SELECT bool_or(demo) AS d FROM vendors')).rows[0].d === true,
    hasOrders: t.created > 0,
    stores: { live: live.length, starting: signed },
    avgStoreMargin: full30.length ? round(full30.reduce((a, s) => a + s.margin30, 0) / full30.length, 0) : null,
    avgStoreMarginStores: full30.length,
    projected12: proj,
    orders: { created: t.created, delivered: t.delivered, perDay: round(t.delivered / days, 1) },
    gmv: round(t.gmv, 0), aov: round(ratio(t.gmv, t.delivered), 2),
    takeRate: round(pct(t.fee, t.gmv), 2), feestFee: round(t.fee, 0), margin: round(t.fee - t.card, 0), riderPay: round(t.rider_pay, 0),
    lost: { n: t.lost, pct: round(pct(t.lost, t.created), 1), reasons: lostReasons },
    jar: { pct: round(pct(offers.accepted, offers.offers), 1), offers: offers.offers, accepted: offers.accepted, expired: offers.expired },
    drivers: { active: drv.active, onboarding: drv.onboarding, delivering7: active7, ordersPerDriverDay: round(ratio(t.delivered, t.drivers_delivering * days), 1) },
    times: {
      storeWait: round(nn(t.store_wait), 1), storeWaitN: t.store_wait_n,
      deliveryLead: round(nn(t.delivery_lead), 1), deliveryLeadN: t.delivery_lead_n,
      orderToDelivered: round(nn(t.order_to_delivered), 1),
      onTimePct: round(pct(t.on_time_n, t.promised_n), 1), stackedPct: round(pct(t.stacked_n, t.delivered), 1),
    },
    series, byArea, targets: TARGETS,
  };
}

module.exports = { TARGETS, dashboard, movingAverage, movingRatio, monthsInNext12, project12 };
