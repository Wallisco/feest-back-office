# FEEST Back Office — Build Spec

Version 1.0 · 6 October 2026 · Owner: Wahlied Cole · Written for Claude Code, in the same way as the ScootHero Back Office Property spec (`Wallisco/Scoothero_Back_Office/docs/property-spec.md`).

This spec covers the whole FEEST back office: signing vendors, running deliveries, managing drivers, paying them weekly, and measuring every segment of every order. It replaces two things: the vendor back office in this repo (built) and `ops.html` in the dispatch service (`Wallisco/habibi-delivery`). There is one FEEST back office. Habibi was the working name.

---

## 1. Architecture decision

**One back office, one login, one Postgres database for the back office. Modules, not separate apps. Dispatch stays a separate engine behind it.**

```
   STAFF (browser, phone)                 KEYCHAT (WhatsApp)        DRIVER APP (Expo)
          │                                      │                         │
          ▼                                      ▼                         ▼
 ┌───────────────────────────┐   service key   ┌──────────────────────────────────┐
 │  FEEST BACK OFFICE         │ ─────────────▶ │  DISPATCH ENGINE                  │
 │  this repo                 │  /v1/ops/*      │  Wallisco/habibi-delivery         │
 │  Express 5 · Postgres      │ ◀───────────── │  Fastify · ready gate · offers    │
 │  vendors, people, setup,   │  event feed     │  stacking · fees · OTP · OSRM     │
 │  payouts, metrics, audit   │  (cursor)       │  live orders and driver state     │
 └───────────────────────────┘                 └──────────────────────────────────┘
          │                                              │
          ▼                                              ▼
   Altron wallet API (payouts)                    OSRM (OpenStreetMap routing)
```

Who owns what:

| Record | Owner | Why |
|---|---|---|
| Staff, roles, audit log | Back office | One login for everything |
| Areas, reps, vendors, owners, agreements, installation | Back office | Built (Vendors module) |
| Delivery zones (polygons), rate cards, surge | Back office edits, dispatch applies | Staff change prices in one place; dispatch prices every order |
| Live orders, offers, driver positions, driver states | Dispatch | Held in memory and solved every few seconds |
| Driver accounts, documents, driver ledger | Dispatch (driver app signs in there) | The back office is the screen for them |
| Order facts and segment timings (history) | Back office (copied from the event feed) | Reporting at 1m orders a month without loading dispatch |
| Weekly payouts and wallet transfers | Back office | Finance approval, audit, reconciliation |

Rules that follow:
- **Staff never call dispatch from the browser.** The back office calls dispatch server-to-server with a service key (`DISPATCH_URL`, `DISPATCH_SERVICE_KEY`) through one client, `src/lib/dispatch.js`. The open `/v1/ops/*` routes on dispatch are closed to everyone else.
- **`ops.html` is retired** once the Operations, Drivers, Pricing and Integration modules here reach parity (playbook step 10).
- **History comes from the event feed, not live queries.** Dispatch exposes `GET /v1/ops/events?after=<cursor>`. The back office polls it every few seconds and writes `order_facts` and `order_segments`. Reports read Postgres, never dispatch.

### Scale: 1 million orders a month

1m orders a month is about 33,000 a day. Assuming 15% of a day's orders land in the peak hour, that is about 5,000 an hour, or 85 a minute.
- The back office writes about 10 events per order, so about 330,000 rows a day. Postgres handles this easily. `order_facts` and `order_segments` are partitioned by month.
- Driver positions are never written to the back office. Only the completed trail is stored, once, as delivery evidence (dispatch rule).
- Live screens (map, orders today) read dispatch through the client. Each screen polls at most every 5 seconds, and the back office caches the response for 2 seconds so ten staff on the map cost one dispatch call.
- No AWS or Azure. Everything runs on our own VPS: Postgres, Node, PM2, Nginx. The OSRM routing server sits on the dispatch server.

---

## 2. Roles and permissions

Enforced on the server. Hiding a button is not security.

