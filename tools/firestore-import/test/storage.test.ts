import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { normalizeObjectPath } from "../../../BetterPlacemaking.SERVER.EXPRESS/src/services/cloudStorageService.js";
import { copyStorage, type GcsObject, type GcsSide, type SupabaseSide } from "../src/storageCopy.js";
import { classifyStorageRef, sanitizeObjectPath } from "../src/storageUrls.js";

describe("storage references", () => {
  it("rewrites gs:// and GCS https URLs of our bucket, leaves others", () => {
    expect(classifyStorageRef("gs://b/a/b c.png", "b")).toMatchObject({ kind: "gcs-rewritten", value: "a/b c.png" });
    expect(classifyStorageRef("https://storage.googleapis.com/b/a%2Fb.xyz?X-Goog-Signature=1", "b")).toMatchObject({ value: "a/b.xyz" });
    expect(classifyStorageRef("https://firebasestorage.googleapis.com/v0/b/b/o/dir%2Fx.png?alt=media&token=t", "b")).toMatchObject({ value: "dir/x.png" });
    expect(classifyStorageRef("gs://other/a.png", "b").kind).toBe("other-absolute");
    expect(classifyStorageRef("https://example.com/a.png", "b").kind).toBe("other-absolute");
    expect(classifyStorageRef("vision/x.json", "b")).toMatchObject({ kind: "relative", sourceObject: "vision/x.json" });
    expect(classifyStorageRef("", "b").kind).toBe("empty");
  });

  it("sanitizes object paths exactly like the server's normalizeObjectPath", () => {
    for (const p of ["a//b\\c/d é.png", "/lead/trail/", "x:y/z (1).xyz", "ok/path.json"]) {
      expect(sanitizeObjectPath(p)).toBe(normalizeObjectPath(p));
    }
  });
});

function fakes(gcsObjects: Record<string, string>, existing: string[] = []) {
  const store = new Set(existing);
  const uploaded: Record<string, string> = {};
  const meta = (name: string): GcsObject => ({ name, size: gcsObjects[name]!.length });
  const gcs: GcsSide = {
    stat: async (n) => (n in gcsObjects ? meta(n) : null),
    async *list(prefix) {
      for (const n of Object.keys(gcsObjects)) if (n.startsWith(prefix)) yield meta(n);
    },
    open: (n) => Readable.from([gcsObjects[n]!]),
  };
  const sb: SupabaseSide = {
    exists: async (k) => store.has(k),
    async upload(k, body) {
      let s = "";
      for await (const c of body) s += c;
      store.add(k);
      uploaded[k] = s;
      return "uploaded";
    },
  };
  return { gcs, sb, uploaded };
}

describe("copyStorage", () => {
  const objs = { "a/one.txt": "11111", "a/two.txt": "22", "b/three.txt": "333", "weird é/x.txt": "4" };

  it("dry run counts objects and bytes without uploading", async () => {
    const { gcs, sb, uploaded } = fakes(objs, ["a/two.txt"]);
    const r = await copyStorage({ refs: new Set(["a/one.txt", "a/two.txt", "nope.txt"]), prefix: "", apply: false, gcs, sb });
    expect(r).toMatchObject({ total: 2, totalBytes: 7, alreadyThere: 1, toCopy: 1, toCopyBytes: 5, missingInBucket: 1, copied: 0 });
    expect(uploaded).toEqual({});
  });

  it("apply streams objects, skips existing ones, and is idempotent", async () => {
    const f = fakes(objs, ["a/two.txt"]);
    const args = { refs: new Set(["a/one.txt"]), prefix: "*", apply: true, ...f };
    const first = await copyStorage(args);
    expect(first).toMatchObject({ total: 4, copied: 3, alreadyThere: 1, renamed: 1, prefixObjects: 3 });
    expect(f.uploaded["a/one.txt"]).toBe("11111");
    expect(f.uploaded["weird _/x.txt"]).toBe("4");
    const second = await copyStorage(args);
    expect(second).toMatchObject({ copied: 0, alreadyThere: 4 });
  });
});
