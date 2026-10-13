import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertCredentialsOutsideRepo, ConfigError, loadEnvFile } from "../src/env.js";

describe("credentials guard", () => {
  it("refuses a key inside a git working tree and accepts one outside", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsimport-"));
    try {
      const repo = path.join(root, "repo");
      fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
      fs.mkdirSync(path.join(repo, "sub"));
      const inside = path.join(repo, "sub", "key.json");
      const outside = path.join(root, "key.json");
      fs.writeFileSync(inside, "{}");
      fs.writeFileSync(outside, "{}");
      expect(() => assertCredentialsOutsideRepo(inside)).toThrow(ConfigError);
      expect(assertCredentialsOutsideRepo(outside)).toBe(outside);
      expect(() => assertCredentialsOutsideRepo(undefined)).toThrow(ConfigError);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("loads env files without overriding existing variables", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fsimport-"));
    try {
      const file = path.join(dir, ".env");
      fs.writeFileSync(file, 'A=1\nB="two words"\nC=3 # c\nexport D=4\n');
      const env: NodeJS.ProcessEnv = { A: "keep" };
      loadEnvFile(file, env);
      expect(env).toMatchObject({ A: "keep", B: "two words", C: "3", D: "4" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("read-only guarantee", () => {
  it("source code calls no Firestore/GCS write APIs", () => {
    const src = path.join(import.meta.dirname, "..", "src");
    const text = fs.readdirSync(src).map((f) => fs.readFileSync(path.join(src, f), "utf8")).join("\n");
    // Only the handle names used for Firestore / GCS objects; Map/Set .set/.delete elsewhere are fine.
    const writes = /\b(fs|firestore|bucket|file|snap|ref)\.(set|update|delete|create|add|recursiveDelete|bulkWriter|batch|runTransaction|save|setMetadata|copy|move)\(/;
    expect(writes.test(text)).toBe(false);
  });
});
