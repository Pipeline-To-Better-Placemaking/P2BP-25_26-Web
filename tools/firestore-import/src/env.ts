import fs from "node:fs";
import path from "node:path";

export class ConfigError extends Error {}

/** Minimal .env parser (KEY=VALUE, optional quotes, # comments). Existing process env wins. */
export function loadEnvFile(file: string, env: NodeJS.ProcessEnv = process.env): void {
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[1] === undefined) continue;
    let v = m[2] ?? "";
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    if (env[m[1]] === undefined) env[m[1]] = v;
  }
}

/** True if `file` (after resolving symlinks) sits inside any git working tree. */
export function isInsideGitWorkingTree(file: string): boolean {
  let dir = path.dirname(fs.realpathSync(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Refuses to continue unless the service-account key exists and lives outside every git working tree. */
export function assertCredentialsOutsideRepo(file: string | undefined): string {
  if (!file) throw new ConfigError("GOOGLE_APPLICATION_CREDENTIALS is not set");
  if (!fs.existsSync(file)) throw new ConfigError("GOOGLE_APPLICATION_CREDENTIALS file does not exist");
  if (isInsideGitWorkingTree(file)) {
    throw new ConfigError("Refusing to run: the credentials file is inside a git working tree. Move it outside the repo.");
  }
  return file;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new ConfigError(`${name} is not set`);
  return v;
}
