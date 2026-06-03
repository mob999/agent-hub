import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  AgentHubDeployStaticSiteToolResult,
  AgentHubListGoalsToolResult,
  AgentHubMcpToolInput,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubUploadArtifactToolResult,
  RunEvent,
  RunId,
} from "@agent-hub/core/protocol";
import type {
  AgentRunArtifactUpload,
  AgentRunInput,
  AgentRunStaticSiteDeploy,
} from "@agent-hub/core/runtime";

import type { AgentHubMcpSessionHandle } from "../mcp/relay";

export interface AgentHubMcpServerCommand {
  args: string[];
  command: string;
  cwd?: string;
}

export interface AgentHubMcpRelayLike {
  createSession(input: {
    enabledTools: AgentHubMcpToolName[];
    onArtifactUpload?(
      upload: AgentRunArtifactUpload,
    ): Promise<AgentHubUploadArtifactToolResult>;
    onStaticSiteDeploy?(
      deployment: AgentRunStaticSiteDeploy,
    ): Promise<AgentHubDeployStaticSiteToolResult>;
    onToolCall(call: {
      createdAt: string;
      input: AgentHubMcpToolInput;
      name: AgentHubMcpToolName;
      runId: RunId;
      toolCallId: string;
    }): AgentHubMcpToolResult | Promise<AgentHubMcpToolResult>;
    runId: RunId;
    workspacePath: string;
  }): AgentHubMcpSessionHandle;
}

export interface AgentHubMcpEventSink {
  push(event: RunEvent): void;
}

function resolveTsxLoaderSpecifier(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const repoRoot = path.resolve(currentDir, "../../../..");
  const workspaceLoaderPath = path.resolve(repoRoot, "node_modules/tsx/dist/loader.mjs");

  if (existsSync(workspaceLoaderPath)) {
    return pathToFileURL(workspaceLoaderPath).href;
  }

  return "tsx";
}

export function createAgentHubMcpServerCommand(): AgentHubMcpServerCommand {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const isTypeScriptSource = currentFile.endsWith(".ts");

  if (isTypeScriptSource) {
    return {
      command: process.execPath,
      args: [
        "--import",
        resolveTsxLoaderSpecifier(),
        path.resolve(currentDir, "../mcp/stdio-server.ts"),
      ],
      cwd: path.resolve(currentDir, "../../../.."),
    };
  }

  return {
    command: process.execPath,
    args: [path.resolve(currentDir, "../mcp/stdio-server.js")],
    cwd: path.resolve(currentDir, ".."),
  };
}

export function createAgentHubMcpSession(input: {
  eventSink: AgentHubMcpEventSink;
  runInput: AgentRunInput;
  relay?: AgentHubMcpRelayLike;
}): AgentHubMcpSessionHandle | undefined {
  const relay = input.relay;

  if (relay === undefined) {
    return undefined;
  }

  const mcpGoals: AgentHubListGoalsToolResult["goals"] = [
    ...(input.runInput.agentHubMcpGoals ?? []),
  ];

  return relay.createSession({
    enabledTools: input.runInput.agentHubMcpTools ?? [],
    runId: input.runInput.run.id,
    workspacePath: input.runInput.workspacePath,
    onArtifactUpload: input.runInput.uploadArtifact,
    onStaticSiteDeploy: input.runInput.deployStaticSite,
    onToolCall: async (call) => {
      if (input.runInput.callAgentHubMcpTool !== undefined) {
        return input.runInput.callAgentHubMcpTool(call);
      }

      input.eventSink.push({
        type: "agenthub.tool.call",
        runId: call.runId,
        toolCallId: call.toolCallId,
        name: call.name,
        input: call.input,
        createdAt: call.createdAt,
      });

      if (call.name === "list_goals") {
        const status = "status" in call.input &&
          typeof call.input.status === "string"
          ? call.input.status
          : undefined;

        return {
          accepted: true,
          goals: status === undefined
            ? mcpGoals.map((goal) => ({ ...goal }))
            : mcpGoals
                .filter((goal) => goal.status === status)
                .map((goal) => ({ ...goal })),
        };
      }

      return { accepted: true };
    },
  });
}
