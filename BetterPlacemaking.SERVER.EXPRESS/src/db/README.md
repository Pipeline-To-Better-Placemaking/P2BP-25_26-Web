# src/db

Drizzle ORM over Postgres (Supabase). Prod: postgres-js (`prepare:false`); tests: PGlite.

- Ids: `text` primary keys, default `crypto.randomUUID()` (same shape as Firestore ids).
- Names: tables/columns snake_case in SQL, camelCase in TS. Timestamps are `timestamptz`.
- API JSON keeps its legacy casing; map DB rows <-> API shape in the service layer.
- Subcollections become tables with an FK (`onDelete: cascade`) and an index on the FK.
- Firestore transactions become `getDb().transaction(...)`.

## Add a domain
1. Create `schema/<domain>.ts`; import `users`/`projects` from `./core.js` for FKs.
2. Add `export * from "./<domain>.js";` to `schema/index.ts`.
3. `npm run db:generate` writes SQL to `../supabase/migrations/` (needs no live DB).

## Tests
```ts
const db = await createTestDb(); // src/test/db.ts: fresh PGlite, schema pushed, installed as getDb()
afterEach(() => setDbForTesting(null));
```
Services call `getDb()` from `src/db/client.ts`, so they hit the test db automatically.
