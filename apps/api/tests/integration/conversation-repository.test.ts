import { randomUUID } from "node:crypto";

import type { RunEvent } from "@agent-hub/core";
import {
  agents,
  conversationMessages,
  conversations,
  createDb,
  runEvents,
  runs,
  sessions,
  users,
} from "@agent-hub/db";
import type { RunQueueJob } from "@agent-hub/server";
import {
  appendRunEvent,
  archiveGroupConversationForUser,
  createGroupConversation,
  createUserMessageAndRun,
  createUserMessageAndRuns,
  ensureDefaultGroupConversation,
  ensureDirectConversation,
  getConversationForUser,
  listConversationMessagesForUser,
  listActiveAgentGroupContexts,
  listConversationsForUser,
  updateGroupConversation,
} from "@agent-hub/server";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const runDbIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === "true";
const describeDb = runDbIntegrationTests ? describe : describe.skip;

function createJob(input: { agentId: string; conversationId: string }): RunQueueJob {
  const now = "2026-05-26T00:00:00.000Z";

  return {
    conversationId: input.conversationId,
    daemonDeviceId: "local-dev",
    prompt: "hello agent",
    workspacePath: "/workspace",
    run: {
      id: randomUUID(),
      agentId: input.agentId,
      daemonDeviceId: "local-dev",
      status: "queued",
      createdAt: now,
      updatedAt: now,
    },
    runtime: {
      runtimeKind: "codex",
      capabilities: [],
      updatedAt: now,
    },
  };
}

