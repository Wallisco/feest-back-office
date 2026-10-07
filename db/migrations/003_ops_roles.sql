-- FEEST Back Office · roles for delivery operations (docs/feest-spec.md section 2)
-- Dispatcher, ops lead and driver support. Which modules each role sees: src/lib/permissions.js.
-- Postgres 12+ allows ADD VALUE inside a transaction; the new values are only used after COMMIT.

BEGIN;

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'dispatcher';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'ops_lead';
ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'driver_support';

COMMIT;
