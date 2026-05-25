import type {
  AgentRuntimeBinding,
  AgentRuntimeConfig,
} from "../protocol/index.js";
import type { AgentRun, RunEvent } from "../protocol/index.js";

export interface AgentRunInput {
  run: AgentRun;
  prompt: string;
  workspacePath: string;
  runtime: AgentRuntimeConfig;
  abortSignal?: AbortSignal;
}

export interface AgentAdapter {
  readonly runtimeKind: AgentRuntimeBinding["runtimeKind"];
  detect(): Promise<AgentRuntimeBinding>;
  run(input: AgentRunInput): AsyncIterable<RunEvent>;
  cancel?(runId: AgentRun["id"]): Promise<void>;
}
