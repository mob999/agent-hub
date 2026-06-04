import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { conversations } from "./conversations.js";

export const daemonDevices = pgTable(
  "daemon_devices",
  {
    id: varchar("id", { length: 120 }).primaryKey(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 120 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("offline"),
    registrationShell: varchar("registration_shell", { length: 16 }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    daemonDevicesOwnerDeletedIdx: index("daemon_devices_owner_deleted_idx").on(
      table.ownerUserId,
      table.deletedAt,
    ),
  }),
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    agentId: varchar("agent_id", { length: 120 }).notNull(),
    daemonDeviceId: varchar("daemon_device_id", { length: 120 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    runtimeSessionId: text("runtime_session_id"),
    parentRunId: uuid("parent_run_id"),
    preemptedByRunId: uuid("preempted_by_run_id"),
    dispatchMode: varchar("dispatch_mode", { length: 16 }).notNull().default("new"),
    prompt: text("prompt").notNull(),
    workspacePath: text("workspace_path").notNull(),
    memoryWorkspacePath: text("memory_workspace_path"),
    runtime: jsonb("runtime").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    runsOwnerUserIdIdx: index("runs_owner_user_id_idx").on(table.ownerUserId),
    runsConversationIdIdx: index("runs_conversation_id_idx").on(
      table.conversationId,
    ),
    runsDaemonDeviceIdIdx: index("runs_daemon_device_id_idx").on(
      table.daemonDeviceId,
    ),
    runsActiveScopeIdx: index("runs_active_scope_idx").on(
      table.ownerUserId,
      table.conversationId,
      table.agentId,
      table.status,
    ),
    runsRuntimeSessionIdIdx: index("runs_runtime_session_id_idx").on(
      table.runtimeSessionId,
    ),
  }),
);

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    runEventsRunIdIdx: index("run_events_run_id_idx").on(table.runId),
  }),
);
