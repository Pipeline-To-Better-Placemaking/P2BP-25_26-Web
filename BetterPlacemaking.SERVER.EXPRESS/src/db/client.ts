import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema/index.js";

/** Driver-agnostic handle: postgres-js in prod, PGlite in tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let instance: Db | null = null;

/** Lazily connects on first use so importing this module never needs DATABASE_URL. */
export function getDb(): Db {
  if (instance) return instance;
  if (!env.databaseUrl) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  // prepare:false is required for Supabase's transaction pooler; small pool for serverless.
  const client = postgres(env.databaseUrl, { prepare: false, max: 3 });
  instance = drizzle(client, { schema }) as unknown as Db;
  return instance;
}

/** Test hook: install (or clear with null) the db returned by getDb(). */
export function setDbForTesting(db: Db | null): void {
  instance = db;
}
