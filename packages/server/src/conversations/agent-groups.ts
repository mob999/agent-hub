import {
  agents,
  conversations,
  type Db,
} from "@agent-hub/db";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
  compactUniqueStrings,
  defaultGroupConversationKey,
  toConversationsWithAgentIds,
} from "./helpers.js";
import type { AgentGroupContext } from "./prompts.js";

export async function listActiveAgentGroupContexts(
  db: Db,
  input: { ownerUserId: string; agentId: string },
): Promise<AgentGroupContext[]> {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.id, input.agentId),
        eq(agents.ownerUserId, input.ownerUserId),
        eq(agents.status, "active"),
      ),
    )
    .limit(1);

  if (agent === undefined) {
    return [];
  }

  const rows = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        inArray(conversations.type, ["group", "project"]),
        eq(conversations.status, "active"),
      ),
    )
    .orderBy(asc(conversations.title));
  const activeGroups = await toConversationsWithAgentIds(db, rows, {
    ownerUserId: input.ownerUserId,
  });
  const agentIds = compactUniqueStrings(
    activeGroups.flatMap((conversation) => conversation.agentIds ?? []),
  );
  const agentRows = agentIds.length === 0
    ? []
    : await db
        .select({ id: agents.id, name: agents.name, tags: agents.tags })
        .from(agents)
        .where(
          and(
            eq(agents.ownerUserId, input.ownerUserId),
            eq(agents.status, "active"),
            inArray(agents.id, agentIds),
          ),
        )
        .orderBy(asc(agents.createdAt));
  const agentDetailsById = new Map(
    agentRows.map((agent) => [
      agent.id,
      {
        id: agent.id,
        name: agent.name,
        tags: Array.isArray(agent.tags)
          ? agent.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
      },
    ]),
  );

  return activeGroups
    .filter((conversation) => conversation.agentIds?.includes(input.agentId))
    .map((conversation) => ({
      agents: (conversation.agentIds ?? []).flatMap((agentId) => {
        const agent = agentDetailsById.get(agentId);

        return agent === undefined ? [] : [agent];
      }),
      conversationId: conversation.id,
      groupName: conversation.key === defaultGroupConversationKey
        ? defaultGroupConversationKey
        : conversation.title,
      orchestratorAgentId: conversation.orchestratorAgentId,
      title: conversation.title,
    }));
}
