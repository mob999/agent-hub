import { adminUsers, oauthAccounts, sessions, users, type Db } from "@agent-hub/db";
import { and, count, desc, eq, ilike, isNull, max, or, sql } from "drizzle-orm";

export type AdminUserRole = "admin";

export interface AdminPrincipal {
  email: string;
  id: string;
  role: AdminUserRole;
}

export interface AdminManagedUser {
  avatar: string | null;
  createdAt: string;
  email: string;
  id: string;
  name: string | null;
  oauthProviderCount: number;
  sessionCount: number;
  updatedAt: string;
  welcomeOnboardingCompletedAt: string | null;
}

export interface AdminManagedUserDetail extends AdminManagedUser {
  lastSessionCreatedAt: string | null;
  oauthProviders: string[];
}

export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseAdminEmails(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map(normalizeAdminEmail)
        .filter((email) => email.length > 0),
    ),
  );
}

export async function seedAdminUsersFromEnv(
  db: Db,
  input: { emails: string },
): Promise<number> {
  const emails = parseAdminEmails(input.emails);
  const now = new Date();

  await Promise.all(
    emails.map((email) =>
      db
        .insert(adminUsers)
        .values({
          email,
          role: "admin",
          source: "env",
          createdAt: now,
          updatedAt: now,
          revokedAt: null,
        })
        .onConflictDoUpdate({
          target: adminUsers.email,
          set: {
            role: "admin",
            source: "env",
            updatedAt: now,
            revokedAt: null,
          },
        }),
    ),
  );

  return emails.length;
}

export async function getAdminPrincipalByEmail(
  db: Db,
  email: string,
): Promise<AdminPrincipal | null> {
  const normalizedEmail = normalizeAdminEmail(email);
  const [admin] = await db
    .select({
      email: adminUsers.email,
      id: adminUsers.id,
      role: adminUsers.role,
    })
    .from(adminUsers)
    .where(and(eq(adminUsers.email, normalizedEmail), isNull(adminUsers.revokedAt)))
    .limit(1);

  if (admin === undefined || admin.role !== "admin") {
    return null;
  }

  return {
    email: admin.email,
    id: admin.id,
    role: "admin",
  };
}

function mapManagedUser(row: {
  avatar: string | null;
  createdAt: Date;
  email: string;
  id: string;
  name: string | null;
  oauthProviderCount: number;
  sessionCount: number;
  updatedAt: Date;
  welcomeOnboardingCompletedAt: Date | null;
}): AdminManagedUser {
  return {
    avatar: row.avatar,
    createdAt: row.createdAt.toISOString(),
    email: row.email,
    id: row.id,
    name: row.name,
    oauthProviderCount: row.oauthProviderCount,
    sessionCount: row.sessionCount,
    updatedAt: row.updatedAt.toISOString(),
    welcomeOnboardingCompletedAt: row.welcomeOnboardingCompletedAt?.toISOString() ?? null,
  };
}

export async function listManagedUsers(
  db: Db,
  input: {
    limit: number;
    offset: number;
    search?: string;
  },
): Promise<{ total: number; users: AdminManagedUser[] }> {
  const search = input.search?.trim();
  const where = search === undefined || search.length === 0
    ? undefined
    : or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`));

  const [totalRow] = await db
    .select({ total: count() })
    .from(users)
    .where(where);

  const sessionCounts = db
    .select({
      sessionCount: count(sessions.id).as("session_count"),
      userId: sessions.userId,
    })
    .from(sessions)
    .groupBy(sessions.userId)
    .as("session_counts");

  const oauthCounts = db
    .select({
      oauthProviderCount: count(oauthAccounts.id).as("oauth_provider_count"),
      userId: oauthAccounts.userId,
    })
    .from(oauthAccounts)
    .groupBy(oauthAccounts.userId)
    .as("oauth_counts");

  const rows = await db
    .select({
      avatar: users.avatar,
      createdAt: users.createdAt,
      email: users.email,
      id: users.id,
      name: users.name,
      oauthProviderCount: sql<number>`coalesce(${oauthCounts.oauthProviderCount}, 0)`,
      sessionCount: sql<number>`coalesce(${sessionCounts.sessionCount}, 0)`,
      updatedAt: users.updatedAt,
      welcomeOnboardingCompletedAt: users.welcomeOnboardingCompletedAt,
    })
    .from(users)
    .leftJoin(sessionCounts, eq(sessionCounts.userId, users.id))
    .leftJoin(oauthCounts, eq(oauthCounts.userId, users.id))
    .where(where)
    .orderBy(desc(users.createdAt))
    .limit(input.limit)
    .offset(input.offset);

  return {
    total: totalRow?.total ?? 0,
    users: rows.map(mapManagedUser),
  };
}

export async function getManagedUserDetail(
  db: Db,
  input: { userId: string },
): Promise<AdminManagedUserDetail | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (user === undefined) {
    return null;
  }

  const [sessionSummary] = await db
    .select({
      lastSessionCreatedAt: max(sessions.createdAt),
      sessionCount: count(sessions.id),
    })
    .from(sessions)
    .where(eq(sessions.userId, input.userId));

  const providers = await db
    .select({ provider: oauthAccounts.provider })
    .from(oauthAccounts)
    .where(eq(oauthAccounts.userId, input.userId));

  return {
    ...mapManagedUser({
      ...user,
      oauthProviderCount: providers.length,
      sessionCount: sessionSummary?.sessionCount ?? 0,
    }),
    lastSessionCreatedAt:
      sessionSummary?.lastSessionCreatedAt?.toISOString() ?? null,
    oauthProviders: providers.map((provider) => provider.provider),
  };
}
