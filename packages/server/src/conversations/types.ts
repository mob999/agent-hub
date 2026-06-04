import type {
  AgentHubMcpToolResult,
  AgentHubSendMessageTarget,
  Conversation,
  ConversationArtifactActionType,
  ConversationMessageAttachment,
  ConversationProject,
  ConversationProjectChange,
  RealtimeEvent,
} from "@agent-hub/core";

import type { MemoryAppendQueueJob, RunQueueJob } from "../queue/index.js";

export interface UserMessageAttachmentUpload {
  artifactId: string;
  attachmentType: ConversationMessageAttachment["type"];
  filename: string;
  sizeBytes: number;
  storageKey: string;
  title: string;
}

export interface ActiveRunContext {
  createdAt: string;
  goalId?: string;
  latestEventType?: string;
  runId: string;
  status: string;
  taskDescription?: string;
  taskId?: string;
  taskIndex?: number;
  taskTitle?: string;
}

export type CreateGroupConversationResult =
  | { status: "created"; conversation: Conversation }
  | { status: "reserved-key" }
  | { status: "duplicate-key" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-group" };

export type CreateProjectConversationResult =
  | { status: "created"; conversation: Conversation; daemonDeviceId: string }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-project" }
  | { status: "agents-not-same-daemon" };

export type UpdateGroupConversationResult =
  | { status: "updated"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "reserved-key" }
  | { status: "duplicate-key" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-group" };

export type UpdateProjectConversationResult =
  | { status: "updated"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-project" }
  | { status: "agents-not-same-daemon" };

export type UpdateConversationOrchestratorResult =
  | { status: "updated"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "agents-not-found" }
  | { status: "orchestrator-not-in-group" };

export type ConversationStatusFilter = Conversation["status"] | "all";

export type ArchiveGroupConversationResult =
  | { status: "archived"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "reserved-key" };

export type RestoreGroupConversationResult =
  | { status: "restored"; conversation: Conversation }
  | { status: "not-found" }
  | { status: "reserved-key" };

export type DeleteArchivedGroupConversationResult =
  | { status: "deleted" }
  | { status: "not-found" }
  | { status: "reserved-key" }
  | { status: "not-archived" };

export type UpdateProjectCloneResult =
  | { status: "updated"; project: ConversationProject }
  | { status: "not-found" };

export interface AppendRunEventResult {
  dispatchJobs: RunQueueJob[];
  memoryAppendJobs: MemoryAppendQueueJob[];
  projectMergeRequests: ProjectChangeMergeRequest[];
  toolResult?: AgentHubMcpToolResult;
  realtimeEvents: RealtimeEvent[];
}

export interface ProjectChangeMergeRequest {
  baseRepoPath: string;
  branchName: string;
  changeId: ConversationProjectChange["id"];
  daemonDeviceId: string;
  message?: string;
}

export interface AppendRunEventOptions {
  publicApiBaseUrl?: string;
  publicWebBaseUrl?: string;
  storageRoot?: string;
}

export interface PersistConversationArtifactUploadInput {
  contentBase64: string;
  filename: string;
  files?: Array<{
    path: string;
    contentBase64: string;
    sizeBytes: number;
  }>;
  entrypoint?: string;
  kind?: "file" | "site";
  publicApiBaseUrl?: string;
  publicWebBaseUrl?: string;
  runId: string;
  messageTarget?: AgentHubSendMessageTarget;
  sizeBytes: number;
  sourcePath?: string;
  storageRoot: string;
  goalId?: string;
  taskIndex?: number;
  title: string;
}

export interface PersistStaticSiteDeploymentInput {
  entrypoint: string;
  files: Array<{
    path: string;
    contentBase64: string;
    sizeBytes: number;
  }>;
  goalId?: string;
  publicApiBaseUrl?: string;
  runId: string;
  storageRoot: string;
  taskIndex?: number;
  title: string;
}

export interface CreateConversationArtifactRevisionInput {
  artifactId: string;
  content: string;
  editorUserId: string;
  ownerUserId: string;
  storageRoot: string;
  summary?: string;
}

export interface CreateConversationArtifactFileRevisionInput {
  artifactId: string;
  content: string;
  editorUserId: string;
  ownerUserId: string;
  path: string;
  storageRoot: string;
  summary?: string;
}

export interface CreateConversationArtifactActionInput {
  artifactId: string;
  ownerUserId: string;
  revisionId?: string;
  type: ConversationArtifactActionType;
}
