/**
 * API document shapes (backed by Postgres tables). Field casing is preserved exactly as the ASP.NET
 * server wrote it (PascalCase for `users`/`refreshTokens`, camelCase for the
 * role/permission collections) since both servers point at the same database
 * during the phased migration.
 */

export interface UserDoc {
  FirstName?: string | null;
  LastName?: string | null;
  EmailAlerts?: boolean | null;
  Email?: string | null;
  Password?: string | null;
  Role?: string | null;
  EmailVerified?: boolean;
  EmailVerificationToken?: string | null;
  PasswordResetToken?: string | null;
  PasswordResetTokenExpiry?: Date | null;
}

export interface User extends UserDoc {
  Id: string;
}

/** User shape safe to return to clients - never includes Password/Role/tokens. */
export interface PublicUser {
  Id: string;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
  EmailAlerts?: boolean | null;
}

export function toPublicUser(user: User): PublicUser {
  return {
    Id: user.Id,
    FirstName: user.FirstName ?? null,
    LastName: user.LastName ?? null,
    Email: user.Email ?? null,
    EmailAlerts: user.EmailAlerts ?? null,
  };
}

export interface RefreshTokenRecord {
  Id: string;
  UserId?: string | null;
  TokenHash?: string | null;
  CreatedAtUtc: Date;
  ExpiresAtUtc: Date;
  RevokedAtUtc?: Date | null;
  ReplacedByTokenId?: string | null;
  UserAgent?: string | null;
}

export interface LoginResponse {
  Success: boolean;
  Message?: string;
  User?: PublicUser;
  Token?: string;
  ExpiresAtUtc?: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}

export interface UserSettingsDto {
  FirstName?: string;
  LastName?: string;
  EmailAlerts?: boolean;
}

export interface ProjectRoleAssignmentDto {
  ProjectId?: string;
  ProjectName?: string;
  Roles: string[];
  NotifyOnOwnScan?: boolean;
  NotifyOnOthersScan?: boolean;
  NotifyOnScheduledScan?: boolean;
  NotifyOnSystemToggle?: boolean;
  NotifyOnHealthAlert?: boolean;
  EmailPdfOnSystemOff?: boolean;
}

export interface UserProjectRoleAssignmentsDto {
  UserId?: string;
  FirstName?: string;
  LastName?: string;
  Email?: string;
  Assignments: ProjectRoleAssignmentDto[];
}

export interface UserProjectRoleAssignmentsUpdateDto {
  UserId?: string;
  Assignments: ProjectRoleAssignmentDto[];
}

export interface ProjectMemberRoleDto {
  UserId?: string;
  FirstName?: string;
  LastName?: string;
  Email?: string;
  Role?: string;
}

export interface ProjectMemberRoleUpdateDto {
  UserId?: string;
  Role?: string;
}

export interface JwtClaims {
  sub: string;
  email?: string;
  role?: string;
  name?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtClaims;
    }
  }
}
