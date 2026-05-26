import type {
  AgentDetails,
  AgentId,
  AgentRuntimeConfig,
  AgentWorkspace,
  DaemonRuntime,
  DaemonDeviceId,
  IsoDateTime,
} from "./agent.js";
import type { AgentHubMcpToolName } from "./mcp.js";
import type {
  ConversationArtifact,
  ConversationArtifactActionId,
  ConversationArtifactActionType,
  ConversationArtifactId,
  ConversationTaskId,
} from "./conversation.js";
import type { AgentRun, RunEvent, RunId } from "./run.js";

export interface DaemonRunAssignment {
  run: AgentRun;
  prompt: string;
  agentInstructions?: string;
  workspacePath: string;
  runtime: AgentRuntimeConfig;
  agentHubMcpTools?: AgentHubMcpToolName[];
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
      type: "artifact.upload";
      uploadId: string;
      runId: RunId;
      taskId: ConversationTaskId;
      title: string;
      filename: string;
      mimeType?: string;
      sizeBytes: number;
      contentBase64: string;
      kind?: ConversationArtifact["kind"];
      metadata?: Record<string, unknown>;
      targetPath?: string;
      displayMode?: string;
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
    }
  | {
      type: "artifact.action.completed";
      actionId: ConversationArtifactActionId;
      status: "succeeded" | "failed" | "cancelled";
      error?: string;
      result?: Record<string, unknown>;
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
    }
  | {
      type: "artifact.action.assigned";
      actionId: ConversationArtifactActionId;
      artifactId: ConversationArtifactId;
      actionType: ConversationArtifactActionType;
      filename: string;
      workspacePath: string;
      contentBase64: string;
      metadata?: Record<string, unknown>;
      targetPath?: string;
      sentAt: IsoDateTime;
    }
  | {
      type: "artifact.upload.ack";
      uploadId: string;
      artifact: ConversationArtifact;
      sentAt: IsoDateTime;
    }
  | {
      type: "artifact.upload.rejected";
      uploadId: string;
      reason: string;
      sentAt: IsoDateTime;
    };
