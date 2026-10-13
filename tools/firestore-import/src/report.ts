import type { RunResult } from "./pipeline.js";
import type { StorageReport } from "./storageCopy.js";

const pad = (s: string | number, n: number) => String(s).padStart(n);

/** Counts and document paths (ids) only. */
export function formatReport(res: RunResult, apply: boolean): string {
  const lines: string[] = [];
  const head = ["collection", "read", "would-insert", "exists", "orphaned", "invalid"];
  if (apply) head.push("inserted", "skipped");
  lines.push(head.map((h, i) => (i === 0 ? h.padEnd(26) : pad(h, 13))).join(" "));
  for (const s of res.stats) {
    const cells = [s.key.padEnd(26), pad(s.read, 13), pad(s.wouldInsert, 13), pad(s.exists, 13), pad(s.orphaned, 13), pad(s.invalid, 13)];
    if (apply) cells.push(pad(s.inserted, 13), pad(s.conflicts, 13));
    lines.push(cells.join(" ") + (s.error ? `  ERROR ${s.error}` : ""));
  }
  for (const s of res.stats) {
    if (s.reasons.size > 0) {
      lines.push(`  ${s.key}: ${[...s.reasons].map(([r, n]) => `${r}=${n}`).join(", ")}`);
    }
    if (s.badIds.length > 0) lines.push(`  ${s.key} ids: ${s.badIds.join(" ")}`);
  }
  if (res.unknownCollections.length > 0) {
    lines.push(`Firestore root collections with no mapping (not imported): ${res.unknownCollections.join(", ")}`);
  }
  if (res.findings.length > 0) {
    lines.push("", "Storage references in documents (counts):");
    for (const f of res.findings) {
      lines.push(`  ${f.field}: object-names=${f.relative} gcs-urls(rewritten)=${f.gcsRewritten} other-absolute-urls(left as is)=${f.otherAbsolute}`);
    }
  }
  return lines.join("\n");
}

export function formatStorage(r: StorageReport, apply: boolean): string {
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MiB`;
  return [
    "",
    `Storage (${apply ? "APPLY" : "dry run"}): objects=${r.total} bytes=${r.totalBytes} (${mb(r.totalBytes)})`,
    `  referenced by documents=${r.referenced} (not in bucket=${r.missingInBucket}), extra via --prefix=${r.prefixObjects}`,
    `  already in Supabase=${r.alreadyThere}, to copy=${r.toCopy} (${mb(r.toCopyBytes)}), renamed by path sanitising=${r.renamed}`,
    apply ? `  copied=${r.copied}, failed=${r.failed.length}` : "",
    r.failed.length ? `  failed objects: ${r.failed.slice(0, 25).join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
