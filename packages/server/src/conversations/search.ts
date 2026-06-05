import type {
  Conversation,
  ConversationSearchHit,
  MessageSearchHit,
  SearchConversationsRequest,
  SearchConversationsResponse,
  SearchSort,
  SearchTimeFilter,
} from "@agent-hub/core";
import {
  agents,
  conversationMessages,
  conversations,
  type Db,
} from "@agent-hub/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { listConversationsForUser } from "./conversation-records.js";

interface ScoredMatch<TMatchedField extends string> {
  matchedFields: TMatchedField[];
  score: number;
}

interface ScoredConversationHit extends ConversationSearchHit {
  score: number;
  sortTimestamp: number;
}

interface ScoredMessageHit extends MessageSearchHit {
  score: number;
  sortTimestamp: number;
}

const defaultSearchLimit = 20;
const maxSearchLimit = 50;

export function normalizeSearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function scoreField(
  query: string,
  value: string | undefined,
  weights: { exact: number; prefix: number; includes: number },
): number {
  if (value === undefined) {
    return 0;
  }

  const normalizedValue = normalizeSearchQuery(value);

  if (normalizedValue.length === 0) {
    return 0;
  }

  if (normalizedValue === query) {
    return weights.exact;
  }

  if (normalizedValue.startsWith(query)) {
    return weights.prefix;
  }

  return normalizedValue.includes(query) ? weights.includes : 0;
}

function pushMatchedField<TMatchedField extends string>(
  matchedFields: Set<TMatchedField>,
  score: number,
  field: TMatchedField,
): number {
  if (score > 0) {
    matchedFields.add(field);
  }

  return score;
}

export function scoreConversationSearchHit(input: {
  conversationDescription?: string;
  conversationTitle: string;
  directAgentDescription?: string;
  directAgentName?: string;
  query: string;
}): ScoredMatch<ConversationSearchHit["matchedFields"][number]> {
  const matchedFields = new Set<ConversationSearchHit["matchedFields"][number]>();
  const normalizedQuery = normalizeSearchQuery(input.query);

  if (normalizedQuery.length === 0) {
    return { matchedFields: [], score: 0 };
  }

  const score =
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.conversationTitle, {
        exact: 140,
        prefix: 120,
        includes: 90,
      }),
      "title",
    ) +
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.conversationDescription, {
        exact: 80,
        prefix: 60,
        includes: 40,
      }),
      "description",
    ) +
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.directAgentName, {
        exact: 140,
        prefix: 120,
        includes: 90,
      }),
      "agentName",
    ) +
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.directAgentDescription, {
        exact: 80,
        prefix: 60,
        includes: 40,
      }),
      "agentDescription",
    );

  return {
    matchedFields: [...matchedFields],
    score,
  };
}

export function scoreMessageSearchHit(input: {
  content: string;
  conversationLabel: string;
  query: string;
  senderLabel: string;
}): ScoredMatch<MessageSearchHit["matchedFields"][number]> {
  const matchedFields = new Set<MessageSearchHit["matchedFields"][number]>();
  const normalizedQuery = normalizeSearchQuery(input.query);

  if (normalizedQuery.length === 0) {
    return { matchedFields: [], score: 0 };
  }

  const score =
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.content, {
        exact: 200,
        prefix: 180,
        includes: 150,
      }),
      "content",
    ) +
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.senderLabel, {
        exact: 90,
        prefix: 70,
        includes: 50,
      }),
      "senderName",
    ) +
    pushMatchedField(
      matchedFields,
      scoreField(normalizedQuery, input.conversationLabel, {
        exact: 70,
        prefix: 55,
        includes: 35,
      }),
      "conversationTitle",
    );

  return {
    matchedFields: [...matchedFields],
    score,
  };
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildMessageSearchSnippet(input: {
  content: string;
  maxLength?: number;
  query: string;
}): string {
  const maxLength = input.maxLength ?? 120;
  const compactContent = compactWhitespace(input.content);

  if (compactContent.length <= maxLength) {
    return compactContent;
  }

  const normalizedQuery = normalizeSearchQuery(input.query);
  const contentIndex = compactContent.toLowerCase().indexOf(normalizedQuery);

  if (contentIndex < 0 || normalizedQuery.length === 0) {
    return `${compactContent.slice(0, maxLength - 3).trimEnd()}...`;
  }

  const contextRadius = Math.max(20, Math.floor((maxLength - normalizedQuery.length) / 2));
  const start = Math.max(0, contentIndex - contextRadius);
  const end = Math.min(
    compactContent.length,
    contentIndex + normalizedQuery.length + contextRadius,
  );
  const prefix = start > 0 ? "..." : "";
  const suffix = end < compactContent.length ? "..." : "";

  return `${prefix}${compactContent.slice(start, end).trim()}${suffix}`;
}

