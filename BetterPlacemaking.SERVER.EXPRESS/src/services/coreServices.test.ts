import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setDbForTesting, type Db } from "../db/client.js";
import { roleDefinitionsGlobal, roleDefinitionsProject, userGlobalRoles, users } from "../db/schema/index.js";
import { createTestDb } from "../test/db.js";
import { seedRoles } from "../authorization/roleSeeder.js";
import * as authz from "../authorization/authorizationService.js";
import * as userService from "./userService.js";
import * as roleAssignmentService from "./roleAssignmentService.js";
import * as refreshTokenService from "./refreshTokenService.js";
import * as projectService from "./projectService.js";
import * as adminService from "./adminService.js";
import * as passwordService from "./passwordService.js";
import * as emailService from "./emailService.js";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(() => setDbForTesting(null));

describe("seedRoles", () => {
  it("is idempotent and respects is_system = false", async () => {
    await seedRoles();
    await seedRoles();
    expect(await db.select().from(roleDefinitionsGlobal)).toHaveLength(2);
    expect(await db.select().from(roleDefinitionsProject)).toHaveLength(4);

    await db.update(roleDefinitionsProject).set({ isSystem: false, permissions: ["x"] }).where(eq(roleDefinitionsProject.name, "ProjectViewer"));
    await seedRoles();
    const [row] = await db.select().from(roleDefinitionsProject).where(eq(roleDefinitionsProject.name, "ProjectViewer"));
    expect(row.permissions).toEqual(["x"]);
    expect(row.isSystem).toBe(false);
    expect(await authz.getProjectRoleOptions()).toContain("ProjectOwner");
  });
});

describe("users, roles and membership", () => {
  it("adds, finds, updates and deletes users", async () => {
    const u = await userService.addUser({ Email: "a@x.com", Password: "password1", FirstName: "A" });
    expect(u?.EmailVerified).toBe(false);
    expect(await userService.addUser({ Email: "a@x.com", Password: "password1" })).toBeNull();
    expect((await userService.getUserByEmail("a@x.com"))?.Id).toBe(u!.Id);
    expect((await userService.getUserByVerificationToken(u!.EmailVerificationToken!))?.Id).toBe(u!.Id);

    await userService.markEmailVerified(u!.Id);
    expect((await userService.getUserById(u!.Id))?.EmailVerified).toBe(true);

    await userService.updateUserSettings(u!.Id, { LastName: " L ", EmailAlerts: true });
    const after = await userService.getUserById(u!.Id);
    expect(after?.LastName).toBe("L");
    expect(after?.EmailAlerts).toBe(true);
    await expect(userService.updateUserSettings(u!.Id, { FirstName: "x".repeat(51) })).rejects.toThrow();

    expect(await userService.deleteUser(u!.Id)).toBe(true);
    expect(await userService.deleteUser(u!.Id)).toBe(false);
  });

  it("assigns project roles, bumps authzVersion, and resolves permissions", async () => {
    const u = (await userService.addUser({ Email: "b@x.com", Password: "password1" }))!;
    const p = await projectService.create({ Title: "P" }, u.Id);

    expect(await authz.hasProjectPermission(u.Id, undefined, p.Id, "Project.Read")).toBe(true);
    expect(await authz.hasProjectPermission("nobody", undefined, p.Id, "Project.Read")).toBe(false);

    expect(await roleAssignmentService.setProjectMemberRole(p.Id, { UserId: u.Id, Role: "ProjectViewer" })).toBe(true);
    const all = await roleAssignmentService.getProjectRoleAssignments();
    const mine = all.find((a) => a.UserId === u.Id)!;
    expect(mine.Assignments[0]).toMatchObject({ ProjectId: p.Id, ProjectName: "P", Roles: ["ProjectViewer"] });
    expect((await roleAssignmentService.getProjectMemberRoles(p.Id)).map((m) => m.Role)).toEqual(["ProjectViewer"]);

    expect(
      await roleAssignmentService.updateProjectNotificationPrefs(u.Id, p.Id, {
        NotifyOnOwnScan: true, NotifyOnOthersScan: false, NotifyOnScheduledScan: false,
        NotifyOnSystemToggle: false, NotifyOnHealthAlert: false, EmailPdfOnSystemOff: false,
      }),
    ).toBe(true);
    expect(await roleAssignmentService.setUserProjectRoleAssignments({ UserId: u.Id, Assignments: [{ ProjectId: p.Id, Roles: [] }] })).toBe(true);
    expect(await roleAssignmentService.getProjectMemberRoles(p.Id)).toHaveLength(0);
    expect(await roleAssignmentService.setProjectMemberRole(p.Id, { UserId: "ghost", Role: "x" })).toBe(false);

    await db.insert(userGlobalRoles).values({ userId: u.Id, roles: ["Admin"] });
    authz._clearGlobalPermissionCache();
    expect((await authz.getEffectiveGlobalPermissions(u.Id)).length).toBeGreaterThan(0);

    expect(await adminService.updateRole("b@x.com", "Moderator")).toBe(true);
    expect((await userService.getUserById(u.Id))?.Role).toBe("Moderator");
    expect(await adminService.updateRole("missing@x.com", "x")).toBe(false);
  });
});

describe("refreshTokenService", () => {
  it("issues, rotates atomically, and revokes", async () => {
    const u = (await userService.addUser({ Email: "c@x.com", Password: "password1" }))!;
    const first = await refreshTokenService.issue(u.Id, "ua");
    const rec = (await refreshTokenService.findActive(first.token))!;
    expect(rec.UserId).toBe(u.Id);

    const next = await refreshTokenService.rotate(rec, "ua2");
    expect(await refreshTokenService.findActive(first.token)).toBeNull();
    const nextRec = (await refreshTokenService.findActive(next.token))!;
    expect(nextRec.Id).toBe(next.id);

    await refreshTokenService.revoke(nextRec.Id);
    expect(await refreshTokenService.findActive(next.token)).toBeNull();
  });
});

describe("passwordService", () => {
  it("resets and changes passwords", async () => {
    const send = vi.spyOn(emailService, "sendPasswordResetEmail").mockResolvedValue(undefined as never);
    const u = (await userService.addUser({ Email: "d@x.com", Password: "password1" }))!;
    expect(await passwordService.requestPasswordReset("d@x.com")).toBe(true);
    const token = send.mock.calls[0][1] as string;

    expect(await passwordService.resetPassword("bad-token", "newpassword1")).toBe(false);
    expect(await passwordService.resetPassword(token, "newpassword1")).toBe(true);
    expect(await passwordService.resetPassword(token, "newpassword1")).toBe(false);

    expect(await passwordService.changePassword(u.Id, "wrong", "another-pass1")).toBe(false);
    expect(await passwordService.changePassword(u.Id, "newpassword1", "another-pass1")).toBe(true);
    const [row] = await db.select().from(users).where(eq(users.id, u.Id));
    expect(row.passwordResetToken).toBeNull();
  });
});
