import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "../../../BetterPlacemaking.SERVER.EXPRESS/src/test/db.js";
import type { DocSource, Options, Query, SqlRunner } from "../src/pipeline.js";
import type { RawDoc, SourceRef } from "../src/specs.js";

/** Timestamp-shaped stand-in (the tool duck-types on toDate()). */
export class FakeTimestamp {
  constructor(private readonly iso: string) {}
  toDate() {
    return new Date(this.iso);
  }
}

/** Fresh PGlite with the server's real schema, exposed as the tool's SqlRunner. */
export async function pgliteRunner(): Promise<SqlRunner & { client: PGlite }> {
  const db = await createTestDb();
  const client = (db as unknown as { $client: PGlite }).$client;
  const wrap =
    (c: { query: PGlite["query"] }): Query =>
    async (text, params) =>
      (await c.query(text, (params ?? []) as never[])).rows as Record<string, unknown>[];
  return {
    client,
    query: wrap(client),
    transaction: (fn) => client.transaction((tx) => fn(wrap(tx as never))),
  };
}

export function doc(path: string, data: Record<string, unknown>, createTime = "2024-05-01T10:00:00Z"): RawDoc {
  return { id: path.split("/").pop()!, path, data, createTime: new Date(createTime), updateTime: new Date(createTime) };
}

/** Serves docs by source: root collection name, or collection-group name (matched on the parent collection id). */
export function fakeSource(docs: RawDoc[]): DocSource & { reads: number } {
  const src = {
    reads: 0,
    async *read(ref: SourceRef) {
      src.reads++;
      for (const d of docs) {
        const seg = d.path.split("/");
        const coll = seg[seg.length - 2];
        if (ref.kind === "collection" ? seg.length === 2 && coll === ref.name : coll === ref.name) yield d;
      }
    },
    async listRootCollections() {
      return [...new Set(docs.map((d) => d.path.split("/")[0]!)), "mystery_collection"];
    },
  };
  return src;
}

export const baseOpts: Options = {
  apply: false,
  overwrite: false,
  includeRefreshTokens: false,
  bucket: "old-bucket",
};
