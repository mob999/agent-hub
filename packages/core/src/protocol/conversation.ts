import type { AgentId, IsoDateTime, UserId } from "./agent.js";
import type { AgentRun, RunId } from "./run.js";

export type ConversationId = string;
export type ConversationMessageId = string;
export type ConversationTaskId = string;
export type ConversationArtifactId = string;

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
export type ConversationArtifactKind =
  | "file"
  | "diff"
  | "web_preview"
  | "document"
  | "slide_deck"
  | "image"
  | "workflow_result"
  | "deployment"
  | "report";
export type ConversationArtifactStatus =
  | "pending"
  | "ready"
  | "failed"
  | "deleted";
export type ConversationArtifactActionType = "apply" | "publish" | "preview";
export type ConversationArtifactActionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";
export type ConversationArtifactDisplayMode =
  | "code"
  | "diff"
  | "markdown"
  | "preview"
  | "record";

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

export interface ConversationArtifact {
  id: ConversationArtifactId;
  ownerUserId: UserId;
  conversationId: ConversationId;
  taskId?: ConversationTaskId;
  runId: RunId;
  creatorAgentId: AgentId;
  kind: ConversationArtifactKind;
  status: ConversationArtifactStatus;
  title: string;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
  metadata?: Record<string, unknown>;
  latestRevisionId?: ConversationArtifactRevisionId;
  downloadUrl?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ConversationArtifactRevisionId = string;
export type ConversationArtifactActionId = string;

export interface ConversationArtifactRevision {
  id: ConversationArtifactRevisionId;
  artifactId: ConversationArtifactId;
  ownerUserId: UserId;
  conversationId: ConversationId;
  runId?: RunId;
  editorUserId?: UserId;
  contentHash: string;
  summary?: string;
  createdAt: IsoDateTime;
}

export interface ConversationArtifactAction {
  id: ConversationArtifactActionId;
  artifactId: ConversationArtifactId;
  revisionId?: ConversationArtifactRevisionId;
  type: ConversationArtifactActionType;
  status: ConversationArtifactActionStatus;
  runId?: RunId;
  error?: string;
  result?: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ConversationArtifactDetails {
  artifact: ConversationArtifact;
  latestRevision?: ConversationArtifactRevision;
  actions: ConversationArtifactAction[];
  availableActions: ConversationArtifactActionType[];
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
  summary?: string;
  resultArtifactIds?: ConversationArtifactId[];
  artifacts?: ConversationArtifact[];
  completedAt?: IsoDateTime;
  finalizerRunId?: RunId;
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

export interface ListConversationArtifactsResponse {
  artifacts: ConversationArtifact[];
}

export interface GetConversationArtifactResponse
  extends ConversationArtifactDetails {}

export interface GetConversationArtifactContentResponse {
  content: string;
  revision?: ConversationArtifactRevision;
}

export interface CreateConversationArtifactRevisionRequest {
  content: string;
  summary?: string;
}

export interface CreateConversationArtifactRevisionResponse {
  revision: ConversationArtifactRevision;
}

export interface CreateConversationArtifactActionResponse {
  action: ConversationArtifactAction;
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

