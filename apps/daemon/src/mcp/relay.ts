import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import type {
  AgentRunArtifactUpload,
  AgentHubCreateTaskToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubMcpToolCall,
  AgentHubMcpToolName,
  AgentHubMcpToolInput,
  AgentHubMcpToolResult,
  AgentHubSendMessageToolInput,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
  RunId,
} from "@agent-hub/core";

import { isPathInsideWorkspace } from "../workspace";

const maxArtifactUploadBytes = 5 * 1024 * 1024;

interface AgentHubMcpSession {
  enabledTools: Set<AgentHubMcpToolName>;
  onArtifactUpload?(
    upload: AgentRunArtifactUpload,
  ): Promise<AgentHubUploadArtifactToolResult>;
  onToolCall(call: AgentHubMcpToolCall): Promise<AgentHubMcpToolResult> | AgentHubMcpToolResult;
  runId: RunId;
  workspacePath: string;
}

export interface AgentHubMcpSessionHandle {
  enabledTools: AgentHubMcpToolName[];
  relayUrl: string;
  token: string;
  close(): void;
}

export class AgentHubMcpRelay {
  #server: Server;
  #sessions = new Map<string, AgentHubMcpSession>();
  #url: string | undefined;

  constructor() {
    this.#server = createServer((request, response) => {
      void this.#handleRequest(request, response);
    });
  }

  get url(): string {
    if (this.#url === undefined) {
      throw new Error("AgentHub MCP relay has not started.");
    }

    return this.#url;
  }

  async start(): Promise<void> {
    if (this.#url !== undefined) {
      return;
    }

    await new Promise<void>((resolve) => {
      this.#server.listen(0, "127.0.0.1", resolve);
    });

    const address = this.#server.address();

    if (address === null || typeof address === "string") {
      throw new Error("AgentHub MCP relay did not bind to a TCP port.");
    }

    this.#url = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    this.#sessions.clear();

    if (this.#url === undefined) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => {
        if (error === undefined) {
          resolve();
          return;
        }

        reject(error);
      });
    });
    this.#url = undefined;
  }

  createSession(input: {
    enabledTools: AgentHubMcpToolName[];
    onArtifactUpload?(
      upload: AgentRunArtifactUpload,
    ): Promise<AgentHubUploadArtifactToolResult>;
    onToolCall(call: AgentHubMcpToolCall): Promise<AgentHubMcpToolResult> | AgentHubMcpToolResult;
    runId: RunId;
    workspacePath: string;
  }): AgentHubMcpSessionHandle {
    const token = randomUUID();
    const enabledTools = [...new Set(input.enabledTools)];

    this.#sessions.set(token, {
      enabledTools: new Set(enabledTools),
      onArtifactUpload: input.onArtifactUpload,
      onToolCall: input.onToolCall,
      runId: input.runId,
      workspacePath: input.workspacePath,
    });

    return {
      enabledTools,
      relayUrl: this.url,
      token,
      close: () => {
        this.#sessions.delete(token);
      },
    };
  }

  async #handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (request.method !== "POST") {
        writeJson(response, 405, { error: "Method not allowed." });
        return;
      }

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const match = /^\/sessions\/([^/]+)\/tools\/([^/]+)$/.exec(url.pathname);

      if (match === null) {
        writeJson(response, 404, { error: "MCP session route was not found." });
        return;
      }

      const [, token, rawToolName] = match;
      const session = this.#sessions.get(token);
      const toolName = decodeURIComponent(rawToolName) as AgentHubMcpToolName;

      if (session === undefined || !session.enabledTools.has(toolName)) {
        writeJson(response, 404, { error: "MCP session or tool was not found." });
        return;
      }

      const body = await readJsonBody(request);
      const input = readToolInput(toolName, body);

      if (input === null) {
        writeJson(response, 400, { error: "Invalid AgentHub MCP tool input." });
        return;
      }

      const toolCallId = readToolCallId(body) ?? randomUUID();

      if (toolName === "upload_artifact") {
        if (session.onArtifactUpload === undefined) {
          writeJson(response, 404, { error: "Artifact upload is not available." });
          return;
        }

        const upload = await readArtifactUpload({
          input: input as AgentHubUploadArtifactToolInput,
          runId: session.runId,
          workspacePath: session.workspacePath,
        });
        const result = await session.onArtifactUpload(upload);
        await session.onToolCall({
          runId: session.runId,
          toolCallId,
          name: toolName,
          input,
          createdAt: new Date().toISOString(),
        });
        writeJson(response, 200, result);
        return;
      }

      const result = await session.onToolCall({
        runId: session.runId,
        toolCallId,
        name: toolName,
        input,
        createdAt: new Date().toISOString(),
      });

      writeJson(response, 200, result);
    } catch (error) {
      writeJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function readToolCallId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const toolCallId = (value as Record<string, unknown>).toolCallId;

  return typeof toolCallId === "string" && toolCallId.length > 0
    ? toolCallId
    : undefined;
}

function readToolInput(
  toolName: AgentHubMcpToolName,
  value: unknown,
): AgentHubMcpToolInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const input = (value as Record<string, unknown>).input;

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  if (toolName === "send_message") {
    return readSendMessageInput(input);
  }

  if (toolName === "create_task") {
    return readCreateTaskInput(input);
  }

  if (toolName === "upload_artifact") {
    return readUploadArtifactInput(input);
  }

  if (toolName === "complete_task") {
    return readCompleteTaskInput(input);
  }

  return null;
}

