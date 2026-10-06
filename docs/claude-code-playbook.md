# Claude Code playbook — FEEST Back Office

Same method as the ScootHero Back Office. One Claude Code session per step. Start each in plan mode (Shift+Tab twice), read the plan, then let it build. Don't start the next step until the previous one works on staging. Paste the quoted prompt as it is.

Two repos are involved:
- **This repo** (`Wallisco/feest-back-office`): the back office. Most steps run here.
- **The dispatch repo** (`Wallisco/habibi-delivery`): the engine. Steps 2 and 8 run there and say so.

The spec is `docs/feest-spec.md`. The rules are `CLAUDE.md`.

---

## Step 0 — One back office: module switcher and roles
> Read CLAUDE.md, docs/feest-spec.md (sections 1–3) and README.md. The Vendors module is built and tested. Turn this into the one FEEST back office:
> 1. Add the module switcher and left menus from spec section 3. Vendors keeps its current screens. The other modules (Overview, Operations, Drivers, Pricing, Payouts, Metrics, Integration) get their menus with an empty "coming next" page each.
> 2. Add the roles from spec section 2 (dispatcher, ops_lead, driver_support) in a new migration, with permission helpers in src/lib/permissions.js and a test for each rule, including "the person who prepares a payout can't approve it".
> 3. A user only sees the modules their role allows; the server refuses the rest.
> 4. Keep `npm test` green.
> Show me the plan first.

**Check:** locally, a dispatcher sees Overview, Operations and Drivers; a sales rep sees only Vendors.

## Step 1 — Server and pipeline (you do the server part)
The back office goes on the ScootHero HostyAfrica VPS beside the ScootHero back office (spec open decision 2).

On the server, as root:
```bash
git clone https://github.com/Wallisco/feest-back-office /tmp/feest && cd /tmp/feest
DOMAIN=backoffice.feest.co.za EMAIL=wahlied@quikr.co.za bash deploy/add-to-server.sh
```
It creates the `feest_backoffice` database, `.env`, the PM2 process on port 3100, the Nginx site with SSL, and nightly backups, and prints a deploy key.
1. Add the printed key to the GitHub repo → Settings → Deploy keys (read-only).
2. GitHub → Settings → Secrets: `SSH_HOST`, `SSH_USER` = deploy, `SSH_KEY`.
3. Point `backoffice.feest.co.za` at the server's IP.
4. Push to `main`.

Then in Claude Code:
> Check the last GitHub Actions run and fix anything that failed. Then, over SSH on the server, create my CEO login with scripts/create-user.js.

**Check:** https://backoffice.feest.co.za shows the login page and `/healthz` reports the migrations.

## Step 2 — Dispatch: get the repo current and close the ops routes (dispatch repo)
Run this one in `Wallisco/habibi-delivery`.
> Read dispatch-service/ARCHITECTURE.md and the FEEST back-office spec section 1 (I'll paste it). First, make sure this repo has everything the server runs: compare /opt/dispatch on the server with main over SSH and list the differences before changing anything. Then:
> 1. Require a service key (`BACKOFFICE_SERVICE_KEY`, hashed, rotatable like partner keys) on every /v1/ops/* route. Fail closed. Keep the OPS_TOKEN only for ops.html until step 10.
> 2. Add `GET /v1/ops/events?after=<cursor>&limit=500`: every order and driver event in order, with a cursor that survives restarts.
> 3. Add the missing timestamps from spec section 4: assignedAt, atStoreAt and atCustomerAt (75 m geofence), backAtStoreAt, nextAcceptedAt, and accept checkoutStartedAt and paidAt from Keychat.
> 4. Add `PUT /v1/ops/stores/:id` (create or update a store from the back office) and `PUT /v1/ops/zones/:id` (polygon and rate card).
> 5. Tests for each, then deploy to staging.
> Show me the plan first.

**Check:** on staging, `/v1/ops/orders` without the key returns 401, and the events feed shows a simulated delivery end to end.

Then make the repo private (GitHub → Settings → Danger zone).

## Step 3 — Dispatch client and Operations: Orders
> Build src/lib/dispatch.js (service-key client with timeouts, 2-second cache for reads, typed errors) with tests against a mock dispatch. Then build spec section 5 Orders: the list with filters and the order page (timeline with segment times against target, map, charges and driver pay, offer rounds, Keychat events). Then the actions: reassign, take driver off, cancel, close, issue code, fix address. Each action is role-checked, sent to dispatch and written to audit_log. Customer address and phone are hidden until revealed, and the reveal is logged.

**Check:** on staging, cancel a simulated order and see it in dispatch and in the audit log.

## Step 4 — Live map and Exceptions
> Build the Live map (Leaflet, OpenStreetMap tiles, drivers by state, open orders, zone toggle, click a driver to see their run) and the Exceptions queue from spec section 5, with an owner and a resolve action on each item. Poll every 5 seconds.

**Go live with Operations here. Dispatchers stop using ops.html for orders.**

## Step 5 — Drivers
> Build spec section 6: Marketplace opt-ins (accept or decline), Onboarding steps with who and when, Active drivers with suspend and reactivate (reason shown in the app), and Messages with templates. Driver records stay in dispatch; read and write them through src/lib/dispatch.js.

**Check:** take a test driver from opt-in to active on staging and see them come online in the driver app.

## Step 6 — Pricing
> Build spec section 7: zones as polygons drawn on the map (Leaflet.draw), rate cards per zone, surge schedule, and the old-vs-new preview on the last 20 orders before saving. Only ops_lead, CEO and admin can save. Keep history. Send changes to dispatch with PUT /v1/ops/zones/:id.

## Step 7 — Event feed, order facts and Metrics
> Build the event consumer: a single worker (PM2, one instance) that polls /v1/ops/events, writes order_facts and order_segments (partitioned by month) and stores its cursor. Then Setup → Segment targets and the Metrics screens from spec section 4: the ten segments and four rolled-up intervals against target, by store, area, driver, hour and day, with "Not measured" counts and CSV export. Test the segment maths with fixtures, including missing timestamps.

**Check:** a day of staging orders shows every segment with a measured count.

## Step 8 — Vendor go-live creates the store (both repos)
> When a vendor goes live, call PUT /v1/ops/stores/:id with the pin, zone, delivery model, opening hours and a starting make-time. Show the dispatch store id, today's orders and the store's segment times on the vendor page. Feed each store's measured make-plus-packaging median back to dispatch nightly for the ready gate.

## Step 9 — Payouts and the Altron wallet
> Build spec section 8: the weekly lock (Monday 06:00 SAST), the payout run with one line per driver (deliveries, tips, surge, adjustments, rental deducted), the exceptions check, two-person approval, and src/lib/wallet with a sandbox adapter. Every transfer has an idempotency key and records the wallet reference. Failed lines go to a retry list. Drivers see their week and payout in the app. Use the sandbox until Altron keys are issued.

**Go live with Payouts here, on the first Tuesday after Altron sandbox sign-off.**

## Step 10 — Overview, Integration, retire ops.html
> Build the Overview (today: orders, live drivers, on-time %, the four intervals against target, alerts) and the Integration module (Keychat events, retries, failures, partner keys). Then confirm every ops.html feature has a home here, list anything missing, and once I agree, remove ops.html and the OPS_TOKEN from dispatch.

**Done: one FEEST back office.**