describeDb("conversation repository integration", () => {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "";
  const db = createDb(databaseUrl);
  const userIds: string[] = [];
  const agentIds: string[] = [];
  const runIds: string[] = [];
  const conversationIds: string[] = [];

  async function createUser(email: string): Promise<string> {
    const [user] = await db
      .insert(users)
      .values({
        email,
        passwordHash: "test-password-hash",
      })
      .returning({ id: users.id });

    userIds.push(user.id);
    return user.id;
  }

  async function createAgent(ownerUserId: string): Promise<string> {
    const id = randomUUID();
    const now = new Date("2026-05-26T00:00:00.000Z");

    await db.insert(agents).values({
      id,
      ownerUserId,
      name: `Agent ${id.slice(0, 4)}`,
      defaultRuntimeKind: "codex",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    agentIds.push(id);
    return id;
  }

  beforeAll(() => {
    if (databaseUrl.length === 0) {
      throw new Error(
        "RUN_DB_INTEGRATION_TESTS=true requires TEST_DATABASE_URL or DATABASE_URL.",
      );
    }
  });

  afterAll(async () => {
    if (runIds.length > 0) {
      await db.delete(runEvents).where(inArray(runEvents.runId, runIds));
      await db.delete(runs).where(inArray(runs.id, runIds));
    }

    if (conversationIds.length > 0) {
      await db
        .delete(conversationMessages)
        .where(inArray(conversationMessages.conversationId, conversationIds));
      await db
        .delete(conversations)
        .where(inArray(conversations.id, conversationIds));
    }

    if (agentIds.length > 0) {
      await db.delete(agents).where(inArray(agents.id, agentIds));
    }

    if (userIds.length > 0) {
      await db.delete(sessions).where(inArray(sessions.userId, userIds));
      await db.delete(users).where(inArray(users.id, userIds));
    }
  });

  it("persists conversations, messages, runs, and streaming assistant content", async () => {
    const ownerUserId = await createUser(
      `conversation-owner-${randomUUID()}@example.com`,
    );
    const otherUserId = await createUser(
      `conversation-other-${randomUUID()}@example.com`,
    );
    const agentId = await createAgent(ownerUserId);

    const defaultConversation = await ensureDefaultGroupConversation(db, {
      ownerUserId,
    });
    const defaultConversationAgain = await ensureDefaultGroupConversation(db, {
      ownerUserId,
    });
    const directConversation = await ensureDirectConversation(db, {
      ownerUserId,
      agentId,
    });
    const directConversationAgain = await ensureDirectConversation(db, {
      ownerUserId,
      agentId,
    });
    const unauthorizedDirectConversation = await ensureDirectConversation(db, {
      ownerUserId: otherUserId,
      agentId,
    });

    conversationIds.push(defaultConversation.id);
    if (directConversation !== null) {
      conversationIds.push(directConversation.id);
    }

    expect(defaultConversationAgain.id).toBe(defaultConversation.id);
    expect(defaultConversation.agentIds).toEqual([agentId]);
    expect(directConversationAgain?.id).toBe(directConversation?.id);
    expect(unauthorizedDirectConversation).toBeNull();

    const job = createJob({
      agentId,
      conversationId: defaultConversation.id,
    });
    runIds.push(job.run.id);

    const created = await createUserMessageAndRun(db, {
      ownerUserId,
      conversationId: defaultConversation.id,
      job,
      userMessageContent: job.prompt,
    });

    expect(created?.messages.user.content).toBe("hello agent");
    expect(created?.messages.assistant.status).toBe("streaming");

    const firstDelta: RunEvent = {
      type: "message.delta",
      runId: job.run.id,
      content: "hi",
      createdAt: "2026-05-26T00:00:01.000Z",
    };
    const secondDelta: RunEvent = {
      type: "message.delta",
      runId: job.run.id,
      content: " there",
      raw: {
        runtimeKind: "codex",
        nativeType: "item.completed",
        payload: {
          type: "item.completed",
          item: {
            id: "item_message_1",
            type: "agent_message",
            text: " there",
          },
        },
      },
      createdAt: "2026-05-26T00:00:02.000Z",
    };
    const completed: RunEvent = {
      type: "run.completed",
      runId: job.run.id,
      status: "succeeded",
      createdAt: "2026-05-26T00:00:03.000Z",
    };

    await appendRunEvent(db, firstDelta);
    await appendRunEvent(db, secondDelta);
    await appendRunEvent(db, completed);

    const messages = await listConversationMessagesForUser(db, {
      ownerUserId,
      conversationId: defaultConversation.id,
    });
    const otherUserMessages = await listConversationMessagesForUser(db, {
      ownerUserId: otherUserId,
      conversationId: defaultConversation.id,
    });

    expect(otherUserMessages).toBeNull();
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({
      senderType: "user",
      content: "hello agent",
      status: "completed",
    });
    expect(messages?.[1]).toMatchObject({
      senderType: "agent",
      runId: job.run.id,
      content: "hi there",
      status: "completed",
    });
  });

  it("creates custom group conversations with scoped agent members", async () => {
    const ownerUserId = await createUser(
      `conversation-group-owner-${randomUUID()}@example.com`,
    );
    const otherUserId = await createUser(
      `conversation-group-other-${randomUUID()}@example.com`,
    );
    const firstAgentId = await createAgent(ownerUserId);
    const secondAgentId = await createAgent(ownerUserId);
    const otherAgentId = await createAgent(otherUserId);

    const group = await createGroupConversation(db, {
      ownerUserId,
      title: "Design Team",
      description: "Design planning",
      agentIds: [firstAgentId, secondAgentId],
    });

    expect(group.status).toBe("created");
    if (group.status !== "created") {
      return;
    }
    conversationIds.push(group.conversation.id);
    expect(group.conversation).toMatchObject({
      type: "group",
      key: "design team",
      title: "Design Team",
      description: "Design planning",
      agentIds: [firstAgentId, secondAgentId],
    });

    const duplicate = await createGroupConversation(db, {
      ownerUserId,
      title: "  design   team  ",
      agentIds: [firstAgentId],
    });
    const reserved = await createGroupConversation(db, {
      ownerUserId,
      title: "all",
      agentIds: [firstAgentId],
    });
    const unauthorizedMember = await createGroupConversation(db, {
      ownerUserId,
      title: "Research",
      agentIds: [otherAgentId],
    });
    const listed = await listConversationsForUser(db, { ownerUserId });
    const fetched = await getConversationForUser(db, {
      ownerUserId,
      conversationId: group.conversation.id,
    });

    expect(duplicate.status).toBe("duplicate-key");
    expect(reserved.status).toBe("reserved-key");
    expect(unauthorizedMember.status).toBe("agents-not-found");
    expect(
      listed.find((conversation) => conversation.id === group.conversation.id)
        ?.description,
    ).toBe("Design planning");
    expect(
      listed.find((conversation) => conversation.id === group.conversation.id)
        ?.agentIds,
    ).toEqual([firstAgentId, secondAgentId]);
    expect(fetched?.description).toBe("Design planning");
    expect(fetched?.agentIds).toEqual([firstAgentId, secondAgentId]);

    const updated = await updateGroupConversation(db, {
      ownerUserId,
      conversationId: group.conversation.id,
      title: "Design Review",
      agentIds: [secondAgentId],
    });

    expect(updated.status).toBe("updated");
    if (updated.status !== "updated") {
      return;
    }
    expect(updated.conversation).toMatchObject({
      type: "group",
      key: "design review",
      title: "Design Review",
      agentIds: [secondAgentId],
    });
    expect(updated.conversation.description).toBeUndefined();

    const fetchedUpdated = await getConversationForUser(db, {
      ownerUserId,
      conversationId: group.conversation.id,
    });

    expect(fetchedUpdated?.agentIds).toEqual([secondAgentId]);
  });

  it("persists group chat MCP send_message calls as agent messages", async () => {
    const ownerUserId = await createUser(
      `conversation-mcp-owner-${randomUUID()}@example.com`,
    );
    const firstAgentId = await createAgent(ownerUserId);
    const secondAgentId = await createAgent(ownerUserId);
    const conversation = await ensureDefaultGroupConversation(db, {
      ownerUserId,
    });
    const firstJob = createJob({
      agentId: firstAgentId,
      conversationId: conversation.id,
    });
    const secondJob = createJob({
      agentId: secondAgentId,
      conversationId: conversation.id,
    });

    conversationIds.push(conversation.id);
    runIds.push(firstJob.run.id, secondJob.run.id);

    const created = await createUserMessageAndRuns(db, {
      ownerUserId,
      conversationId: conversation.id,
      jobs: [firstJob, secondJob],
      userMessageContent: "who wants this?",
    });

    expect(created?.messages.assistants).toEqual([]);

    await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: secondJob.run.id,
      toolCallId: "tool_1",
      name: "send_message",
      input: { content: "I can take it." },
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    await appendRunEvent(db, {
      type: "message.delta",
      runId: secondJob.run.id,
      content: "normal output should stay hidden",
      createdAt: "2026-05-26T00:00:02.000Z",
    });
    await appendRunEvent(db, {
      type: "run.completed",
      runId: secondJob.run.id,
      status: "succeeded",
      createdAt: "2026-05-26T00:00:03.000Z",
    });

    const messages = await listConversationMessagesForUser(db, {
      ownerUserId,
      conversationId: conversation.id,
    });

    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({
      senderType: "user",
      content: "who wants this?",
    });
    expect(messages?.[1]).toMatchObject({
      senderType: "agent",
      senderAgentId: secondAgentId,
      runId: secondJob.run.id,
      content: "I can take it.",
      status: "completed",
    });
  });

  it("persists cross-conversation MCP messages and hides archived groups from context", async () => {
    const ownerUserId = await createUser(
      `conversation-cross-owner-${randomUUID()}@example.com`,
    );
    const agentId = await createAgent(ownerUserId);
    const sourceConversation = await ensureDefaultGroupConversation(db, {
      ownerUserId,
    });
    const activeGroup = await createGroupConversation(db, {
      ownerUserId,
      title: "Design",
      agentIds: [agentId],
    });
    const archivedGroup = await createGroupConversation(db, {
      ownerUserId,
      title: "Archive Me",
      agentIds: [agentId],
    });

    expect(activeGroup.status).toBe("created");
    expect(archivedGroup.status).toBe("created");
    if (activeGroup.status !== "created" || archivedGroup.status !== "created") {
      return;
    }

    conversationIds.push(
      sourceConversation.id,
      activeGroup.conversation.id,
      archivedGroup.conversation.id,
    );

    await archiveGroupConversationForUser(db, {
      ownerUserId,
      conversationId: archivedGroup.conversation.id,
    });

    const job = createJob({
      agentId,
      conversationId: sourceConversation.id,
    });
    runIds.push(job.run.id);

    await createUserMessageAndRuns(db, {
      ownerUserId,
      conversationId: sourceConversation.id,
      jobs: [job],
      userMessageContent: "notify another group",
    });

    const contexts = await listActiveAgentGroupContexts(db, {
      ownerUserId,
      agentId,
    });

    expect(contexts.map((context) => context.groupName).sort()).toEqual([
      "Design",
      "all",
    ]);

    await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: job.run.id,
      toolCallId: "tool_group",
      name: "send_message_to_group",
      input: { groupName: "#Design", content: "Cross-group note." },
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: job.run.id,
      toolCallId: "tool_archived",
      name: "send_message_to_group",
      input: { groupName: "Archive Me", content: "Should not appear." },
      createdAt: "2026-05-26T00:00:02.000Z",
    });
    await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: job.run.id,
      toolCallId: "tool_user",
      name: "send_message_to_user",
      input: { content: "Private note." },
      createdAt: "2026-05-26T00:00:03.000Z",
    });

    const activeGroupMessages = await listConversationMessagesForUser(db, {
      ownerUserId,
      conversationId: activeGroup.conversation.id,
    });
    const archivedGroupMessages = await listConversationMessagesForUser(db, {
      ownerUserId,
      conversationId: archivedGroup.conversation.id,
    });
    const directConversation = await ensureDirectConversation(db, {
      ownerUserId,
      agentId,
    });

    if (directConversation !== null) {
      conversationIds.push(directConversation.id);
    }

    const directMessages = directConversation === null
      ? null
      : await listConversationMessagesForUser(db, {
          ownerUserId,
          conversationId: directConversation.id,
        });

    expect(activeGroupMessages?.map((message) => message.content)).toEqual([
      "Cross-group note.",
    ]);
    expect(archivedGroupMessages).toEqual([]);
    expect(directMessages?.map((message) => message.content)).toEqual([
      "Private note.",
    ]);
  });
});
