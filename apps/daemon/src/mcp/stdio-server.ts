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
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubSendMessageToolInput,
  AgentHubSendMessageToolResult,
} from "@agent-hub/core";

const sendMessageToolName = "send_message" satisfies AgentHubMcpToolName;
const createTaskToolName = "create_task" satisfies AgentHubMcpToolName;
const agentHubMcpToolNames = [sendMessageToolName, createTaskToolName] as const;

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

async function callRelayTool(input: {
  input: AgentHubCreateTaskToolInput | AgentHubSendMessageToolInput;
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

  return (await response.json()) as AgentHubCreateTaskToolResult | AgentHubSendMessageToolResult;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startAgentHubMcpStdioServer();
}
