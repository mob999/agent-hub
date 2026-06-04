import type { AgentId, IsoDateTime } from "./agent.js";
import type {
  ConversationArtifact,
  ConversationArtifactId,
  ConversationDeployment,
  ConversationGoal,
  ConversationGoalId,
  ConversationGoalStatus,
  ConversationGoalTask,
  ConversationProjectChange,
  ConversationProjectChangeId,
  ConversationId,
  ConversationMessage,
  ConversationMessageId,
} from "./conversation.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName =
  | "send_message"
  | "list_group_messages"
  | "search_group_messages"
  | "list_goals"
  | "list_artifacts"
  | "read_artifact"
  | "download_artifact"
  | "append_memory"
  | "search_memory"
  | "read_memory"
  | "create_goal"
  | "create_task"
  | "approve_task"
  | "cancel_task"
  | "upload_artifact"
  | "deploy_static_site"
  | "list_project_changes"
  | "read_project_change"
  | "merge_project_change"
  | "reject_project_change"
  | "complete_task"
  | "complete_goal";

export const agentHubAllMcpTools = [
  "send_message",
  "list_group_messages",
  "search_group_messages",
  "list_goals",
  "list_artifacts",
  "read_artifact",
  "download_artifact",
  "append_memory",
  "search_memory",
  "read_memory",
  "create_goal",
  "create_task",
  "approve_task",
  "cancel_task",
  "list_project_changes",
  "read_project_change",
  "merge_project_change",
  "reject_project_change",
  "complete_goal",
] as const satisfies readonly AgentHubMcpToolName[];

export const agentHubNonOrchestratorMcpTools = [
  "send_message",
  "list_group_messages",
  "search_group_messages",
  "list_goals",
  "list_artifacts",
  "read_artifact",
  "download_artifact",
  "append_memory",
  "search_memory",
  "read_memory",
  "list_project_changes",
  "read_project_change",
  "upload_artifact",
  "deploy_static_site",
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
  goalId?: ConversationGoalId;
  taskIndex?: number;
  limit?: number;
}

export interface AgentHubListGroupMessagesToolInput {
  limit?: number;
  beforeMessageId?: ConversationMessageId;
}

export interface AgentHubListGroupMessagesToolResult {
  accepted: true;
  messages: ConversationMessage[];
}

export interface AgentHubSearchGroupMessagesToolInput {
  query: string;
  limit?: number;
}

export interface AgentHubSearchGroupMessagesToolResult {
  accepted: true;
  messages: ConversationMessage[];
}

export interface AgentHubListArtifactsToolResult {
  accepted: true;
  artifacts: ConversationArtifact[];
}

