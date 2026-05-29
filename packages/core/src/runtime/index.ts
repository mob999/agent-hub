import type {
  AgentHubSendMessageTarget,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
  AgentRuntimeConfig,
  AgentHubListGoalsToolResult,
  AgentHubMcpToolCall,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  DaemonRuntime,
} from "../protocol/index.js";
import type { AgentRun, RunEvent } from "../protocol/index.js";

export interface AgentRunArtifactUpload
  extends Omit<AgentHubUploadArtifactToolInput, "goalId" | "taskIndex"> {
  messageTarget?: AgentHubSendMessageTarget;
  goalId?: AgentHubUploadArtifactToolInput["goalId"];
  taskIndex?: AgentHubUploadArtifactToolInput["taskIndex"];
  filename: string;
  sourcePath?: string;
  sizeBytes: number;
  contentBase64: string;
}

export interface AgentRunInput {
  run: AgentRun;
  prompt: string;
  agentInstructions?: string;
  workspacePath: string;
  runtime: AgentRuntimeConfig;
  agentHubMcpTools?: AgentHubMcpToolName[];
  agentHubMcpGoals?: AgentHubListGoalsToolResult["goals"];
  uploadArtifact?(
    upload: AgentRunArtifactUpload,
  ): Promise<AgentHubUploadArtifactToolResult>;
  callAgentHubMcpTool?(
    call: AgentHubMcpToolCall,
  ): Promise<AgentHubMcpToolResult>;
  abortSignal?: AbortSignal;
}

export interface AgentAdapter {
  readonly runtimeKind: DaemonRuntime["runtimeKind"];
  detect(): Promise<DaemonRuntime>;
  run(input: AgentRunInput): AsyncIterable<RunEvent>;
  cancel?(runId: AgentRun["id"]): Promise<void>;
}
