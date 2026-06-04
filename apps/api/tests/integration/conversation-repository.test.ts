import { randomUUID } from "node:crypto";

import type { RunEvent } from "@agent-hub/core";
import {
  agentRuntimeBindings,
  agents,
  agentWorkspaces,
  conversationGoalTasks,
  conversationMessages,
  conversations,
  createDb,
  daemonDevices,
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
  listConversationGoalsForUser,
  listConversationsForUser,
  updateGroupConversation,
} from "@agent-hub/server";
import { eq, inArray } from "drizzle-orm";
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
  const daemonDeviceIds: string[] = [];
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

  async function createAgent(ownerUserId: string, name?: string): Promise<string> {
    const id = randomUUID();
    const now = new Date("2026-05-26T00:00:00.000Z");

    await db.insert(agents).values({
      id,
      ownerUserId,
      name: name ?? `Agent ${id.slice(0, 4)}`,
      defaultRuntimeKind: "codex",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    agentIds.push(id);
    return id;
  }

  async function markAgentReady(agentId: string): Promise<string> {
    const daemonDeviceId = `local-${randomUUID()}`;
    const now = new Date("2026-05-26T00:00:00.000Z");

    await db.insert(daemonDevices).values({
      id: daemonDeviceId,
      name: daemonDeviceId,
      status: "online",
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
    daemonDeviceIds.push(daemonDeviceId);
    return daemonDeviceId;
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
        .delete(daemonDevices)
        .where(inArray(daemonDevices.id, daemonDeviceIds));
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
      name: "send_message",
      input: {
        target: { type: "group", groupName: "#Design" },
        content: "Cross-group note.",
      },
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: job.run.id,
      toolCallId: "tool_archived",
      name: "send_message",
      input: {
        target: { type: "group", groupName: "Archive Me" },
        content: "Should not appear.",
      },
      createdAt: "2026-05-26T00:00:02.000Z",
    });
    await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: job.run.id,
      toolCallId: "tool_user",
      name: "send_message",
      input: { target: { type: "user" }, content: "Private note." },
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

  it("dispatches group chat runs from text mentions in agent messages", async () => {
    const ownerUserId = await createUser(
      `conversation-mention-owner-${randomUUID()}@example.com`,
    );
    const senderAgentId = await createAgent(ownerUserId, "coco");
    const mentionedAgentId = await createAgent(ownerUserId, "dudu");
    await markAgentReady(senderAgentId);
    await markAgentReady(mentionedAgentId);
    const directConversation = await ensureDirectConversation(db, {
      ownerUserId,
      agentId: senderAgentId,
    });
    const group = await createGroupConversation(db, {
      ownerUserId,
      title: "Design",
      agentIds: [senderAgentId, mentionedAgentId],
    });

    expect(directConversation).not.toBeNull();
    expect(group.status).toBe("created");
    if (directConversation === null || group.status !== "created") {
      return;
    }

    conversationIds.push(directConversation.id, group.conversation.id);

    const directJob = createJob({
      agentId: senderAgentId,
      conversationId: directConversation.id,
    });
    runIds.push(directJob.run.id);
    await createUserMessageAndRun(db, {
      ownerUserId,
      conversationId: directConversation.id,
      job: directJob,
      userMessageContent: "ask the group",
    });

    const crossResult = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: directJob.run.id,
      toolCallId: "tool_group_mention",
      name: "send_message",
      input: {
        target: { type: "group", groupName: "Design" },
        content: "@dudu 看一下这个问题",
      },
      createdAt: "2026-05-26T00:00:01.000Z",
    });

    expect(crossResult.dispatchJobs).toHaveLength(1);
    expect(crossResult.dispatchJobs[0]?.run.agentId).toBe(mentionedAgentId);
    if (crossResult.dispatchJobs[0] !== undefined) {
      runIds.push(crossResult.dispatchJobs[0].run.id);
    }

    const groupMessages = await listConversationMessagesForUser(db, {
      ownerUserId,
      conversationId: group.conversation.id,
    });

    expect(groupMessages?.map((message) => message.content)).toEqual([
      "@dudu 看一下这个问题",
    ]);

    const groupJob = createJob({
      agentId: senderAgentId,
      conversationId: group.conversation.id,
    });
    runIds.push(groupJob.run.id);
    await createUserMessageAndRuns(db, {
      ownerUserId,
      conversationId: group.conversation.id,
      jobs: [groupJob],
      userMessageContent: "continue here",
    });

    const groupResult = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: groupJob.run.id,
      toolCallId: "tool_local_mention",
      name: "send_message",
      input: { content: "@dudu please continue" },
      createdAt: "2026-05-26T00:00:02.000Z",
    });

    expect(groupResult.dispatchJobs).toHaveLength(1);
    expect(groupResult.dispatchJobs[0]?.run.agentId).toBe(mentionedAgentId);
    if (groupResult.dispatchJobs[0] !== undefined) {
      runIds.push(groupResult.dispatchJobs[0].run.id);
    }
  });

  it("creates and dispatches assigned task runs from create_task", async () => {
    const ownerUserId = await createUser(
      `conversation-task-owner-${randomUUID()}@example.com`,
    );
    const orchestratorAgentId = await createAgent(ownerUserId, "orch");
    const assigneeAgentId = await createAgent(ownerUserId, "dudu");
    await markAgentReady(orchestratorAgentId);
    await markAgentReady(assigneeAgentId);
    const group = await createGroupConversation(db, {
      ownerUserId,
      title: "Tasks",
      agentIds: [orchestratorAgentId, assigneeAgentId],
      orchestratorAgentId,
    });

    expect(group.status).toBe("created");
    if (group.status !== "created") {
      return;
    }

    conversationIds.push(group.conversation.id);

    const orchestratorJob = createJob({
      agentId: orchestratorAgentId,
      conversationId: group.conversation.id,
    });
    runIds.push(orchestratorJob.run.id);
    await createUserMessageAndRuns(db, {
      ownerUserId,
      conversationId: group.conversation.id,
      jobs: [orchestratorJob],
      userMessageContent: "make a report",
    });

    const goalResult = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: orchestratorJob.run.id,
      toolCallId: "tool_create_goal",
      name: "create_goal",
      input: {
        title: "Agent report",
        description: "make a report",
      },
      createdAt: "2026-05-26T00:00:00.500Z",
    });
    const goalId = goalResult.toolResult !== undefined && "goal" in goalResult.toolResult
      ? goalResult.toolResult.goal.id
      : undefined;
    expect(goalId).toBeDefined();
    if (goalId === undefined) {
      return;
    }

    const result = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: orchestratorJob.run.id,
      toolCallId: "tool_create_task",
      name: "create_task",
      input: {
        goalId,
        title: "Write the report",
        description: "Summarize the result.",
        assigneeAgentId,
      },
      createdAt: "2026-05-26T00:00:01.000Z",
    });

    expect(result.dispatchJobs).toHaveLength(1);
    expect(result.dispatchJobs[0]?.run.agentId).toBe(assigneeAgentId);
    if (result.dispatchJobs[0] !== undefined) {
      runIds.push(result.dispatchJobs[0].run.id);
    }

    const goals = await listConversationGoalsForUser(db, {
      ownerUserId,
      conversationId: group.conversation.id,
    });
    const messages = await listConversationMessagesForUser(db, {
      ownerUserId,
      conversationId: group.conversation.id,
    });

    const task = goals?.[0]?.tasks[0];

    expect(goals?.[0]).toMatchObject({
      id: goalId,
      title: "Agent report",
      status: "active",
    });
    expect(task).toMatchObject({
      index: 0,
      assigneeAgentId,
      status: "assigned",
    });
    expect(task?.assigneeRunId).toBe(result.dispatchJobs[0]?.run.id);
    expect(messages?.map((message) => message.content)).toContain(
      `@dudu 已创建任务：\nGoal: [Agent report](/chat/${group.conversation.id}/goals/${goalId})\n[Task #0 Write the report](/chat/${group.conversation.id}/goals/${goalId}/tasks/0)`,
    );
  });

  it("preempts an active assigned task run without interrupting the handed off task", async () => {
    const ownerUserId = await createUser(
      `conversation-task-handoff-owner-${randomUUID()}@example.com`,
    );
    const orchestratorAgentId = await createAgent(ownerUserId, "orch");
    const assigneeAgentId = await createAgent(ownerUserId, "dudu");
    await markAgentReady(orchestratorAgentId);
    await markAgentReady(assigneeAgentId);
    const group = await createGroupConversation(db, {
      ownerUserId,
      title: "Task handoff",
      agentIds: [orchestratorAgentId, assigneeAgentId],
      orchestratorAgentId,
    });

    expect(group.status).toBe("created");
    if (group.status !== "created") {
      return;
    }

    conversationIds.push(group.conversation.id);

    const orchestratorJob = createJob({
      agentId: orchestratorAgentId,
      conversationId: group.conversation.id,
    });
    runIds.push(orchestratorJob.run.id);
    await createUserMessageAndRuns(db, {
      ownerUserId,
      conversationId: group.conversation.id,
      jobs: [orchestratorJob],
      userMessageContent: "make a report",
    });

    const goalResult = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: orchestratorJob.run.id,
      toolCallId: "tool_create_goal",
      name: "create_goal",
      input: {
        title: "Agent report",
      },
      createdAt: "2026-05-26T00:00:00.500Z",
    });
    const goalId = goalResult.toolResult !== undefined && "goal" in goalResult.toolResult
      ? goalResult.toolResult.goal.id
      : undefined;
    expect(goalId).toBeDefined();
    if (goalId === undefined) {
      return;
    }

    const createTaskResult = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: orchestratorJob.run.id,
      toolCallId: "tool_create_task",
      name: "create_task",
      input: {
        goalId,
        title: "Write the report",
        assigneeAgentId,
      },
      createdAt: "2026-05-26T00:00:01.000Z",
    });
    const oldTaskRun = createTaskResult.dispatchJobs[0];
    expect(oldTaskRun).toBeDefined();
    if (oldTaskRun === undefined) {
      return;
    }
    runIds.push(oldTaskRun.run.id);

    await appendRunEvent(db, {
      type: "run.started",
      runId: oldTaskRun.run.id,
      workspacePath: "/workspace",
      createdAt: "2026-05-26T00:00:02.000Z",
    });

    const mentionResult = await appendRunEvent(db, {
      type: "agenthub.tool.call",
      runId: orchestratorJob.run.id,
      toolCallId: "tool_mention_assignee",
      name: "send_message",
      input: { content: "@dudu continue the assigned task" },
      createdAt: "2026-05-26T00:00:03.000Z",
    });
    const handoffRun = mentionResult.dispatchJobs[0];
    expect(handoffRun).toBeDefined();
    if (handoffRun === undefined) {
      return;
    }
    runIds.push(handoffRun.run.id);

    const [oldRunRow] = await db
      .select()
      .from(runs)
      .where(eq(runs.id, oldTaskRun.run.id))
      .limit(1);
    expect(oldRunRow.status).toBe("interrupted");
    expect(oldRunRow.preemptedByRunId).toBe(handoffRun.run.id);

    const oldRunEvents = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, oldTaskRun.run.id));
    expect(oldRunEvents.some((event) => event.eventType === "run.completed")).toBe(true);

    const [taskAfterHandoff] = await db
      .select()
      .from(conversationGoalTasks)
      .where(eq(conversationGoalTasks.goalId, goalId))
      .limit(1);
    expect(taskAfterHandoff.assigneeRunId).toBe(handoffRun.run.id);
    expect(taskAfterHandoff.status).toBe("running");
    expect(handoffRun.prompt).toContain("<agenthub_assigned_task>");
    expect(handoffRun.prompt).toContain("You are continuing the same assigned task");
    expect(handoffRun.prompt).toContain(`Goal ID: ${goalId}`);
    expect(handoffRun.prompt).toContain("Task Index: 0");
    expect(handoffRun.agentHubMcpTools).toContain("complete_task");
    expect(handoffRun.agentHubMcpTools).toContain("upload_artifact");
    expect(handoffRun.agentHubMcpTools).toContain("download_artifact");

    await appendRunEvent(db, {
      type: "run.completed",
      runId: oldTaskRun.run.id,
      status: "interrupted",
      error: "Daemon reported interruption after server preemption.",
      createdAt: "2026-05-26T00:00:04.000Z",
    });

    const [taskAfterDuplicateInterrupt] = await db
      .select()
      .from(conversationGoalTasks)
      .where(eq(conversationGoalTasks.id, taskAfterHandoff.id))
      .limit(1);
    expect(taskAfterDuplicateInterrupt.assigneeRunId).toBe(handoffRun.run.id);
    expect(taskAfterDuplicateInterrupt.status).toBe("running");
  });
});
