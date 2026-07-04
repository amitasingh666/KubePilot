-- Remove Row-Level Security. Tenant isolation is now enforced at the
-- application layer (every query filters by tenant_id). RLS is deferred as a
-- production-hardening step (see docs/07-Database-Schema.md §14).
--
-- We KEEP the `kubepilot_app` role + its grants (still the runtime connection,
-- for least privilege) and the `app_current_tenant()` function (harmless).

DROP POLICY IF EXISTS tenant_isolation ON "tenant";
DROP POLICY IF EXISTS tenant_isolation ON "membership";
DROP POLICY IF EXISTS tenant_isolation ON "cluster";

ALTER TABLE "tenant" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "membership" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "cluster" DISABLE ROW LEVEL SECURITY;
