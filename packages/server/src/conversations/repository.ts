import type {
  Conversation,
  ConversationId,
  ConversationMessage,
  RunEvent,
} from "@agent-hub/core";
import {
  agents,
  conversationMessages,
  conversations,
  runEvents,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";

import type { RunQueueJob } from "../queue/index.js";

export const defaultGroupConversationKey = "all";
export const defaultGroupConversationTitle = "all";

type ConversationRow = typeof conversations.$inferSelect;
type ConversationMessageRow = typeof conversationMessages.$inferSelect;

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

export function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    type: row.type as Conversation["type"],
    key: optionalString(row.key),
    title: row.title,
    directAgentId: optionalString(row.directAgentId),
    status: row.status as Conversation["status"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastMessageAt: row.lastMessageAt?.toISOString(),
  };
}

export function toConversationMessage(
  row: ConversationMessageRow,
): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderType: row.senderType as ConversationMessage["senderType"],
    senderAgentId: optionalString(row.senderAgentId),
    runId: optionalString(row.runId),
    content: row.content,
    status: row.status as ConversationMessage["status"],
    error: optionalString(row.error),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function conversationPromptRole(message: ConversationMessage): string {
  if (message.senderType === "user") {
    return "User";
  }

  if (message.senderType === "agent") {
    return "Agent";
  }

  return "System";
}

export function buildConversationRunPrompt(input: {
  currentUserMessage: string;
  messages: ConversationMessage[];
}): string {
  const history = input.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => {
      const role = conversationPromptRole(message);

      return `${role}:\n${message.content.trim()}`;
    });

  if (history.length === 0) {
    return input.currentUserMessage;
  }

  return [
    "<conversation_history>",
    history.join("\n\n"),
    "</conversation_history>",
    "",
    "<user_request>",
    input.currentUserMessage,
    "</user_request>",
  ].join("\n");
}

export async function ensureDefaultGroupConversation(
  db: Db,
  input: { ownerUserId: string },
): Promise<Conversation> {
  const now = new Date();
  const [created] = await db
    .insert(conversations)
    .values({
      ownerUserId: input.ownerUserId,
      type: "group",
      key: defaultGroupConversationKey,
      title: defaultGroupConversationTitle,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [conversations.ownerUserId, conversations.key],
    })
    .returning();

  if (created !== undefined) {
    return toConversation(created);
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.key, defaultGroupConversationKey),
      ),
    )
    .limit(1);

  if (conversation === undefined) {
    throw new Error("Default group conversation was not created.");
  }

  return toConversation(conversation);
}

export async function ensureDirectConversation(
  db: Db,
  input: { ownerUserId: string; agentId: string },
): Promise<Conversation | null> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.id, input.agentId),
        eq(agents.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (agent === undefined) {
    return null;
  }

  const now = new Date();
  const [created] = await db
    .insert(conversations)
    .values({
      ownerUserId: input.ownerUserId,
      type: "direct",
      title: agent.name,
      directAgentId: agent.id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [conversations.ownerUserId, conversations.directAgentId],
    })
    .returning();

  if (created !== undefined) {
    return toConversation(created);
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.directAgentId, input.agentId),
      ),
    )
    .limit(1);

  return conversation === undefined ? null : toConversation(conversation);
}

export async function listConversationsForUser(
  db: Db,
  input: { ownerUserId: string },
): Promise<Conversation[]> {
  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.ownerUserId, input.ownerUserId))
    .orderBy(desc(conversations.updatedAt));

  return rows.map(toConversation);
}

export async function getConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<Conversation | null> {
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  return conversation === undefined ? null : toConversation(conversation);
}

export async function listConversationMessagesForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    limit?: number;
    before?: Date;
  },
): Promise<ConversationMessage[] | null> {
  const conversation = await getConversationForUser(db, input);

  if (conversation === null) {
    return null;
  }

  const conditions = [eq(conversationMessages.conversationId, input.conversationId)];

  if (input.before !== undefined) {
    conditions.push(lt(conversationMessages.createdAt, input.before));
  }

  const rows = await db
    .select()
    .from(conversationMessages)
    .where(and(...conditions))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(input.limit ?? 50);

  return rows.reverse().map(toConversationMessage);
}

export async function createUserMessageAndRun(
  db: Db,
  input: {
    ownerUserId: string;
    conversationId: ConversationId;
    job: RunQueueJob;
    userMessageContent: string;
  },
): Promise<{
  conversation: Conversation;
  messages: {
    user: ConversationMessage;
    assistant: ConversationMessage;
  };
} | null> {
  return db.transaction(async (tx) => {
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.id, input.conversationId),
          eq(conversations.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (conversation === undefined) {
      return null;
    }

    const createdAt = new Date(input.job.run.createdAt);
    const [userMessage] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        senderType: "user",
        content: input.userMessageContent,
        status: "completed",
        createdAt,
        updatedAt: createdAt,
      })
      .returning();

    await tx.insert(runs).values({
      id: input.job.run.id,
      ownerUserId: input.ownerUserId,
      conversationId: input.conversationId,
      agentId: input.job.run.agentId,
      daemonDeviceId: input.job.daemonDeviceId,
      status: input.job.run.status,
      prompt: input.userMessageContent,
      workspacePath: input.job.workspacePath,
      runtime: input.job.runtime,
      createdAt,
      updatedAt: createdAt,
    });

    const queuedEvent: RunEvent = {
      type: "run.queued",
      runId: input.job.run.id,
      agentId: input.job.run.agentId,
      daemonDeviceId: input.job.daemonDeviceId,
      createdAt: input.job.run.createdAt,
    };

    await tx.insert(runEvents).values({
      runId: input.job.run.id,
      eventType: queuedEvent.type,
      payload: queuedEvent,
      createdAt,
    });

    const assistantCreatedAt = new Date(createdAt.getTime() + 1);
    const [assistantMessage] = await tx
      .insert(conversationMessages)
      .values({
        conversationId: input.conversationId,
        senderType: "agent",
        senderAgentId: input.job.run.agentId,
        runId: input.job.run.id,
        content: "",
        status: "streaming",
        createdAt: assistantCreatedAt,
        updatedAt: assistantCreatedAt,
      })
      .returning();

    const [updatedConversation] = await tx
      .update(conversations)
      .set({
        lastMessageAt: assistantCreatedAt,
        updatedAt: assistantCreatedAt,
      })
      .where(eq(conversations.id, input.conversationId))
      .returning();

    return {
      conversation: toConversation(updatedConversation ?? conversation),
      messages: {
        user: toConversationMessage(userMessage),
        assistant: toConversationMessage(assistantMessage),
      },
    };
  });
}

export async function appendRunEventToConversationMessage(
  db: Db,
  event: RunEvent,
): Promise<void> {
  if (event.type !== "message.delta" && event.type !== "run.completed") {
    return;
  }

  const updatedAt = new Date(event.createdAt);
  const messageStatus =
    event.type === "run.completed"
      ? event.status === "succeeded"
        ? "completed"
        : event.status
      : "streaming";
  const [message] = await db
    .update(conversationMessages)
    .set({
      ...(event.type === "message.delta"
        ? {
            content: sql`${conversationMessages.content} || ${event.content}`,
          }
        : {
            status: messageStatus,
            error: event.error ?? null,
          }),
      updatedAt,
    })
    .where(eq(conversationMessages.runId, event.runId))
    .returning({
      conversationId: conversationMessages.conversationId,
    });

  if (message === undefined) {
    return;
  }

  await db
    .update(conversations)
    .set({
      lastMessageAt: updatedAt,
      updatedAt,
    })
    .where(eq(conversations.id, message.conversationId));
}
