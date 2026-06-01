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
  AgentHubListGoalsToolResult,
  AgentHubMcpToolCall,
  AgentHubMcpToolResult,
  AgentHubSendMessageTarget,
} from "./mcp.js";
import type {
  ConversationArtifact,
  ConversationArtifactActionId,
  ConversationArtifactActionType,
  ConversationArtifactId,
  ConversationGoalId,
} from "./conversation.js";
import type { AgentRun, RunEvent, RunId } from "./run.js";

export interface DaemonRunAssignment {
  run: AgentRun;
  prompt: string;
  contextCompression?: {
    compressibleText: string;
    promptTemplate: string;
    thresholdChars: number;
  };
  agentInstructions?: string;
  workspacePath: string;
  runtime: AgentRuntimeConfig;
  agentHubMcpTools?: AgentHubMcpToolName[];
  agentHubMcpGoals?: AgentHubListGoalsToolResult["goals"];
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
      type: "agenthub.tool.call";
      requestId: string;
      call: AgentHubMcpToolCall;
      sentAt: IsoDateTime;
    }
  | {
      type: "artifact.upload";
      uploadId: string;
      runId: RunId;
      goalId?: ConversationGoalId;
      taskIndex?: number;
      messageTarget?: AgentHubSendMessageTarget;
      title: string;
      filename: string;
      sizeBytes: number;
      contentBase64: string;
      sourcePath?: string;
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
      type: "memory.appended";
      requestId: string;
      entryId: string;
      file: string;
      sentAt: IsoDateTime;
    }
  | {
      type: "memory.append_failed";
      requestId: string;
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
      sourcePath?: string;
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
    }
  | {
      type: "memory.append";
      requestId: string;
      workspacePath: string;
      kind: "daily" | "transcript";
      title?: string;
      content: string;
      tags?: string[];
      date?: string;
      dedupeKey?: string;
      sentAt: IsoDateTime;
    }
  | {
      type: "agenthub.tool.call.result";
      requestId: string;
      result: AgentHubMcpToolResult;
      sentAt: IsoDateTime;
    }
  | {
      type: "agenthub.tool.call.rejected";
      requestId: string;
      reason: string;
      sentAt: IsoDateTime;
    };
