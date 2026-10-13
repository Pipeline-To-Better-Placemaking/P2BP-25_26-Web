import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { refreshTokens } from "../db/schema/index.js";
import { env, refreshTokenHashKey } from "../config/env.js";
import type { RefreshTokenRecord } from "../models/types.js";

function generateToken(): string {
  return crypto.randomBytes(64).toString("base64url");
}

function computeTokenHash(token: string): string {
  return crypto.createHmac("sha256", refreshTokenHashKey()).update(token).digest("base64");
}

function expiryFrom(now: Date): Date {
  return new Date(now.getTime() + env.authRefreshTokenDays * 24 * 60 * 60 * 1000);
}

export interface IssuedRefreshToken {
  token: string;
  expiresAtUtc: Date;
  id: string;
}

/** Issues a brand new refresh token (used at login, and as half of rotation). */
export async function issue(userId: string, userAgent: string | undefined): Promise<IssuedRefreshToken> {
  const token = generateToken();
  const now = new Date();
  const expiresAtUtc = expiryFrom(now);

  const [row] = await getDb()
    .insert(refreshTokens)
    .values({
      userId,
      tokenHash: computeTokenHash(token),
      createdAtUtc: now,
      expiresAtUtc,
      userAgent: userAgent ?? null,
    })
    .returning({ id: refreshTokens.id });

  return { token, expiresAtUtc, id: row.id };
}

/** Looks up an active (not revoked, not expired) refresh token record by its raw token value. */
export async function findActive(token: string): Promise<RefreshTokenRecord | null> {
  const hash = computeTokenHash(token);
  const [row] = await getDb().select().from(refreshTokens).where(eq(refreshTokens.tokenHash, hash)).limit(1);
  if (!row) return null;
  if (row.revokedAtUtc) return null;
  if (row.expiresAtUtc.getTime() <= Date.now()) return null;

  return {
    Id: row.id,
    UserId: row.userId,
    TokenHash: row.tokenHash,
    CreatedAtUtc: row.createdAtUtc,
    ExpiresAtUtc: row.expiresAtUtc,
    RevokedAtUtc: row.revokedAtUtc,
    ReplacedByTokenId: row.replacedByTokenId,
    UserAgent: row.userAgent,
  };
}

export async function revoke(tokenId: string, replacedByTokenId?: string): Promise<void> {
  await getDb()
    .update(refreshTokens)
    .set({ revokedAtUtc: new Date(), replacedByTokenId: replacedByTokenId ?? null })
    .where(eq(refreshTokens.id, tokenId));
}

/**
 * Atomically issues a new refresh token and revokes the old one in a single
 * transaction (the ASP.NET server does these as two separate calls;
 * this closes that race window per the migration plan's deviation #4).
 */
export async function rotate(oldRecord: RefreshTokenRecord, userAgent: string | undefined): Promise<IssuedRefreshToken> {
  const token = generateToken();
  const now = new Date();
  const expiresAtUtc = expiryFrom(now);

  const id = await getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(refreshTokens)
      .values({
        userId: oldRecord.UserId ?? null,
        tokenHash: computeTokenHash(token),
        createdAtUtc: now,
        expiresAtUtc,
        userAgent: userAgent ?? null,
      })
      .returning({ id: refreshTokens.id });
    await tx
      .update(refreshTokens)
      .set({ revokedAtUtc: now, replacedByTokenId: row.id })
      .where(eq(refreshTokens.id, oldRecord.Id));
    return row.id;
  });

  return { token, expiresAtUtc, id };
}
