#!/usr/bin/env bash
# TEST HARNESS ONLY: local PostgreSQL 15 + PostgREST emulating Supabase (no real data, no secrets).
# Usage: bash scripts/local-test-db.sh   -> recreates DB 'bimbingta_test' and starts PostgREST on $PGRST_PORT
set -euo pipefail
cd "$(dirname "$0")/.."
DB=${TEST_DB:-bimbingta_test}
PGRST_PORT=${PGRST_PORT:-54321}
JWT_SECRET=${LOCAL_JWT_SECRET:-local-test-secret-not-for-production-000000}
PGRST_BIN=${PGRST_BIN:-/root/tools/postgrest}

if ! command -v pg_ctlcluster >/dev/null; then
  echo "Installing postgresql-15 (test harness)"; DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql-15 >/dev/null
fi
if [ ! -x "$PGRST_BIN" ]; then
  mkdir -p "$(dirname "$PGRST_BIN")"
  arch=$(uname -m); asset=postgrest-v12.2.3-linux-static-x64.tar.xz; [ "$arch" = aarch64 ] && asset=postgrest-v12.2.3-ubuntu-aarch64.tar.xz
  curl -sL "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/$asset" | tar xJ -C "$(dirname "$PGRST_BIN")"
fi
pg_ctlcluster 15 main start 2>/dev/null || true
pkill -f "postgrest.*bimbingta" 2>/dev/null || true

PSQL="su postgres -c"
$PSQL "psql -q -c 'drop database if exists $DB with (force)' -c 'create database $DB'"
run() { su postgres -c "psql -q -v ON_ERROR_STOP=1 -d $DB -f $1" ; }
run supabase/tests/local/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do echo "apply $f"; run "$f"; done
node scripts/seed-rubric.mjs > /tmp/bt_seed.sql && run /tmp/bt_seed.sql

cat > /tmp/bimbingta-postgrest.conf <<EOF
db-uri = "postgres://authenticator:authenticator_local_only@127.0.0.1:5432/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$JWT_SECRET"
server-port = $PGRST_PORT
server-host = "127.0.0.1"
EOF
su postgres -c "psql -q -c \"alter role authenticator password 'authenticator_local_only'\" -c \"alter role postgres password 'postgres_local_only'\""
nohup "$PGRST_BIN" /tmp/bimbingta-postgrest.conf > /tmp/bimbingta-postgrest.log 2>&1 &
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PGRST_PORT/app_config" || true)
  [ "$code" != "000" ] && [ "$code" != "503" ] && break; sleep 0.5
done
echo "local test stack ready: db=$DB rest=http://127.0.0.1:$PGRST_PORT"
