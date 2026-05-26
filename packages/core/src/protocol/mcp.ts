import type { IsoDateTime } from "./agent.js";
import type { RunId } from "./run.js";

export type AgentHubMcpToolName = "send_message";

export interface AgentHubSendMessageToolInput {
  content: string;
}

export interface AgentHubSendMessageToolResult {
  accepted: true;
}

export type AgentHubMcpToolInput = AgentHubSendMessageToolInput;
export type AgentHubMcpToolResult = AgentHubSendMessageToolResult;

export interface AgentHubMcpToolCall {
  runId: RunId;
  toolCallId: string;
  name: AgentHubMcpToolName;
  input: AgentHubMcpToolInput;
  createdAt: IsoDateTime;
}
