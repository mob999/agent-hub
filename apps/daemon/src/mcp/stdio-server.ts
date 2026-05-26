import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  AgentHubMcpToolName,
  AgentHubSendMessageToolInput,
  AgentHubSendMessageToolResult,
} from "@agent-hub/core";

const sendMessageToolName = "send_message" satisfies AgentHubMcpToolName;

export async function startAgentHubMcpStdioServer(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const relayUrl = requireEnv(env, "AGENTHUB_MCP_RELAY_URL");
  const sessionToken = requireEnv(env, "AGENTHUB_MCP_SESSION_TOKEN");
  const enabledTools = new Set(
    (env.AGENTHUB_MCP_TOOLS ?? "")
      .split(",")
      .map((tool) => tool.trim())
      .filter((tool): tool is AgentHubMcpToolName => tool === sendMessageToolName),
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
    tools: enabledTools.has(sendMessageToolName)
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
              },
              required: ["content"],
            },
          },
        ]
      : [],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const toolName = request.params.name;

    if (toolName !== sendMessageToolName || !enabledTools.has(sendMessageToolName)) {
      throw new Error(`AgentHub MCP tool is not enabled: ${toolName}`);
    }

    const input = readSendMessageInput(request.params.arguments);
    const result = await callRelayTool({
      input,
      relayUrl,
      sessionToken,
      toolCallId: String(extra.requestId),
      toolName,
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

  return { content: content.trim() };
}

async function callRelayTool(input: {
  input: AgentHubSendMessageToolInput;
  relayUrl: string;
  sessionToken: string;
  toolCallId: string;
  toolName: AgentHubMcpToolName;
}): Promise<AgentHubSendMessageToolResult> {
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

  return (await response.json()) as AgentHubSendMessageToolResult;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startAgentHubMcpStdioServer();
}
