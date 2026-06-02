import { pathToFileURL } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type {
  AgentHubApproveTaskToolInput,
  AgentHubApproveTaskToolResult,
  AgentHubCancelTaskToolInput,
  AgentHubCancelTaskToolResult,
  AgentHubCompleteGoalToolInput,
  AgentHubCompleteGoalToolResult,
  AgentHubCompleteTaskToolInput,
  AgentHubCompleteTaskToolResult,
  AgentHubDeployStaticSiteToolInput,
  AgentHubCreateGoalToolInput,
  AgentHubCreateGoalToolResult,
  AgentHubCreateTaskToolInput,
  AgentHubCreateTaskToolResult,
  AgentHubAppendMemoryToolInput,
  AgentHubAppendMemoryToolResult,
  AgentHubListArtifactsToolInput,
  AgentHubListArtifactsToolResult,
  AgentHubListGoalsToolInput,
  AgentHubListGoalsToolResult,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubReadMemoryToolInput,
  AgentHubReadMemoryToolResult,
  AgentHubReadArtifactToolInput,
  AgentHubReadArtifactToolResult,
  AgentHubSearchMemoryToolInput,
  AgentHubSearchMemoryToolResult,
  AgentHubSendMessageToolInput,
  AgentHubSendMessageToolResult,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
} from "@agent-hub/core";

