/** Value coercion from Firestore-shaped data to Postgres parameter values. Never logs values. */

export type ColType = "text" | "int" | "float" | "bool" | "ts" | "json" | "textarr";

export const SQL_CAST: Record<ColType, string> = {
  text: "text",
  int: "integer",
  float: "double precision",
  bool: "boolean",
  ts: "timestamptz",
  json: "jsonb",
  textarr: "text[]",
};

interface TimestampLike {
  toDate(): Date;
}

/** Duck-typed so tests (and any SDK version) can pass Timestamp-shaped objects. */
export function isTimestampLike(v: unknown): v is TimestampLike {
  return typeof v === "object" && v !== null && typeof (v as TimestampLike).toDate === "function";
}

export function toDate(v: unknown): Date | null {
  let d: Date | null = null;
  if (v instanceof Date) d = v;
  else if (isTimestampLike(v)) d = v.toDate();
  else if (typeof v === "string" && v.trim()) d = new Date(v);
  else if (typeof v === "number" && Number.isFinite(v)) d = new Date(v);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

/** Deep-converts Firestore values to plain JSON: Timestamps -> ISO strings, references -> path, undefined dropped. */
export function jsonSafe(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (isTimestampLike(v)) return v.toDate().toISOString();
  if (Array.isArray(v)) return v.map((x) => jsonSafe(x));
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    // DocumentReference (has .path and .firestore) -> its path
    if (typeof o.path === "string" && "firestore" in o) return o.path;
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(o)) {
      if (val !== undefined) out[k] = jsonSafe(val);
    }
    return out;
  }
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  if (typeof v === "bigint") return Number(v);
  return v;
}

export type Coerced = { ok: true; value: unknown } | { ok: false };

/** null/undefined -> {ok, null}. A present value of the wrong shape -> {ok:false}. */
export function coerce(type: ColType, v: unknown): Coerced {
  if (v === null || v === undefined) return { ok: true, value: null };
  switch (type) {
    case "text":
      if (typeof v === "string") return { ok: true, value: v };
      if (typeof v === "number" || typeof v === "boolean") return { ok: true, value: String(v) };
      return { ok: false };
    case "int":
    case "float": {
      const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
      if (!Number.isFinite(n)) return { ok: false };
      if (type === "int" && (!Number.isInteger(n) || Math.abs(n) > 2147483647)) return { ok: false };
      return { ok: true, value: n };
    }
    case "bool":
      if (typeof v === "boolean") return { ok: true, value: v };
      if (v === "true") return { ok: true, value: true };
      if (v === "false") return { ok: true, value: false };
      return { ok: false };
    case "ts": {
      const d = toDate(v);
      return d ? { ok: true, value: d } : { ok: false };
    }
    case "json":
      return { ok: true, value: jsonSafe(v) };
    case "textarr": {
      if (!Array.isArray(v)) return { ok: false };
      const out: string[] = [];
      for (const x of v) {
        const c = coerce("text", x);
        if (!c.ok || c.value === null) return { ok: false };
        out.push(c.value as string);
      }
      return { ok: true, value: out };
    }
  }
}

function pgArrayLiteral(items: string[]): string {
  return `{${items.map((s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}

/** Coerced value -> query parameter (each placeholder is cast to its column type in SQL). */
export function toParam(type: ColType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "ts":
      return (value as Date).toISOString();
    case "json":
      return JSON.stringify(value);
    case "textarr":
      return pgArrayLiteral(value as string[]);
    default:
      return value;
  }
}