export interface AgentHubReadArtifactToolInput {
  goalId?: ConversationGoalId;
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

export interface AgentHubDownloadArtifactToolInput {
  artifactId: ConversationArtifactId;
  goalId?: ConversationGoalId;
  localPath?: string;
}

export interface AgentHubDownloadArtifactToolResult {
  accepted: true;
  artifact: ConversationArtifact;
  contentBase64?: string;
  filename?: string;
  localPath?: string;
  sizeBytes: number;
}

export type AgentHubMemoryScope = "long_term" | "daily" | "transcript";

export interface AgentHubAppendMemoryToolInput {
  scope?: Exclude<AgentHubMemoryScope, "transcript">;
  title?: string;
  content: string;
  tags?: string[];
}

export interface AgentHubAppendMemoryToolResult {
  accepted: true;
  entryId: string;
  file: string;
}

export interface AgentHubSearchMemoryToolInput {
  query: string;
  scopes?: AgentHubMemoryScope[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface AgentHubMemorySearchResult {
  file: string;
  line: number;
  score: number;
  scope: AgentHubMemoryScope;
  snippet: string;
}

export interface AgentHubSearchMemoryToolResult {
  accepted: true;
  results: AgentHubMemorySearchResult[];
}

export interface AgentHubReadMemoryToolInput {
  scope: AgentHubMemoryScope;
  date?: string;
  maxBytes?: number;
}

export interface AgentHubReadMemoryToolResult {
  accepted: true;
  content: string;
  file: string;
  truncated: boolean;
}

export interface AgentHubUploadArtifactToolInput {
  goalId: ConversationGoalId;
  taskIndex: number;
  title: string;
  localPath: string;
  filename?: string;
  kind?: "file" | "site";
  entrypoint?: string;
}

export interface AgentHubUploadArtifactToolResult {
  accepted: true;
  artifact: ConversationArtifact;
}

export interface AgentHubDeployStaticSiteToolInput {
  goalId?: ConversationGoalId;
  taskIndex?: number;
  title: string;
  localPath: string;
  entrypoint?: string;
}

export interface AgentHubDeployStaticSiteToolResult {
  accepted: true;
  deployment: ConversationDeployment;
}

export interface AgentHubListProjectChangesToolInput {
  status?: ConversationProjectChange["status"];
}

export interface AgentHubListProjectChangesToolResult {
  accepted: true;
  changes: ConversationProjectChange[];
}

export interface AgentHubReadProjectChangeToolInput {
  changeId: ConversationProjectChangeId;
}

export interface AgentHubReadProjectChangeToolResult {
  accepted: true;
  change: ConversationProjectChange;
  diff: string;
}

export interface AgentHubMergeProjectChangeToolInput {
  changeId: ConversationProjectChangeId;
  message?: string;
}

export interface AgentHubMergeProjectChangeToolResult {
  accepted: true;
  change: ConversationProjectChange;
}

export interface AgentHubRejectProjectChangeToolInput {
  changeId: ConversationProjectChangeId;
  reason?: string;
}

export interface AgentHubRejectProjectChangeToolResult {
  accepted: true;
  change: ConversationProjectChange;
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
  | AgentHubListGroupMessagesToolInput
  | AgentHubSearchGroupMessagesToolInput
  | AgentHubCreateGoalToolInput
  | AgentHubListGoalsToolInput
  | AgentHubListArtifactsToolInput
  | AgentHubReadArtifactToolInput
  | AgentHubDownloadArtifactToolInput
  | AgentHubAppendMemoryToolInput
  | AgentHubSearchMemoryToolInput
  | AgentHubReadMemoryToolInput
  | AgentHubCreateTaskToolInput
  | AgentHubApproveTaskToolInput
  | AgentHubCancelTaskToolInput
  | AgentHubUploadArtifactToolInput
  | AgentHubDeployStaticSiteToolInput
  | AgentHubListProjectChangesToolInput
  | AgentHubReadProjectChangeToolInput
  | AgentHubMergeProjectChangeToolInput
  | AgentHubRejectProjectChangeToolInput
  | AgentHubCompleteTaskToolInput
  | AgentHubCompleteGoalToolInput;
export type AgentHubMcpToolResult =
  | AgentHubSendMessageToolResult
  | AgentHubListGroupMessagesToolResult
  | AgentHubSearchGroupMessagesToolResult
  | AgentHubCreateGoalToolResult
  | AgentHubListGoalsToolResult
  | AgentHubListArtifactsToolResult
  | AgentHubReadArtifactToolResult
  | AgentHubDownloadArtifactToolResult
  | AgentHubAppendMemoryToolResult
  | AgentHubSearchMemoryToolResult
  | AgentHubReadMemoryToolResult
  | AgentHubCreateTaskToolResult
  | AgentHubApproveTaskToolResult
  | AgentHubCancelTaskToolResult
  | AgentHubUploadArtifactToolResult
  | AgentHubDeployStaticSiteToolResult
  | AgentHubListProjectChangesToolResult
  | AgentHubReadProjectChangeToolResult
  | AgentHubMergeProjectChangeToolResult
  | AgentHubRejectProjectChangeToolResult
  | AgentHubCompleteTaskToolResult
  | AgentHubCompleteGoalToolResult;

export interface AgentHubMcpToolCall {
  runId: RunId;
  toolCallId: string;
  name: AgentHubMcpToolName;
  input: AgentHubMcpToolInput;
  createdAt: IsoDateTime;
}
