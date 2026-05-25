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

export const daemonDevices = pgTable("daemon_devices", {
  id: varchar("id", { length: 120 }).primaryKey(),
  status: varchar("status", { length: 32 }).notNull().default("offline"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: varchar("agent_id", { length: 120 }).notNull(),
    daemonDeviceId: varchar("daemon_device_id", { length: 120 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    prompt: text("prompt").notNull(),
    workspacePath: text("workspace_path").notNull(),
    runtime: jsonb("runtime").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    runsOwnerUserIdIdx: index("runs_owner_user_id_idx").on(table.ownerUserId),
    runsDaemonDeviceIdIdx: index("runs_daemon_device_id_idx").on(
      table.daemonDeviceId,
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
