# infra/

Infrastructure as code for the hosted KubePilot SaaS.

- **Local development** uses `docker-compose.yml` at the repo root
  (Postgres+TimescaleDB, two Redis instances, MinIO). Run `pnpm infra:up`.
- **Cloud provisioning** (managed Postgres/Timescale, Redis, object storage,
  Kubernetes, DNS) via **Terraform/Pulumi** is intentionally **deferred** to a
  later phase; this directory will hold those modules.
