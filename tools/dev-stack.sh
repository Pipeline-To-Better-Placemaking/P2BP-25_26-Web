#!/usr/bin/env bash
# Starts (or restarts) the whole local dev stack, then seeds the demo data.
#
#   tools/dev-stack.sh          start anything that isn't already running, then seed
#   tools/dev-stack.sh stop     stop everything this script started
#
#   Database            DATABASE_URL in BetterPlacemaking.SERVER.EXPRESS/.env (a dev Supabase
#                       project; run `npm run db:migrate && npm run db:seed-roles` there first)
#   Express API (React) :5200                   used by the React client
#   Express API (Ng)    :5123                   same backend, on the port the ORIGINAL Angular client expects
#   React client        :5173
#   Original Angular    :4200                   visual reference only; needs `npm install` in BetterPlacemaking.CLIENT
#
# Logs: tools/visual-compare/out/logs/*.log        Demo login: demo@example.com / DemoPass123!
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$ROOT/tools/visual-compare/out/logs"
mkdir -p "$LOGS"

up() { curl -s -o /dev/null -m 2 "$1"; }

if [ "${1:-}" = "stop" ]; then
  for p in 5200 5123 4200 5173; do
    pids=$(lsof -ti :"$p" -sTCP:LISTEN 2>/dev/null); [ -n "$pids" ] && kill $pids 2>/dev/null
  done
  echo "stopped"; exit 0
fi

start() { # name, url-to-probe, dir, env-prefix..., command...
  local name="$1" url="$2" dir="$3"; shift 3
  if up "$url"; then echo "[$name] already up"; return; fi
  echo "[$name] starting"
  ( cd "$dir" && nohup env "$@" > "$LOGS/$name.log" 2>&1 & )
}

if [ ! -f "$ROOT/BetterPlacemaking.SERVER.EXPRESS/.env" ] && [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set and BetterPlacemaking.SERVER.EXPRESS/.env is missing - see docs/DEPLOY.md" >&2
  exit 1
fi

start api-5200 http://localhost:5200/health "$ROOT/BetterPlacemaking.SERVER.EXPRESS" npx tsx src/server.ts
start api-5123 http://localhost:5123/health "$ROOT/BetterPlacemaking.SERVER.EXPRESS" \
  PORT=5123 ALLOWED_ORIGINS=http://localhost:4200,http://127.0.0.1:4200 API_BASE_URL=http://localhost:5123 APP_BASE_URL=http://localhost:4200 npx tsx src/server.ts
start react-5173 http://localhost:5173 "$ROOT/BetterPlacemaking.CLIENT.REACT" npm run dev
if [ -d "$ROOT/BetterPlacemaking.CLIENT/node_modules" ]; then
  start angular-4200 http://localhost:4200 "$ROOT/BetterPlacemaking.CLIENT" npx ng serve --port 4200 --host localhost
else
  echo "[angular-4200] skipped (run npm install in BetterPlacemaking.CLIENT to enable the visual reference)"
fi

for u in http://localhost:5200/health http://localhost:5123/health http://localhost:5173; do until up "$u"; do sleep 2; done; done
[ -d "$ROOT/BetterPlacemaking.CLIENT/node_modules" ] && until up http://localhost:4200; do sleep 3; done

( cd "$ROOT/BetterPlacemaking.SERVER.EXPRESS" && npm run db:seed-demo )
echo "stack ready"
