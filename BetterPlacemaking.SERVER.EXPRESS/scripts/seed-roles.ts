import "dotenv/config";

// Idempotently upserts the system role definitions (same seeder the server runs on boot).
// Uses DATABASE_URL, falling back to DATABASE_DIRECT_URL.
process.env.DATABASE_URL ||= process.env.DATABASE_DIRECT_URL;
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL or DATABASE_DIRECT_URL.");
  process.exit(1);
}

// Imported after the env fallback above, because config/env.ts reads process.env at import time.
const { seedRoles } = await import("../src/authorization/roleSeeder.js");
await seedRoles();
console.log("System roles seeded.");
process.exit(0);
