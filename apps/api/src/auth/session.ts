import crypto from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, users, type Db } from "@agent-hub/db";

export function createSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getSessionExpiresAt(ttlDays: number): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + ttlDays);
  return expiresAt;
}

export async function createSession(
  db: Db,
  input: { userId: string; ttlDays: number },
) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = getSessionExpiresAt(input.ttlDays);

  const [session] = await db
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash,
      expiresAt,
    })
    .returning();

  return {
    session,
    token,
  };
}

export async function getUserBySessionToken(db: Db, token: string) {
  const tokenHash = hashSessionToken(token);
  const now = new Date();

  const [result] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, now),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);

  return result ?? null;
}

export async function revokeSession(db: Db, token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);

  await db
    .update(sessions)
    .set({
      revokedAt: new Date(),
    })
    .where(eq(sessions.tokenHash, tokenHash));
}

