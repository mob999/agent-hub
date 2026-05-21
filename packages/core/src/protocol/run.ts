import type { AgentId, DaemonDeviceId, IsoDateTime } from "./agent";
import type { Artifact } from "./artifact";

export type RunId = string;

export type RunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

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
