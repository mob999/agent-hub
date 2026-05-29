import type { AgentId, IsoDateTime } from "./agent.js";
import type {
  ConversationArtifact,
  ConversationArtifactId,
  ConversationGoal,
  ConversationGoalId,
  ConversationGoalStatus,
  ConversationGoalTask,
  ConversationId,
  ConversationMessageId,
} from "./conversation.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName =
  | "send_message"
  | "list_goals"
  | "list_artifacts"
  | "read_artifact"
  | "create_goal"
  | "create_task"
  | "approve_task"
  | "cancel_task"
  | "upload_artifact"
  | "complete_task"
  | "complete_goal";

export const agentHubAllMcpTools = [
  "send_message",
  "list_goals",
  "list_artifacts",
  "read_artifact",
  "create_goal",
  "create_task",
  "approve_task",
  "cancel_task",
  "complete_goal",
] as const satisfies readonly AgentHubMcpToolName[];

export const agentHubNonOrchestratorMcpTools = [
  "send_message",
  "list_goals",
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

export interface AgentHubCreateGoalToolInput {
  title: string;
  description?: string;
}

export interface AgentHubCreateGoalToolResult {
  accepted: true;
  goal: ConversationGoal;
}

export interface AgentHubListGoalsToolInput {
  status?: ConversationGoalStatus;
}

export interface AgentHubListGoalsToolResult {
  accepted: true;
  goals: ConversationGoal[];
}

export interface AgentHubCreateTaskToolInput {
  goalId: ConversationGoalId;
  title: string;
  description?: string;
  assigneeAgentId: AgentId;
  dependsOnTaskIndexes?: number[];
}

export interface AgentHubCreateTaskToolResult {
  accepted: true;
  task: ConversationGoalTask;
}

export interface AgentHubApproveTaskToolInput {
  goalId: ConversationGoalId;
  taskIndex: number;
}

export interface AgentHubApproveTaskToolResult {
  accepted: true;
  goalId: ConversationGoalId;
  taskIndex: number;
  runId?: RunId;
}

export interface AgentHubCancelTaskToolInput {
  goalId: ConversationGoalId;
  taskIndex: number;
  reason?: string;
}

export interface AgentHubCancelTaskToolResult {
  accepted: true;
  goalId: ConversationGoalId;
  taskIndex: number;
}

export interface AgentHubCompleteGoalToolInput {
  goalId: ConversationGoalId;
  summary?: string;
}

export interface AgentHubCompleteGoalToolResult {
  accepted: true;
  goal: ConversationGoal;
}

export interface AgentHubListArtifactsToolInput {
  goalId: ConversationGoalId;
  taskIndex?: number;
  limit?: number;
}

export interface AgentHubListArtifactsToolResult {
  accepted: true;
  artifacts: ConversationArtifact[];
}

export interface AgentHubReadArtifactToolInput {
  goalId: ConversationGoalId;
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
  goalId: ConversationGoalId;
  taskIndex: number;
  title: string;
  localPath: string;
  filename?: string;
}

export interface AgentHubUploadArtifactToolResult {
  accepted: true;
  artifact: ConversationArtifact;
}

export interface AgentHubCompleteTaskToolInput {
  goalId: ConversationGoalId;
  taskIndex: number;
  summary: string;
  artifactIds?: ConversationArtifactId[];
}

export interface AgentHubCompleteTaskToolResult {
  accepted: true;
}

export type AgentHubMcpToolInput =
  | AgentHubSendMessageToolInput
  | AgentHubCreateGoalToolInput
  | AgentHubListGoalsToolInput
  | AgentHubListArtifactsToolInput
  | AgentHubReadArtifactToolInput
  | AgentHubCreateTaskToolInput
  | AgentHubApproveTaskToolInput
  | AgentHubCancelTaskToolInput
  | AgentHubUploadArtifactToolInput
  | AgentHubCompleteTaskToolInput
  | AgentHubCompleteGoalToolInput;
export type AgentHubMcpToolResult =
  | AgentHubSendMessageToolResult
  | AgentHubCreateGoalToolResult
  | AgentHubListGoalsToolResult
  | AgentHubListArtifactsToolResult
  | AgentHubReadArtifactToolResult
  | AgentHubCreateTaskToolResult
  | AgentHubApproveTaskToolResult
  | AgentHubCancelTaskToolResult
  | AgentHubUploadArtifactToolResult
  | AgentHubCompleteTaskToolResult
  | AgentHubCompleteGoalToolResult;

export interface AgentHubMcpToolCall {
  runId: RunId;
  toolCallId: string;
  name: AgentHubMcpToolName;
  input: AgentHubMcpToolInput;
  createdAt: IsoDateTime;
}
