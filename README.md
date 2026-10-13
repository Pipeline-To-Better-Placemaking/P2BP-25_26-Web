# Better Placemaking - Web

Admin/operator dashboard for the senior design project **Pipeline to Better Placemaking**: manage
field devices (cameras + lidar), run calibration, fuse multi-sensor tracks and view results in 3D.

## Structure

| Path | What it is |
|---|---|
| `BetterPlacemaking.CLIENT.REACT` | React + Vite frontend |
| `BetterPlacemaking.SERVER.EXPRESS` | Express + TypeScript API (Drizzle ORM, Postgres, Supabase Storage) |
| `api/index.ts` | Vercel serverless entry that mounts the Express app |
| `supabase/migrations` | SQL migrations generated from `src/db/schema` |
| `workstation/` | Python workstation skeleton (not wired in yet) |

## Local development

Needs Node 20+ and a dev Postgres (a Supabase project works).

```bash
cd BetterPlacemaking.SERVER.EXPRESS
npm ci && cp .env.example .env   # fill DATABASE_URL, DATABASE_DIRECT_URL, SUPABASE_*, JWT_*
npm run db:migrate               # apply migrations (DATABASE_DIRECT_URL)
npm run db:seed-roles            # seed system roles
npm run dev                      # API on http://localhost:5200
npm run db:seed-demo             # optional: demo@example.com / DemoPass123!
cd ../BetterPlacemaking.CLIENT.REACT && npm ci && npm run dev   # http://localhost:5173
```

`tools/dev-stack.sh` starts everything together. Tests (in-memory PGlite, no database needed):
`npx tsc -p tsconfig.json --noEmit && npm test` in the API folder.

## Deploy

One Vercel project serves the React build and the API on one domain, backed by Supabase
(Postgres + Storage). See [docs/DEPLOY.md](docs/DEPLOY.md).
