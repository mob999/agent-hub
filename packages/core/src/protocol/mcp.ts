import type { AgentId, IsoDateTime } from "./agent.js";
import type {
  ConversationArtifact,
  ConversationArtifactId,
  ConversationId,
  ConversationMessageId,
  ConversationTaskStatus,
  ConversationTaskId,
} from "./conversation.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName =
  | "send_message"
  | "list_tasks"
  | "list_artifacts"
  | "read_artifact"
  | "create_task"
  | "approve_task"
  | "cancel_task"
  | "upload_artifact"
  | "complete_task"
  | "complete_workflow";

export const agentHubAllMcpTools = [
  "send_message",
  "list_tasks",
  "list_artifacts",
  "read_artifact",
  "create_task",
  "approve_task",
  "cancel_task",
  "upload_artifact",
  "complete_task",
  "complete_workflow",
] as const satisfies readonly AgentHubMcpToolName[];

export const agentHubNonOrchestratorMcpTools = [
  "send_message",
  "list_tasks",
  "list_artifacts",
  "read_artifact",
  "upload_artifact",
  "complete_task",
] as const satisfies readonly AgentHubMcpToolName[];

export type AgentHubSendMessageTarget =
  | { type: "current" }
  | { type: "group"; groupName: string }
  | { type: "user" };

export interface AgentHubSendMessageAttachmentInput {
  type: "image";
  localPath?: string;
  artifactId?: ConversationArtifactId;
  title?: string;
  filename?: string;
}

export interface AgentHubSendMessageToolInput {
  target?: AgentHubSendMessageTarget;
  content: string;
  attachments?: AgentHubSendMessageAttachmentInput[];
}

export interface AgentHubSendMessageToolResult {
  accepted: true;
  conversationId?: ConversationId;
  messageId?: ConversationMessageId;
  attachments?: ConversationArtifact[];
}

export interface AgentHubListTasksToolInput {
  status?: ConversationTaskStatus;
}

export interface AgentHubListTasksToolResult {
  accepted: true;
  tasks: Array<{
    id: ConversationTaskId;
    title: string;
    assigneeAgentId: AgentId;
    assigneeRunId?: RunId;
    workflowId?: string;
    dependsOnTaskIds?: ConversationTaskId[];
    description?: string;
    status: ConversationTaskStatus;
    blockedReason?: string;
    summary?: string;
    resultArtifactIds?: ConversationArtifactId[];
  }>;
}

export interface AgentHubCreateTaskToolInput {
  title: string;
  description?: string;
  assigneeAgentId: AgentId;
  dependsOnTaskIds?: ConversationTaskId[];
  taskId?: ConversationTaskId;
}

export interface AgentHubCreateTaskToolResult {
  accepted: true;
  task: {
    id: ConversationTaskId;
    title: string;
    assigneeAgentId: AgentId;
    status: ConversationTaskStatus;
    dependsOnTaskIds?: ConversationTaskId[];
  };
}

export interface AgentHubApproveTaskToolInput {
  taskId: ConversationTaskId;
}

export interface AgentHubApproveTaskToolResult {
  accepted: true;
  taskId: ConversationTaskId;
  runId?: RunId;
}

export interface AgentHubCancelTaskToolInput {
  taskId: ConversationTaskId;
  reason?: string;
}

export interface AgentHubCancelTaskToolResult {
  accepted: true;
  taskId: ConversationTaskId;
}

export interface AgentHubCompleteWorkflowToolInput {
  summary?: string;
}

export interface AgentHubCompleteWorkflowToolResult {
  accepted: true;
  workflowId: string;
}

export interface AgentHubListArtifactsToolInput {
  taskId?: ConversationTaskId;
  limit?: number;
}

export interface AgentHubListArtifactsToolResult {
  accepted: true;
  artifacts: ConversationArtifact[];
}

export interface AgentHubReadArtifactToolInput {
  artifactId: ConversationArtifactId;
}

export interface AgentHubReadArtifactToolResult {
  accepted: true;
  artifact: ConversationArtifact;
  contentBase64?: string;
  contentText?: string;
  encoding: "base64" | "text";
  truncated?: boolean;
}

export interface AgentHubUploadArtifactToolInput {
  taskId: ConversationTaskId;
  title: string;
  localPath: string;
  filename?: string;
}

export interface AgentHubUploadArtifactToolResult {
  accepted: true;
  artifact: ConversationArtifact;
}

export interface AgentHubCompleteTaskToolInput {
  taskId: ConversationTaskId;
  summary: string;
  artifactIds?: ConversationArtifactId[];
}

export interface AgentHubCompleteTaskToolResult {
  accepted: true;
}

export type AgentHubMcpToolInput =
  | AgentHubSendMessageToolInput
  | AgentHubListTasksToolInput
  | AgentHubListArtifactsToolInput
  | AgentHubReadArtifactToolInput
  | AgentHubCreateTaskToolInput
  | AgentHubApproveTaskToolInput
  | AgentHubCancelTaskToolInput
  | AgentHubUploadArtifactToolInput
  | AgentHubCompleteTaskToolInput
  | AgentHubCompleteWorkflowToolInput;
export type AgentHubMcpToolResult =
  | AgentHubSendMessageToolResult
  | AgentHubListTasksToolResult
  | AgentHubListArtifactsToolResult
  | AgentHubReadArtifactToolResult
  | AgentHubCreateTaskToolResult
  | AgentHubApproveTaskToolResult
  | AgentHubCancelTaskToolResult
  | AgentHubUploadArtifactToolResult
  | AgentHubCompleteTaskToolResult
  | AgentHubCompleteWorkflowToolResult;

export interface AgentHubMcpToolCall {
  runId: RunId;
  toolCallId: string;
  name: AgentHubMcpToolName;
  input: AgentHubMcpToolInput;
  createdAt: IsoDateTime;
}