async function readArtifactUpload(input: {
  input: AgentHubUploadArtifactToolInput;
  runId: RunId;
  workspacePath: string;
}): Promise<AgentRunArtifactUpload> {
  const resolvedPath = path.resolve(input.workspacePath, input.input.localPath);

  if (!isPathInsideWorkspace(input.workspacePath, resolvedPath)) {
    throw new Error("upload_artifact.localPath must stay inside this run workspace.");
  }

  const info = await stat(resolvedPath);

  if (!info.isFile()) {
    throw new Error("upload_artifact.localPath must point to a file.");
  }

  if (info.size > maxArtifactUploadBytes) {
    throw new Error("upload_artifact file is too large.");
  }

  const content = await readFile(resolvedPath);

  return {
    ...input.input,
    filename: input.input.filename ?? path.basename(resolvedPath),
    sizeBytes: content.byteLength,
    contentBase64: content.toString("base64"),
  };
}

function readUploadArtifactInput(
  input: unknown,
): AgentHubUploadArtifactToolInput | null {
  const record = input as Record<string, unknown>;
  const taskId = record.taskId;
  const title = record.title;
  const localPath = record.localPath;
  const filename = record.filename;
  const kind = record.kind;
  const metadata = record.metadata;
  const mimeType = record.mimeType;
  const targetPath = record.targetPath;
  const displayMode = record.displayMode;

  if (
    typeof taskId !== "string" ||
    taskId.length === 0 ||
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 160 ||
    typeof localPath !== "string" ||
    localPath.trim().length === 0
  ) {
    return null;
  }

  return {
    taskId,
    title: title.trim(),
    localPath: localPath.trim(),
    filename:
      typeof filename === "string" && filename.trim().length > 0
        ? filename.trim()
        : undefined,
    kind: typeof kind === "string" && kind.trim().length > 0
      ? kind.trim() as AgentHubUploadArtifactToolInput["kind"]
      : undefined,
    metadata:
      typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : undefined,
    mimeType:
      typeof mimeType === "string" && mimeType.trim().length > 0
        ? mimeType.trim()
        : undefined,
    targetPath:
      typeof targetPath === "string" && targetPath.trim().length > 0
        ? targetPath.trim()
        : undefined,
    displayMode:
      typeof displayMode === "string" && displayMode.trim().length > 0
        ? displayMode.trim() as AgentHubUploadArtifactToolInput["displayMode"]
        : undefined,
  };
}

function readCompleteTaskInput(input: unknown): AgentHubCompleteTaskToolInput | null {
  const record = input as Record<string, unknown>;
  const taskId = record.taskId;
  const summary = record.summary;
  const artifactIds = Array.isArray(record.artifactIds)
    ? record.artifactIds.filter((artifactId): artifactId is string =>
        typeof artifactId === "string" && artifactId.length > 0,
      )
    : undefined;

  if (
    typeof taskId !== "string" ||
    taskId.length === 0 ||
    typeof summary !== "string" ||
    summary.trim().length === 0
  ) {
    return null;
  }

  return {
    taskId,
    summary: summary.trim(),
    artifactIds: artifactIds && artifactIds.length > 0 ? artifactIds : undefined,
  };
}

function readSendMessageInput(input: unknown): AgentHubSendMessageToolInput | null {
  const content = (input as Record<string, unknown>).content;

  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const mentions = Array.isArray(record.mentions)
    ? record.mentions.flatMap((mention) => {
        if (
          typeof mention !== "object" ||
          mention === null ||
          Array.isArray(mention)
        ) {
          return [];
        }

        const mentionRecord = mention as Record<string, unknown>;

        return mentionRecord.type === "agent" &&
          typeof mentionRecord.agentId === "string"
          ? [
              {
                type: "agent" as const,
                agentId: mentionRecord.agentId,
                label: typeof mentionRecord.label === "string"
                  ? mentionRecord.label
                  : undefined,
              },
            ]
          : [];
      })
    : undefined;
  const taskIds = Array.isArray(record.taskIds)
    ? record.taskIds.filter((taskId): taskId is string => typeof taskId === "string")
    : undefined;

  return {
    content: content.trim(),
    mentions: mentions && mentions.length > 0 ? mentions : undefined,
    taskIds: taskIds && taskIds.length > 0 ? taskIds : undefined,
  };
}

function readCreateTaskInput(input: unknown): AgentHubCreateTaskToolInput | null {
  const record = input as Record<string, unknown>;
  const title = record.title;
  const description = record.description;
  const assigneeAgentId = record.assigneeAgentId;

  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 160 ||
    typeof assigneeAgentId !== "string" ||
    assigneeAgentId.length === 0
  ) {
    return null;
  }

  return {
    title: title.trim(),
    description:
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : undefined,
    assigneeAgentId,
    taskId: randomUUID(),
  };
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    request.on("data", (chunk: Buffer) => {
      totalLength += chunk.length;

      if (totalLength > 1024 * 1024) {
        reject(new Error("MCP tool request body is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("MCP tool request body is not valid JSON."));
      }
    });
  });
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
