-- FEEST Back Office · Vendors module · core schema
-- Postgres 14+. Applied by scripts/migrate.js.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;   -- case-insensitive emails (trusted extension since Postgres 13)

-- ---------- Enums ----------
CREATE TYPE app_role AS ENUM (
  'sales_rep', 'sales_lead', 'onboarding', 'installation', 'finance', 'ceo', 'admin'
);

-- Vendor funnel. Computed from what has happened (src/vendors/stages.js) and stored
-- for fast lists. Changed only by the actions in src/vendors/routes.js.
CREATE TYPE vendor_stage AS ENUM ('captured', 'ready', 'signoff', 'install', 'live', 'notnow');

CREATE TYPE delivery_model AS ENUM ('open', 'own_branded', 'own_plain', 'pickup_only');

-- ---------- People ----------
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           citext,
  mobile          text,
  role            app_role NOT NULL DEFAULT 'sales_rep',
  password_hash   text,
  active          boolean NOT NULL DEFAULT true,
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  last_login_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (email) WHERE email IS NOT NULL;

-- ---------- Step 1: areas and the reps allocated to them ----------
CREATE TABLE areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  city        text NOT NULL DEFAULT '',
  target      int,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, city)
);
CREATE TABLE area_reps (
  area_id  uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (area_id, user_id)
);

-- ---------- Owners (the company that owns the store; like the landlord on a site) ----------
CREATE TABLE owners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  reg_no        text NOT NULL DEFAULT '',
  contact_name  text NOT NULL DEFAULT '',
  title         text NOT NULL DEFAULT '',
  email         citext,
  mobile        text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Vendors ----------
CREATE TABLE vendors (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  category           text NOT NULL,
  area_id            uuid NOT NULL REFERENCES areas(id),
  rep_id             uuid NOT NULL REFERENCES users(id),
  owner_id           uuid NOT NULL REFERENCES owners(id),
  stage              vendor_stage NOT NULL DEFAULT 'captured',

  address            text NOT NULL DEFAULT '',
  lat                numeric(9,6) NOT NULL,
  lng                numeric(9,6) NOT NULL,
  pin_accuracy_m     numeric,
  pin_source         text NOT NULL DEFAULT 'gps',      -- gps | manual
  pin_captured_at    timestamptz NOT NULL DEFAULT now(),
  store_phone        text NOT NULL DEFAULT '',
  whatsapp           text NOT NULL DEFAULT '',
  hours              text NOT NULL DEFAULT '',
  notes              text NOT NULL DEFAULT '',
  photos             jsonb NOT NULL DEFAULT '{}',       -- {storefront, logo, counter}: storage keys
  first_touch_at     timestamptz NOT NULL DEFAULT now(),

  -- Step: model and services
  model              delivery_model,
  services           jsonb NOT NULL DEFAULT '{}',       -- {whatsapp, delivery, pickup, tableQr, ...}: booleans
  own_drivers        int NOT NULL DEFAULT 0,
  vehicles           int NOT NULL DEFAULT 0,
  tables             int NOT NULL DEFAULT 0,

  -- Step: sales toolkit (their numbers; maths in src/vendors/finance.js)
  toolkit            jsonb,
  toolkit_completed_at timestamptz,

  -- Installation pack quantities the rep changed from the defaults
  print_qty          jsonb NOT NULL DEFAULT '{}',

  -- Step: pack and sign-off
  pack_emailed_at    timestamptz,
  pack_emailed_to    text,
  pack_emailed_by    uuid REFERENCES users(id),
  pack_email_method  text,                              -- sent | manual
  signed_off_on      date,
  signed_off_by      text,
  signoff_method     text,
  signoff_note       text NOT NULL DEFAULT '',

  -- Step: installation
  install            jsonb NOT NULL DEFAULT '{}',       -- checklist dates and fields (keychatStoreId, wabaNumber, ...)
  live_at            timestamptz,

  -- Closed as Not now
  closed_at          timestamptz,
  closed_reason      text,
  closed_note        text NOT NULL DEFAULT '',

  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
);
CREATE INDEX vendors_stage_idx ON vendors (stage);
CREATE INDEX vendors_area_idx ON vendors (area_id);
CREATE INDEX vendors_rep_idx ON vendors (rep_id);

-- ---------- Agreements (signed on screen; one active per vendor) ----------
CREATE TABLE agreements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid NOT NULL REFERENCES vendors(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void')),
  terms            jsonb NOT NULL,          -- snapshot: services, fee tier, who pays, pack at cost, toolkit estimate
  start_date       date NOT NULL,
  owner_name       text NOT NULL,
  owner_title      text NOT NULL DEFAULT '',
  owner_sig_key    text NOT NULL,           -- storage key of the PNG signature
  rep_user_id      uuid NOT NULL REFERENCES users(id),
  rep_name         text NOT NULL,
  rep_sig_key      text NOT NULL,
  wording_version  int NOT NULL,
  signed_at        timestamptz NOT NULL DEFAULT now(),
  signed_ip        inet,
  voided_at        timestamptz,
  voided_by        uuid REFERENCES users(id),
  void_reason      text
);
CREATE UNIQUE INDEX agreements_one_active ON agreements (vendor_id) WHERE status = 'active';

CREATE TABLE agreement_wordings (
  version     int PRIMARY KEY,
  text        text NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Setup lists ----------
CREATE TABLE categories (
  name  text PRIMARY KEY,
  sort  int NOT NULL DEFAULT 100
);

-- pricing, print: JSON settings edited in Setup. Defaults live in src/vendors/finance.js.
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- Logs ----------
CREATE TABLE email_log (
  id           bigserial PRIMARY KEY,
  template     text NOT NULL,
  to_address   text NOT NULL,
  cc           text,
  subject      text NOT NULL,
  related_type text,
  related_id   uuid,
  provider_id  text,
  status       text NOT NULL,
  error        text,
  sent_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id),
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  before     jsonb,
  after      jsonb,
  ip         inet,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx ON audit_log (entity, entity_id, at DESC);

-- ---------- Seed: categories and the first agreement wording ----------
INSERT INTO categories (name, sort) VALUES
  ('Restaurant', 10), ('Takeaway', 20), ('Grocery store', 30), ('Hardware', 40), ('Pharmacy', 50),
  ('Butchery', 60), ('Bakery', 70), ('Convenience store', 80), ('Courier', 90), ('Other', 999);

INSERT INTO agreement_wordings (version, text) VALUES (1,
'FEEST VENDOR AGREEMENT (v1, draft for legal review)

1. FEEST gives the Vendor a WhatsApp ordering channel, run through Keychat, with the services selected in this agreement.
2. Customers pay the Vendor''s in-store menu prices. FEEST charges the service fee shown in this agreement, on menu price, paid by the party shown. Delivery fees are charged to the customer.
3. The Vendor owns its customer list. Customers opt in on WhatsApp in line with POPIA. FEEST will not sell the list or use it for any other vendor.
4. The installation pack (labels, stickers, flyers and any branded boxes or vehicle panels) is printed at cost to the Vendor, as listed, excluding VAT.
5. If selected, FEEST sets up the Vendor''s social media accounts for the once-off fee shown. The accounts belong to the Vendor.
6. The agreement starts on the start date shown and continues month to month. Either party may end it with 30 days'' written notice.
7. This agreement takes effect once the Vendor confirms the emailed agreement pack.');

COMMIT;
