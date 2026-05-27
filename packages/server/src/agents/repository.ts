import type {
  AgentDetails,
  AgentStatus,
  AgentRuntimeBinding,
  AgentWorkspace,
  DaemonRuntime,
  RuntimeCapability,
  RuntimeKind,
} from "@agent-hub/core";
import {
  agentRuntimeBindings,
  agents,
  agentWorkspaces,
  conversations,
  daemonDevices,
  daemonRuntimes,
  type Db,
} from "@agent-hub/db";
import { and, asc, eq } from "drizzle-orm";

export interface CreateAgentRecordInput {
  id: string;
  ownerUserId: string;
  name: string;
  description?: string;
  avatar?: string;
  runtime: DaemonRuntime;
  createdAt: Date;
}

export interface RunnableAgent {
  agent: AgentDetails["agent"];
  daemonDeviceId: string;
  workspacePath: string;
  runtime: {
    runtimeKind: RuntimeKind;
    runtimeVersion?: string;
    executablePath?: string;
    capabilities: RuntimeCapability[];
    updatedAt: string;
  };
}

export type AgentStatusFilter = AgentStatus | "all";

export type ArchiveAgentResult =
  | { status: "archived"; agent: AgentDetails }
  | { status: "not-found" };

export type RestoreAgentResult =
  | { status: "restored"; agent: AgentDetails }
  | { status: "not-found" };

type AgentRow = typeof agents.$inferSelect;
type BindingRow = typeof agentRuntimeBindings.$inferSelect;
type WorkspaceRow = typeof agentWorkspaces.$inferSelect;
type RuntimeRow = typeof daemonRuntimes.$inferSelect;

function optionalString(value: string | null): string | undefined {
  return value ?? undefined;
}

function toAgentDetails(
  agent: AgentRow,
  binding: BindingRow,
  workspace: WorkspaceRow,
): AgentDetails {
  return {
    agent: {
      id: agent.id,
      ownerUserId: agent.ownerUserId,
      name: agent.name,
      description: optionalString(agent.description),
      avatar: optionalString(agent.avatar),
      defaultRuntimeKind: agent.defaultRuntimeKind as RuntimeKind,
      status: agent.status as AgentDetails["agent"]["status"],
      createdAt: agent.createdAt.toISOString(),
      updatedAt: agent.updatedAt.toISOString(),
    },
    runtimeBinding: {
      agentId: binding.agentId,
      daemonDeviceId: binding.daemonDeviceId,
      runtimeKind: binding.runtimeKind as RuntimeKind,
      runtimeVersion: optionalString(binding.runtimeVersion),
      executablePath: optionalString(binding.executablePath),
      capabilities: binding.capabilities as RuntimeCapability[],
      status: binding.status as AgentRuntimeBinding["status"],
      lastSeenAt: binding.lastSeenAt?.toISOString(),
      error: optionalString(binding.error),
    },
    workspace: {
      agentId: workspace.agentId,
      daemonDeviceId: workspace.daemonDeviceId,
      workspacePath: optionalString(workspace.workspacePath),
      status: workspace.status as AgentWorkspace["status"],
      syncMode: workspace.syncMode as AgentWorkspace["syncMode"],
      createdAt: workspace.createdAt.toISOString(),
      updatedAt: workspace.updatedAt.toISOString(),
      error: optionalString(workspace.error),
    },
  };
}

function toDaemonRuntime(row: RuntimeRow): DaemonRuntime {
  return {
    daemonDeviceId: row.daemonDeviceId,
    runtimeKind: row.runtimeKind as RuntimeKind,
    runtimeVersion: optionalString(row.runtimeVersion),
    executablePath: optionalString(row.executablePath),
    capabilities: row.capabilities as RuntimeCapability[],
    status: row.status as DaemonRuntime["status"],
    lastSeenAt: row.lastSeenAt?.toISOString(),
  };
}

