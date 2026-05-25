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
  createUserMessageAndRun,
  ensureDefaultGroupConversation,
  ensureDirectConversation,
  listConversationMessagesForUser,
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
});
