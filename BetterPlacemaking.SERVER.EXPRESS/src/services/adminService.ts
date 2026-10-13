import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema/index.js";
import * as userService from "./userService.js";

export async function updateRole(targetEmail: string, newRole: string): Promise<boolean> {
  const user = await userService.getUserByEmail(targetEmail);
  if (!user) return false;

  if (user.Role === "Admin") return false; // legacy rule: Admins can't be role-changed via this endpoint
  if (user.Role === newRole) return true;

  await getDb().update(users).set({ role: newRole }).where(eq(users.id, user.Id));
  return true;
}
