import {
  integer,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { agents } from "./agents.js";
import { users } from "./auth.js";

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    key: varchar("key", { length: 80 }),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    directAgentId: uuid("direct_agent_id"),
    orchestratorAgentId: uuid("orchestrator_agent_id").references(
      () => agents.id,
      { onDelete: "set null" },
    ),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationsOwnerUpdatedAtIdx: index(
      "conversations_owner_updated_at_idx",
    ).on(table.ownerUserId, table.updatedAt),
    conversationsOwnerKeyUniqueIdx: uniqueIndex(
      "conversations_owner_key_unique_idx",
    ).on(table.ownerUserId, table.key),
    conversationsOwnerDirectAgentUniqueIdx: uniqueIndex(
      "conversations_owner_direct_agent_unique_idx",
    ).on(table.ownerUserId, table.directAgentId),
    conversationsOrchestratorAgentIdIdx: index(
      "conversations_orchestrator_agent_id_idx",
    ).on(table.orchestratorAgentId),
  }),
);

export const conversationAgentMembers = pgTable(
  "conversation_agent_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationAgentMembersUniqueIdx: uniqueIndex(
      "conversation_agent_members_unique_idx",
    ).on(table.conversationId, table.agentId),
    conversationAgentMembersAgentIdIdx: index(
      "conversation_agent_members_agent_id_idx",
    ).on(table.agentId),
  }),
);

export const conversationMessages = pgTable(
  "conversation_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderType: varchar("sender_type", { length: 32 }).notNull(),
    senderAgentId: uuid("sender_agent_id"),
    runId: uuid("run_id"),
    content: text("content").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationMessagesConversationCreatedAtIdx: index(
      "conversation_messages_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationMessagesRunIdIdx: index("conversation_messages_run_id_idx").on(
      table.runId,
    ),
  }),
);

export const conversationTasks = pgTable(
  "conversation_tasks",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    creatorRunId: uuid("creator_run_id").notNull(),
    orchestratorAgentId: uuid("orchestrator_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    assigneeAgentId: uuid("assignee_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    assigneeRunId: uuid("assignee_run_id"),
    dispatchMessageId: uuid("dispatch_message_id").references(
      () => conversationMessages.id,
      { onDelete: "set null" },
    ),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull(),
    summary: text("summary"),
    resultArtifactIds: jsonb("result_artifact_ids").$type<string[]>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    finalizerRunId: uuid("finalizer_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationTasksConversationCreatedAtIdx: index(
      "conversation_tasks_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationTasksCreatorRunIdIdx: index(
      "conversation_tasks_creator_run_id_idx",
    ).on(table.creatorRunId),
    conversationTasksAssigneeRunIdIdx: index(
      "conversation_tasks_assignee_run_id_idx",
    ).on(table.assigneeRunId),
    conversationTasksAssigneeAgentIdIdx: index(
      "conversation_tasks_assignee_agent_id_idx",
    ).on(table.assigneeAgentId),
  }),
);

export const conversationArtifacts = pgTable(
  "conversation_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => conversationTasks.id, {
      onDelete: "set null",
    }),
    runId: uuid("run_id").notNull(),
    creatorAgentId: uuid("creator_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    title: varchar("title", { length: 160 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 160 }),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    latestRevisionId: uuid("latest_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationArtifactsConversationCreatedAtIdx: index(
      "conversation_artifacts_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationArtifactsTaskIdIdx: index(
      "conversation_artifacts_task_id_idx",
    ).on(table.taskId),
    conversationArtifactsRunIdIdx: index("conversation_artifacts_run_id_idx").on(
      table.runId,
    ),
    conversationArtifactsCreatorAgentIdIdx: index(
      "conversation_artifacts_creator_agent_id_idx",
    ).on(table.creatorAgentId),
  }),
);

export const conversationArtifactRevisions = pgTable(
  "conversation_artifact_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => conversationArtifacts.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    runId: uuid("run_id"),
    editorUserId: uuid("editor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationArtifactRevisionsArtifactCreatedAtIdx: index(
      "conversation_artifact_revisions_artifact_created_at_idx",
    ).on(table.artifactId, table.createdAt),
    conversationArtifactRevisionsConversationIdx: index(
      "conversation_artifact_revisions_conversation_idx",
    ).on(table.conversationId),
  }),
);

export const conversationArtifactActions = pgTable(
  "conversation_artifact_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => conversationArtifacts.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").references(
      () => conversationArtifactRevisions.id,
      { onDelete: "set null" },
    ),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    runId: uuid("run_id"),
    error: text("error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationArtifactActionsArtifactCreatedAtIdx: index(
      "conversation_artifact_actions_artifact_created_at_idx",
    ).on(table.artifactId, table.createdAt),
    conversationArtifactActionsConversationIdx: index(
      "conversation_artifact_actions_conversation_idx",
    ).on(table.conversationId),
    conversationArtifactActionsStatusIdx: index(
      "conversation_artifact_actions_status_idx",
    ).on(table.status),
  }),
);

