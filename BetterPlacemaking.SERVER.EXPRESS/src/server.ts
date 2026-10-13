import { sql } from "drizzle-orm";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { getDb } from "./db/client.js";
import { seedRoles } from "./authorization/roleSeeder.js";

async function main() {
  await getDb().execute(sql`select 1`); // fail fast if DATABASE_URL is missing or unreachable

  console.log("Seeding system role definitions...");
  await seedRoles();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`BetterPlacemaking Express API listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