function timeFilterCutoff(
  timeFilter: SearchTimeFilter,
): Date | undefined {
  const now = Date.now();

  switch (timeFilter) {
    case "24h":
      return new Date(now - 24 * 60 * 60 * 1000);
    case "7d":
      return new Date(now - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case "any":
    default:
      return undefined;
  }
}

function compareScoredHits(
  left: { score: number; sortTimestamp: number },
  right: { score: number; sortTimestamp: number },
  sort: SearchSort,
): number {
  if (sort === "recent") {
    return right.sortTimestamp - left.sortTimestamp;
  }

  return right.score - left.score || right.sortTimestamp - left.sortTimestamp;
}

function conversationSubtitle(
  conversation: Conversation,
  directAgentDescription?: string,
): string {
  if (conversation.type === "direct") {
    return directAgentDescription?.trim() || "Direct message";
  }

  return conversation.description?.trim() || "Channel";
}

export async function searchConversationsForUser(
  db: Db,
  input: { ownerUserId: string } & SearchConversationsRequest,
): Promise<SearchConversationsResponse> {
  const normalizedQuery = normalizeSearchQuery(input.query);
  const sort = input.sort ?? "relevant";
  const timeFilter = input.timeFilter ?? "any";
  const limit = Math.min(
    Math.max(input.limit ?? defaultSearchLimit, 1),
    maxSearchLimit,
  );

  if (normalizedQuery.length === 0) {
    return {
      query: input.query,
      filters: {
        channelId: input.channelId,
        limit,
        scope: "active",
        senderAgentId: input.senderAgentId,
        senderType: input.senderType,
        sort,
        timeFilter,
      },
      conversationHits: [],
      messageHits: [],
      totalCount: 0,
    };
  }

  const cutoff = timeFilterCutoff(timeFilter);
  const activeConversations = (await listConversationsForUser(db, {
    ownerUserId: input.ownerUserId,
    status: "active",
  })).filter((conversation) => {
    if (input.channelId !== undefined && conversation.id !== input.channelId) {
      return false;
    }

    if (cutoff === undefined) {
      return true;
    }

    const activityAt = conversation.lastMessageAt ?? conversation.updatedAt;
    return Date.parse(activityAt) >= cutoff.getTime();
  });
  const directAgentIds = [...new Set(
    activeConversations
      .filter((conversation) => conversation.type === "direct")
      .map((conversation) => conversation.directAgentId)
      .filter((agentId): agentId is string => typeof agentId === "string"),
  )];
  const directAgentMap = new Map<string, { description?: string; name: string }>(
    (
      directAgentIds.length === 0
        ? []
        : await db
            .select({
              description: agents.description,
              id: agents.id,
              name: agents.name,
            })
            .from(agents)
            .where(inArray(agents.id, directAgentIds))
    ).map((agent) => [
      agent.id,
      {
        description: agent.description ?? undefined,
        name: agent.name,
      },
    ]),
  );

  const scoredConversationHits = activeConversations
    .map((conversation): ScoredConversationHit | null => {
      const directAgent = conversation.directAgentId === undefined
        ? undefined
        : directAgentMap.get(conversation.directAgentId);
      const scored = scoreConversationSearchHit({
        conversationDescription: conversation.description,
        conversationTitle: conversation.title,
        directAgentDescription: directAgent?.description,
        directAgentName: directAgent?.name,
        query: normalizedQuery,
      });

      if (scored.score <= 0) {
        return null;
      }

      return {
        conversationId: conversation.id,
        conversationType: conversation.type,
        matchedFields: scored.matchedFields,
        score: scored.score,
        sortTimestamp: Date.parse(conversation.lastMessageAt ?? conversation.updatedAt),
        subtitle: conversationSubtitle(conversation, directAgent?.description),
        title: conversation.type === "direct"
          ? directAgent?.name ?? conversation.title
          : conversation.title,
        type: "conversation",
        updatedAt: conversation.updatedAt,
      };
    })
    .filter((hit): hit is ScoredConversationHit => hit !== null)
    .sort((left, right) => compareScoredHits(left, right, sort));

  const searchableConversationIds = activeConversations.map((conversation) => conversation.id);
  const conversationsById = new Map(
    activeConversations.map((conversation) => [conversation.id, conversation]),
  );

  const messageRows = searchableConversationIds.length === 0
    ? []
    : await db
        .select({
          content: conversationMessages.content,
          conversationId: conversationMessages.conversationId,
          createdAt: conversationMessages.createdAt,
          id: conversationMessages.id,
          senderAgentId: conversationMessages.senderAgentId,
          senderType: conversationMessages.senderType,
        })
        .from(conversationMessages)
        .where(
          and(
            inArray(conversationMessages.conversationId, searchableConversationIds),
            ...(cutoff === undefined
              ? []
              : [gte(conversationMessages.createdAt, cutoff)]),
            ...(input.senderType === undefined
              ? []
              : [eq(conversationMessages.senderType, input.senderType)]),
            ...(input.senderAgentId === undefined
              ? []
              : [eq(conversationMessages.senderAgentId, input.senderAgentId)]),
          ),
        )
        .orderBy(desc(conversationMessages.createdAt));
  const senderAgentIds = [...new Set(
    messageRows
      .map((message) => message.senderAgentId ?? undefined)
      .filter((agentId): agentId is string => typeof agentId === "string"),
  )];
  const senderAgentMap = new Map<string, string>(
    (
      senderAgentIds.length === 0
        ? []
        : await db
            .select({ id: agents.id, name: agents.name })
            .from(agents)
            .where(inArray(agents.id, senderAgentIds))
    ).map((agent) => [agent.id, agent.name]),
  );
  const scoredMessageHits = messageRows
    .map((message): ScoredMessageHit | null => {
      const conversation = conversationsById.get(message.conversationId);

      if (conversation === undefined) {
        return null;
      }

      const senderLabel = message.senderType === "user"
        ? "User"
        : message.senderType === "agent"
          ? message.senderAgentId === null
            ? "Agent"
            : senderAgentMap.get(message.senderAgentId) ?? "Agent"
          : "System";
      const conversationLabel = conversation.type === "direct"
        ? (
            conversation.directAgentId === undefined
              ? conversation.title
              : directAgentMap.get(conversation.directAgentId)?.name ?? conversation.title
          )
        : conversation.title;
      const scored = scoreMessageSearchHit({
        content: message.content,
        conversationLabel,
        query: normalizedQuery,
        senderLabel,
      });

      if (scored.score <= 0) {
        return null;
      }

      return {
        conversationId: message.conversationId,
        conversationLabel,
        createdAt: message.createdAt.toISOString(),
        matchedFields: scored.matchedFields,
        messageId: message.id,
        score: scored.score,
        senderAgentId: message.senderAgentId ?? undefined,
        senderLabel,
        senderType: message.senderType as MessageSearchHit["senderType"],
        snippet: buildMessageSearchSnippet({
          content: message.content,
          query: normalizedQuery,
        }),
        sortTimestamp: message.createdAt.getTime(),
        type: "message",
      };
    })
    .filter((hit): hit is ScoredMessageHit => hit !== null)
    .sort((left, right) => compareScoredHits(left, right, sort));
  const totalCount = scoredConversationHits.length + scoredMessageHits.length;

  return {
    conversationHits: scoredConversationHits
      .slice(0, limit)
      .map(({ score: _score, sortTimestamp: _sortTimestamp, ...hit }) => hit),
    filters: {
      channelId: input.channelId,
      limit,
      scope: "active",
      senderAgentId: input.senderAgentId,
      senderType: input.senderType,
      sort,
      timeFilter,
    },
    messageHits: scoredMessageHits
      .slice(0, limit)
      .map(({ score: _score, sortTimestamp: _sortTimestamp, ...hit }) => hit),
    query: input.query,
    totalCount,
  };
}
