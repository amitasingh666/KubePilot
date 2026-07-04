-- Daily rollup of workload usage, auto-maintained by TimescaleDB.
-- Preserves MAX for memory (never averages) so the OOM-safety rule stays honest.
CREATE MATERIALIZED VIEW usage_workload_daily
WITH (timescaledb.continuous) AS
SELECT
  tenant_id,
  cluster_id,
  workload_id,
  time_bucket('1 day', ts) AS day,
  max(cpu_p95_m)     AS cpu_p95_max_m,
  max(mem_max_bytes) AS mem_max_bytes,
  sum(restarts)      AS restarts
FROM usage_metric_workload
GROUP BY tenant_id, cluster_id, workload_id, time_bucket('1 day', ts)
WITH NO DATA;

-- Background job: keep the last 30 days refreshed, hourly, leaving the newest
-- hour to settle (data may still be arriving for it).
SELECT add_continuous_aggregate_policy('usage_workload_daily',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');