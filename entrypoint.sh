#!/bin/sh
set -e
cd /app

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] Running migrations..."
  bun run src/scripts/migrate.ts
else
  echo "[entrypoint] Skipping migrations (RUN_MIGRATIONS=false)"
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] Seeding database..."
  bun run src/scripts/seed.ts
else
  echo "[entrypoint] Skipping seed (RUN_SEED=false)"
fi

echo "[entrypoint] Starting app..."
exec "$@"
