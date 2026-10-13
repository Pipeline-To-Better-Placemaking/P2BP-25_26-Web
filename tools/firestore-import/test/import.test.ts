import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { runImport } from "../src/pipeline.js";
import { formatReport } from "../src/report.js";
import { SPECS } from "../src/specs.js";
import { baseOpts, doc, FakeTimestamp, fakeSource, pgliteRunner } from "./helpers.js";

const SECRET_HASH = "$2a$10$SECRETSECRETSECRETSECRETuAbCdEfGhIjKlMnOpQrStUvWxYz012";
const SECRET_API = "api-key-hash-SECRET-value";
const SECRET_TOKEN = "reset-token-SECRET-value";
const SECRET_EMAIL = "someone.private@example.com";

const docs = [
  doc("users/u1", {
    FirstName: "Ada",
    Email: SECRET_EMAIL,
    Password: SECRET_HASH,
    Role: "Admin",
    EmailVerified: true,
    PasswordResetToken: SECRET_TOKEN,
    PasswordResetTokenExpiry: new FakeTimestamp("2025-01-02T03:04:05Z"),
  }),
  doc("users/u2", { Email: "dup@example.com", Password: SECRET_HASH }),
  doc("users/u3", { Email: "dup@example.com", Password: SECRET_HASH }), // unique email conflict -> invalid
  doc("user_global_roles/u1", { roles: ["Admin"] }),
  doc("user_global_roles/ghost", { roles: ["Admin"] }), // orphan
  doc("projects/p1", { Title: "Park", Location: "Orlando" }),
  doc("projects/p1/members/u1", { roles: ["ProjectOwner"], authzVersion: 3, notifyOnOwnScan: true }),
  doc("projects/p1/members/ghost", { roles: ["Viewer"] }), // orphan user
  doc("projects/missing/members/u1", { roles: ["Viewer"] }), // orphan project
  doc("devices/d1", {
    ProjectId: "p1",
    Name: "Jetson",
    ApiKeyHash: SECRET_API,
    Config: { A: 1, When: new FakeTimestamp("2025-03-04T00:00:00Z"), Nested: { list: [1, 2] } },
  }),
  doc("devices/d2", { ProjectId: "gone", Name: "lost" }), // orphan
  doc("projects/p1/devices/d1/scans/s1", {
    Status: "complete",
    CreatedAt: new FakeTimestamp("2025-02-03T04:05:06Z"),
    ObjUrl: "gs://old-bucket/vision/lidar-scans/p1/d1/s1.xyz",
    scan_resolution: "high",
    Custom: { at: new FakeTimestamp("2025-02-03T04:05:07Z") },
  }),
  doc("projects/p1/devices/d1/scans/cal1", {
    Status: "complete",
    CreatedAt: new FakeTimestamp("2025-02-04T00:00:00Z"),
    IsCombinedCalibrationScan: true,
    SourceScanIds: ["s1"],
    CombineTransforms: [{ ScanId: "s1", XTranslation: 1, YTranslation: 2, Theta: 0.5 }],
    ObjUrl: "/local/path.xyz",
  }),
  doc("projects/p1/scan_schedules/sc1", { Frequency: "daily", LastRunAt: new FakeTimestamp("2025-04-01T00:00:00Z") }),
  doc("aruco_sessions/a1", { Status: "collecting", CamerasCheckedIn: ["aa:bb"], CamerasTotal: 1 }),
  doc("aruco_sessions/a2", { ArucoDict: "x" }), // invalid: Status required
  doc("board_library/b1", {
    UserId: "u1",
    Type: "charuco",
    Nickname: "n",
    Dictionary: "d",
    Units: "mm",
    MarkerSize: 10,
    MarkerSizeMm: 10,
    PreviewSvg: "<svg/>",
    CreatedAtUtc: new FakeTimestamp("2024-01-01T00:00:00Z"),
  }),
  doc("floorplan_library/f1", {
    UserId: "u1",
    ImagePath: "https://storage.googleapis.com/old-bucket/floorplans/u1/a%20b.png?X-Goog-Signature=zzz",
    ImageSizeBytes: 5,
    ImageWidth: 1,
    ImageHeight: 2,
    Calibration: { MmPerPixel: 2, ReferenceDistanceMm: 1, CalibratedAtUtc: "2024-01-01T00:00:00Z" },
  }),
  doc("fusion_runs/r1", { Status: "done", StartedAtUnix: 1700000000.5, OutputGcsPath: "vision/tracks-fused/p1/out.json" }),
  doc("fusion_config/default", { ScheduledHourUtc: 3, ScheduledMinuteUtc: 0, Enabled: true }),
  doc("global_homographies/p1", { MmPerFpPx: 2.5, Placements: [{ DeviceId: "d1" }], LockedGroups: [] }),
  doc("refreshTokens/t1", { UserId: "u1", TokenHash: "hash-SECRET", ExpiresAtUtc: new FakeTimestamp("2030-01-01T00:00:00Z") }),
];

