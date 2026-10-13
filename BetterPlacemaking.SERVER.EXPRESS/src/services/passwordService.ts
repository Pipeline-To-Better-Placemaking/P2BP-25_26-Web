import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema/index.js";
import * as userService from "./userService.js";
import * as emailService from "./emailService.js";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 10;

export async function requestPasswordReset(email: string): Promise<boolean> {
  const user = await userService.getUserByEmail(email);
  if (!user) return false;

  const token = crypto.randomUUID();
  const expiry = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await getDb()
    .update(users)
    .set({ passwordResetToken: token, passwordResetTokenExpiry: expiry })
    .where(eq(users.id, user.Id));

  await emailService.sendPasswordResetEmail(email, token);
  return true;
}

export class ValidationError extends Error {}

export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select().from(users).where(eq(users.passwordResetToken, token)).limit(1);
  if (!row) return false;

  const expiry = row.passwordResetTokenExpiry;
  if (!expiry || expiry.getTime() < Date.now()) return false;

  // Deviation from the ASP.NET server: it didn't enforce a minimum length here even
  // though changePassword does. Enforcing the same rule for consistency (see plan).
  if (!newPassword || newPassword.trim().length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await db
    .update(users)
    .set({ password: hashedPassword, passwordResetToken: null, passwordResetTokenExpiry: null })
    .where(eq(users.id, row.id));
  return true;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
  if (!currentPassword || !newPassword) {
    throw new ValidationError("Current and new password are required.");
  }
  if (newPassword.trim().length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const user = await userService.getUserById(userId);
  if (!user || !user.Password) {
    throw new ValidationError("User not found.");
  }

  const matches = await bcrypt.compare(currentPassword, user.Password);
  if (!matches) return false;

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userService.updatePassword(userId, hashedPassword);
  return true;
}
