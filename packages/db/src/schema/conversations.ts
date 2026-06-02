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

export const conversationGoals = pgTable(
  "conversation_goals",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    orchestratorAgentId: uuid("orchestrator_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    initialRunId: uuid("initial_run_id").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull(),
    summary: text("summary"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationGoalsConversationCreatedAtIdx: index(
      "conversation_goals_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationGoalsInitialRunIdIdx: index(
      "conversation_goals_initial_run_id_idx",
    ).on(table.initialRunId),
  }),
);

export const conversationGoalTasks = pgTable(
  "conversation_goal_tasks",
  {
    id: uuid("id").primaryKey(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => conversationGoals.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    assigneeAgentId: uuid("assignee_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    assigneeRunId: uuid("assignee_run_id"),
    dispatchMessageId: uuid("dispatch_message_id").references(
      () => conversationMessages.id,
      { onDelete: "set null" },
    ),
    dependsOnTaskIndexes: jsonb("depends_on_task_indexes").$type<number[]>().notNull().default([]),
    title: varchar("title", { length: 160 }).notNull(),
    description: text("description"),
    status: varchar("status", { length: 32 }).notNull(),
    blockedReason: text("blocked_reason"),
    summary: text("summary"),
    resultArtifactIds: jsonb("result_artifact_ids").$type<string[]>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checkpointRunId: uuid("checkpoint_run_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationGoalTasksGoalIndexUniqueIdx: uniqueIndex(
      "conversation_goal_tasks_goal_index_unique_idx",
    ).on(table.goalId, table.index),
    conversationGoalTasksGoalCreatedAtIdx: index(
      "conversation_goal_tasks_goal_created_at_idx",
    ).on(table.goalId, table.createdAt),
    conversationGoalTasksAssigneeRunIdIdx: index(
      "conversation_goal_tasks_assignee_run_id_idx",
    ).on(table.assigneeRunId),
    conversationGoalTasksAssigneeAgentIdIdx: index(
      "conversation_goal_tasks_assignee_agent_id_idx",
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
    kind: varchar("kind", { length: 32 }).notNull().default("file"),
    goalId: uuid("goal_id").references(() => conversationGoals.id, {
      onDelete: "set null",
    }),
    goalTaskId: uuid("goal_task_id").references(() => conversationGoalTasks.id, {
      onDelete: "set null",
    }),
    taskIndex: integer("task_index"),
    runId: uuid("run_id"),
    creatorAgentId: uuid("creator_agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    creatorType: varchar("creator_type", { length: 32 }).notNull().default("agent"),
    creatorUserId: uuid("creator_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    title: varchar("title", { length: 160 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    entrypoint: text("entrypoint"),
    fileCount: integer("file_count"),
    sourcePath: text("source_path"),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    latestRevisionId: uuid("latest_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationArtifactsConversationCreatedAtIdx: index(
      "conversation_artifacts_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationArtifactsGoalIdIdx: index(
      "conversation_artifacts_goal_id_idx",
    ).on(table.goalId),
    conversationArtifactsGoalTaskIdIdx: index(
      "conversation_artifacts_goal_task_id_idx",
    ).on(table.goalTaskId),
    conversationArtifactsRunIdIdx: index("conversation_artifacts_run_id_idx").on(
      table.runId,
    ),
    conversationArtifactsCreatorAgentIdIdx: index(
      "conversation_artifacts_creator_agent_id_idx",
    ).on(table.creatorAgentId),
    conversationArtifactsCreatorUserIdIdx: index(
      "conversation_artifacts_creator_user_id_idx",
    ).on(table.creatorUserId),
  }),
);

export const conversationArtifactFiles = pgTable(
  "conversation_artifact_files",
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
    path: text("path").notNull(),
    mimeType: varchar("mime_type", { length: 120 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    latestRevisionId: uuid("latest_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationArtifactFilesArtifactPathUniqueIdx: uniqueIndex(
      "conversation_artifact_files_artifact_path_unique_idx",
    ).on(table.artifactId, table.path),
    conversationArtifactFilesConversationIdx: index(
      "conversation_artifact_files_conversation_idx",
    ).on(table.conversationId),
  }),
);

export const conversationMessageArtifacts = pgTable(
  "conversation_message_artifacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => conversationMessages.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => conversationArtifacts.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationMessageArtifactsMessagePositionIdx: uniqueIndex(
      "conversation_message_artifacts_message_position_idx",
    ).on(table.messageId, table.position),
    conversationMessageArtifactsArtifactIdx: index(
      "conversation_message_artifacts_artifact_idx",
    ).on(table.artifactId),
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

export const conversationArtifactFileRevisions = pgTable(
  "conversation_artifact_file_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    artifactFileId: uuid("artifact_file_id")
      .notNull()
      .references(() => conversationArtifactFiles.id, { onDelete: "cascade" }),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => conversationArtifacts.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    editorUserId: uuid("editor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationArtifactFileRevisionsFileCreatedAtIdx: index(
      "conversation_artifact_file_revisions_file_created_at_idx",
    ).on(table.artifactFileId, table.createdAt),
    conversationArtifactFileRevisionsArtifactIdx: index(
      "conversation_artifact_file_revisions_artifact_idx",
    ).on(table.artifactId),
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

export const conversationDeployments = pgTable(
  "conversation_deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => conversationGoals.id, {
      onDelete: "set null",
    }),
    taskIndex: integer("task_index"),
    runId: uuid("run_id").notNull(),
    creatorAgentId: uuid("creator_agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    sourceArtifactId: uuid("source_artifact_id").references(
      () => conversationArtifacts.id,
      { onDelete: "set null" },
    ),
    sourceRevisionId: uuid("source_revision_id"),
    publishedByUserId: uuid("published_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    publishedFrom: varchar("published_from", { length: 32 }).notNull().default("agent"),
    title: varchar("title", { length: 160 }).notNull(),
    entrypoint: text("entrypoint").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    storagePrefix: text("storage_prefix").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    conversationDeploymentsConversationCreatedAtIdx: index(
      "conversation_deployments_conversation_created_at_idx",
    ).on(table.conversationId, table.createdAt),
    conversationDeploymentsGoalIdIdx: index(
      "conversation_deployments_goal_id_idx",
    ).on(table.goalId),
    conversationDeploymentsRunIdIdx: index(
      "conversation_deployments_run_id_idx",
    ).on(table.runId),
    conversationDeploymentsCreatorAgentIdIdx: index(
      "conversation_deployments_creator_agent_id_idx",
    ).on(table.creatorAgentId),
    conversationDeploymentsSourceArtifactIdIdx: index(
      "conversation_deployments_source_artifact_id_idx",
    ).on(table.sourceArtifactId),
  }),
);
