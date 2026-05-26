import type { AgentId, IsoDateTime } from "./agent.js";
import type { ConversationMention, ConversationTaskId } from "./conversation.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName = "send_message" | "create_task";

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

export type AgentHubMcpToolInput =
  | AgentHubSendMessageToolInput
  | AgentHubCreateTaskToolInput;
export type AgentHubMcpToolResult =
  | AgentHubSendMessageToolResult
  | AgentHubCreateTaskToolResult;

export interface AgentHubMcpToolCall {
  runId: RunId;
  toolCallId: string;
  name: AgentHubMcpToolName;
  input: AgentHubMcpToolInput;
  createdAt: IsoDateTime;
}
