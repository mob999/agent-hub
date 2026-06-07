import { randomUUID } from "node:crypto";

import {
  agentRuntimeBindings,
  agents,
  agentWorkspaces,
  conversationGoalTasks,
  conversationGoals,
  conversationMessages,
  conversations,
  createDb,
  daemonDevices,
  daemonRuntimes,
  sessions,
  users,
} from "@agent-hub/db";
import {
  completeWelcomeOnboardingForUser,
  getWelcomeSummaryForUser,
} from "@agent-hub/server";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDbIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeDb = runDbIntegrationTests ? describe : describe.skip;

describeDb("welcome repository integration", () => {
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
      await db
        .delete(agentWorkspaces)
        .where(inArray(agentWorkspaces.agentId, agentIds));
      await db
        .delete(agentRuntimeBindings)
        .where(inArray(agentRuntimeBindings.agentId, agentIds));
      await db.delete(agents).where(inArray(agents.id, agentIds));
    }

    if (daemonDeviceIds.length > 0) {
      await db
        .delete(daemonRuntimes)
        .where(inArray(daemonRuntimes.daemonDeviceId, daemonDeviceIds));
      await db
        .delete(daemonDevices)
        .where(inArray(daemonDevices.id, daemonDeviceIds));
    }

    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  async function createUser(): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        email: `welcome-${randomUUID()}@example.com`,
        passwordHash: "test-password-hash",
      })
      .returning({ id: users.id });

    userIds.push(user.id);
    return user.id;
  }

  async function createReadyDaemon(ownerUserId: string): Promise<string> {
    const daemonDeviceId = `welcome-${randomUUID()}`;

    daemonDeviceIds.push(daemonDeviceId);
    await db.insert(daemonDevices).values({
      id: daemonDeviceId,
      ownerUserId,
      name: "Welcome daemon",
      status: "online",
    });
    await db.insert(daemonRuntimes).values({
      daemonDeviceId,
      runtimeKind: "codex",
      capabilities: [],
      status: "ready",
    });

    return daemonDeviceId;
  }

  async function createReadyAgent(ownerUserId: string, daemonDeviceId: string): Promise<string> {
    const agentId = randomUUID();
    const now = new Date("2026-06-06T00:00:00.000Z");

    agentIds.push(agentId);
    await db.insert(agents).values({
      id: agentId,
      ownerUserId,
      name: "Welcome agent",
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
      workspacePath: "/tmp/welcome",
      status: "ready",
      syncMode: "local-only",
      createdAt: now,
      updatedAt: now,
    });

    return agentId;
  }

  async function createWorkspaceConversation(ownerUserId: string): Promise<string> {
    const now = new Date("2026-06-06T00:00:00.000Z");
    const [conversation] = await db
      .insert(conversations)
      .values({
        ownerUserId,
        type: "group",
        key: `welcome-${randomUUID()}`,
        title: "Welcome group",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: conversations.id });

    conversationIds.push(conversation.id);
    return conversation.id;
  }

  it("tracks prerequisites and refuses completion until the first workspace exists", async () => {
    const userId = await createUser();
    const daemonDeviceId = await createReadyDaemon(userId);
    await createReadyAgent(userId, daemonDeviceId);

    const summary = await getWelcomeSummaryForUser(db, { ownerUserId: userId });
    const incomplete = await completeWelcomeOnboardingForUser(db, {
      ownerUserId: userId,
    });

    expect(summary?.onboarding.prerequisites).toMatchObject({
      hasOnlineDaemon: true,
      hasReadyAgent: true,
      hasReadyRuntime: true,
      hasWorkspaceConversation: false,
    });
    expect(incomplete.status).toBe("not-ready");
  });

  it("completes onboarding once daemon, agent, and a non-default group exist", async () => {
    const userId = await createUser();
    const daemonDeviceId = await createReadyDaemon(userId);
    await createReadyAgent(userId, daemonDeviceId);
    await createWorkspaceConversation(userId);

    const result = await completeWelcomeOnboardingForUser(db, {
      ownerUserId: userId,
    });
    const repeated = await completeWelcomeOnboardingForUser(db, {
      ownerUserId: userId,
    });

    expect(result.status).toBe("completed");
    expect(result.status === "completed" ? result.welcome.onboarding.completed : false).toBe(true);
    expect(repeated.status).toBe("completed");
  });

  it("summarizes recent conversations with latest messages and recent goals", async () => {
    const userId = await createUser();
    const daemonDeviceId = await createReadyDaemon(userId);
    const agentId = await createReadyAgent(userId, daemonDeviceId);
    const groupId = await createWorkspaceConversation(userId);
    const projectId = randomUUID();
    const directId = randomUUID();
    const projectTime = new Date("2026-06-06T00:10:00.000Z");
    const directTime = new Date("2026-06-06T00:20:00.000Z");
    const groupMessageTime = new Date("2026-06-06T00:30:00.000Z");
    const projectGoalId = randomUUID();
    const groupGoalId = randomUUID();

    conversationIds.push(projectId, directId);
    await db.insert(conversations).values([
      {
        id: projectId,
        ownerUserId: userId,
        type: "project",
        title: "Welcome project",
        status: "active",
        createdAt: projectTime,
        updatedAt: projectTime,
        lastMessageAt: projectTime,
      },
      {
        id: directId,
        ownerUserId: userId,
        type: "direct",
        title: "Welcome agent",
        directAgentId: agentId,
        status: "active",
        createdAt: directTime,
        updatedAt: directTime,
        lastMessageAt: directTime,
      },
    ]);
    await db
      .update(conversations)
      .set({
        lastMessageAt: groupMessageTime,
        updatedAt: groupMessageTime,
      })
      .where(inArray(conversations.id, [groupId]));
    await db.insert(conversationMessages).values([
      {
        conversationId: projectId,
        senderType: "user",
        content: "project preview",
        status: "completed",
        createdAt: projectTime,
        updatedAt: projectTime,
      },
      {
        conversationId: directId,
        senderType: "agent",
        senderAgentId: agentId,
        content: "agent preview",
        status: "completed",
        createdAt: directTime,
        updatedAt: directTime,
      },
      {
        conversationId: groupId,
        senderType: "user",
        content: "group preview",
        status: "completed",
        createdAt: groupMessageTime,
        updatedAt: groupMessageTime,
      },
    ]);
    await db.insert(conversationGoals).values([
      {
        id: projectGoalId,
        ownerUserId: userId,
        conversationId: projectId,
        orchestratorAgentId: agentId,
        initialRunId: randomUUID(),
        title: "Project goal",
        status: "active",
        createdAt: projectTime,
        updatedAt: new Date("2026-06-06T00:40:00.000Z"),
      },
      {
        id: groupGoalId,
        ownerUserId: userId,
        conversationId: groupId,
        orchestratorAgentId: agentId,
        initialRunId: randomUUID(),
        title: "Group goal",
        status: "completed",
        createdAt: directTime,
        updatedAt: directTime,
      },
    ]);
    await db.insert(conversationGoalTasks).values([
      {
        id: randomUUID(),
        goalId: projectGoalId,
        index: 0,
        assigneeAgentId: agentId,
        title: "Implement",
        status: "running",
        createdAt: projectTime,
        updatedAt: projectTime,
      },
      {
        id: randomUUID(),
        goalId: projectGoalId,
        index: 1,
        assigneeAgentId: agentId,
        title: "Review",
        status: "waiting",
        createdAt: projectTime,
        updatedAt: projectTime,
      },
    ]);

    const summary = await getWelcomeSummaryForUser(db, {
      ownerUserId: userId,
    });

    expect(summary?.dashboard.conversations.map((item) => item.conversation.id).slice(0, 3))
      .toEqual([groupId, directId, projectId]);
    expect(summary?.dashboard.conversations.find((item) => item.conversation.id === groupId)?.latestMessage?.content)
      .toBe("group preview");
    expect(summary?.dashboard.conversations.find((item) => item.conversation.id === directId)?.latestMessage?.content)
      .toBe("agent preview");
    expect(Object.prototype.hasOwnProperty.call(summary?.dashboard ?? {}, "messages")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(summary?.dashboard ?? {}, "deployments")).toBe(false);
    expect(summary?.dashboard.goals[0]?.goal.id).toBe(projectGoalId);
    expect(summary?.dashboard.goals[0]?.taskCounts).toMatchObject({
      running: 1,
      waiting: 1,
    });
  });
});
