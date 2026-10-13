import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

// Applies supabase/migrations to the database at DATABASE_DIRECT_URL (direct connection, port 5432).
const url = process.env.DATABASE_DIRECT_URL;
if (!url) {
  console.error("Missing required environment variable: DATABASE_DIRECT_URL");
  process.exit(1);
}

const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const client = postgres(url, { max: 1 });
try {
  await migrate(drizzle(client), { migrationsFolder: folder });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