| Role | Can do |
|---|---|
| Sales rep | Vendors: capture, services, toolkit, sign, pack, installation, for their own vendors or their areas |
| Sales lead | Everything a rep can, on every vendor; areas and reps |
| Onboarding / Installation | Installation checklist, print quantities and go-live on any vendor |
| Dispatcher | Operations: watch orders and the live map, reassign, cancel, close, issue codes, fix addresses, message drivers |
| Ops lead | Everything a dispatcher can, plus driver onboarding decisions, suspensions, incidents, pricing previews |
| Driver support | Drivers: documents, onboarding steps, messages, notes. No pricing, no payouts |
| Finance | View everything; prepare and approve payouts; ledger adjustments; Keychat reconciliation |
| CEO, Admin | Everything, plus team, fees, pricing changes, segment targets, agreement wording and setup |

Rules:
- **Pricing changes** (rate cards, zone polygons, surge) are saved by Ops lead, CEO or Admin. Every change shows a preview of 20 recent orders under the old and new price before saving, and keeps a history.
- **Payouts need two people.** The person who prepares a payout run can't approve it. Approval is Finance or CEO.
- **Ledger adjustments** (manual credits or debits on a driver) need a reason, and over R500 need a second approver.
- **Driver suspensions** need a reason the driver sees in the app.

Every write goes through `audit_log` (who, what, when, before/after), including actions sent to dispatch.

---

## 3. Modules and menus

Top bar: module switcher. A user sees only the modules their role allows. Inside each module, a left menu follows the workflow, with live counts and anything past its SLA flagged.

```
Overview
  Today                     orders, live drivers, on-time %, segment times against target, alerts
Vendors (built)
  Dashboard · Capture · All vendors · Areas and reps · Ready to sign · Awaiting sign-off
  Installation · Live · Not now
Operations
  Live map                  drivers and open orders on OpenStreetMap
  Orders                    today, search, filters by stage, store, area
  Exceptions                late, unassigned, stuck, failed delivery, driver problem reports
  Stacked runs              runs with 2–3 orders and the time each order lost
Drivers
  Marketplace opt-ins       drivers who chose FEEST in the ScootHero marketplace
  Onboarding                documents, checks, training, activate
  Active drivers            status, area, acceptance, completion, rating, vehicle
  Messages                  two-way with the driver app
Pricing
  Zones                     polygons on the map, by area
  Rate cards                per zone: customer fee, driver pay, per-km rate, minimum
  Surge                     scheduled bonuses by zone and time
Payouts
  This week                 running totals per driver (Monday to Sunday)
  Payout runs               prepare, check, approve, send to wallet, reconcile
  Driver ledger             earnings, tips, rental deductions, adjustments
  Keychat reconciliation    what Keychat owes FEEST for completed deliveries
Metrics
  Segments                  the ten order segments against target
  By store · By area · By driver
  Ready gate                predicted vs actual ready time per store
Integration
  Keychat events            webhooks in and out, retries, failures
  Partner keys              issue and rotate
Setup
  Team and roles · Areas · Vendor categories · Fees · Print price list · Agreement wording
  Segment targets · Payout settings · Stacking rules
```

---

## 4. Order segments and metrics

These are the ten segments from the project brief. Targets are editable in Setup → Segment targets ("dynamically adopted"), and every screen that shows a segment compares it against the current target.

| # | Segment | Starts | Ends | Target (min) | Cumulative |
|---|---|---|---|---|---|
| 1 | Order time (Keychat, WhatsApp) | Customer opens checkout | Payment confirmed | 4 | 4 |
| 2 | Take time (phone orders) | Call answered | Order captured | 3 | 7 |
| 3 | Make time | Order accepted by store | Food made | 13 | 20 |
| 4 | Packaging and QC | Food made | Order packed (POS "ready") | 3 | 23 |
| 5 | Wait time | Order ready | Driver assigned and at store | 4 | 27 |
| 6 | Pickup time (hustle) | Driver at store | Driver leaves with order (collected) | 4 | 31 |
| 7 | Customer drive time | Collected | Arrived at customer | 7 | 38 |
| 8 | Door time | Arrived at customer | Delivered (OTP verified) | 5 | 43 |
| 9 | Store return time | Delivered | Back at store (stationed drivers) or next zone | 7 | 50 |
| 10 | End run time | Back at store | Next order accepted | 4 | 54 |

Rolled-up intervals shown on the Overview:

