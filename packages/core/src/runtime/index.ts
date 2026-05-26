import type {
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
  AgentRuntimeConfig,
  AgentHubMcpToolName,
  DaemonRuntime,
} from "../protocol/index.js";
import type { AgentRun, RunEvent } from "../protocol/index.js";

export interface AgentRunArtifactUpload extends AgentHubUploadArtifactToolInput {
  filename: string;
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
