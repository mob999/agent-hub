import type {
  AgentDetails,
  AgentId,
  AgentRuntimeConfig,
  AgentWorkspace,
  DaemonRuntime,
  DaemonDeviceId,
  IsoDateTime,
} from "./agent.js";
import type { AgentRun, RunEvent, RunId } from "./run.js";

export interface DaemonRunAssignment {
  run: AgentRun;
  prompt: string;
  workspacePath: string;
  runtime: AgentRuntimeConfig;
}

export type DaemonClientMessage =
  | {
      type: "daemon.hello";
      deviceId: DaemonDeviceId;
      token: string;
      runtimes: DaemonRuntime[];
      sentAt: IsoDateTime;
    }
  | {
      type: "daemon.heartbeat";
      deviceId: DaemonDeviceId;
      runningRunIds: RunId[];
      sentAt: IsoDateTime;
    }
  | {
      type: "run.accepted";
      runId: RunId;
      sentAt: IsoDateTime;
    }
  | {
      type: "run.rejected";
      runId: RunId;
      reason: string;
      sentAt: IsoDateTime;
    }
  | {
      type: "run.event";
      runId: RunId;
      event: RunEvent;
      sentAt: IsoDateTime;
    }
  | {
      type: "agent.created";
      agentId: AgentId;
      daemonDeviceId: DaemonDeviceId;
      workspace: AgentWorkspace;
      runtime: AgentRuntimeConfig;
      sentAt: IsoDateTime;
    }
  | {
      type: "agent.create_failed";
      agentId: AgentId;
      daemonDeviceId: DaemonDeviceId;
      reason: string;
      sentAt: IsoDateTime;
    };

export type DaemonServerMessage =
  | {
      type: "daemon.hello.ack";
      deviceId: DaemonDeviceId;
      serverTime: IsoDateTime;
    }
  | ({
      type: "run.assigned";
      agentId: AgentId;
      daemonDeviceId: DaemonDeviceId;
    } & DaemonRunAssignment)
  | {
      type: "agent.create";
      agent: AgentDetails["agent"];
      daemonDeviceId: DaemonDeviceId;
      runtime: AgentRuntimeConfig;
      sentAt: IsoDateTime;
    }
  | {
      type: "run.cancel";
      runId: RunId;
      reason?: string;
    };
