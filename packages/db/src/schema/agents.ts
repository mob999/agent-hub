import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "./auth.js";
import { daemonDevices } from "./runs.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    description: text("description"),
    avatar: text("avatar"),
    defaultRuntimeKind: varchar("default_runtime_kind", { length: 40 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    agentsOwnerUserIdIdx: index("agents_owner_user_id_idx").on(table.ownerUserId),
  }),
);

export const daemonRuntimes = pgTable(
  "daemon_runtimes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    daemonDeviceId: varchar("daemon_device_id", { length: 120 })
      .notNull()
      .references(() => daemonDevices.id, { onDelete: "cascade" }),
    runtimeKind: varchar("runtime_kind", { length: 40 }).notNull(),
    runtimeVersion: varchar("runtime_version", { length: 120 }),
    executablePath: text("executable_path"),
    capabilities: jsonb("capabilities").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ready"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    daemonRuntimesDeviceRuntimeUniqueIdx: uniqueIndex(
      "daemon_runtimes_device_runtime_unique_idx",
    ).on(table.daemonDeviceId, table.runtimeKind),
    daemonRuntimesDeviceIdIdx: index("daemon_runtimes_device_id_idx").on(
      table.daemonDeviceId,
    ),
  }),
);

export const agentRuntimeBindings = pgTable(
  "agent_runtime_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    daemonDeviceId: varchar("daemon_device_id", { length: 120 })
      .notNull()
      .references(() => daemonDevices.id, { onDelete: "cascade" }),
    runtimeKind: varchar("runtime_kind", { length: 40 }).notNull(),
    runtimeVersion: varchar("runtime_version", { length: 120 }),
    executablePath: text("executable_path"),
    capabilities: jsonb("capabilities").notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    error: text("error"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    agentRuntimeBindingsAgentUniqueIdx: uniqueIndex(
      "agent_runtime_bindings_agent_unique_idx",
    ).on(table.agentId),
    agentRuntimeBindingsDaemonDeviceIdIdx: index(
      "agent_runtime_bindings_daemon_device_id_idx",
    ).on(table.daemonDeviceId),
  }),
);

export const agentWorkspaces = pgTable(
  "agent_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    daemonDeviceId: varchar("daemon_device_id", { length: 120 })
      .notNull()
      .references(() => daemonDevices.id, { onDelete: "cascade" }),
    workspacePath: text("workspace_path"),
    status: varchar("status", { length: 32 }).notNull(),
    syncMode: varchar("sync_mode", { length: 32 }).notNull().default("local-only"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    agentWorkspacesAgentDaemonUniqueIdx: uniqueIndex(
      "agent_workspaces_agent_daemon_unique_idx",
    ).on(table.agentId, table.daemonDeviceId),
    agentWorkspacesDaemonDeviceIdIdx: index(
      "agent_workspaces_daemon_device_id_idx",
    ).on(table.daemonDeviceId),
  }),
);
