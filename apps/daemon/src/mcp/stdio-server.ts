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
  AgentHubListTasksToolInput,
  AgentHubListTasksToolResult,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubSendMessageToolInput,
  AgentHubSendMessageToolResult,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
} from "@agent-hub/core";

const sendMessageToolName = "send_message" satisfies AgentHubMcpToolName;
const listTasksToolName = "list_tasks" satisfies AgentHubMcpToolName;
const createTaskToolName = "create_task" satisfies AgentHubMcpToolName;
const uploadArtifactToolName = "upload_artifact" satisfies AgentHubMcpToolName;
const completeTaskToolName = "complete_task" satisfies AgentHubMcpToolName;
const agentHubMcpToolNames = [
  sendMessageToolName,
  listTasksToolName,
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
                "Send a visible AgentHub message. The target defaults to the current conversation; use target.group for another active group or target.user to privately message the user.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  target: {
                    type: "object",
                    additionalProperties: false,
                    description:
                      "Optional target. Omit or use { type: 'current' } for the current conversation.",
                    properties: {
                      type: {
                        type: "string",
                        enum: ["current", "group", "user"],
                      },
                      groupName: {
                        type: "string",
                        minLength: 1,
                        description:
                          "Required when type is group. Use the visible group name, with or without #.",
                      },
                    },
                    required: ["type"],
                  },
                  content: {
                    type: "string",
                    minLength: 1,
                    description: "The chat message content to send.",
                  },
                  attachments: {
                    type: "array",
                    description:
                      "Optional image attachments from the current run workspace.",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        type: { const: "image" },
                        localPath: {
                          type: "string",
                          minLength: 1,
                          description:
                            "Path to an image file inside the current run workspace.",
                        },
                        title: { type: "string" },
                        filename: { type: "string" },
                      },
                      required: ["type", "localPath"],
                    },
                  },
                },
                required: ["content"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(listTasksToolName)
        ? [
            {
              name: listTasksToolName,
              description:
                "List tasks in the current AgentHub group conversation, including task ids.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  status: {
                    type: "string",
                    enum: [
                      "created",
                      "assigned",
                      "running",
                      "succeeded",
                      "failed",
                      "cancelled",
                    ],
                    description:
                      "Optional task status filter.",
                  },
                },
              },
            },
          ]
        : []),
      ...(enabledTools.has(createTaskToolName)
        ? [
            {
              name: createTaskToolName,
              description:
                "Create and dispatch an AgentHub task to one group agent in the current Task mode run.",
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
        : toolName === listTasksToolName
          ? readListTasksInput(request.params.arguments)
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

function readObjectArguments(value: unknown, toolName: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${toolName} arguments must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readSendMessageInput(value: unknown): AgentHubSendMessageToolInput {
  const input = readObjectArguments(value, "send_message");
  const content = input.content;

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("send_message.content is required.");
  }

  return {
    content: content.trim(),
    target: readSendMessageTarget(input.target),
    attachments: readSendMessageAttachments(input.attachments),
  };
}

function readSendMessageTarget(
  value: unknown,
): AgentHubSendMessageToolInput["target"] {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("send_message.target must be an object.");
  }

  const record = value as Record<string, unknown>;

  if (record.type === "current") {
    return { type: "current" };
  }

  if (record.type === "user") {
    return { type: "user" };
  }

  if (record.type === "group") {
    if (typeof record.groupName !== "string" || record.groupName.trim().length === 0) {
      throw new Error("send_message.target.groupName is required for group targets.");
    }

    return { type: "group", groupName: record.groupName.trim() };
  }

  throw new Error("send_message.target.type must be current, group, or user.");
}

function readSendMessageAttachments(
  value: unknown,
): AgentHubSendMessageToolInput["attachments"] {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("send_message.attachments must be an array.");
  }

  const attachments = value.map((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error("send_message attachment must be an object.");
    }

    const record = item as Record<string, unknown>;

    if (record.type !== "image") {
      throw new Error("send_message attachment type must be image.");
    }

    if (typeof record.localPath !== "string" || record.localPath.trim().length === 0) {
      throw new Error("send_message image attachment localPath is required.");
    }

    return {
      type: "image" as const,
      localPath: record.localPath.trim(),
      title:
        typeof record.title === "string" && record.title.trim().length > 0
          ? record.title.trim()
          : undefined,
      filename:
        typeof record.filename === "string" && record.filename.trim().length > 0
          ? record.filename.trim()
          : undefined,
    };
  });

  return attachments.length > 0 ? attachments : undefined;
}

function readListTasksInput(value: unknown): AgentHubListTasksToolInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("list_tasks arguments must be an object.");
  }

  const status = (value as Record<string, unknown>).status;

  return typeof status === "string" && status.length > 0
    ? { status: status as AgentHubListTasksToolInput["status"] }
    : {};
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
    | AgentHubListTasksToolInput
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
    | AgentHubListTasksToolResult
    | AgentHubUploadArtifactToolResult
    | AgentHubCompleteTaskToolResult;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startAgentHubMcpStdioServer();
}
