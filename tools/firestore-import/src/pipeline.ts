/**
 * Map + classify + (optionally) write. Pure of Firestore/Postgres SDKs: both sit behind the
 * DocSource / SqlRunner interfaces. Nothing here prints document values; only counts and ids.
 */
import { coerce, SQL_CAST, toParam } from "./convert.js";
import { classifyStorageRef } from "./storageUrls.js";
import { type ColSpec, type Ctx, matchesPattern, type RawDoc, type SourceRef, SPECS, type TableSpec } from "./specs.js";

export interface DocSource {
  read(ref: SourceRef): AsyncIterable<RawDoc>;
  listRootCollections?(): Promise<string[]>;
}

export type Query = (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
export interface SqlRunner {
  query: Query;
  transaction<T>(fn: (q: Query) => Promise<T>): Promise<T>;
}

export interface Options {
  apply: boolean;
  overwrite: boolean;
  only?: string[];
  includeRefreshTokens: boolean;
  /** Old GCS bucket name, used to recognise gs:// / GCS https references. */
  bucket: string;
}

export interface TableStats {
  key: string;
  table: string;
  read: number;
  wouldInsert: number;
  exists: number;
  orphaned: number;
  invalid: number;
  inserted: number;
  conflicts: number;
  reasons: Map<string, number>;
  /** Document paths (ids only) of invalid/orphaned docs, capped. */
  badIds: string[];
  error?: string;
}

export interface StorageFinding {
  field: string; // "table.column"
  relative: number;
  gcsRewritten: number;
  otherAbsolute: number;
}

export interface RunResult {
  stats: TableStats[];
  findings: StorageFinding[];
  /** Object names (old bucket) referenced by valid documents. */
  refs: Set<string>;
  unknownCollections: string[];
}

const MAX_BAD_IDS = 25;
const KEY_SEP = "\u0001";

export class UsageError extends Error {}

export function selectSpecs(opts: Pick<Options, "only" | "includeRefreshTokens">): TableSpec[] {
  const known = new Set(SPECS.map((s) => s.key));
  if (opts.only) {
    for (const k of opts.only) if (!known.has(k)) throw new UsageError(`Unknown --only value: ${k}`);
    if (opts.only.includes("refresh_tokens") && !opts.includeRefreshTokens) {
      throw new UsageError("refresh_tokens requires --include-refresh-tokens");
    }
    return SPECS.filter((s) => opts.only!.includes(s.key));
  }
  return SPECS.filter((s) => !s.optIn || opts.includeRefreshTokens);
}

type Mapped = { ok: true; row: Record<string, unknown> } | { ok: false; reason: string };

/** Source value -> coerced column values. Reasons carry column names only, never values. */
export function mapDoc(spec: TableSpec, ctx: Ctx): Mapped {
  const row: Record<string, unknown> = {};
  for (const c of spec.cols) {
    let raw: unknown;
    if (c.from) raw = c.from(ctx);
    else {
      const fields = Array.isArray(c.field) ? c.field : c.field ? [c.field] : [];
      for (const fld of fields) {
        if (ctx.data[fld] !== undefined && ctx.data[fld] !== null) {
          raw = ctx.data[fld];
          break;
        }
      }
    }
    let out = coerce(c.type, raw);
    if (!out.ok) return { ok: false, reason: `bad-type:${c.col}` };
    if (out.value === null && c.def !== undefined) {
      const dv = typeof c.def === "function" ? (c.def as (x: Ctx) => unknown)(ctx) : c.def;
      out = coerce(c.type, dv);
      if (!out.ok) return { ok: false, reason: `bad-default:${c.col}` };
    }
    if (out.value === null && c.req) return { ok: false, reason: `missing:${c.col}` };
    row[c.col] = out.value;
  }
  return { ok: true, row };
}

const keyOf = (spec: TableSpec, row: Record<string, unknown>) => spec.pk.map((c) => String(row[c])).join(KEY_SEP);

export function buildInsert(spec: TableSpec, rows: Record<string, unknown>[], overwrite: boolean) {
  const cols = spec.cols.map((c) => c.col);
  const params: unknown[] = [];
  const tuples = rows.map((r) => {
    const ph = spec.cols.map((c: ColSpec) => {
      params.push(toParam(c.type, r[c.col]));
      return `$${params.length}::${SQL_CAST[c.type]}`;
    });
    return `(${ph.join(",")})`;
  });
  const q = (s: string) => `"${s}"`;
  const nonPk = cols.filter((c) => !spec.pk.includes(c));
  const conflict = overwrite
    ? `ON CONFLICT (${spec.pk.map(q).join(",")}) DO UPDATE SET ${nonPk.map((c) => `${q(c)}=EXCLUDED.${q(c)}`).join(",")}`
    : "ON CONFLICT DO NOTHING";
  const text = `INSERT INTO ${q(spec.table)} (${cols.map(q).join(",")}) VALUES ${tuples.join(",")} ${conflict} RETURNING 1 AS ok`;
  return { text, params };
}

async function loadKeys(db: SqlRunner, spec: TableSpec): Promise<Set<string>> {
  const rows = await db.query(`SELECT ${spec.pk.map((c) => `"${c}"`).join(",")} FROM "${spec.table}"`);
  return new Set(rows.map((r) => spec.pk.map((c) => String(r[c])).join(KEY_SEP)));
}

/** Postgres error -> safe label (SQLSTATE + constraint name only; messages can echo row values). */
export function safeDbError(e: unknown): string {
  const err = e as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  const code = typeof err?.code === "string" ? err.code : "unknown";
  const constraint = err?.constraint_name ?? err?.constraint;
  return typeof constraint === "string" ? `${code} (${constraint})` : code;
}

export async function runImport(source: DocSource, db: SqlRunner, opts: Options): Promise<RunResult> {
  const selected = selectSpecs(opts);
  const byKey = new Map(SPECS.map((s) => [s.key, s]));
  const parentIds = new Map<string, Set<string>>();
  const findings = new Map<string, StorageFinding>();
  const refs = new Set<string>();
  const stats: TableStats[] = [];

  async function parentSet(key: string): Promise<Set<string>> {
    let s = parentIds.get(key);
    if (!s) {
      s = await loadKeys(db, byKey.get(key)!);
      parentIds.set(key, s);
    }
    return s;
  }

  for (const spec of selected) {
    const st: TableStats = {
      key: spec.key,
      table: spec.table,
      read: 0,
      wouldInsert: 0,
      exists: 0,
      orphaned: 0,
      invalid: 0,
      inserted: 0,
      conflicts: 0,
      reasons: new Map(),
      badIds: [],
    };
    stats.push(st);
    const bad = (path: string, reason: string, kind: "invalid" | "orphaned") => {
      st[kind]++;
      st.reasons.set(reason, (st.reasons.get(reason) ?? 0) + 1);
      if (st.badIds.length < MAX_BAD_IDS) st.badIds.push(path);
    };

    try {
      const existing = await loadKeys(db, spec);
      const uniqueOwners = new Map<string, Map<string, string>>(); // col -> value -> pk key
      for (const uc of spec.unique ?? []) {
        const rows = await db.query(
          `SELECT ${spec.pk.map((c) => `"${c}"`).join(",")}, "${uc}" AS u FROM "${spec.table}" WHERE "${uc}" IS NOT NULL`,
        );
        uniqueOwners.set(uc, new Map(rows.map((r) => [String(r.u), spec.pk.map((c) => String(r[c])).join(KEY_SEP)])));
      }
      const fkSets = new Map<string, Set<string>>();
      for (const fk of spec.fks ?? []) fkSets.set(fk.col, await parentSet(fk.parent));

      const seen = new Set<string>();
      const toWrite: Record<string, unknown>[] = [];
      const validKeys: string[] = [];

      for await (const doc of source.read(spec.source)) {
        const seg = doc.path.split("/");
        if (!matchesPattern(seg, spec.pattern)) continue;
        const ctx: Ctx = { doc, data: doc.data ?? {}, seg };
        if (spec.include && !spec.include(ctx)) continue;
        st.read++;

        const m = mapDoc(spec, ctx);
        if (!m.ok) {
          bad(doc.path, m.reason, "invalid");
          continue;
        }
        const row = m.row;
        const key = keyOf(spec, row);
        if (seen.has(key)) {
          bad(doc.path, "duplicate-id", "invalid");
          continue;
        }

        let conflict: string | null = null;
        for (const uc of spec.unique ?? []) {
          const v = row[uc];
          if (v === null || v === undefined) continue;
          const owner = uniqueOwners.get(uc)!.get(String(v));
          if (owner !== undefined && owner !== key) conflict = `unique-conflict:${uc}`;
          uniqueOwners.get(uc)!.set(String(v), key);
        }
        if (conflict) {
          bad(doc.path, conflict, "invalid");
          continue;
        }

        let orphan = false;
        for (const fk of spec.fks ?? []) {
          const v = row[fk.col];
          if (v !== null && v !== undefined && !fkSets.get(fk.col)!.has(String(v))) orphan = true;
        }
        if (orphan) {
          bad(doc.path, "orphan", "orphaned");
          continue;
        }

        seen.add(key);
        applyStorage(spec, row, opts.bucket, findings, refs);
        validKeys.push(key);
        if (existing.has(key)) {
          st.exists++;
          if (opts.overwrite) toWrite.push(row);
        } else {
          st.wouldInsert++;
          toWrite.push(row);
        }
      }

      // Parents for later tables: DB rows plus everything valid here (they would exist after apply).
      const ps = await parentSet(spec.key);
      for (const k of validKeys) ps.add(k);

      if (opts.apply && toWrite.length > 0) {
        const chunk = Math.max(1, Math.min(200, Math.floor(60000 / spec.cols.length)));
        st.inserted = await db.transaction(async (q) => {
          let n = 0;
          for (let off = 0; off < toWrite.length; off += chunk) {
            const { text, params } = buildInsert(spec, toWrite.slice(off, off + chunk), opts.overwrite);
            n += (await q(text, params)).length;
          }
          return n;
        });
        st.conflicts = toWrite.length - st.inserted;
      }
    } catch (e) {
      st.error = safeDbError(e);
    }
  }

  let unknownCollections: string[] = [];
  if (source.listRootCollections) {
    try {
      const known = new Set<string>([...SPECS.map((s) => (s.source.kind === "collection" ? s.source.name : "")), "projects"]);
      for (const k of ["role_definitions_global", "role_definitions_project"]) known.add(k);
      unknownCollections = (await source.listRootCollections()).filter((c) => !known.has(c));
    } catch {
      /* listing is informational only */
    }
  }

  return { stats, findings: [...findings.values()], refs, unknownCollections };
}

function applyStorage(
  spec: TableSpec,
  row: Record<string, unknown>,
  bucket: string,
  findings: Map<string, StorageFinding>,
  refs: Set<string>,
): void {
  for (const sc of spec.storage ?? []) {
    const value = row[sc.col];
    if (typeof value !== "string") continue;
    const cl = classifyStorageRef(value, bucket);
    if (cl.kind === "empty") continue;
    const field = `${spec.table}.${sc.col}`;
    let fd = findings.get(field);
    if (!fd) findings.set(field, (fd = { field, relative: 0, gcsRewritten: 0, otherAbsolute: 0 }));
    if (cl.kind === "other-absolute") fd.otherAbsolute++;
    else if (cl.kind === "relative") fd.relative++;
    else fd.gcsRewritten++;
    if (!sc.rewrite) continue;
    if (cl.kind === "gcs-rewritten") row[sc.col] = cl.value;
    if (cl.sourceObject) refs.add(cl.sourceObject);
  }
}
