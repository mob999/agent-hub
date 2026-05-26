import {
  integer,
  index,
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
    directAgentId: uuid("direct_agent_id"),
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