| Interval | Segments | Target |
|---|---|---|
| Order to meal prep | 1–4 | 23 min |
| Meal prep to collection | 5–6 | 8 min |
| Collection to delivery | 7–8 | 12 min |
| Store return | 9–10 | 11 min |

Where each timestamp comes from:

| Event | Source | In dispatch today? |
|---|---|---|
| Checkout opened, payment confirmed | Keychat order payload (`checkoutStartedAt`, `paidAt`) | No. Ask Keychat to send both on job create |
| Phone order call answered, captured | Pilot POS or the store screen | No. Needs a source (open decision 5) |
| Store accepted, food made | Pilot POS events | No. `readyAt` only |
| Packed / ready | POS ready event | Yes, `readyAt` |
| Driver assigned | Dispatch | Partly. Add `assignedAt` |
| At store | Geofence 75 m around the store pin | No. Add `atStoreAt` |
| Collected | Driver scan | Yes, `collectedAt` |
| At customer | Geofence 75 m around the drop-off | No. Add `atCustomerAt` |
| Delivered | OTP verified | Yes, `completedAt` |
| Back at store / next order accepted | Geofence, next offer accepted | No. Add both |

A segment with a missing timestamp shows as "Not measured", never as zero. The Metrics screens show how many orders each segment was measured on.

Measured medians per store feed the ready gate (make plus packaging time), so dispatch sends drivers to arrive when the food is ready. That is the "dynamically adopted" part: the target is what we aim for; the measured median is what dispatch plans with.

Every segment can be broken down by store, area, driver, hour and day, and exported to CSV.

---

## 5. Operations

