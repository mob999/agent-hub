import type { AgentId, IsoDateTime } from "./agent.js";
import type {
  ConversationArtifact,
  ConversationArtifactId,
  ConversationMention,
  ConversationTaskId,
} from "./conversation.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName =
  | "send_message"
  | "create_task"
  | "upload_artifact"
  | "complete_task";

export interface AgentHubSendMessageToolInput {
  content: string;
  mentions?: ConversationMention[];
  taskIds?: ConversationTaskId[];
}

export interface AgentHubSendMessageToolResult {
  accepted: true;
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
  mimeType?: string;
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
  | AgentHubCreateTaskToolInput
  | AgentHubUploadArtifactToolInput
  | AgentHubCompleteTaskToolInput;
export type AgentHubMcpToolResult =
  | AgentHubSendMessageToolResult
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