const stat = (res: Awaited<ReturnType<typeof runImport>>, key: string) => res.stats.find((s) => s.key === key)!;

describe("firestore import", () => {
  let db: Awaited<ReturnType<typeof pgliteRunner>>;
  beforeAll(async () => {
    db = await pgliteRunner();
  });
  afterEach(() => vi.restoreAllMocks());

  it("maps every spec column onto a real column of the server schema", async () => {
    const rows = await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`);
    const have = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    for (const spec of SPECS) for (const c of spec.cols) expect(have.has(`${spec.table}.${c.col}`), `${spec.table}.${c.col}`).toBe(true);
  });

  it("dry run classifies but never writes", async () => {
    const res = await runImport(fakeSource(docs), db, baseOpts);
    expect(stat(res, "users")).toMatchObject({ read: 3, wouldInsert: 2, invalid: 1, exists: 0 });
    expect(stat(res, "user_global_roles")).toMatchObject({ read: 2, wouldInsert: 1, orphaned: 1 });
    expect(stat(res, "project_members")).toMatchObject({ read: 3, wouldInsert: 1, orphaned: 2 });
    expect(stat(res, "devices")).toMatchObject({ read: 2, wouldInsert: 1, orphaned: 1 });
    expect(stat(res, "scans")).toMatchObject({ read: 1, wouldInsert: 1 });
    expect(stat(res, "scan_calibration_records")).toMatchObject({ read: 1, wouldInsert: 1 });
    expect(stat(res, "aruco_sessions")).toMatchObject({ read: 2, wouldInsert: 1, invalid: 1 });
    expect(res.stats.find((s) => s.key === "refresh_tokens")).toBeUndefined();
    expect(res.unknownCollections).toEqual(["mystery_collection"]);
    for (const t of ["users", "projects", "devices", "scans"]) {
      expect(await db.query(`SELECT 1 FROM ${t}`)).toHaveLength(0);
    }
  });

  it("apply inserts in FK order; a second run inserts nothing (idempotent)", async () => {
    const first = await runImport(fakeSource(docs), db, { ...baseOpts, apply: true });
    expect(first.stats.every((s) => !s.error)).toBe(true);
    expect(stat(first, "users").inserted).toBe(2);
    expect(stat(first, "project_members").inserted).toBe(1);
    expect(stat(first, "scans").inserted).toBe(1);

    const second = await runImport(fakeSource(docs), db, { ...baseOpts, apply: true });
    for (const s of second.stats) {
      expect(s.inserted, s.key).toBe(0);
      expect(s.wouldInsert, s.key).toBe(0);
    }
    expect(stat(second, "users").exists).toBe(2);
    expect(await db.query(`SELECT id FROM users`)).toHaveLength(2);
    expect(await db.query(`SELECT 1 FROM project_members`)).toHaveLength(1);
  });

  it("converts timestamps and keeps jsonb shapes the services expect", async () => {
    const [u] = await db.query(`SELECT created_at, password_reset_token_expiry, password FROM users WHERE id='u1'`);
    expect((u!.password_reset_token_expiry as Date).toISOString()).toBe("2025-01-02T03:04:05.000Z");
    expect((u!.created_at as Date).toISOString()).toBe("2024-05-01T10:00:00.000Z"); // falls back to doc createTime
    expect(u!.password).toBe(SECRET_HASH); // copied as-is

    const [s] = await db.query(`SELECT * FROM scans WHERE id='s1'`);
    expect(s).toMatchObject({ project_id: "p1", device_id: "d1", status: "complete" });
    expect((s!.created_at as Date).toISOString()).toBe("2025-02-03T04:05:06.000Z");
    expect(s!.extra).toEqual({ scan_resolution: "high", Custom: { at: "2025-02-03T04:05:07.000Z" } });
    expect(s!.obj_url).toBe("vision/lidar-scans/p1/d1/s1.xyz"); // gs:// rewritten to an object name

    const [dev] = await db.query(`SELECT config FROM devices WHERE id='d1'`);
    expect(dev!.config).toEqual({ A: 1, When: "2025-03-04T00:00:00.000Z", Nested: { list: [1, 2] } });

    const [m] = await db.query(`SELECT * FROM project_members WHERE user_id='u1'`);
    expect(m).toMatchObject({ roles: ["ProjectOwner"], authz_version: 3, notify_on_own_scan: true, notify_on_others_scan: false });

    const [cal] = await db.query(`SELECT * FROM scan_calibration_records WHERE id='cal1'`);
    expect(cal).toMatchObject({ is_combined_calibration_scan: true, source_scan_ids: ["s1"], obj_url: "/local/path.xyz" });
    expect(cal!.combine_transforms).toEqual([{ ScanId: "s1", XTranslation: 1, YTranslation: 2, Theta: 0.5 }]);

    const [fp] = await db.query(`SELECT image_path FROM floorplan_library WHERE id='f1'`);
    expect(fp!.image_path).toBe("floorplans/u1/a b.png");
  });

  it("does not overwrite without --overwrite, and upserts with it", async () => {
    const changed = docs.map((d) => (d.path === "projects/p1" ? { ...d, data: { Title: "Renamed" } } : d));
    await runImport(fakeSource(changed), db, { ...baseOpts, apply: true });
    expect((await db.query(`SELECT title FROM projects WHERE id='p1'`))[0]!.title).toBe("Park");
    const res = await runImport(fakeSource(changed), db, { ...baseOpts, apply: true, overwrite: true });
    expect(stat(res, "projects").inserted).toBe(1);
    expect((await db.query(`SELECT title FROM projects WHERE id='p1'`))[0]!.title).toBe("Renamed");
  });

  it("imports refresh tokens only when asked", async () => {
    const res = await runImport(fakeSource(docs), db, { ...baseOpts, apply: true, includeRefreshTokens: true, only: ["refresh_tokens"] });
    expect(stat(res, "refresh_tokens").inserted).toBe(1);
    await expect(runImport(fakeSource(docs), db, { ...baseOpts, only: ["refresh_tokens"] })).rejects.toThrow(/include-refresh-tokens/);
    await expect(runImport(fakeSource(docs), db, { ...baseOpts, only: ["nope"] })).rejects.toThrow(/Unknown/);
  });

  it("never lets secrets or PII reach log output", async () => {
    const fresh = await pgliteRunner();
    const out: string[] = [];
    const capture = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(process.stdout, "write").mockImplementation((c) => (out.push(String(c)), true));
    const res = await runImport(fakeSource(docs), fresh, { ...baseOpts, apply: true, includeRefreshTokens: true });
    console.log(formatReport(res, true));
    const text = out.join("\n");
    expect(text).toContain("users");
    for (const secret of [SECRET_HASH, SECRET_API, SECRET_TOKEN, SECRET_EMAIL, "hash-SECRET", "Ada"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("reports DB failures as SQLSTATE only", async () => {
    const failing = {
      query: db.query,
      transaction: async () => {
        throw Object.assign(new Error(`duplicate key value (${SECRET_EMAIL})`), { code: "23505", constraint_name: "users_email_uq" });
      },
    };
    const fresh = await pgliteRunner();
    const res = await runImport(fakeSource(docs), { ...fresh, transaction: failing.transaction }, { ...baseOpts, apply: true, only: ["users"] });
    const text = formatReport(res, true);
    expect(text).toContain("23505");
    expect(text).not.toContain(SECRET_EMAIL);
  });
});