export async function upsertDaemonRuntime(
  db: Db,
  runtime: DaemonRuntime,
): Promise<void> {
  const now = new Date();

  await db
    .insert(daemonRuntimes)
    .values({
      daemonDeviceId: runtime.daemonDeviceId,
      runtimeKind: runtime.runtimeKind,
      runtimeVersion: runtime.runtimeVersion,
      executablePath: runtime.executablePath,
      capabilities: runtime.capabilities,
      status: runtime.status,
      lastSeenAt: runtime.lastSeenAt === undefined
        ? now
        : new Date(runtime.lastSeenAt),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [daemonRuntimes.daemonDeviceId, daemonRuntimes.runtimeKind],
      set: {
        runtimeVersion: runtime.runtimeVersion,
        executablePath: runtime.executablePath,
        capabilities: runtime.capabilities,
        status: runtime.status,
        lastSeenAt: runtime.lastSeenAt === undefined
          ? now
          : new Date(runtime.lastSeenAt),
        updatedAt: now,
      },
    });
}

export async function setDaemonRuntimesStatus(
  db: Db,
  input: { daemonDeviceId: string; status: DaemonRuntime["status"] },
): Promise<void> {
  await db
    .update(daemonRuntimes)
    .set({
      status: input.status,
      updatedAt: new Date(),
    })
    .where(eq(daemonRuntimes.daemonDeviceId, input.daemonDeviceId));
}

export async function getReadyDaemonRuntime(
  db: Db,
  input: { daemonDeviceId: string; runtimeKind: RuntimeKind },
): Promise<DaemonRuntime | null> {
  const [row] = await db
    .select({ runtime: daemonRuntimes })
    .from(daemonRuntimes)
    .innerJoin(
      daemonDevices,
      eq(daemonDevices.id, daemonRuntimes.daemonDeviceId),
    )
    .where(
      and(
        eq(daemonRuntimes.daemonDeviceId, input.daemonDeviceId),
        eq(daemonRuntimes.runtimeKind, input.runtimeKind),
        eq(daemonRuntimes.status, "ready"),
        eq(daemonDevices.status, "online"),
      ),
    )
    .limit(1);

  return row === undefined ? null : toDaemonRuntime(row.runtime);
}

export async function listDaemonDevicesWithRuntimes(db: Db) {
  const deviceRows = await db
    .select()
    .from(daemonDevices)
    .orderBy(asc(daemonDevices.id));
  const runtimeRows = await db
    .select()
    .from(daemonRuntimes)
    .orderBy(asc(daemonRuntimes.runtimeKind));
  const runtimesByDevice = new Map<string, DaemonRuntime[]>();

  for (const runtime of runtimeRows) {
    const runtimes = runtimesByDevice.get(runtime.daemonDeviceId) ?? [];
    runtimes.push(toDaemonRuntime(runtime));
    runtimesByDevice.set(runtime.daemonDeviceId, runtimes);
  }

  return deviceRows.map((device) => ({
    ...device,
    runtimes: runtimesByDevice.get(device.id) ?? [],
  }));
}

