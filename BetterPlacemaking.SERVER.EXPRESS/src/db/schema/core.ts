import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const id = () => text("id").primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const textArray = (name: string) => text(name).array().notNull().default(sql`'{}'::text[]`);

/** Legacy `users` (PascalCase fields in the API; snake_case here). */
export const users = pgTable(
  "users",
  {
    id: id(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    email: text("email"),
    password: text("password"),
    role: text("role"),
    emailAlerts: boolean("email_alerts"),
    emailVerified: boolean("email_verified").notNull().default(false),
    emailVerificationToken: text("email_verification_token"),
    passwordResetToken: text("password_reset_token"),
    passwordResetTokenExpiry: ts("password_reset_token_expiry"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    index("users_email_verification_token_idx").on(t.emailVerificationToken),
  ],
);

/** Legacy `refreshTokens`. */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    createdAtUtc: ts("created_at_utc").notNull().defaultNow(),
    expiresAtUtc: ts("expires_at_utc").notNull(),
    revokedAtUtc: ts("revoked_at_utc"),
    replacedByTokenId: text("replaced_by_token_id"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("refresh_tokens_token_hash_uq").on(t.tokenHash),
    index("refresh_tokens_user_id_idx").on(t.userId),
  ],
);

/** Legacy `role_definitions_global`; doc id = role name. */
export const roleDefinitionsGlobal = pgTable("role_definitions_global", {
  name: text("name").primaryKey(),
  permissions: textArray("permissions"),
  isSystem: boolean("is_system").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Legacy `role_definitions_project`; doc id = role name. */
export const roleDefinitionsProject = pgTable("role_definitions_project", {
  name: text("name").primaryKey(),
  permissions: textArray("permissions"),
  isSystem: boolean("is_system").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Legacy `user_global_roles`; doc id = user id, `roles` = array of role names. */
export const userGlobalRoles = pgTable("user_global_roles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  roles: textArray("roles"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Legacy `projects`. */
export const projects = pgTable("projects", {
  id: id(),
  title: text("title"),
  description: text("description"),
  location: text("location"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Legacy `projects/{id}/members/{userId}`; one row per (project, user). */
export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roles: textArray("roles"),
    authzVersion: integer("authz_version").notNull().default(0),
    notifyOnOwnScan: boolean("notify_on_own_scan").notNull().default(false),
    notifyOnOthersScan: boolean("notify_on_others_scan").notNull().default(false),
    notifyOnScheduledScan: boolean("notify_on_scheduled_scan").notNull().default(false),
    notifyOnSystemToggle: boolean("notify_on_system_toggle").notNull().default(false),
    notifyOnHealthAlert: boolean("notify_on_health_alert").notNull().default(false),
    emailPdfOnSystemOff: boolean("email_pdf_on_system_off").notNull().default(false),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("project_members_project_user_uq").on(t.projectId, t.userId),
    index("project_members_user_id_idx").on(t.userId),
  ],
);
