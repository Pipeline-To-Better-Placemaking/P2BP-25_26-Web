import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");

describe("supabase/migrations", () => {
  it("applies cleanly to an empty database and creates every schema table", async () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.length).toBeGreaterThan(0);

    const client = new PGlite();
    for (const file of files) {
      const statements = readFileSync(path.join(migrationsDir, file), "utf8").split("--> statement-breakpoint");
      for (const statement of statements) {
        if (statement.trim()) await client.exec(statement);
      }
    }

    const expected = Object.values(schema)
      .filter((v): v is PgTable => is(v, PgTable))
      .map((t) => getTableName(t))
      .sort();
    expect(expected.length).toBeGreaterThan(10);

    const { rows } = await client.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const actual = rows.map((r) => r.table_name);
    for (const table of expected) expect(actual).toContain(table);
  });

  it("enables row level security on every public table", async () => {
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const client = new PGlite();
    for (const file of files) {
      const statements = readFileSync(path.join(migrationsDir, file), "utf8").split("--> statement-breakpoint");
      for (const statement of statements) {
        if (statement.trim()) await client.exec(statement);
      }
    }
    // Supabase exposes public tables via its Data API; a table without RLS is world-accessible.
    // If this fails after adding a table, add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in a new migration.
    const { rows } = await client.query<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
