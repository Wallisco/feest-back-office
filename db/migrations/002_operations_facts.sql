-- FEEST Back Office · operations facts for the Overview dashboard
-- Orders, offers and drivers copied from dispatch (event feed, playbook step 7).
-- Until dispatch is connected, scripts/demo-orders.js can load clearly flagged demo rows on a test server.

BEGIN;

-- Regions group areas on the dashboard (e.g. Western Cape, Gauteng).
ALTER TABLE areas ADD COLUMN region text NOT NULL DEFAULT '';
ALTER TABLE areas ADD COLUMN demo boolean NOT NULL DEFAULT false;
ALTER TABLE vendors ADD COLUMN demo boolean NOT NULL DEFAULT false;

-- Drivers as dispatch knows them. No names or numbers here (POPIA): dispatch holds those.
CREATE TABLE drivers (
  id          text PRIMARY KEY,                  -- dispatch driver id
  area_id     uuid REFERENCES areas(id),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('onboarding', 'active', 'suspended', 'left')),
  vehicle     text NOT NULL DEFAULT '',          -- scoothero_bike | own_bike | car
  joined_on   date,
  demo        boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per order. Timestamps follow the ten segments in docs/feest-spec.md section 4;
-- a missing timestamp means "not measured", never zero.
CREATE TABLE order_facts (
  id               text PRIMARY KEY,             -- dispatch job id
  vendor_id        uuid REFERENCES vendors(id),
  area_id          uuid REFERENCES areas(id),
  channel          text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'phone', 'web', 'table')),
  status           text NOT NULL CHECK (status IN ('open', 'delivered', 'cancelled', 'failed', 'unassigned')),
  lost_reason      text,                         -- why an order was not delivered
  order_value      numeric(10,2) NOT NULL DEFAULT 0,   -- food at menu prices (GMV)
  feest_fee        numeric(10,2) NOT NULL DEFAULT 0,   -- FEEST service fee (the take)
  delivery_fee     numeric(10,2) NOT NULL DEFAULT 0,   -- paid by the customer, all to the rider
  processing_cost  numeric(10,2) NOT NULL DEFAULT 0,   -- card fees FEEST pays
  driver_id        text,
  stacked          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL,
  paid_at          timestamptz,
  ready_at         timestamptz,
  assigned_at      timestamptz,
  at_store_at      timestamptz,
  collected_at     timestamptz,
  delivered_at     timestamptz,
  promised_at      timestamptz,
  demo             boolean NOT NULL DEFAULT false
);
CREATE INDEX order_facts_created ON order_facts (created_at);
CREATE INDEX order_facts_area_created ON order_facts (area_id, created_at);
CREATE INDEX order_facts_vendor_created ON order_facts (vendor_id, created_at);

-- Every offer a driver saw, for the job acceptance rate (JAR). When one of the 5 drivers accepts,
-- the others' offers are withdrawn: those count neither for nor against JAR.
CREATE TABLE driver_offers (
  id          bigserial PRIMARY KEY,
  order_id    text NOT NULL,
  driver_id   text NOT NULL,
  area_id     uuid REFERENCES areas(id),
  offered_at  timestamptz NOT NULL,
  response    text NOT NULL CHECK (response IN ('accepted', 'declined', 'expired', 'withdrawn')),
  demo        boolean NOT NULL DEFAULT false
);
CREATE INDEX driver_offers_offered ON driver_offers (offered_at);

COMMIT;
