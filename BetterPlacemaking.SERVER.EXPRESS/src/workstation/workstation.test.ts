import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalFsWorkstation } from "./LocalFsWorkstation.js";
import { RemoteWorkstation } from "./RemoteWorkstation.js";
import { NotImplementedError } from "./types.js";

describe("LocalFsWorkstation", () => {
  let dir: string;
  const ws = new LocalFsWorkstation();

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "bp-ws-test-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes, reads and checks existence", async () => {
    const p = path.join(dir, "a.txt");
    expect(await ws.exists(p)).toBe(false);
    await ws.writeFile(p, "héllo\n");
    expect(await ws.exists(p)).toBe(true);
    expect(await ws.readText(p)).toBe("héllo\n");
    expect((await ws.readBytes(p)).equals(Buffer.from("héllo\n"))).toBe(true);
  });

  it("writes binary data", async () => {
    const p = path.join(dir, "b.bin");
    await ws.writeFile(p, Buffer.from([0, 1, 2, 255]));
    expect([...(await ws.readBytes(p))]).toEqual([0, 1, 2, 255]);
  });

  it("ensureDir is recursive and idempotent; writeFile does not create parents", async () => {
    const nested = path.join(dir, "x", "y");
    await expect(ws.writeFile(path.join(nested, "f"), "1")).rejects.toThrow();
    await ws.ensureDir(nested);
    await ws.ensureDir(nested);
    await ws.writeFile(path.join(nested, "f"), "1");
    expect(await ws.readText(path.join(nested, "f"))).toBe("1");
  });

  it("readText rejects for a missing file", async () => {
    await expect(ws.readText(path.join(dir, "nope"))).rejects.toThrow();
  });

  it("lists names and stats, and removes files", async () => {
    await ws.writeFile(path.join(dir, "one.xyz"), "abc");
    await ws.writeFile(path.join(dir, "two.json"), "{}");
    expect((await ws.listNames(dir)).sort()).toEqual(["one.xyz", "two.json"]);
    const stats = await ws.listStats(dir);
    const one = stats.find((s) => s.name === "one.xyz")!;
    expect(one.size).toBe(3);
    expect(one.mtimeMs).toBeGreaterThan(0);
    await ws.remove(path.join(dir, "one.xyz"));
    expect(await ws.exists(path.join(dir, "one.xyz"))).toBe(false);
    await expect(ws.remove(path.join(dir, "one.xyz"))).rejects.toThrow();
  });
});

describe("RemoteWorkstation stub", () => {
  it("throws NotImplementedError from every method", async () => {
    const ws = new RemoteWorkstation();
    const calls = [
      () => ws.exists("p"),
      () => ws.readText("p"),
      () => ws.readBytes("p"),
      () => ws.writeFile("p", "x"),
      () => ws.ensureDir("p"),
      () => ws.remove("p"),
      () => ws.listNames("p"),
      () => ws.listStats("p"),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toThrow(NotImplementedError);
      await expect(call()).rejects.toThrow("workstation integration pending");
    }
  });
});
