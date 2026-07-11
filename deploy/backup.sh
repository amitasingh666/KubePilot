#!/usr/bin/env bash
# Nightly Postgres backup for the single-VM prototype. Run from the repo root.
# Optional off-box copy: set BACKUP_S3_BUCKET (needs awscli + credentials).
set -euo pipefail

COMPOSE="docker compose -f deploy/docker-compose.prod.yml"
OUT="${BACKUP_DIR:-/var/backups/kubepilot}"
STAMP="$(date +%F-%H%M)"
FILE="$OUT/kubepilot-$STAMP.sql.gz"

mkdir -p "$OUT"
echo "→ dumping to $FILE"
$COMPOSE exec -T postgres pg_dump -U postgres -d kubepilot | gzip > "$FILE"

# Retain 14 days locally.
find "$OUT" -name 'kubepilot-*.sql.gz' -mtime +14 -delete

# Ship off-box (strongly recommended — the VM is a single point of failure).
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  echo "→ uploading to s3://$BACKUP_S3_BUCKET/backups/"
  aws s3 cp "$FILE" "s3://$BACKUP_S3_BUCKET/backups/"
fi
echo "✓ backup complete"
