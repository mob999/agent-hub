import type { AgentId, DaemonDeviceId, IsoDateTime } from "./agent";
import type { Artifact } from "./artifact";

export type RunId = string;

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type RunLogStream = "stdout" | "stderr";
export type ToolCallStatus = "succeeded" | "failed";

export interface AgentRun {
  id: RunId;
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
  status: RunStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
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
      type: "tool.call.started";
      runId: RunId;
      toolCallId: string;
      name: string;
      input?: unknown;
      createdAt: IsoDateTime;
    }
  | {
      type: "tool.call.completed";
      runId: RunId;
      toolCallId: string;
      status: ToolCallStatus;
      output?: unknown;
      error?: string;
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
      status: Extract<RunStatus, "succeeded" | "failed" | "cancelled">;
      error?: string;
      createdAt: IsoDateTime;
    };
