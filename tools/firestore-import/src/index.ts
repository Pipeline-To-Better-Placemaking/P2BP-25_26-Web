import { parseArgs } from "node:util";
import path from "node:path";
import { createFirestoreSource, createGcsSide, createPostgresRunner } from "./adapters.js";
import { assertCredentialsOutsideRepo, ConfigError, loadEnvFile, requireEnv } from "./env.js";
import { runImport, selectSpecs, UsageError } from "./pipeline.js";
import { formatReport, formatStorage } from "./report.js";
import { copyStorage, createSupabaseSide } from "./storageCopy.js";

const USAGE = `Usage: npx tsx src/index.ts [--apply] [--only users,projects,...] [--storage] [--overwrite]
  --apply                   write to Postgres / Supabase Storage (default: dry run, nothing is written)
  --only a,b                limit to these collections (users, projects, project_members, devices, scans, ...)
  --overwrite               upsert existing rows instead of ON CONFLICT DO NOTHING
  --storage                 also copy referenced GCS objects to Supabase Storage (dry run unless --apply)
  --prefix <p|*>            with --storage: also copy every object under prefix p ("*" = whole bucket)
  --include-refresh-tokens  also import refreshTokens (skipped by default)
  --env-file <path>         load env from this file (default: $DOTENV_CONFIG_PATH)`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      apply: { type: "boolean", default: false },
      only: { type: "string" },
      overwrite: { type: "boolean", default: false },
      storage: { type: "boolean", default: false },
      prefix: { type: "string", default: "" },
      "include-refresh-tokens": { type: "boolean", default: false },
      "env-file": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  const envFile = values["env-file"] ?? process.env.DOTENV_CONFIG_PATH;
  if (envFile) loadEnvFile(path.resolve(envFile));

  const apply = values.apply === true;
  const opts = {
    apply,
    overwrite: values.overwrite === true,
    only: values.only ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
    includeRefreshTokens: values["include-refresh-tokens"] === true,
    bucket: process.env.GCS_BUCKET ?? "better-placemaking-vision.firebasestorage.app",
  };
  const selected = selectSpecs(opts); // validates --only before touching anything

  assertCredentialsOutsideRepo(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const db = createPostgresRunner(requireEnv("DATABASE_DIRECT_URL"));
  console.log(`${apply ? "APPLY" : "DRY RUN (nothing is written)"}${opts.overwrite ? " +overwrite" : ""}: ${selected.map((s) => s.key).join(", ")}`);

  let failed = false;
  try {
    const source = createFirestoreSource(process.env.FIRESTORE_PROJECT_ID ?? "better-placemaking-vision");
    const res = await runImport(source, db, opts);
    console.log(formatReport(res, apply));
    failed = res.stats.some((s) => s.error);

    if (values.storage) {
      const sb = createSupabaseSide(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SECRET_KEY"), process.env.SUPABASE_STORAGE_BUCKET ?? "media");
      const report = await copyStorage({ refs: res.refs, prefix: values.prefix ?? "", apply, gcs: createGcsSide(opts.bucket), sb });
      console.log(formatStorage(report, apply));
      failed ||= report.failed.length > 0;
    }
    if (!apply) console.log("\nDry run only. Re-run with --apply to write.");
  } finally {
    await db.close();
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    // Never print e.message for database errors (can echo row values); config/usage messages are ours.
    if (e instanceof ConfigError || e instanceof UsageError) console.error(`Error: ${e.message}\n\n${USAGE}`);
    else console.error(`Failed (${(e as { code?: string })?.code ?? "unexpected error"})`);
    process.exit(2);
  },
);
