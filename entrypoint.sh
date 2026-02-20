#!/bin/sh
set -e
cd /app

bun run 

echo "[entrypoint] Running migrations..."
bun run src/scripts/migrate.ts

echo "[entrypoint] Seeding database..."
bun run src/scripts/seed.ts

echo "[entrypoint] Starting app..."
exec "$@"
