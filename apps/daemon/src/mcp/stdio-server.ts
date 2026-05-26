import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  AgentHubCreateTaskToolInput,
  AgentHubCreateTaskToolResult,
  AgentHubCompleteTaskToolInput,
  AgentHubCompleteTaskToolResult,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubSendMessageToolInput,
  AgentHubSendMessageToolResult,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
} from "@agent-hub/core";

const sendMessageToolName = "send_message" satisfies AgentHubMcpToolName;
const createTaskToolName = "create_task" satisfies AgentHubMcpToolName;
const uploadArtifactToolName = "upload_artifact" satisfies AgentHubMcpToolName;
const completeTaskToolName = "complete_task" satisfies AgentHubMcpToolName;
const agentHubMcpToolNames = [
  sendMessageToolName,
  createTaskToolName,
  uploadArtifactToolName,
  completeTaskToolName,
] as const;

export async function startAgentHubMcpStdioServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const relayUrl = requireEnv(env, "AGENTHUB_MCP_RELAY_URL");
  const sessionToken = requireEnv(env, "AGENTHUB_MCP_SESSION_TOKEN");
  const enabledTools = new Set(
    (env.AGENTHUB_MCP_TOOLS ?? "")
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool): tool is AgentHubMcpToolName =>
        agentHubMcpToolNames.includes(tool as AgentHubMcpToolName),
      ),
  );
  const server = new Server(
    {
      name: "agenthub-daemon",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: "AgentHub local daemon tools scoped to the current run.",
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...(enabledTools.has(sendMessageToolName)
        ? [
            {
              name: sendMessageToolName,
              description:
                "Send a visible message to the current AgentHub group conversation. Use this only when you intentionally want to speak in the chat.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  content: {
                    type: "string",
                    minLength: 1,
                    description: "The chat message content to send.",
                  },
                  mentions: {
                    type: "array",
                    description:
                      "Optional AgentHub mentions, usually one per assigned agent.",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        type: { const: "agent" },
                        agentId: { type: "string", minLength: 1 },
                        label: { type: "string" },
                      },
                      required: ["type", "agentId"],
                    },
                  },
                  taskIds: {
                    type: "array",
                    description:
                      "Task ids created with create_task that this message dispatches.",
                    items: { type: "string", minLength: 1 },
                  },
                },
                required: ["content"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(createTaskToolName)
        ? [
            {
              name: createTaskToolName,
              description:
                "Create an AgentHub task for one group agent in the current Task mode run.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: {
                    type: "string",
                    minLength: 1,
                    maxLength: 160,
                    description: "Short task title.",
                  },
                  description: {
                    type: "string",
                    description: "Optional task details.",
                  },
                  assigneeAgentId: {
                    type: "string",
                    minLength: 1,
                    description: "Agent id that should receive this task.",
                  },
                },
                required: ["title", "assigneeAgentId"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(uploadArtifactToolName)
        ? [
            {
              name: uploadArtifactToolName,
              description:
                "Upload a report or result file from the current run workspace to the AgentHub group workspace.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  taskId: { type: "string", minLength: 1 },
                  title: { type: "string", minLength: 1, maxLength: 160 },
                  localPath: {
                    type: "string",
                    minLength: 1,
                    description:
                      "Path to a file inside the current run workspace.",
                  },
                  filename: { type: "string" },
                  mimeType: { type: "string" },
                },
                required: ["taskId", "title", "localPath"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(completeTaskToolName)
        ? [
            {
              name: completeTaskToolName,
              description:
                "Mark the current assigned AgentHub task complete with a summary and optional uploaded artifact ids.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  taskId: { type: "string", minLength: 1 },
                  summary: { type: "string", minLength: 1 },
                  artifactIds: {
                    type: "array",
                    items: { type: "string", minLength: 1 },
                  },
                },
                required: ["taskId", "summary"],
              },
            },
          ]
        : []),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;

    if (!enabledTools.has(toolName as AgentHubMcpToolName)) {
      throw new Error(`AgentHub MCP tool is not enabled: ${toolName}`);
    }

    const input =
      toolName === sendMessageToolName
        ? readSendMessageInput(request.params.arguments)
        : toolName === createTaskToolName
          ? readCreateTaskInput(request.params.arguments)
          : toolName === uploadArtifactToolName
            ? readUploadArtifactInput(request.params.arguments)
            : toolName === completeTaskToolName
              ? readCompleteTaskInput(request.params.arguments)
          : undefined;

    if (input === undefined) {
      throw new Error(`Unknown AgentHub MCP tool: ${toolName}`);
    }

    const result = await callRelayTool({
      input,
      relayUrl,
      sessionToken,
      toolCallId: String(extra.requestId),
      toolName: toolName as AgentHubMcpToolName,
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result),
        },
      ],
      structuredContent: result,
    };
  });

  await server.connect(new StdioServerTransport());
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];

  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readSendMessageInput(value: unknown): AgentHubSendMessageToolInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("send_message arguments must be an object.");
  }

  const content = (value as Record<string, unknown>).content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("send_message.content is required.");
  }

  const input = value as Record<string, unknown>;
  const mentions = Array.isArray(input.mentions)
    ? input.mentions.flatMap((mention) => {
        if (
          typeof mention !== "object" ||
          mention === null ||
          Array.isArray(mention)
        ) {
          return [];
        }

        const record = mention as Record<string, unknown>;

        return record.type === "agent" && typeof record.agentId === "string"
          ? [
              {
                type: "agent" as const,
                agentId: record.agentId,
                label: typeof record.label === "string" ? record.label : undefined,
              },
            ]
          : [];
      })
    : undefined;
  const taskIds = Array.isArray(input.taskIds)
    ? input.taskIds.filter((taskId): taskId is string => typeof taskId === "string")
    : undefined;

  return {
    content: content.trim(),
    mentions: mentions && mentions.length > 0 ? mentions : undefined,
    taskIds: taskIds && taskIds.length > 0 ? taskIds : undefined,
  };
}

