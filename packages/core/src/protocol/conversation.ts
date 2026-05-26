import type { AgentId, IsoDateTime, UserId } from "./agent.js";
import type { AgentRun, RunId } from "./run.js";

export type ConversationId = string;
export type ConversationMessageId = string;
export type ConversationTaskId = string;

export type ConversationType = "group" | "direct";
export type ConversationStatus = "active" | "archived";
export type ConversationMessageSenderType = "user" | "agent" | "system";
export type ConversationMessageStatus =
  | "completed"
  | "streaming"
  | "failed"
  | "cancelled";
export type ConversationTaskStatus =
  | "created"
  | "assigned"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface Conversation {
  id: ConversationId;
  ownerUserId: UserId;
  type: ConversationType;
  key?: string;
  title: string;
  description?: string;
  directAgentId?: AgentId;
  agentIds?: AgentId[];
  orchestratorAgentId?: AgentId;
  status: ConversationStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  lastMessageAt?: IsoDateTime;
}

export interface ConversationMessage {
  id: ConversationMessageId;
  conversationId: ConversationId;
  senderType: ConversationMessageSenderType;
  senderAgentId?: AgentId;
  runId?: RunId;
  content: string;
  status: ConversationMessageStatus;
  error?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ConversationTask {
  id: ConversationTaskId;
  ownerUserId: UserId;
  conversationId: ConversationId;
  creatorRunId: RunId;
  orchestratorAgentId: AgentId;
  assigneeAgentId: AgentId;
  assigneeRunId?: RunId;
  dispatchMessageId?: ConversationMessageId;
  title: string;
  description?: string;
  status: ConversationTaskStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ListConversationsResponse {
  conversations: Conversation[];
}

export interface EnsureDefaultGroupConversationResponse {
  conversation: Conversation;
}

export interface EnsureDirectConversationRequest {
  agentId: AgentId;
}

export interface EnsureDirectConversationResponse {
  conversation: Conversation;
}

export interface CreateGroupConversationRequest {
  title: string;
  description?: string;
  agentIds: AgentId[];
  orchestratorAgentId?: AgentId;
}

export interface CreateGroupConversationResponse {
  conversation: Conversation;
}

export interface UpdateGroupConversationRequest {
  title: string;
  description?: string;
  agentIds: AgentId[];
  orchestratorAgentId?: AgentId;
}

export interface UpdateGroupConversationResponse {
  conversation: Conversation;
}

export interface ListConversationMessagesResponse {
  messages: ConversationMessage[];
}

export interface ListConversationTasksResponse {
  tasks: ConversationTask[];
}

export type SendConversationMessageMode = "chat" | "task";

export interface ConversationMention {
  type: "agent";
  agentId: AgentId;
  label?: string;
}

export interface SendConversationMessageRequest {
  content: string;
  mode?: SendConversationMessageMode;
  agentId?: AgentId;
  mentions?: ConversationMention[];
}

export interface SendConversationMessageResponse {
  conversation: Conversation;
  messages: {
    user: ConversationMessage;
    assistant?: ConversationMessage;
    assistants: ConversationMessage[];
  };
  run?: AgentRun;
  runs: AgentRun[];
  queueMessageId?: string;
  queueMessageIds: string[];
}

