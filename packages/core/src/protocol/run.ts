import type {
  AgentId,
  DaemonDeviceId,
  IsoDateTime,
  RuntimeKind,
} from "./agent.js";
import type { Artifact } from "./artifact.js";
import type { AgentHubMcpToolInput, AgentHubMcpToolName } from "./mcp.js";

export type RunId = string;

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export type RunDispatchMode = "new" | "resume";

export type RunLogStream = "stdout" | "stderr";
export type ToolCallStatus = "succeeded" | "failed";

export interface RuntimeRawEvent {
  runtimeKind: RuntimeKind;
  nativeType?: string;
  payload: unknown;
}

export interface AgentRun {
  id: RunId;
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
  status: RunStatus;
  runtimeSessionId?: string;
  parentRunId?: RunId;
  preemptedByRunId?: RunId;
  dispatchMode?: RunDispatchMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface AgentRunSummary {
  run: AgentRun;
  prompt: string;
  conversationId?: string;
}

export type RunEvent =
  | {
      type: "run.queued";
      runId: RunId;
      agentId: AgentId;
      daemonDeviceId: DaemonDeviceId;
      createdAt: IsoDateTime;
    }
  | {
      type: "run.started";
      runId: RunId;
      workspacePath: string;
      createdAt: IsoDateTime;
    }
  | {
      type: "message.delta";
      runId: RunId;
      content: string;
      raw?: RuntimeRawEvent;
      createdAt: IsoDateTime;
    }
  | {
      type: "log.line";
      runId: RunId;
      stream: RunLogStream;
      line: string;
      createdAt: IsoDateTime;
    }
  | {
      type: "runtime.event";
      runId: RunId;
      raw: RuntimeRawEvent;
      createdAt: IsoDateTime;
    }
  | {
      type: "runtime.session.started";
      runId: RunId;
      runtimeKind: RuntimeKind;
      sessionId: string;
      createdAt: IsoDateTime;
    }
  | {
      type: "tool.call.started";
      runId: RunId;
      toolCallId: string;
      name: string;
      input?: unknown;
      raw?: RuntimeRawEvent;
      createdAt: IsoDateTime;
    }
  | {
      type: "tool.call.completed";
      runId: RunId;
      toolCallId: string;
      name?: string;
      status: ToolCallStatus;
      output?: unknown;
      error?: string;
      raw?: RuntimeRawEvent;
      createdAt: IsoDateTime;
    }
  | {
      type: "agenthub.tool.call";
      runId: RunId;
      toolCallId: string;
      name: AgentHubMcpToolName;
      input: AgentHubMcpToolInput;
      raw?: RuntimeRawEvent;
      createdAt: IsoDateTime;
    }
  | {
      type: "artifact.created";
      runId: RunId;
      artifact: Artifact;
      createdAt: IsoDateTime;
    }
  | {
      type: "run.completed";
      runId: RunId;
      status: Extract<RunStatus, "succeeded" | "failed" | "cancelled" | "interrupted">;
      error?: string;
      createdAt: IsoDateTime;
    };