const sendMessageToolName = "send_message" satisfies AgentHubMcpToolName;
const listGoalsToolName = "list_goals" satisfies AgentHubMcpToolName;
const listArtifactsToolName = "list_artifacts" satisfies AgentHubMcpToolName;
const readArtifactToolName = "read_artifact" satisfies AgentHubMcpToolName;
const appendMemoryToolName = "append_memory" satisfies AgentHubMcpToolName;
const searchMemoryToolName = "search_memory" satisfies AgentHubMcpToolName;
const readMemoryToolName = "read_memory" satisfies AgentHubMcpToolName;
const createGoalToolName = "create_goal" satisfies AgentHubMcpToolName;
const createTaskToolName = "create_task" satisfies AgentHubMcpToolName;
const approveTaskToolName = "approve_task" satisfies AgentHubMcpToolName;
const cancelTaskToolName = "cancel_task" satisfies AgentHubMcpToolName;
const uploadArtifactToolName = "upload_artifact" satisfies AgentHubMcpToolName;
const deployStaticSiteToolName = "deploy_static_site" satisfies AgentHubMcpToolName;
const completeTaskToolName = "complete_task" satisfies AgentHubMcpToolName;
const completeGoalToolName = "complete_goal" satisfies AgentHubMcpToolName;
const agentHubMcpToolNames = [
  sendMessageToolName,
  listGoalsToolName,
  listArtifactsToolName,
  readArtifactToolName,
  appendMemoryToolName,
  searchMemoryToolName,
  readMemoryToolName,
  createGoalToolName,
  createTaskToolName,
  approveTaskToolName,
  cancelTaskToolName,
  uploadArtifactToolName,
  deployStaticSiteToolName,
  completeTaskToolName,
  completeGoalToolName,
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
                "Send a visible AgentHub message. The target defaults to the current conversation; use target.group for another active group or target.user to privately message the user. In group targets, content containing @AgentName forces that agent to run, and content containing @all forces all other ready agents in the target group to run. If this is an ordinary reply, progress update, or final summary, do not include @AgentName or @all.",
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
      ...(enabledTools.has(listGoalsToolName)
        ? [
            {
              name: listGoalsToolName,
              description:
                "List goals in the current AgentHub group conversation, including each goal's tasks and task indexes.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  status: {
                    type: "string",
                    enum: ["active", "completed", "cancelled", "failed"],
                    description: "Optional goal status filter.",
                  },
                },
              },
            },
          ]
        : []),
      ...(enabledTools.has(listArtifactsToolName)
        ? [
            {
              name: listArtifactsToolName,
              description:
                "List files and reports in the current AgentHub conversation workspace. Pass goalId to limit results to one goal.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: {
                    type: "string",
                    minLength: 1,
                    description: "Optional goal id to inspect.",
                  },
                  taskIndex: {
                    type: "number",
                    minimum: 0,
                    description: "Optional goal-local task index filter.",
                  },
                  limit: {
                    type: "number",
                    minimum: 1,
                    maximum: 50,
                    description: "Maximum number of artifacts to return.",
                  },
                },
                required: [],
              },
            },
          ]
        : []),
      ...(enabledTools.has(readArtifactToolName)
        ? [
            {
              name: readArtifactToolName,
              description:
                "Read one artifact from the current AgentHub conversation workspace. Text files return text; binary files return base64. Pass goalId when you want to assert the artifact belongs to a specific goal.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: { type: "string", minLength: 1 },
                  artifactId: { type: "string", minLength: 1 },
                },
                required: ["artifactId"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(appendMemoryToolName)
        ? [
            {
              name: appendMemoryToolName,
              description:
                "Append a memory entry for this AgentHub agent. Use long_term for stable preferences/facts that should persist across days, and daily for notable events today.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  scope: {
                    type: "string",
                    enum: ["long_term", "daily"],
                    description: "Defaults to long_term.",
                  },
                  title: { type: "string", maxLength: 120 },
                  content: { type: "string", minLength: 1 },
                  tags: {
                    type: "array",
                    items: { type: "string" },
                    maxItems: 12,
                  },
                },
                required: ["content"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(searchMemoryToolName)
        ? [
            {
              name: searchMemoryToolName,
              description:
                "Search this agent's long-term memory, daily memory, and local conversation transcripts.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  query: { type: "string", minLength: 1 },
                  scopes: {
                    type: "array",
                    items: {
                      type: "string",
                      enum: ["long_term", "daily", "transcript"],
                    },
                  },
                  fromDate: { type: "string" },
                  toDate: { type: "string" },
                  limit: { type: "number", minimum: 1, maximum: 50 },
                },
                required: ["query"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(readMemoryToolName)
        ? [
            {
              name: readMemoryToolName,
              description:
                "Read this agent's memory file. Use scope transcript with a date to inspect that day's full local conversation transcript.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  scope: {
                    type: "string",
                    enum: ["long_term", "daily", "transcript"],
                  },
                  date: {
                    type: "string",
                    description: "Required for historical daily or transcript files. Defaults to today.",
                  },
                  maxBytes: { type: "number", minimum: 1, maximum: 65536 },
                },
                required: ["scope"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(createGoalToolName)
        ? [
            {
              name: createGoalToolName,
              description:
                "Create a top-level AgentHub Goal for the user's Task-mode request before creating executable tasks.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string", minLength: 1, maxLength: 160 },
                  description: { type: "string" },
                },
                required: ["title"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(createTaskToolName)
        ? [
            {
              name: createTaskToolName,
              description:
                "Create an AgentHub task under an existing Goal for one group agent. Tasks without dependencies dispatch immediately; dependent tasks wait for Orchestrator approval after dependencies succeed.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: {
                    type: "string",
                    minLength: 1,
                    description: "Goal id returned by create_goal or list_goals.",
                  },
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
                  dependsOnTaskIndexes: {
                    type: "array",
                    items: { type: "number", minimum: 0 },
                    description:
                      "Optional upstream task indexes in the same goal that must succeed before this task can be approved.",
                  },
                },
                required: ["goalId", "title", "assigneeAgentId"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(approveTaskToolName)
        ? [
            {
              name: approveTaskToolName,
              description:
                "Approve and dispatch a ready downstream task after reviewing a checkpoint.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: { type: "string", minLength: 1 },
                  taskIndex: { type: "number", minimum: 0 },
                },
                required: ["goalId", "taskIndex"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(cancelTaskToolName)
        ? [
            {
              name: cancelTaskToolName,
              description:
                "Cancel an obsolete or invalid task in the current Goal.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: { type: "string", minLength: 1 },
                  taskIndex: { type: "number", minimum: 0 },
                  reason: { type: "string" },
                },
                required: ["goalId", "taskIndex"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(uploadArtifactToolName)
        ? [
            {
              name: uploadArtifactToolName,
              description:
                "Upload a report, result file, screenshot, zip, or source directory from the current run workspace to the current Goal and task. If localPath is a directory, AgentHub uploads it as a zip artifact unless kind is set to site. Use kind=site for editable static websites that the user should review, modify, and publish from the AgentHub Editor.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: { type: "string", minLength: 1 },
                  taskIndex: { type: "number", minimum: 0 },
                  title: { type: "string", minLength: 1, maxLength: 160 },
                  localPath: {
                    type: "string",
                    minLength: 1,
                    description:
                      "Path to a file or directory inside the current run workspace.",
                  },
                  filename: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["file", "site"],
                    description:
                      "Use site when uploading an editable static website directory. Omit or use file for ordinary files, screenshots, reports, zips, or source packages.",
                  },
                  entrypoint: {
                    type: "string",
                    minLength: 1,
                    description:
                      "Entrypoint for kind=site directory uploads. Defaults to index.html.",
                  },
                },
                required: ["goalId", "taskIndex", "title", "localPath"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(deployStaticSiteToolName)
        ? [
            {
              name: deployStaticSiteToolName,
              description:
                "Deploy a static website directory from the current run workspace. Use this for runnable HTML/CSS/JavaScript websites. Return the deployment URL to the user as a Markdown link. Use upload_artifact separately if you also need to deliver a source zip or report.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: {
                    type: "string",
                    minLength: 1,
                    description:
                      "Optional Goal ID when deploying as part of an assigned task.",
                  },
                  taskIndex: {
                    type: "number",
                    minimum: 0,
                    description:
                      "Optional Goal task index when deploying as part of an assigned task.",
                  },
                  title: { type: "string", minLength: 1, maxLength: 160 },
                  localPath: {
                    type: "string",
                    minLength: 1,
                    description:
                      "Path to a static site directory inside the current run workspace.",
                  },
                  entrypoint: {
                    type: "string",
                    minLength: 1,
                    description: "Entrypoint file inside localPath. Defaults to index.html.",
                  },
                },
                required: ["title", "localPath"],
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
                  goalId: { type: "string", minLength: 1 },
                  taskIndex: { type: "number", minimum: 0 },
                  summary: { type: "string", minLength: 1 },
                  artifactIds: {
                    type: "array",
                    items: { type: "string", minLength: 1 },
                  },
                },
                required: ["goalId", "taskIndex", "summary"],
              },
            },
          ]
        : []),
      ...(enabledTools.has(completeGoalToolName)
        ? [
            {
              name: completeGoalToolName,
              description:
                "Mark a Goal complete after all active tasks are done. Send the final user-facing summary separately with send_message.",
              inputSchema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  goalId: { type: "string", minLength: 1 },
                  summary: { type: "string" },
                },
                required: ["goalId"],
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
        : toolName === listGoalsToolName
          ? readListGoalsInput(request.params.arguments)
          : toolName === listArtifactsToolName
            ? readListArtifactsInput(request.params.arguments)
            : toolName === readArtifactToolName
              ? readReadArtifactInput(request.params.arguments)
              : toolName === appendMemoryToolName
                ? readAppendMemoryInput(request.params.arguments)
                : toolName === searchMemoryToolName
                  ? readSearchMemoryInput(request.params.arguments)
                  : toolName === readMemoryToolName
                    ? readReadMemoryInput(request.params.arguments)
                    : toolName === createGoalToolName
                      ? readCreateGoalInput(request.params.arguments)
                      : toolName === createTaskToolName
                        ? readCreateTaskInput(request.params.arguments)
                        : toolName === approveTaskToolName
                          ? readApproveTaskInput(request.params.arguments)
                          : toolName === cancelTaskToolName
                            ? readCancelTaskInput(request.params.arguments)
                            : toolName === uploadArtifactToolName
                              ? readUploadArtifactInput(request.params.arguments)
                              : toolName === deployStaticSiteToolName
                                ? readDeployStaticSiteInput(request.params.arguments)
                                : toolName === completeTaskToolName
                                  ? readCompleteTaskInput(request.params.arguments)
                                  : toolName === completeGoalToolName
                                    ? readCompleteGoalInput(request.params.arguments)
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

function readListGoalsInput(value: unknown): AgentHubListGoalsToolInput {
  const input = readObjectArguments(value, "list_goals");
  const status = input.status;

  return typeof status === "string" && status.length > 0
    ? { status: status as AgentHubListGoalsToolInput["status"] }
    : {};
}

function readListArtifactsInput(value: unknown): AgentHubListArtifactsToolInput {
  const input = readObjectArguments(value, "list_artifacts");
  const goalId = input.goalId;
  const taskIndex = readTaskIndex(input.taskIndex);
  const limit = input.limit;

  return {
    goalId: typeof goalId === "string" && goalId.length > 0
      ? goalId
      : undefined,
    taskIndex: taskIndex ?? undefined,
    limit:
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 50)
        : undefined,
  };
}

function readReadArtifactInput(value: unknown): AgentHubReadArtifactToolInput {
  const input = readObjectArguments(value, "read_artifact");
  const goalId = input.goalId;
  const artifactId = input.artifactId;

  if (typeof artifactId !== "string" || artifactId.length === 0) {
    throw new Error("read_artifact.artifactId is required.");
  }

  return {
    artifactId,
    goalId: typeof goalId === "string" && goalId.length > 0
      ? goalId
      : undefined,
  };
}

function readAppendMemoryInput(value: unknown): AgentHubAppendMemoryToolInput {
  const input = readObjectArguments(value, "append_memory");
  const scope = input.scope;
  const title = input.title;
  const content = input.content;
  const tags = input.tags;

  if (scope !== undefined && scope !== "long_term" && scope !== "daily") {
    throw new Error("append_memory.scope must be long_term or daily.");
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("append_memory.content is required.");
  }

  if (Buffer.byteLength(content.trim(), "utf8") > 8 * 1024) {
    throw new Error("append_memory.content is too large.");
  }

  return {
    scope,
    title:
      typeof title === "string" && title.trim().length > 0
        ? title.trim().slice(0, 120)
        : undefined,
    content: content.trim(),
    tags: Array.isArray(tags)
      ? tags
          .filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
          .map((tag) => tag.trim())
          .slice(0, 12)
      : undefined,
  };
}

function readMemoryScopes(value: unknown): ("long_term" | "daily" | "transcript")[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const scopes = value.filter((scope): scope is "long_term" | "daily" | "transcript" =>
    scope === "long_term" || scope === "daily" || scope === "transcript",
  );

  return scopes.length > 0 ? [...new Set(scopes)] : undefined;
}

function readSearchMemoryInput(value: unknown): AgentHubSearchMemoryToolInput {
  const input = readObjectArguments(value, "search_memory");
  const query = input.query;
  const limit = input.limit;

  if (typeof query !== "string" || query.trim().length === 0) {
    throw new Error("search_memory.query is required.");
  }

  return {
    query: query.trim(),
    scopes: readMemoryScopes(input.scopes),
    fromDate:
      typeof input.fromDate === "string" && input.fromDate.length > 0
        ? input.fromDate
        : undefined,
    toDate:
      typeof input.toDate === "string" && input.toDate.length > 0
        ? input.toDate
        : undefined,
    limit:
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 50)
        : undefined,
  };
}

function readReadMemoryInput(value: unknown): AgentHubReadMemoryToolInput {
  const input = readObjectArguments(value, "read_memory");
  const scope = input.scope;
  const maxBytes = input.maxBytes;

  if (scope !== "long_term" && scope !== "daily" && scope !== "transcript") {
    throw new Error("read_memory.scope must be long_term, daily, or transcript.");
  }

  return {
    scope,
    date:
      typeof input.date === "string" && input.date.length > 0
        ? input.date
        : undefined,
    maxBytes:
      typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0
        ? Math.min(Math.floor(maxBytes), 64 * 1024)
        : undefined,
  };
}

function readCreateGoalInput(value: unknown): AgentHubCreateGoalToolInput {
  const input = readObjectArguments(value, "create_goal");
  const title = input.title;
  const description = input.description;

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("create_goal.title is required.");
  }

  if (title.trim().length > 160) {
    throw new Error("create_goal.title must be 160 characters or fewer.");
  }

  return {
    title: title.trim(),
    description:
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : undefined,
  };
}

function readCreateTaskInput(value: unknown): AgentHubCreateTaskToolInput {
  const input = readObjectArguments(value, "create_task");
  const goalId = input.goalId;
  const title = input.title;
  const description = input.description;
  const assigneeAgentId = input.assigneeAgentId;
  const dependsOnTaskIndexes = Array.isArray(input.dependsOnTaskIndexes)
    ? compactUniqueNumbers(input.dependsOnTaskIndexes)
    : undefined;

  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("create_task.goalId is required.");
  }

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
    goalId,
    title: title.trim(),
    description:
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : undefined,
    assigneeAgentId,
    dependsOnTaskIndexes: dependsOnTaskIndexes && dependsOnTaskIndexes.length > 0
      ? dependsOnTaskIndexes
      : undefined,
  };
}

function readApproveTaskInput(value: unknown): AgentHubApproveTaskToolInput {
  const input = readObjectArguments(value, "approve_task");
  const goalId = input.goalId;
  const taskIndex = readTaskIndex(input.taskIndex);

  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("approve_task.goalId is required.");
  }

  if (taskIndex === null) {
    throw new Error("approve_task.taskIndex is required.");
  }

  return { goalId, taskIndex };
}

function readCancelTaskInput(value: unknown): AgentHubCancelTaskToolInput {
  const input = readObjectArguments(value, "cancel_task");
  const goalId = input.goalId;
  const taskIndex = readTaskIndex(input.taskIndex);
  const reason = input.reason;

  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("cancel_task.goalId is required.");
  }

  if (taskIndex === null) {
    throw new Error("cancel_task.taskIndex is required.");
  }

  return {
    goalId,
    taskIndex,
    reason:
      typeof reason === "string" && reason.trim().length > 0
        ? reason.trim()
        : undefined,
  };
}

function readUploadArtifactInput(value: unknown): AgentHubUploadArtifactToolInput {
  const input = readObjectArguments(value, "upload_artifact");
  const goalId = input.goalId;
  const taskIndex = readTaskIndex(input.taskIndex);
  const title = input.title;
  const localPath = input.localPath;
  const filename = input.filename;
  const kind = input.kind;
  const entrypoint = input.entrypoint;

  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("upload_artifact.goalId is required.");
  }

  if (taskIndex === null) {
    throw new Error("upload_artifact.taskIndex is required.");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("upload_artifact.title is required.");
  }

  if (typeof localPath !== "string" || localPath.trim().length === 0) {
    throw new Error("upload_artifact.localPath is required.");
  }

  return {
    goalId,
    taskIndex,
    title: title.trim(),
    localPath: localPath.trim(),
    filename:
      typeof filename === "string" && filename.trim().length > 0
        ? filename.trim()
        : undefined,
    kind: kind === "site" ? "site" : kind === "file" ? "file" : undefined,
    entrypoint:
      typeof entrypoint === "string" && entrypoint.trim().length > 0
        ? entrypoint.trim()
        : undefined,
  };
}

function readDeployStaticSiteInput(value: unknown): AgentHubDeployStaticSiteToolInput {
  const input = readObjectArguments(value, "deploy_static_site");
  const goalId = input.goalId;
  const taskIndex = readTaskIndex(input.taskIndex);
  const title = input.title;
  const localPath = input.localPath;
  const entrypoint = input.entrypoint;

  if (goalId !== undefined && typeof goalId !== "string") {
    throw new Error("deploy_static_site.goalId must be a string.");
  }

  if (input.taskIndex !== undefined && taskIndex === null) {
    throw new Error("deploy_static_site.taskIndex must be a non-negative integer.");
  }

  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("deploy_static_site.title is required.");
  }

  if (typeof localPath !== "string" || localPath.trim().length === 0) {
    throw new Error("deploy_static_site.localPath is required.");
  }

  return {
    goalId,
    taskIndex: taskIndex ?? undefined,
    title: title.trim(),
    localPath: localPath.trim(),
    entrypoint:
      typeof entrypoint === "string" && entrypoint.trim().length > 0
        ? entrypoint.trim()
        : undefined,
  };
}

function readCompleteTaskInput(value: unknown): AgentHubCompleteTaskToolInput {
  const input = readObjectArguments(value, "complete_task");
  const goalId = input.goalId;
  const taskIndex = readTaskIndex(input.taskIndex);
  const summary = input.summary;
  const artifactIds = Array.isArray(input.artifactIds)
    ? input.artifactIds.filter((artifactId): artifactId is string =>
        typeof artifactId === "string" && artifactId.length > 0,
      )
    : undefined;

  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("complete_task.goalId is required.");
  }

  if (taskIndex === null) {
    throw new Error("complete_task.taskIndex is required.");
  }

  if (typeof summary !== "string" || summary.trim().length === 0) {
    throw new Error("complete_task.summary is required.");
  }

  return {
    goalId,
    taskIndex,
    summary: summary.trim(),
    artifactIds: artifactIds && artifactIds.length > 0 ? artifactIds : undefined,
  };
}

function readCompleteGoalInput(value: unknown): AgentHubCompleteGoalToolInput {
  const input = readObjectArguments(value, "complete_goal");
  const goalId = input.goalId;
  const summary = input.summary;

  if (typeof goalId !== "string" || goalId.length === 0) {
    throw new Error("complete_goal.goalId is required.");
  }

  return {
    goalId,
    summary:
      typeof summary === "string" && summary.trim().length > 0
        ? summary.trim()
        : undefined,
  };
}

function readTaskIndex(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function compactUniqueNumbers(value: unknown[]): number[] {
  return [...new Set(value.filter((item): item is number =>
    typeof item === "number" && Number.isInteger(item) && item >= 0,
  ))];
}

async function callRelayTool(input: {
  input:
    | AgentHubApproveTaskToolInput
    | AgentHubCancelTaskToolInput
    | AgentHubCompleteGoalToolInput
    | AgentHubCompleteTaskToolInput
    | AgentHubDeployStaticSiteToolInput
    | AgentHubCreateGoalToolInput
    | AgentHubCreateTaskToolInput
    | AgentHubAppendMemoryToolInput
    | AgentHubListArtifactsToolInput
    | AgentHubListGoalsToolInput
    | AgentHubReadMemoryToolInput
    | AgentHubReadArtifactToolInput
    | AgentHubSearchMemoryToolInput
    | AgentHubSendMessageToolInput
    | AgentHubUploadArtifactToolInput;
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
    const errorText = await response.text().catch(() => "");
    let reason = errorText.trim();
    try {
      const parsed = JSON.parse(errorText) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.length > 0) {
        reason = parsed.error;
      }
    } catch {
      // Keep the raw relay response when it is not JSON.
    }

    throw new Error(
      reason.length > 0
        ? `AgentHub MCP relay rejected ${input.toolName}: ${reason}`
        : `AgentHub MCP relay rejected ${input.toolName}.`,
    );
  }

  return (await response.json()) as
    | AgentHubApproveTaskToolResult
    | AgentHubCancelTaskToolResult
    | AgentHubCompleteGoalToolResult
    | AgentHubCompleteTaskToolResult
    | AgentHubCreateGoalToolResult
    | AgentHubCreateTaskToolResult
    | AgentHubAppendMemoryToolResult
    | AgentHubListArtifactsToolResult
    | AgentHubListGoalsToolResult
    | AgentHubReadMemoryToolResult
    | AgentHubReadArtifactToolResult
    | AgentHubSearchMemoryToolResult
    | AgentHubSendMessageToolResult
    | AgentHubUploadArtifactToolResult;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await startAgentHubMcpStdioServer();
}
