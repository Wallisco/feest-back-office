FEEST Back Office — instructions for Claude Code
Read this before every task. The full product spec is `docs/feest-spec.md`; the step-by-step build prompts are `docs/claude-code-playbook.md`. It follows the ScootHero Back Office (github.com/Wallisco/Scoothero_Back_Office): same stack, same rules, same method, FEEST branding.

What this is
The one FEEST back office (Habibi was the working name; there is no separate Habibi back office). One login, one Postgres database, modules: Overview, Vendors (built), Operations, Drivers, Pricing, Payouts, Metrics, Integration, Setup. One app, `server.js` at the repo root: Node 22, Express 5, Postgres, express-session with connect-pg-simple. Hosted on the ScootHero HostyAfrica VPS beside the ScootHero back office (port 3100, its own database and PM2 process), deployed from GitHub Actions over SSH (`deploy/`). The public Sales Toolkit is served at `/toolkit`.

The dispatch engine is a separate service (repo Wallisco/habibi-delivery, Fastify, habibi-api.quikr.co.za). It owns live orders, offers, driver state, the ready gate, stacking and driver pay. This back office talks to it only server-to-server through src/lib/dispatch.js with the service key, and builds its own history from the dispatch event feed.

The vendor journey (stages are derived, see src/vendors/stages.js)
1. Areas and reps: sales leads allocate reps to areas.
2. Capture (stage captured): pin at the entrance, owner company (signs, like a landlord), photos.
3. Model and services: open network, own drivers branded or unbranded, or no delivery; services incl. Pilot and social setup.
4. Sales toolkit (ready): in-store price check first (the manager's 3 best sellers, counter price vs Uber Eats and Mr D through to checkout, checkout fees, commission they pay). Measured values replace the estimates per app (finance.priceCheck, toolkitResult); the headline takes the smaller vendor gain and the smaller customer saving across the apps checked, so neither is overstated.
5. Agreement (signoff): owner and rep sign on screen; start date defaults to 30 days out; terms are snapshotted.
6. Pack: PDF emailed to the owner (SMTP) or downloaded and sent by the rep; owner's confirmation recorded (install).
7. Installation checklist, then go-live (live). Orders then flow Keychat → vendor (Pilot or WhatsApp) → dispatch.

Non-negotiables
Server-side role checks on every route (src/vendors/permissions.js). Hiding a button is not security.
Every write goes through `audit_log` (src/lib/audit.js).
Stages change only through the actions in src/vendors/routes.js, via restage(). Never set `vendors.stage` from a form.
Money comes only from src/vendors/finance.js, which the browser loads unchanged at /static/finance.js. Never recalculate fees, the toolkit comparison or the pack cost anywhere else.
The installation checklist comes only from src/vendors/checklist.js (also served to the browser).
Signed agreements are immutable: services and toolkit are locked while an agreement is active; to change terms, void (only before the owner signs off) and sign again.
Dispatch: staff never call dispatch from the browser. Every call goes through src/lib/dispatch.js with DISPATCH_SERVICE_KEY, and every action sent to dispatch is written to audit_log here first.
Reports and metrics read Postgres (order_facts, order_segments), never live dispatch queries. Segment maths lives only in src/metrics/segments.js; a missing timestamp is "Not measured", never zero.
Driver pay is calculated only by dispatch (fees.js). The back office shows it, adjusts it through ledger entries with a reason, and never recalculates it.
Payouts: the person who prepares a payout run can't approve it. Wallet transfers go only through src/lib/wallet, each with an idempotency key, so a retry never pays twice.
Pricing changes (zones, rate cards, surge, stacking rules) are saved only by ops_lead, ceo or admin, after a preview, and keep history.
Customer address and phone stay hidden until a user reveals them for a reason; the reveal is logged. Driver positions are never stored here.
Typography comes only from src/styles/typography.css tokens. No hard-coded px font sizes.
Files go through src/lib/storage (STORAGE_DIR, outside the web root) and are streamed by the role-checked /files route.
Personal information (POPIA): no owner, customer or staff data in logs or error messages.
Mobile first for rep screens: 16px inputs and 44px tap targets on touch screens (already in the tokens).

Conventions
Migrations: numbered SQL files in db/migrations/, forward-only, each wrapped in a transaction. Never edit a migration that has run in production; add a new one.
Tests: `npm test` (node --test). Unit tests always run; test/api.test.js runs the whole vendor journey when TEST_DATABASE_URL is set (CI sets it; it wipes that database). Every new calculation, stage transition and permission rule gets a test.
Money in rand, stored as numeric or in JSON snapshots; dates in South African format on screen (16 Sep 2026), ISO in the database.
Plain language in the UI: sentence case, no jargon, error messages say what to do next.
Secrets only from environment variables. Never commit .env.

Workflow for each task
Read the relevant code first. Propose a short plan and wait for approval before large changes. Build on a branch, small commits, tests passing. Finish with what changed, how to test it, anything left open.
