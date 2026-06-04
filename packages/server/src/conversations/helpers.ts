import type { Conversation } from "@agent-hub/core";
import {
  agents,
  conversationAgentMembers,
  conversationProjects,
  conversations,
  type Db,
} from "@agent-hub/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  toConversation,
  toConversationProject,
  type ConversationRow,
} from "./mappers.js";

export const defaultGroupConversationKey = "all";
export const defaultGroupConversationTitle = "all";

export function normalizeGroupConversationTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ");
}

export function groupConversationKeyFromTitle(title: string): string {
  return normalizeGroupConversationTitle(title).toLowerCase();
}

export function inferProjectConversationTitle(remoteUrl: string): string {
  const normalized = remoteUrl.trim().replace(/[?#].*$/, "");
  const lastSegment = normalized.split(/[/:\\]/).filter(Boolean).at(-1) ?? "Project";
  const withoutGit = lastSegment.endsWith(".git")
    ? lastSegment.slice(0, -4)
    : lastSegment;
  return normalizeGroupConversationTitle(withoutGit || "Project").slice(0, 160);
}

export function normalizeProjectDescription(description?: string): string | undefined {
  const normalized = description?.trim();
  return normalized === "" ? undefined : normalized;
}

export async function getConversationAgentIdsForRow(
  db: Pick<Db, "select">,
  row: ConversationRow,
): Promise<string[] | undefined> {
  if (row.type !== "group" && row.type !== "project") {
    return undefined;
  }

  if (row.type === "group" && row.key === defaultGroupConversationKey) {
    const agentRows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.ownerUserId, row.ownerUserId))
      .orderBy(asc(agents.createdAt));

    return agentRows.map((agent) => agent.id);
  }

  const memberRows = await db
    .select({ agentId: conversationAgentMembers.agentId })
    .from(conversationAgentMembers)
    .where(eq(conversationAgentMembers.conversationId, row.id))
    .orderBy(asc(conversationAgentMembers.position));

  return memberRows.map((member) => member.agentId);
}

export async function listAgentIdsForUser(
  db: Db,
  input: { ownerUserId: string; status?: "active" | "all" },
): Promise<string[]> {
  const status = input.status ?? "active";
  const conditions = [eq(agents.ownerUserId, input.ownerUserId)];

  if (status !== "all") {
    conditions.push(eq(agents.status, status));
  }

  const rows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(...conditions))
    .orderBy(asc(agents.createdAt));

  return rows.map((row) => row.id);
}

export async function listConversationMemberAgentIds(
  db: Db,
  conversationIds: string[],
): Promise<Map<string, string[]>> {
  if (conversationIds.length === 0) {
    return new Map();
  }

  const rows = await db
    .select({
      conversationId: conversationAgentMembers.conversationId,
      agentId: conversationAgentMembers.agentId,
    })
    .from(conversationAgentMembers)
    .where(inArray(conversationAgentMembers.conversationId, conversationIds))
    .orderBy(
      asc(conversationAgentMembers.conversationId),
      asc(conversationAgentMembers.position),
    );
  const membersByConversation = new Map<string, string[]>();

  for (const row of rows) {
    const members = membersByConversation.get(row.conversationId) ?? [];
    members.push(row.agentId);
    membersByConversation.set(row.conversationId, members);
  }

  return membersByConversation;
}

export function includesOrNoOrchestrator(input: {
  agentIds: string[];
  orchestratorAgentId?: string;
}): boolean {
  return input.orchestratorAgentId === undefined ||
    input.agentIds.includes(input.orchestratorAgentId);
}

export function compactUniqueStrings(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.filter(
        (value): value is string =>
          typeof value === "string" && value.length > 0,
      ),
    ),
  ];
}

export function compactUniqueNumbers(values: number[]): number[] {
  return [
    ...new Set(
      values.filter((value) => Number.isInteger(value) && value >= 0),
    ),
  ];
}

export async function toConversationsWithAgentIds(
  db: Db,
  rows: ConversationRow[],
  input: { ownerUserId: string },
): Promise<Conversation[]> {
  const groupRows = rows.filter((row) => row.type === "group");
  const projectRows = rows.filter((row) => row.type === "project");
  const defaultGroupIds = groupRows
    .filter((row) => row.key === defaultGroupConversationKey)
    .map((row) => row.id);
  const customMemberConversationIds = [
    ...groupRows
    .filter((row) => row.key !== defaultGroupConversationKey)
      .map((row) => row.id),
    ...projectRows.map((row) => row.id),
  ];
  const allAgentIds =
    defaultGroupIds.length === 0
      ? []
      : await listAgentIdsForUser(db, { ownerUserId: input.ownerUserId });
  const customMemberIds = await listConversationMemberAgentIds(
    db,
    customMemberConversationIds,
  );
  const projectIds = projectRows.map((row) => row.id);
  const projectMetadataRows =
    projectIds.length === 0
      ? []
      : await db
          .select()
          .from(conversationProjects)
          .where(inArray(conversationProjects.conversationId, projectIds));
  const projectsByConversationId = new Map(
    projectMetadataRows.map((row) => [
      row.conversationId,
      toConversationProject(row),
    ]),
  );

  return rows.map((row) => {
    if (row.type === "project") {
      return toConversation(
        row,
        customMemberIds.get(row.id) ?? [],
        projectsByConversationId.get(row.id),
      );
    }

    if (row.type !== "group") {
      return toConversation(row);
    }

    if (row.key === defaultGroupConversationKey) {
      return toConversation(row, allAgentIds);
    }

    return toConversation(row, customMemberIds.get(row.id) ?? []);
  });
}