### Orders
- List: today by default. Filters: stage, store, area, driver, late only, stacked only. Each row shows the order's current segment and its time against target.
- Order page: timeline of every event with the time each segment took, map with store, customer and driver trail, customer first name and suburb only (no full address or phone unless the user's role needs it to fix a problem; reveal is logged), charges and driver pay lines, and the Keychat event history.
- Actions (sent to dispatch, audited here): reassign to another driver, take a driver off the job, cancel (with reason, before collection), close (after collection, with outcome), issue a new delivery code, fix the drop-off pin or address.

### Offer cascade (shown, not edited here)
Dispatch offers each order to the 5 closest available drivers by drive time (OSRM). The first to accept gets it. If none accept within the offer window, it goes to the next 5, and so on. The order page shows each round: who was offered, when, and who declined or let it lapse.

### Stacking
Up to 3 orders on one run when:
- pickups are within 100 m of each other,
- drop-offs are within 1 km of each other,
- and no order is delayed by more than 5 minutes compared with being delivered on its own.

Stacking rules are editable in Setup → Stacking rules (Ops lead and above), and dispatch reads them on change. The Stacked runs screen shows each run, each order's added minutes, and runs where an order went over the limit.

### Exceptions
One queue: unassigned after 2 offer rounds, ready but no driver within the wait target, driver stopped for more than 5 minutes mid-delivery, failed delivery, driver problem reports (the driver app's escape hatch), and Keychat webhooks failing. Each item has an owner and a resolve action.

### Live map
OpenStreetMap tiles with Leaflet. Drivers coloured by state (available, to store, at store, to customer, returning), open orders as pins, zone polygons as a toggle. Clicking a driver shows their current run. Customer and driver locations are on for the live map only; nothing on the map is stored.

---

## 6. Drivers

- **Marketplace opt-in.** Drivers come from the ScootHero driver marketplace. A driver opts in to FEEST in the marketplace, and the opt-in lands in Drivers → Marketplace opt-ins with their ScootHero profile, vehicle and documents already on file. Ops lead accepts or declines. Accepted drivers get FEEST onboarding.
- **Onboarding.** Steps: documents checked (ID, licence, vehicle papers, PrDP if needed), bank or wallet linked, training done, first shift. Each step has who did it and when. A driver goes active only when every step is done.
- **Active drivers.** Status, area, vehicle (ScootHero bike or own), acceptance rate, completion rate, lateness, rating, this week's earnings. Suspend or reactivate with a reason.
- **Messages.** Two-way with the driver app. Templates for common replies.

---

## 7. Pricing

- **Zones are polygons** drawn on the OpenStreetMap map, grouped by area. Every store sits in one zone; a store's zone sets the price of its deliveries.
- **Rate card per zone:** customer delivery fee, driver pay per km, driver minimum per job, stacked-order pay (the second and third orders on a run), and whether the customer fee is flat or distance-based.
- **Surge:** scheduled bonuses by zone, day and time.
- **Preview before save:** the 20 most recent orders in that zone, priced old and new.
- **Distance** comes from OSRM drive distance, never straight-line, for anything billed.

The toolkit default is a flat R35 customer delivery fee, all of it to the driver. The brief says driver pay is distance in km × a rate per area. Both fit the rate card. Which one is the default is open decision 1.

---

## 8. Payouts

- **Week:** Monday 00:00 to Sunday 23:59, South African time. Paid on Tuesday.
- **Monday 06:00:** the week locks and a payout run is prepared automatically. It has one line per driver: deliveries, tips, surge, adjustments, ScootHero bike rental deducted (for drivers on a rental), and net pay.
- **Monday:** Finance checks exceptions (negative balances, disputed jobs, missing wallet link) and fixes them through ledger adjustments.
- **Tuesday:** a second person approves. The back office sends each line to the driver's Altron wallet through `src/lib/wallet` (the same wallet as the ScootHero driver app). Each transfer records the Altron reference and status. Failed transfers go to a retry list and never pay twice (idempotency key per line).
- **Drivers see it in the app:** this week so far, last week's payout and every line behind it.
- **Reconcile:** the run is closed when every line is paid or carried to next week.

`src/lib/wallet` has the same shape as `src/lib/esign` in ScootHero: one interface, a sandbox adapter for tests and staging, and the Altron adapter when keys are issued.

---

## 9. Vendors (built) and how a vendor reaches dispatch

The Vendors module is built: areas and reps, capture with store pin and owner company, delivery model and services, sales toolkit, agreement signed on screen (start date 30 days out), pack emailed for sign-off, installation checklist, go-live.

Missing link: **go-live creates the store in dispatch.** When a vendor goes live, the back office calls dispatch to create (or update) the store: id, name, pin, zone, delivery model (FEEST network, own drivers, none), opening hours, and a starting make-time for the ready gate. The vendor page then shows the dispatch store id, today's orders and the store's segment times.

---

## 10. Non-functional

- **Security.** Login with lockout (built). Service key between the back office and dispatch, rotated like partner keys. All `/v1/ops/*` routes on dispatch require it.
- **POPIA.** No customer, driver or owner personal information in logs, error messages or analytics. Customer address and phone are revealed only on purpose, and the reveal is logged.
- **Backups.** Nightly Postgres dump, kept 14 days, copied off the server (built in `deploy/backup.sh`).
- **Look.** Same as the ScootHero back office: typography tokens, sentence case, mobile first for rep and driver-support screens. FEEST branding.
- **Environments.** Staging uses dispatch staging (`habibi-staging.quikr.co.za`) with simulated drivers, so every Operations screen can be tested with live-looking orders.

---

## 11. Open decisions

1. **Default driver pay.** Flat R35 per delivery, which is the customer's delivery fee (toolkit and Plus pilot), or km × zone rate (project brief)? Proposed: flat R35 as the default rate card, with per-km zones where distances are long.
2. **Hosting.** For now: a test server under ScootHero, `delivery-test.scoothero.co.za` on the ScootHero HostyAfrica VPS (decided 6 Oct). Still open: the final domain and whether production stays there or moves beside dispatch. Either works over the service key.
3. **The dispatch repo is behind.** `Wallisco/habibi-delivery` on GitHub has 5 commits on `main` and nothing else. The lifecycle, OSRM, auth and route-split work, and the `production-readiness` branch (Keychat v1.2, idempotency keys), are not on GitHub, and the repo is public. Before step 2: push all of it, then make the repo private.
4. **Altron wallet.** API documentation, sandbox keys and whether transfers are per driver or a bulk file.
5. **Phone orders.** Where "take time" comes from: Pilot POS, a store screen, or not measured for now.
6. **Keychat timestamps.** Ask Keychat to add `checkoutStartedAt` and `paidAt` to job create (v1.2 change).
