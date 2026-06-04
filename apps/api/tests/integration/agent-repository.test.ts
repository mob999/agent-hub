import { randomUUID } from "node:crypto";

import {
  agentRuntimeBindings,
  agents,
  agentWorkspaces,
  conversations,
  createDb,
  daemonDevices,
  sessions,
  users,
} from "@agent-hub/db";
import {
  ensureDirectConversation,
  updateAgentProfileForUser,
} from "@agent-hub/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDbIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeDb = runDbIntegrationTests ? describe : describe.skip;

describeDb("agent repository integration", () => {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const db = createDb(databaseUrl);
  const userIds: string[] = [];
  const agentIds: string[] = [];
  const daemonDeviceIds: string[] = [];
  const conversationIds: string[] = [];

  beforeAll(() => {
    if (databaseUrl.length === 0) {
      throw new Error(
        "RUN_DB_INTEGRATION_TESTS=true requires TEST_DATABASE_URL or DATABASE_URL.",
      );
    }
  });

  afterAll(async () => {
    if (conversationIds.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, conversationIds));
    }

    if (agentIds.length > 0) {
      await db.delete(agents).where(inArray(agents.id, agentIds));
    }

    if (daemonDeviceIds.length > 0) {
      await db
        .delete(daemonDevices)
        .where(inArray(daemonDevices.id, daemonDeviceIds));
    }

    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it("updates an agent profile and its direct conversation title", async () => {
    const now = new Date("2026-05-26T00:00:00.000Z");
    const [user] = await db
      .insert(users)
      .values({
        email: `agent-update-${randomUUID()}@example.com`,
        passwordHash: "test-password-hash",
      })
      .returning({ id: users.id });
    const daemonDeviceId = `local-${randomUUID()}`;
    const agentId = randomUUID();

    userIds.push(user.id);
    daemonDeviceIds.push(daemonDeviceId);
    agentIds.push(agentId);

    await db.insert(daemonDevices).values({
      id: daemonDeviceId,
      name: daemonDeviceId,
      status: "online",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(agents).values({
      id: agentId,
      ownerUserId: user.id,
      name: "Old agent",
      defaultRuntimeKind: "codex",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(agentRuntimeBindings).values({
      agentId,
      daemonDeviceId,
      runtimeKind: "codex",
      capabilities: [],
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(agentWorkspaces).values({
      agentId,
      daemonDeviceId,
      workspacePath: "/workspace",
      status: "ready",
      syncMode: "local-only",
      createdAt: now,
      updatedAt: now,
    });

    const directConversation = await ensureDirectConversation(db, {
      ownerUserId: user.id,
      agentId,
    });

    expect(directConversation).not.toBeNull();
    if (directConversation === null) {
      return;
    }
    conversationIds.push(directConversation.id);

    const updated = await updateAgentProfileForUser(db, {
      ownerUserId: user.id,
      agentId,
      name: "Jojo",
      description: "Frontend tasks",
    });
    const [directConversationRow] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, directConversation.id))
      .limit(1);

    expect(updated?.agent.name).toBe("Jojo");
    expect(updated?.agent.description).toBe("Frontend tasks");
    expect(directConversationRow?.title).toBe("Jojo");
  });
});
