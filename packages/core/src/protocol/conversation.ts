import type { AgentId, IsoDateTime, UserId } from "./agent.js";
import type { AgentRun, RunId } from "./run.js";

export type ConversationId = string;
export type ConversationMessageId = string;
export type ConversationGoalId = string;
export type ConversationGoalTaskId = string;
export type ConversationArtifactId = string;

export type ConversationType = "group" | "direct";
export type ConversationStatus = "active" | "archived";
export type ConversationMessageSenderType = "user" | "agent" | "system";
export type ConversationMessageStatus =
  | "completed"
  | "streaming"
  | "failed"
  | "cancelled";
export type ConversationGoalStatus =
  | "active"
  | "completed"
  | "cancelled"
  | "failed";
export type ConversationGoalTaskStatus =
  | "waiting"
  | "ready"
  | "assigned"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";
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
  attachments?: ConversationMessageAttachment[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ConversationArtifact {
  id: ConversationArtifactId;
  ownerUserId: UserId;
  conversationId: ConversationId;
  goalId?: ConversationGoalId;
  goalTaskId?: ConversationGoalTaskId;
  taskIndex?: number;
  runId: RunId;
  creatorAgentId: AgentId;
  status: ConversationArtifactStatus;
  title: string;
  filename: string;
  sizeBytes: number;
  latestRevisionId?: ConversationArtifactRevisionId;
  downloadUrl?: string;
  editorUrl?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ConversationMessageAttachment {
  id: string;
  messageId: ConversationMessageId;
  artifactId: ConversationArtifactId;
  type: "image";
  artifact: ConversationArtifact;
  createdAt: IsoDateTime;
}

export type ConversationArtifactRevisionId = string;
export type ConversationArtifactActionId = string;
export type ConversationDeploymentId = string;

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

export interface ConversationDeployment {
  id: ConversationDeploymentId;
  ownerUserId: UserId;
  conversationId: ConversationId;
  goalId?: ConversationGoalId;
  taskIndex?: number;
  runId: RunId;
  creatorAgentId: AgentId;
  title: string;
  entrypoint: string;
  status: "ready" | "failed" | "deleted";
  url?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ConversationGoalTask {
  id: ConversationGoalTaskId;
  goalId: ConversationGoalId;
  index: number;
  assigneeAgentId: AgentId;
  assigneeRunId?: RunId;
  dispatchMessageId?: ConversationMessageId;
  dependsOnTaskIndexes?: number[];
  title: string;
  description?: string;
  status: ConversationGoalTaskStatus;
  blockedReason?: string;
  summary?: string;
  resultArtifactIds?: ConversationArtifactId[];
  artifacts?: ConversationArtifact[];
  completedAt?: IsoDateTime;
  checkpointRunId?: RunId;
  webUrl?: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ConversationGoal {
  id: ConversationGoalId;
  ownerUserId: UserId;
  conversationId: ConversationId;
  orchestratorAgentId: AgentId;
  initialRunId: RunId;
  title: string;
  description?: string;
  status: ConversationGoalStatus;
  summary?: string;
  tasks: ConversationGoalTask[];
  completedAt?: IsoDateTime;
  webUrl?: string;
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

export interface ArchiveGroupConversationResponse {
  conversation: Conversation;
}

export interface RestoreGroupConversationResponse {
  conversation: Conversation;
}

export interface ListConversationMessagesResponse {
  messages: ConversationMessage[];
}

export interface ListConversationGoalsResponse {
  goals: ConversationGoal[];
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

export interface SendConversationMessageRequest {
  content: string;
  mode?: SendConversationMessageMode;
  agentId?: AgentId;
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
