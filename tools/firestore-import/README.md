# firestore-import

One-off migration: legacy Firestore (`better-placemaking-vision`, default DB) and its GCS bucket into Supabase Postgres + Storage bucket `media`. Firestore and GCS are only ever read. Default is a dry run.

## Setup
1. GCP console > IAM > Service accounts: create a key for an account with **Cloud Datastore Viewer** and **Storage Object Viewer**. Save the JSON OUTSIDE this repo (the tool refuses a key inside any git working tree).
2. `cd tools/firestore-import && npm install`
3. Export `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`. DB and Supabase settings come from the server `.env`
   (`DATABASE_DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`): `export DOTENV_CONFIG_PATH=../../BetterPlacemaking.SERVER.EXPRESS/.env` (or `--env-file`).
   Optional: `GCS_BUCKET`, `SUPABASE_STORAGE_BUCKET`, `FIRESTORE_PROJECT_ID`.

## Run
- Dry run (reads only, prints a per-collection table): `npx tsx src/index.ts [--only users,projects] [--storage]`
- Review the table: `orphaned` = FK parent missing (skipped), `invalid` = bad or missing fields (ids listed, never values), `exists` = already imported.
- Apply: `npx tsx src/index.ts --apply [--storage]`. Safe to re-run (`ON CONFLICT DO NOTHING`); `--overwrite` upserts instead.
- `--storage` copies referenced GCS objects (`--prefix <p|*>` adds everything under a prefix) and skips ones already in Supabase. gs:// and GCS https references in path fields are rewritten to object names.
- Refresh tokens are skipped unless `--include-refresh-tokens`. System role definitions are never touched.

## Post-checks
- Compare per-table counts in Postgres with the `read` column; investigate any `orphaned`/`invalid`.
- Dry-run again: `would-insert` must be 0 everywhere.
- Log in as a migrated user; open a project, a floorplan, and download a fusion output.
- Delete the service-account key and revoke it in GCP.

Tests (no network): `npm test`. Needs `npm ci` in `BetterPlacemaking.SERVER.EXPRESS` (the tests reuse its `createTestDb()`).
