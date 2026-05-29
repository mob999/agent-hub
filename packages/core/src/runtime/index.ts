import type {
  AgentHubSendMessageTarget,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
  AgentRuntimeConfig,
  AgentHubListTasksToolResult,
  AgentHubMcpToolName,
  DaemonRuntime,
} from "../protocol/index.js";
import type { AgentRun, RunEvent } from "../protocol/index.js";

export interface AgentRunArtifactUpload
  extends Omit<AgentHubUploadArtifactToolInput, "taskId"> {
  messageTarget?: AgentHubSendMessageTarget;
  taskId?: AgentHubUploadArtifactToolInput["taskId"];
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
  agentHubMcpTasks?: AgentHubListTasksToolResult["tasks"];
  uploadArtifact?(
    upload: AgentRunArtifactUpload,
  ): Promise<AgentHubUploadArtifactToolResult>;
  abortSignal?: AbortSignal;
}

export interface AgentAdapter {
  readonly runtimeKind: DaemonRuntime["runtimeKind"];
  detect(): Promise<DaemonRuntime>;
  run(input: AgentRunInput): AsyncIterable<RunEvent>;
  cancel?(runId: AgentRun["id"]): Promise<void>;
}
