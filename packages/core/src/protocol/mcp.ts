import type { AgentId, IsoDateTime } from "./agent.js";
import type {
  ConversationArtifact,
  ConversationArtifactId,
  ConversationMention,
  ConversationTaskStatus,
  ConversationTaskId,
} from "./conversation.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName =
  | "send_message"
  | "list_tasks"
  | "create_task"
  | "upload_artifact"
  | "complete_task";

export const agentHubAllMcpTools = [
  "send_message",
  "list_tasks",
  "create_task",
  "upload_artifact",
  "complete_task",
] as const satisfies readonly AgentHubMcpToolName[];

export const agentHubNonOrchestratorMcpTools = [
  "send_message",
  "list_tasks",
  "upload_artifact",
  "complete_task",
] as const satisfies readonly AgentHubMcpToolName[];

export interface AgentHubSendMessageToolInput {
  content: string;
  mentions?: ConversationMention[];
  taskIds?: ConversationTaskId[];
}

export interface AgentHubSendMessageToolResult {
  accepted: true;
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
    description?: string;
    status: ConversationTaskStatus;
    summary?: string;
  }>;
}

export interface AgentHubCreateTaskToolInput {
  title: string;
  description?: string;
  assigneeAgentId: AgentId;
  taskId?: ConversationTaskId;
}

export interface AgentHubCreateTaskToolResult {
  accepted: true;
  task: {
    id: ConversationTaskId;
    title: string;
    assigneeAgentId: AgentId;
  };
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
  | AgentHubCreateTaskToolInput
  | AgentHubUploadArtifactToolInput
  | AgentHubCompleteTaskToolInput;
export type AgentHubMcpToolResult =
  | AgentHubSendMessageToolResult
  | AgentHubListTasksToolResult
  | AgentHubCreateTaskToolResult
  | AgentHubUploadArtifactToolResult
  | AgentHubCompleteTaskToolResult;

export interface AgentHubMcpToolCall {
  runId: RunId;
  toolCallId: string;
  name: AgentHubMcpToolName;
  input: AgentHubMcpToolInput;
  createdAt: IsoDateTime;
}
