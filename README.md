# FEEST Back Office

The back office for FEEST vendors, built on the ScootHero Back Office structure and look, with FEEST branding.

**Areas and reps → capture a vendor → model and services → sales toolkit → agreement signed on screen → pack emailed for sign-off → installation → live.**

Vendors are anyone who needs their menu or catalogue in front of their customers: restaurants, takeaways, grocers, hardware stores, pharmacies, butcheries, couriers. Categories are editable in Setup.

The public **Sales Toolkit** (compare, brand kit, sign-up, driver earnings) is served without login at `/toolkit`.

## What's here

| Path | What it does |
|---|---|
| `server.js` | Express app: login, sessions in Postgres, role-checked API, files, public `/toolkit`, `/healthz` |
| `db/migrations/001_vendors_core.sql` | Users and roles, areas and reps, owners, vendors, agreements, wording versions, settings, email and audit logs |
| `src/vendors/finance.js` | All the money: toolkit comparison, installation pack at cost, start date. Shared with the browser |
| `src/vendors/checklist.js` | Installation checklist and go-live check. Shared with the browser |
| `src/vendors/stages.js` | Stage from facts: captured → ready → signoff → install → live (or notnow) |
| `src/vendors/permissions.js` | Who can do what |
| `src/vendors/routes.js` | The API |
| `src/vendors/pack-pdf.js` | The agreement and setup pack PDF (PDFKit) |
| `src/lib/` | Database, audit log, login (scrypt, lockout), SMTP mail, file storage (from ScootHero) |
| `public/` | The single-page back office, login page and the Sales Toolkit |
| `deploy/` | `add-to-server.sh` (one-time, on the ScootHero VPS), `deploy.sh`, `nginx.conf`, `backup.sh` |
| `.github/workflows/deploy.yml` | Tests every push against Postgres; deploys `main` |

## Roles

| Role | Can do |
|---|---|
| Sales rep | Capture vendors; work vendors they own or in their areas: services, toolkit, sign, send pack, sign-off, installation |
| Sales lead | Everything a rep can, on every vendor; manage areas and reps |
| Onboarding, Installation | Installation checklist, print quantities and go-live on any vendor |
| Finance | View everything |
| CEO, Admin | Everything, plus team, fees, print price list, categories and agreement wording |

## Run it locally

```bash
npm install
cp .env.example .env            # set DATABASE_URL and SESSION_SECRET
set -a; . ./.env; set +a
npm run migrate
node scripts/create-user.js --name "Your Name" --email you@example.com --role ceo
npm start                       # http://127.0.0.1:3100
```

Tests: `npm test`. To include the full API journey: `TEST_DATABASE_URL=postgres://… npm test` (wipes that database).

## Deploy to the ScootHero HostyAfrica VPS

The server already runs the ScootHero back office. This app sits beside it on port 3100 with its own database (`feest_backoffice`), PM2 process (`feest-backoffice`) and Nginx site.

1. Point the DNS A record for the back-office domain (for example `backoffice.feest.co.za`) at the server.
2. On the server, as root, from a checkout of this repo:
   `DOMAIN=backoffice.feest.co.za EMAIL=you@example.com bash deploy/add-to-server.sh`
3. Add the deploy key it prints to this repo (Settings → Deploy keys, read-only).
4. Add GitHub Actions secrets `SSH_HOST`, `SSH_USER` (`deploy`), `SSH_KEY`.
5. Push to `main`. Then create the first login with `scripts/create-user.js` (the setup script prints the command).

To email packs straight from the app, add `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` to `/var/www/feest-backoffice/shared/.env` and redeploy. Without them, reps download the PDF and send it from their own mailbox.

## Placeholders to confirm

Print unit costs (Setup → Print price list) and the agreement wording (draft for legal review, Setup → Agreement wording). Signed agreements keep the terms they were signed on.