export async function createAgentProvisioningRecords(
  db: Db,
  input: CreateAgentRecordInput,
): Promise<AgentDetails> {
  const [agent] = await db
    .insert(agents)
    .values({
      id: input.id,
      ownerUserId: input.ownerUserId,
      name: input.name,
      description: input.description,
      avatar: input.avatar,
      defaultRuntimeKind: input.runtime.runtimeKind,
      status: "active",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .returning();

  const [binding] = await db
    .insert(agentRuntimeBindings)
    .values({
      agentId: input.id,
      daemonDeviceId: input.runtime.daemonDeviceId,
      runtimeKind: input.runtime.runtimeKind,
      runtimeVersion: input.runtime.runtimeVersion,
      executablePath: input.runtime.executablePath,
      capabilities: input.runtime.capabilities,
      status: "pending",
      lastSeenAt: input.runtime.lastSeenAt === undefined
        ? input.createdAt
        : new Date(input.runtime.lastSeenAt),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .returning();

  const [workspace] = await db
    .insert(agentWorkspaces)
    .values({
      agentId: input.id,
      daemonDeviceId: input.runtime.daemonDeviceId,
      status: "pending",
      syncMode: "local-only",
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
    .returning();

  return toAgentDetails(agent, binding, workspace);
}

export async function listAgentsForUser(
  db: Db,
  input: { ownerUserId: string; status?: AgentStatusFilter },
): Promise<AgentDetails[]> {
  const status = input.status ?? "active";
  const conditions = [eq(agents.ownerUserId, input.ownerUserId)];

  if (status !== "all") {
    conditions.push(eq(agents.status, status));
  }

  const rows = await db
    .select({
      agent: agents,
      binding: agentRuntimeBindings,
      workspace: agentWorkspaces,
    })
    .from(agents)
    .innerJoin(
      agentRuntimeBindings,
      eq(agentRuntimeBindings.agentId, agents.id),
    )
    .innerJoin(agentWorkspaces, eq(agentWorkspaces.agentId, agents.id))
    .where(and(...conditions))
    .orderBy(asc(agents.createdAt));

  return rows.map((row) =>
    toAgentDetails(row.agent, row.binding, row.workspace),
  );
}

export async function archiveAgentForUser(
  db: Db,
  input: { agentId: string; ownerUserId: string },
): Promise<ArchiveAgentResult> {
  const result = await db.transaction(async (tx) => {
    const [agent] = await tx
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
      return { status: "not-found" as const };
    }

    const updatedAt = new Date();

    await tx
      .update(agents)
      .set({
        status: "archived",
        updatedAt,
      })
      .where(eq(agents.id, input.agentId));

    await tx
      .update(conversations)
      .set({
        status: "archived",
        updatedAt,
      })
      .where(
        and(
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.directAgentId, input.agentId),
        ),
      );

    return { status: "archived" as const };
  });

  if (result.status !== "archived") {
    return result;
  }

  const agent = await getAgentForUser(db, input);

  if (agent === null) {
    return { status: "not-found" };
  }

  return { status: "archived", agent };
}

export async function restoreAgentForUser(
  db: Db,
  input: { agentId: string; ownerUserId: string },
): Promise<RestoreAgentResult> {
  const result = await db.transaction(async (tx) => {
    const [agent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, input.agentId),
          eq(agents.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (agent === undefined) {
      return { status: "not-found" as const };
    }

    const updatedAt = new Date();

    await tx
      .update(agents)
      .set({
        status: "active",
        updatedAt,
      })
      .where(eq(agents.id, input.agentId));

    await tx
      .update(conversations)
      .set({
        status: "active",
        updatedAt,
      })
      .where(
        and(
          eq(conversations.ownerUserId, input.ownerUserId),
          eq(conversations.directAgentId, input.agentId),
        ),
      );

    return { status: "restored" as const };
  });

  if (result.status !== "restored") {
    return result;
  }

  const agent = await getAgentForUser(db, input);

  if (agent === null) {
    return { status: "not-found" };
  }

  return { status: "restored", agent };
}

export async function getAgentForUser(
  db: Db,
  input: { agentId: string; ownerUserId: string },
): Promise<AgentDetails | null> {
  const [row] = await db
    .select({
      agent: agents,
      binding: agentRuntimeBindings,
      workspace: agentWorkspaces,
    })
    .from(agents)
    .innerJoin(
      agentRuntimeBindings,
      eq(agentRuntimeBindings.agentId, agents.id),
    )
    .innerJoin(agentWorkspaces, eq(agentWorkspaces.agentId, agents.id))
    .where(
      and(
        eq(agents.id, input.agentId),
        eq(agents.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  return row === undefined
    ? null
    : toAgentDetails(row.agent, row.binding, row.workspace);
}

export async function updateAgentProfileForUser(
  db: Db,
  input: {
    agentId: string;
    ownerUserId: string;
    name: string;
    description?: string;
    avatar?: string;
  },
): Promise<AgentDetails | null> {
  const name = input.name.trim();
  const description = input.description?.trim() || undefined;
  const updatedAt = new Date();
  const updateValues: {
    name: string;
    description: string | null;
    avatar?: string | null;
    updatedAt: Date;
  } = {
    name,
    description: description ?? null,
    updatedAt,
  };

  if (Object.hasOwn(input, "avatar")) {
    updateValues.avatar = input.avatar ?? null;
  }

  const [updated] = await db
    .update(agents)
    .set(updateValues)
    .where(
      and(
        eq(agents.id, input.agentId),
        eq(agents.ownerUserId, input.ownerUserId),
      ),
    )
    .returning({ id: agents.id });

  if (updated === undefined) {
    return null;
  }

  await db
    .update(conversations)
    .set({
      title: name,
      updatedAt,
    })
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.directAgentId, input.agentId),
      ),
    );

  return getAgentForUser(db, input);
}

export async function getRunnableAgentForUser(
  db: Db,
  input: { agentId: string; ownerUserId: string },
): Promise<RunnableAgent | null> {
  const agent = await getAgentForUser(db, input);

  if (
    agent === null ||
    agent.agent.status !== "active" ||
    agent.runtimeBinding.status !== "ready" ||
    agent.workspace.status !== "ready" ||
    agent.workspace.workspacePath === undefined
  ) {
    return null;
  }

  return {
    agent: agent.agent,
    daemonDeviceId: agent.runtimeBinding.daemonDeviceId,
    workspacePath: agent.workspace.workspacePath,
    runtime: {
      runtimeKind: agent.runtimeBinding.runtimeKind,
      runtimeVersion: agent.runtimeBinding.runtimeVersion,
      executablePath: agent.runtimeBinding.executablePath,
      capabilities: agent.runtimeBinding.capabilities,
      updatedAt: agent.workspace.updatedAt,
    },
  };
}

export async function getFirstRunnableAgentForUser(
  db: Db,
  input: { ownerUserId: string },
): Promise<RunnableAgent | null> {
  const [row] = await db
    .select({
      agent: agents,
      binding: agentRuntimeBindings,
      workspace: agentWorkspaces,
    })
    .from(agents)
    .innerJoin(
      agentRuntimeBindings,
      eq(agentRuntimeBindings.agentId, agents.id),
    )
    .innerJoin(agentWorkspaces, eq(agentWorkspaces.agentId, agents.id))
    .where(
      and(
        eq(agents.ownerUserId, input.ownerUserId),
        eq(agents.status, "active"),
        eq(agentRuntimeBindings.status, "ready"),
        eq(agentWorkspaces.status, "ready"),
      ),
    )
    .orderBy(asc(agents.createdAt))
    .limit(1);

  if (row === undefined || row.workspace.workspacePath === null) {
    return null;
  }

  const agent = toAgentDetails(row.agent, row.binding, row.workspace);

  return {
    agent: agent.agent,
    daemonDeviceId: agent.runtimeBinding.daemonDeviceId,
    workspacePath: row.workspace.workspacePath,
    runtime: {
      runtimeKind: agent.runtimeBinding.runtimeKind,
      runtimeVersion: agent.runtimeBinding.runtimeVersion,
      executablePath: agent.runtimeBinding.executablePath,
      capabilities: agent.runtimeBinding.capabilities,
      updatedAt: agent.workspace.updatedAt,
    },
  };
}

export async function markAgentProvisioningReady(
  db: Db,
  input: {
    agentId: string;
    daemonDeviceId: string;
    workspacePath: string;
    runtime: RunnableAgent["runtime"];
    updatedAt: Date;
  },
): Promise<void> {
  await db
    .update(agentRuntimeBindings)
    .set({
      runtimeVersion: input.runtime.runtimeVersion,
      executablePath: input.runtime.executablePath,
      capabilities: input.runtime.capabilities,
      status: "ready",
      error: null,
      lastSeenAt: input.updatedAt,
      updatedAt: input.updatedAt,
    })
    .where(eq(agentRuntimeBindings.agentId, input.agentId));

  await db
    .update(agentWorkspaces)
    .set({
      workspacePath: input.workspacePath,
      status: "ready",
      error: null,
      updatedAt: input.updatedAt,
    })
    .where(eq(agentWorkspaces.agentId, input.agentId));

  await db
    .update(agents)
    .set({ updatedAt: input.updatedAt })
    .where(eq(agents.id, input.agentId));
}

export async function markAgentProvisioningFailed(
  db: Db,
  input: {
    agentId: string;
    error: string;
    updatedAt?: Date;
  },
): Promise<void> {
  const updatedAt = input.updatedAt ?? new Date();

  await db
    .update(agentRuntimeBindings)
    .set({
      status: "unavailable",
      error: input.error,
      updatedAt,
    })
    .where(eq(agentRuntimeBindings.agentId, input.agentId));

  await db
    .update(agentWorkspaces)
    .set({
      status: "unavailable",
      error: input.error,
      updatedAt,
    })
    .where(eq(agentWorkspaces.agentId, input.agentId));

  await db
    .update(agents)
    .set({ updatedAt })
    .where(eq(agents.id, input.agentId));
}
