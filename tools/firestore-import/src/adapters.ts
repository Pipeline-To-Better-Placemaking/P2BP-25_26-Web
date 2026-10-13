/** Thin SDK adapters. Firestore and GCS are used through READ operations only. */
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import postgres from "postgres";
import type { DocSource, Query, SqlRunner } from "./pipeline.js";
import type { RawDoc, SourceRef } from "./specs.js";
import type { GcsSide } from "./storageCopy.js";

export function createFirestoreSource(projectId: string): DocSource {
  const fs = new Firestore({ projectId, keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS });
  return {
    async *read(ref: SourceRef): AsyncIterable<RawDoc> {
      const q = ref.kind === "collection" ? fs.collection(ref.name) : fs.collectionGroup(ref.name);
      const stream = q.stream() as unknown as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot>;
      for await (const snap of stream) {
        yield {
          id: snap.id,
          path: snap.ref.path,
          data: snap.data(),
          createTime: snap.createTime?.toDate(),
          updateTime: snap.updateTime?.toDate(),
        };
      }
    },
    async listRootCollections() {
      return (await fs.listCollections()).map((c) => c.id);
    },
  };
}

export function createPostgresRunner(url: string): SqlRunner & { close(): Promise<void> } {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  const sql = postgres(url, { prepare: false, max: 1, ssl: local ? false : "require", onnotice: () => {} });
  const wrap =
    (c: { unsafe: (t: string, p?: never[]) => PromiseLike<unknown> }): Query =>
    async (text, params) =>
      (await c.unsafe(text, (params ?? []) as never[])) as Record<string, unknown>[];
  return {
    query: wrap(sql),
    transaction: (fn) => sql.begin((tx) => fn(wrap(tx as never))) as Promise<never>,
    close: () => sql.end(),
  };
}

export function createGcsSide(bucketName: string): GcsSide {
  const bucket = new Storage({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS }).bucket(bucketName);
  return {
    async stat(name) {
      const file = bucket.file(name);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [meta] = await file.getMetadata();
      return { name, size: Number(meta.size ?? 0), contentType: meta.contentType };
    },
    async *list(prefix) {
      const stream = bucket.getFilesStream({ prefix: prefix || undefined }) as unknown as AsyncIterable<{
        name: string;
        metadata: { size?: string; contentType?: string };
      }>;
      for await (const f of stream) {
        yield { name: f.name, size: Number(f.metadata.size ?? 0), contentType: f.metadata.contentType };
      }
    },
    open: (name) => bucket.file(name).createReadStream(),
  };
}
