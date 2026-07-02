-- Extensions, the runtime application role, and Row-Level Security policies.
-- This is the tenant-isolation boundary required by the architecture.

-- Extensions ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Application role -----------------------------------------------------------
-- Non-superuser + NOBYPASSRLS so RLS is actually ENFORCED at runtime.
-- Migrations/seed run as the superuser (which bypasses RLS by design).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kubepilot_app') THEN
    CREATE ROLE kubepilot_app LOGIN PASSWORD 'app_password' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO kubepilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kubepilot_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kubepilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kubepilot_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO kubepilot_app;

-- Current-tenant helper: reads the per-transaction session var.
-- `missing_ok => true` + NULLIF means an UNSET tenant yields NULL → deny-all
-- (a missing SET LOCAL can never accidentally expose another tenant's rows).
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- RLS: tenant (a tenant row is visible only to itself) ----------------------
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant"
  USING ("id" = app_current_tenant())
  WITH CHECK ("id" = app_current_tenant());

-- RLS: membership -----------------------------------------------------------
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "membership"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());

-- RLS: cluster --------------------------------------------------------------
ALTER TABLE "cluster" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cluster" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "cluster"
  USING ("tenant_id" = app_current_tenant())
  WITH CHECK ("tenant_id" = app_current_tenant());

-- NOTE: app_user is a GLOBAL identity table (a person can belong to several
-- tenants) so it has no tenant_id and no RLS policy. Access to it is mediated
-- through membership joins in the application layer.
