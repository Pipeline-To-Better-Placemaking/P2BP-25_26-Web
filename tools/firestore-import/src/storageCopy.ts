/** GCS -> Supabase Storage copy. Dry run by default; streams bodies; never overwrites existing objects. */
import { Readable } from "node:stream";
import { sanitizeObjectPath } from "./storageUrls.js";

export interface GcsObject {
  name: string;
  size: number;
  contentType?: string;
}

export interface GcsSide {
  /** null when the object does not exist. */
  stat(name: string): Promise<GcsObject | null>;
  list(prefix: string): AsyncIterable<GcsObject>;
  open(name: string): Readable;
}

export interface SupabaseSide {
  exists(key: string): Promise<boolean>;
  /** "exists" if the server reports a duplicate (race). */
  upload(key: string, body: Readable, size: number, contentType?: string): Promise<"uploaded" | "exists">;
}

export interface StorageReport {
  referenced: number;
  missingInBucket: number;
  prefixObjects: number;
  total: number;
  totalBytes: number;
  alreadyThere: number;
  toCopy: number;
  toCopyBytes: number;
  renamed: number;
  copied: number;
  failed: string[]; // object names (ids), not content
}

export async function copyStorage(opts: {
  refs: Set<string>;
  /** "" = none, "*" = whole bucket, otherwise copy all objects under this prefix too. */
  prefix: string;
  apply: boolean;
  gcs: GcsSide;
  sb: SupabaseSide;
  concurrency?: number;
}): Promise<StorageReport> {
  const r: StorageReport = {
    referenced: opts.refs.size,
    missingInBucket: 0,
    prefixObjects: 0,
    total: 0,
    totalBytes: 0,
    alreadyThere: 0,
    toCopy: 0,
    toCopyBytes: 0,
    renamed: 0,
    copied: 0,
    failed: [],
  };

  const objects = new Map<string, GcsObject>();
  for (const name of opts.refs) {
    const o = await opts.gcs.stat(name);
    if (o) objects.set(o.name, o);
    else r.missingInBucket++;
  }
  if (opts.prefix) {
    for await (const o of opts.gcs.list(opts.prefix === "*" ? "" : opts.prefix)) {
      if (o.name.endsWith("/")) continue; // folder placeholder
      if (!objects.has(o.name)) {
        objects.set(o.name, o);
        r.prefixObjects++;
      }
    }
  }
  r.total = objects.size;

  const queue = [...objects.values()];
  const work = async () => {
    for (let o = queue.shift(); o; o = queue.shift()) {
      r.totalBytes += o.size;
      // The new server addresses objects via normalizeObjectPath, so land them under that name.
      const key = sanitizeObjectPath(o.name);
      if (!key) {
        r.failed.push(o.name);
        continue;
      }
      if (key !== o.name) r.renamed++;
      try {
        if (await opts.sb.exists(key)) {
          r.alreadyThere++;
          continue;
        }
        r.toCopy++;
        r.toCopyBytes += o.size;
        if (!opts.apply) continue;
        const res = await opts.sb.upload(key, opts.gcs.open(o.name), o.size, o.contentType);
        if (res === "uploaded") r.copied++;
        else {
          r.alreadyThere++;
          r.toCopy--;
          r.toCopyBytes -= o.size;
        }
      } catch {
        r.failed.push(o.name);
      }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, work));
  return r;
}

/** Supabase Storage REST (no SDK): raw-body upload, so the GCS read stream is piped straight through. */
export function createSupabaseSide(baseUrl: string, secretKey: string, bucket: string): SupabaseSide {
  const root = baseUrl.replace(/\/+$/, "");
  const enc = (key: string) => key.split("/").map(encodeURIComponent).join("/");
  const auth = { Authorization: `Bearer ${secretKey}`, apikey: secretKey };
  return {
    async exists(key) {
      const res = await fetch(`${root}/storage/v1/object/info/${bucket}/${enc(key)}`, { headers: auth });
      if (res.status === 200) return true;
      if (res.status === 404 || res.status === 400) return false;
      throw new Error(`exists-check status ${res.status}`);
    },
    async upload(key, body, size, contentType) {
      const res = await fetch(`${root}/storage/v1/object/${bucket}/${enc(key)}`, {
        method: "POST",
        headers: {
          ...auth,
          "content-type": contentType || "application/octet-stream",
          "content-length": String(size),
          "x-upsert": "false",
        },
        body: Readable.toWeb(body) as unknown as ReadableStream,
        duplex: "half",
      } as RequestInit);
      if (res.ok) return "uploaded";
      if (res.status === 409) return "exists";
      const text = await res.text().catch(() => "");
      if (/duplicate|already exists/i.test(text)) return "exists";
      throw new Error(`upload status ${res.status}`);
    },
  };
}
