import { and, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "../db/client.js";
import { projectMembers, projects, users } from "../db/schema/index.js";
import * as userService from "./userService.js";
import type {
  ProjectMemberRoleDto,
  ProjectMemberRoleUpdateDto,
  ProjectRoleAssignmentDto,
  UserProjectRoleAssignmentsDto,
  UserProjectRoleAssignmentsUpdateDto,
} from "../models/types.js";

function normalizeRoles(roles: string[] | undefined): string[] {
  if (!roles) return [];
  const seen = new Map<string, string>();
  for (const role of roles) {
    const trimmed = role?.trim();
    if (trimmed) seen.set(trimmed.toLowerCase(), trimmed);
  }
  return Array.from(seen.values());
}

/** Upserts a member's roles, bumping authzVersion (starts at 1) and leaving notification prefs untouched. */
async function upsertMemberRoles(db: Pick<Db, "insert">, projectId: string, userId: string, roles: string[]) {
  await db
    .insert(projectMembers)
    .values({ projectId, userId, roles, authzVersion: 1 })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: {
        roles,
        authzVersion: sql`${projectMembers.authzVersion} + 1`,
        updatedAt: new Date(),
      },
    });
}

/** All users, each with their role assignments across every project. Mirrors UserService.GetProjectRoleAssignments. */
export async function getProjectRoleAssignments(): Promise<UserProjectRoleAssignmentsDto[]> {
  const db = getDb();
  const allUsers = await userService.getUsers();
  const rows = await db
    .select({ member: projectMembers, title: projects.title })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId));

  const assignmentsByUser = new Map<string, ProjectRoleAssignmentDto[]>();

  for (const { member, title } of rows) {
    const roles = normalizeRoles(member.roles);
    if (roles.length === 0) continue;

    const list = assignmentsByUser.get(member.userId) ?? [];
    list.push({
      ProjectId: member.projectId,
      ProjectName: title ?? undefined,
      Roles: roles,
      NotifyOnOwnScan: member.notifyOnOwnScan,
      NotifyOnOthersScan: member.notifyOnOthersScan,
      NotifyOnScheduledScan: member.notifyOnScheduledScan,
      NotifyOnSystemToggle: member.notifyOnSystemToggle,
      NotifyOnHealthAlert: member.notifyOnHealthAlert,
      EmailPdfOnSystemOff: member.emailPdfOnSystemOff,
    });
    assignmentsByUser.set(member.userId, list);
  }

  return allUsers.map((user) => ({
    UserId: user.Id,
    FirstName: user.FirstName ?? undefined,
    LastName: user.LastName ?? undefined,
    Email: user.Email ?? undefined,
    Assignments: assignmentsByUser.get(user.Id) ?? [],
  }));
}

/** Overwrites one user's role assignments across the projects listed in the request. */
export async function setUserProjectRoleAssignments(request: UserProjectRoleAssignmentsUpdateDto): Promise<boolean> {
  if (!request.UserId) return false;
  const userId = request.UserId;
  const db = getDb();

  const user = await userService.getUserById(userId);
  if (!user) return false;

  await db.transaction(async (tx) => {
    for (const assignment of request.Assignments) {
      if (!assignment.ProjectId) continue;

      const roles = normalizeRoles(assignment.Roles);
      if (roles.length === 0) {
        await tx
          .delete(projectMembers)
          .where(and(eq(projectMembers.projectId, assignment.ProjectId), eq(projectMembers.userId, userId)));
        continue;
      }

      await upsertMemberRoles(tx, assignment.ProjectId, userId, roles);
    }
  });

  return true;
}

/** Members of one project with their (single, display-only) role. Mirrors UserService.GetProjectMemberRoles. */
export async function getProjectMemberRoles(projectId: string): Promise<ProjectMemberRoleDto[]> {
  const rows = await getDb()
    .select({ member: projectMembers, user: users })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId));

  const results: ProjectMemberRoleDto[] = [];
  for (const { member, user } of rows) {
    const role = member.roles.find((r) => r?.trim())?.trim();
    if (!role) continue;

    results.push({
      UserId: member.userId,
      FirstName: user.firstName ?? undefined,
      LastName: user.lastName ?? undefined,
      Email: user.email ?? undefined,
      Role: role,
    });
  }

  return results.sort((a, b) => {
    return (
      (a.FirstName ?? "").localeCompare(b.FirstName ?? "") ||
      (a.LastName ?? "").localeCompare(b.LastName ?? "") ||
      (a.Email ?? "").localeCompare(b.Email ?? "")
    );
  });
}

export async function setProjectMemberRole(projectId: string, request: ProjectMemberRoleUpdateDto): Promise<boolean> {
  if (!request.UserId) return false;
  const userId = request.UserId;
  const db = getDb();

  const user = await userService.getUserById(userId);
  if (!user) return false;

  const normalizedRole = request.Role?.trim();

  if (!normalizedRole) {
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return true;
  }

  await upsertMemberRoles(db, projectId, userId, [normalizedRole]);
  return true;
}

export interface NotificationPrefsUpdate {
  NotifyOnOwnScan: boolean;
  NotifyOnOthersScan: boolean;
  NotifyOnScheduledScan: boolean;
  NotifyOnSystemToggle: boolean;
  NotifyOnHealthAlert: boolean;
  EmailPdfOnSystemOff: boolean;
}

export async function updateProjectNotificationPrefs(
  userId: string,
  projectId: string,
  prefs: NotificationPrefsUpdate,
): Promise<boolean> {
  const rows = await getDb()
    .update(projectMembers)
    .set({
      notifyOnOwnScan: prefs.NotifyOnOwnScan,
      notifyOnOthersScan: prefs.NotifyOnOthersScan,
      notifyOnScheduledScan: prefs.NotifyOnScheduledScan,
      notifyOnSystemToggle: prefs.NotifyOnSystemToggle,
      notifyOnHealthAlert: prefs.NotifyOnHealthAlert,
      emailPdfOnSystemOff: prefs.EmailPdfOnSystemOff,
    })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .returning({ userId: projectMembers.userId });
  return rows.length > 0;
}
