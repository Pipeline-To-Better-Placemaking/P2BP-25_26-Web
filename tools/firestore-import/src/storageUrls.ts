/**
 * Storage path handling. The new server treats these document fields as Supabase object names
 * (see cloudStorageService.normalizeObjectPath), so absolute GCS references are rewritten to them.
 */

/** Copy of cloudStorageService.sanitizeObjectPath (kept in sync by a parity test). Returns null if empty. */
export function sanitizeObjectPath(path: string): string | null {
  const normalizedSlashes = path.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "");
  let result = "";
  let lastWasSlash = false;
  for (const c of normalizedSlashes) {
    if (c === "/") {
      if (!lastWasSlash) {
        result += "/";
        lastWasSlash = true;
      }
      continue;
    }
    lastWasSlash = false;
    result += /[a-zA-Z0-9\-_: .]/.test(c) ? c : "_";
  }
  const cleaned = result.replace(/^\/+|\/+$/g, "");
  return cleaned.trim() ? cleaned : null;
}

export type RefKind = "relative" | "gcs-rewritten" | "other-absolute" | "empty";

export interface Classified {
  kind: RefKind;
  /** The value to store (rewritten for gcs-rewritten, otherwise unchanged). */
  value: string | null;
  /** Object name in the OLD bucket to copy (relative or rewritten refs only). */
  sourceObject?: string;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Extracts the object name if `value` points at `bucket` via gs:// or a GCS/Firebase https URL (signed or not). */
export function gcsObjectFromUrl(value: string, bucket: string): string | null {
  const gs = /^gs:\/\/([^/]+)\/(.+)$/.exec(value);
  if (gs) return gs[1] === bucket ? gs[2] : null;
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.hostname === "storage.googleapis.com") {
    const m = /^\/([^/]+)\/(.+)$/.exec(u.pathname);
    return m && m[1] === bucket ? safeDecode(m[2]) : null;
  }
  if (u.hostname === `${bucket}.storage.googleapis.com`) return safeDecode(u.pathname.replace(/^\//, ""));
  if (u.hostname === "firebasestorage.googleapis.com") {
    const m = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(u.pathname);
    return m && m[1] === bucket ? safeDecode(m[2]) : null;
  }
  return null;
}

/** `urlsAllowed`: also treat gs:// / GCS https values as rewritable references (otherwise they are only reported). */
export function classifyStorageRef(value: string | null, bucket: string): Classified {
  if (value === null || !value.trim()) return { kind: "empty", value };
  const v = value.trim();
  if (/^(gs|https?):\/\//i.test(v)) {
    const obj = gcsObjectFromUrl(v, bucket);
    const clean = obj ? sanitizeObjectPath(obj) : null;
    if (clean) return { kind: "gcs-rewritten", value: clean, sourceObject: obj! };
    return { kind: "other-absolute", value };
  }
  return { kind: "relative", value, sourceObject: v.replace(/^\/+/, "") };
}