function readCreateTaskInput(value: unknown): AgentHubCreateTaskToolInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("create_task arguments must be an object.");
  }

  const input = value as Record<string, unknown>;
  const title = input.title;
  const description = input.description;
  const assigneeAgentId = input.assigneeAgentId;

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("create_task.title is required.");
  }

  if (title.trim().length > 160) {
    throw new Error("create_task.title must be 160 characters or fewer.");
  }

  if (typeof assigneeAgentId !== "string" || assigneeAgentId.length === 0) {
    throw new Error("create_task.assigneeAgentId is required.");
  }

  return {
    title: title.trim(),
    description:
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : undefined,
    assigneeAgentId,
  };
}

function readUploadArtifactInput(value: unknown): AgentHubUploadArtifactToolInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("upload_artifact arguments must be an object.");
  }

  const input = value as Record<string, unknown>;
  const taskId = input.taskId;
  const title = input.title;
  const localPath = input.localPath;
  const filename = input.filename;
  const mimeType = input.mimeType;

  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("upload_artifact.taskId is required.");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("upload_artifact.title is required.");
  }

  if (typeof localPath !== "string" || localPath.trim().length === 0) {
    throw new Error("upload_artifact.localPath is required.");
  }

  return {
    taskId,
    title: title.trim(),
    localPath: localPath.trim(),
    filename:
      typeof filename === "string" && filename.trim().length > 0
        ? filename.trim()
        : undefined,
    mimeType:
      typeof mimeType === "string" && mimeType.trim().length > 0
        ? mimeType.trim()
        : undefined,
  };
}

function readCompleteTaskInput(value: unknown): AgentHubCompleteTaskToolInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("complete_task arguments must be an object.");
  }

  const input = value as Record<string, unknown>;
  const taskId = input.taskId;
  const summary = input.summary;
  const artifactIds = Array.isArray(input.artifactIds)
    ? input.artifactIds.filter((artifactId): artifactId is string =>
        typeof artifactId === "string" && artifactId.length > 0,
      )
    : undefined;

  if (typeof taskId !== "string" || taskId.length === 0) {
    throw new Error("complete_task.taskId is required.");
  }

  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("complete_task.summary is required.");
  }

  return {
    taskId,
    summary: summary.trim(),
    artifactIds: artifactIds && artifactIds.length > 0 ? artifactIds : undefined,
  };
}

async function callRelayTool(input: {
  input:
    | AgentHubCreateTaskToolInput
    | AgentHubSendMessageToolInput
    | AgentHubUploadArtifactToolInput
    | AgentHubCompleteTaskToolInput;
  relayUrl: string;
  sessionToken: string;
  toolCallId: string;
  toolName: AgentHubMcpToolName;
}): Promise<AgentHubMcpToolResult> {
  const response = await fetch(
    `${input.relayUrl}/sessions/${input.sessionToken}/tools/${input.toolName}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: input.input,
        toolCallId: input.toolCallId,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`AgentHub MCP relay rejected ${input.toolName}.`);
  }

  return (await response.json()) as
    | AgentHubCreateTaskToolResult
    | AgentHubSendMessageToolResult
    | AgentHubUploadArtifactToolResult
    | AgentHubCompleteTaskToolResult;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startAgentHubMcpStdioServer();
}
