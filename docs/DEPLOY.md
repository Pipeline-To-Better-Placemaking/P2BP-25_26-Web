# Deploying to Vercel + Supabase

One Vercel project serves the React build (static) and the Express API (`api/index.ts`, one
serverless function) on the same domain, so the `bp_refresh` cookie is first-party.
`/api/*` and `/health` go to the function; everything else falls back to `index.html`.

## 1. Supabase

1. supabase.com > New project. Save the database password.
2. Project Settings > API: copy **Project URL** (`SUPABASE_URL`) and the **service_role** key
   (`SUPABASE_SERVICE_ROLE_KEY`, secret, server only).
3. Project Settings > Database > Connection string (click **Connect**):
   - **Transaction pooler** (port 6543, host `*.pooler.supabase.com`) = `DATABASE_URL`. Use this
     on Vercel; serverless functions open many short connections and need the pooler.
   - **Direct** (port 5432, `db.<ref>.supabase.co`) or Session pooler = `DATABASE_DIRECT_URL`.
     Only for running migrations from your machine.
   Replace `[YOUR-PASSWORD]` in both (URL-encode special characters).
4. Storage > New bucket, name it `media` (= `SUPABASE_STORAGE_BUCKET`), keep it **private**.
5. Apply migrations (from your machine, once and after each schema change):
   - Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push`
     (reads `supabase/migrations/`), or
   - paste each file in `supabase/migrations/*.sql` (in order) into SQL Editor > Run.

## 2. Vercel

1. vercel.com > Add New > Project > import `Pipeline-To-Better-Placemaking/P2BP-25_26-Web`.
2. Leave **Root Directory** empty (repo root). Framework Preset: **Other**. `vercel.json`
   supplies install/build/output commands; do not override them in the UI.
3. Settings > Environment Variables (Production + Preview), then deploy:

| Variable | Secret | Notes |
|---|---|---|
| `DATABASE_URL` | yes | pooled string (6543) |
| `SUPABASE_URL` | no | |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | |
| `SUPABASE_STORAGE_BUCKET` | no | `media` |
| `JWT_KEY` | yes | long random string |
| `JWT_ISSUER`, `JWT_AUDIENCE` | no | `BetterPlacemaking`, `BetterPlacemaking.Client` |
| `AUTH_REFRESH_TOKEN_HASH_KEY` | yes | random; falls back to `JWT_KEY` |
| `API_BASE_URL`, `APP_BASE_URL` | no | both your Vercel domain, e.g. `https://app.vercel.app` |
| `ALLOWED_ORIGINS` | no | leave unset (same origin) |
| `MAILJET_KEY`, `MAILJET_SECRET_KEY` | yes | |
| `MAILJET_FROM_EMAIL`, `MAILJET_FROM_NAME` | no | |
| `WORKSTATION_MODE` | no | `disabled` |
| `WORKSTATION_BASE_URL`, `WORKSTATION_API_TOKEN` | token yes | only if enabled |
| `NODE_ENV` | no | `production` (cookies marked secure) |
| `FIREBASE_PROJECT_ID`, `GCS_BUCKET_NAME` | no | LEGACY placeholders (any text) until the cleanup PR; `config/env.ts` still requires them |

`DATABASE_DIRECT_URL` is only for local migrations; do not add it to Vercel.
The client needs no variable: `.env.production` sets `VITE_API_BASE_URL` empty (same origin).

## 3. Verify

- `https://<domain>/health` returns `{"status":"ok"}`; `/` loads the app; deep links
  (e.g. `/projects`) reload fine.
- Function logs: Vercel > Deployments > Functions. Limits set in `vercel.json`: 30 s, 1024 MB.

## Notes

- The function has no boot-time seeding (no `app.listen`); run role seeding as part of the migrations.
- Local API dev is unchanged: `npm run dev` in the Express folder plus `npm run dev` in the React
  folder (`.env.development` points the client at `http://localhost:5200`).
- Request bodies on Vercel are capped at 4.5 MB, below the 35 MB the Express limit allows. Large
  uploads (floorplans, media) must use Supabase Storage signed upload URLs, not the API body.
