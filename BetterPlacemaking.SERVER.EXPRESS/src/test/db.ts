import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { setDbForTesting, type Db } from "../db/client.js";
import * as schema from "../db/schema/index.js";

/** Fresh in-memory Postgres (PGlite) with the full schema applied, installed as getDb(). */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const { apply } = await pushSchema(schema, db as never);
  await apply();
  setDbForTesting(db as unknown as Db);
  return db as unknown as Db;
}
