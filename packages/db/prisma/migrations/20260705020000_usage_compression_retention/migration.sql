ALTER TABLE usage_metric_workload SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, workload_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
ALTER TABLE usage_metric_node SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'tenant_id, node_id',
  timescaledb.compress_orderby   = 'ts DESC'
);
SELECT add_compression_policy('usage_metric_workload', INTERVAL '7 days');
SELECT add_compression_policy('usage_metric_node',     INTERVAL '7 days');
SELECT add_retention_policy('usage_metric_workload', INTERVAL '90 days');
SELECT add_retention_policy('usage_metric_node',     INTERVAL '90 days');