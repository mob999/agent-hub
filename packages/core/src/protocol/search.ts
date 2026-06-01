import type { IsoDateTime } from "./agent.js";
import type { ConversationId, ConversationStatus, ConversationType } from "./conversation.js";

export type SearchSort = "relevant" | "recent";
export type SearchTimeFilter = "any" | "24h" | "7d" | "30d";
export type SearchSenderType = "user" | "agent" | "system";

export interface ConversationSearchHit {
  type: "conversation";
  conversationId: ConversationId;
  conversationType: ConversationType;
  title: string;
  subtitle: string;
  matchedFields: Array<"title" | "description" | "agentName" | "agentDescription">;
  updatedAt: IsoDateTime;
}

export interface MessageSearchHit {
  type: "message";
  conversationId: ConversationId;
  messageId: string;
  senderType: SearchSenderType;
  senderAgentId?: string;
  senderLabel: string;
  conversationLabel: string;
  snippet: string;
  matchedFields: Array<"content" | "senderName" | "conversationTitle">;
  createdAt: IsoDateTime;
}

export interface SearchConversationsRequest {
  query: string;
  channelId?: ConversationId;
  senderAgentId?: string;
  senderType?: SearchSenderType;
  timeFilter?: SearchTimeFilter;
  sort?: SearchSort;
  limit?: number;
}

export interface SearchConversationsResponse {
  query: string;
  filters: {
    channelId?: ConversationId;
    senderAgentId?: string;
    senderType?: SearchSenderType;
    timeFilter: SearchTimeFilter;
    sort: SearchSort;
    limit: number;
    scope: ConversationStatus;
  };
  conversationHits: ConversationSearchHit[];
  messageHits: MessageSearchHit[];
  totalCount: number;
}
