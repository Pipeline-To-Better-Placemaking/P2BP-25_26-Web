import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema/index.js";
import type { User, UserDoc, UserSettingsDto } from "../models/types.js";

const BCRYPT_ROUNDS = 10;

type UserRow = typeof users.$inferSelect;

function toUser(row: UserRow): User {
  return {
    Id: row.id,
    FirstName: row.firstName,
    LastName: row.lastName,
    Email: row.email,
    Password: row.password,
    Role: row.role,
    EmailAlerts: row.emailAlerts,
    EmailVerified: row.emailVerified,
    EmailVerificationToken: row.emailVerificationToken,
    PasswordResetToken: row.passwordResetToken,
    PasswordResetTokenExpiry: row.passwordResetTokenExpiry,
  };
}

/** Maps API-cased fields to column values (full set: omitted fields become null / default). */
function toRowValues(doc: UserDoc) {
  return {
    firstName: doc.FirstName ?? null,
    lastName: doc.LastName ?? null,
    email: doc.Email ?? null,
    password: doc.Password ?? null,
    role: doc.Role ?? null,
    emailAlerts: doc.EmailAlerts ?? null,
    emailVerified: doc.EmailVerified ?? false,
    emailVerificationToken: doc.EmailVerificationToken ?? null,
    passwordResetToken: doc.PasswordResetToken ?? null,
    passwordResetTokenExpiry: doc.PasswordResetTokenExpiry ?? null,
  };
}

export async function getUsers(): Promise<User[]> {
  const rows = await getDb().select().from(users);
  return rows.map(toUser);
}

export async function getUserById(id: string): Promise<User | null> {
  const [row] = await getDb().select().from(users).where(eq(users.id, id)).limit(1);
  return row ? toUser(row) : null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [row] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  return row ? toUser(row) : null;
}

export interface RegisterInput {
  FirstName?: string;
  LastName?: string;
  Email: string;
  Password: string;
}

/** Returns null if the email is already registered. */
export async function addUser(input: RegisterInput): Promise<User | null> {
  const existing = await getUserByEmail(input.Email);
  if (existing) return null;

  const hashedPassword = await bcrypt.hash(input.Password, BCRYPT_ROUNDS);
  const emailVerificationToken = crypto.randomUUID();

  const [row] = await getDb()
    .insert(users)
    .values({
      firstName: input.FirstName ?? null,
      lastName: input.LastName ?? null,
      email: input.Email,
      password: hashedPassword,
      role: "User",
      emailVerified: false,
      emailVerificationToken,
    })
    .returning();

  return toUser(row);
}

/** Full-document overwrite, matching the ASP.NET server's SetAsync-based update. */
export async function updateUser(id: string, data: UserDoc): Promise<boolean> {
  const rows = await getDb().update(users).set(toRowValues(data)).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
}

export async function deleteUser(id: string): Promise<boolean> {
  const rows = await getDb().delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
}

export async function updatePassword(id: string, hashedPassword: string): Promise<void> {
  await getDb().update(users).set({ password: hashedPassword }).where(eq(users.id, id));
}

export async function markEmailVerified(id: string): Promise<void> {
  await getDb().update(users).set({ emailVerified: true, emailVerificationToken: null }).where(eq(users.id, id));
}

export async function getUserByVerificationToken(token: string): Promise<User | null> {
  const [row] = await getDb().select().from(users).where(eq(users.emailVerificationToken, token)).limit(1);
  return row ? toUser(row) : null;
}

export class SettingsValidationError extends Error {}

/** Mirrors UserService.UserSettings: trims names, enforces a 50-char max, no-op if nothing changed. */
export async function updateUserSettings(id: string, settings: UserSettingsDto): Promise<void> {
  const patch: Partial<typeof users.$inferInsert> = {};

  if (settings.FirstName != null) {
    const first = settings.FirstName.trim();
    if (first.length > 50) throw new SettingsValidationError("FirstName must be <= 50 characters.");
    if (first.length > 0) patch.firstName = first;
  }

  if (settings.LastName != null) {
    const last = settings.LastName.trim();
    if (last.length > 50) throw new SettingsValidationError("LastName must be <= 50 characters.");
    patch.lastName = last;
  }

  if (settings.EmailAlerts !== undefined) patch.emailAlerts = settings.EmailAlerts;

  if (Object.keys(patch).length === 0) return;

  await getDb().update(users).set(patch).where(eq(users.id, id));
}

export function toPublicSettings(user: User): UserSettingsDto {
  return {
    FirstName: user.FirstName ?? undefined,
    LastName: user.LastName ?? undefined,
    EmailAlerts: user.EmailAlerts ?? undefined,
  };
}
