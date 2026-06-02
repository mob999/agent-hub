import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import type {
  AgentHubApproveTaskToolInput,
  AgentHubCancelTaskToolInput,
  AgentHubCompleteGoalToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubDeployStaticSiteToolInput,
  AgentHubDeployStaticSiteToolResult,
  AgentHubCreateGoalToolInput,
  AgentHubCreateTaskToolInput,
  AgentHubAppendMemoryToolInput,
  AgentHubListArtifactsToolInput,
  AgentHubListGoalsToolInput,
  AgentHubMcpToolCall,
  AgentHubMcpToolInput,
  AgentHubMcpToolName,
  AgentHubMcpToolResult,
  AgentHubReadMemoryToolInput,
  AgentHubReadArtifactToolInput,
  AgentHubSearchMemoryToolInput,
  AgentHubSendMessageToolInput,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
  AgentRunArtifactUpload,
  AgentRunStaticSiteDeploy,
  RunId,
} from "@agent-hub/core";

import { isPathInsideWorkspace } from "../workspace";
import {
  appendMemoryTool,
  readMemoryTool,
  searchMemoryTool,
} from "../memory";

const maxArtifactUploadBytes = 5 * 1024 * 1024;
const maxDirectoryArtifactUploadBytes = 25 * 1024 * 1024;
const maxStaticSiteDeployBytes = 25 * 1024 * 1024;
const maxDirectoryFileCount = 500;
const fetchBlockedPorts = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77,
  79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123,
  135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526,
  530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function isFetchBlockedPort(port: number): boolean {
  return fetchBlockedPorts.has(port);
}

interface AgentHubMcpSession {
  enabledTools: Set<AgentHubMcpToolName>;
  onArtifactUpload?(
    upload: AgentRunArtifactUpload,
  ): Promise<AgentHubUploadArtifactToolResult>;
  onStaticSiteDeploy?(
    deployment: AgentRunStaticSiteDeploy,
  ): Promise<AgentHubDeployStaticSiteToolResult>;
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

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await new Promise<void>((resolve) => {
        this.#server.listen(0, "127.0.0.1", resolve);
      });

      const address = this.#server.address();

      if (address === null || typeof address === "string") {
        throw new Error("AgentHub MCP relay did not bind to a TCP port.");
      }

      if (!isFetchBlockedPort(address.port)) {
        this.#url = `http://127.0.0.1:${address.port}`;
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
    }

    throw new Error("AgentHub MCP relay could not bind to a fetch-safe port.");
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
    onStaticSiteDeploy?(
      deployment: AgentRunStaticSiteDeploy,
    ): Promise<AgentHubDeployStaticSiteToolResult>;
    onToolCall(call: AgentHubMcpToolCall): Promise<AgentHubMcpToolResult> | AgentHubMcpToolResult;
    runId: RunId;
    workspacePath: string;
  }): AgentHubMcpSessionHandle {
    const token = randomUUID();
    const enabledTools = [...new Set(input.enabledTools)];

    this.#sessions.set(token, {
      enabledTools: new Set(enabledTools),
      onArtifactUpload: input.onArtifactUpload,
      onStaticSiteDeploy: input.onStaticSiteDeploy,
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

      if (toolName === "send_message") {
        const sendMessageInput = input as AgentHubSendMessageToolInput;
        const attachments = sendMessageInput.attachments ?? [];

        if (attachments.some((attachment) => attachment.localPath !== undefined)) {
          if (session.onArtifactUpload === undefined) {
            writeJson(response, 404, { error: "Message attachments are not available." });
            return;
          }

          const uploadedAttachments = [];
          const uploadedArtifacts = [];

          for (const [index, attachment] of attachments.entries()) {
            if (attachment.localPath === undefined) {
              uploadedAttachments.push(attachment);
              continue;
            }

            const upload = await readMessageAttachmentUpload({
              attachment,
              index,
              messageTarget: sendMessageInput.target,
              runId: session.runId,
              workspacePath: session.workspacePath,
            });
            const uploadResult = await session.onArtifactUpload(upload);
            uploadedArtifacts.push(uploadResult.artifact);
            uploadedAttachments.push({
              ...attachment,
              artifactId: uploadResult.artifact.id,
              localPath: undefined,
            });
          }

          const relayedInput: AgentHubSendMessageToolInput = {
            ...sendMessageInput,
            attachments: uploadedAttachments,
          };
          const result = await session.onToolCall({
            runId: session.runId,
            toolCallId,
            name: toolName,
            input: relayedInput,
            createdAt: new Date().toISOString(),
          });
          writeJson(response, 200, {
            ...result,
            attachments: uploadedArtifacts,
          });
          return;
        }
      }

      if (toolName === "append_memory") {
        const result = await appendMemoryTool(
          session.workspacePath,
          input as AgentHubAppendMemoryToolInput,
        );
        void Promise.resolve()
          .then(() =>
            session.onToolCall({
              runId: session.runId,
              toolCallId,
              name: toolName,
              input,
              createdAt: new Date().toISOString(),
            })
          )
          .catch(() => undefined);
        writeJson(response, 200, result);
        return;
      }

      if (toolName === "deploy_static_site") {
        if (session.onStaticSiteDeploy === undefined) {
          writeJson(response, 404, { error: "Static site deployment is not available." });
          return;
        }

        const deployment = await readStaticSiteDeployment({
          input: input as AgentHubDeployStaticSiteToolInput,
          runId: session.runId,
          workspacePath: session.workspacePath,
        });
        const result = await session.onStaticSiteDeploy(deployment);
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

      if (toolName === "search_memory") {
        const result = await searchMemoryTool(
          session.workspacePath,
          input as AgentHubSearchMemoryToolInput,
        );
        void Promise.resolve()
          .then(() =>
            session.onToolCall({
              runId: session.runId,
              toolCallId,
              name: toolName,
              input,
              createdAt: new Date().toISOString(),
            })
          )
          .catch(() => undefined);
        writeJson(response, 200, result);
        return;
      }

      if (toolName === "read_memory") {
        const result = await readMemoryTool(
          session.workspacePath,
          input as AgentHubReadMemoryToolInput,
        );
        void Promise.resolve()
          .then(() =>
            session.onToolCall({
              runId: session.runId,
              toolCallId,
              name: toolName,
              input,
              createdAt: new Date().toISOString(),
            })
          )
          .catch(() => undefined);
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

  if (toolName === "list_goals") {
    return readListGoalsInput(input);
  }

  if (toolName === "list_artifacts") {
    return readListArtifactsInput(input);
  }

  if (toolName === "read_artifact") {
    return readReadArtifactInput(input);
  }

  if (toolName === "append_memory") {
    return readAppendMemoryInput(input);
  }

  if (toolName === "search_memory") {
    return readSearchMemoryInput(input);
  }

  if (toolName === "read_memory") {
    return readReadMemoryInput(input);
  }

  if (toolName === "create_goal") {
    return readCreateGoalInput(input);
  }

  if (toolName === "create_task") {
    return readCreateTaskInput(input);
  }

  if (toolName === "approve_task") {
    return readApproveTaskInput(input);
  }

  if (toolName === "cancel_task") {
    return readCancelTaskInput(input);
  }

  if (toolName === "upload_artifact") {
    return readUploadArtifactInput(input);
  }

  if (toolName === "deploy_static_site") {
    return readDeployStaticSiteInput(input);
  }

  if (toolName === "complete_task") {
    return readCompleteTaskInput(input);
  }

  if (toolName === "complete_goal") {
    return readCompleteGoalInput(input);
  }

  return null;
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

function readAppendMemoryInput(input: unknown): AgentHubAppendMemoryToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const scope = record.scope;
  const title = record.title;
  const content = record.content;
  const tags = Array.isArray(record.tags)
    ? record.tags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
    : undefined;

  if (
    scope !== undefined &&
    scope !== "long_term" &&
    scope !== "daily"
  ) {
    return null;
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    return null;
  }

  return {
    scope,
    title:
      typeof title === "string" && title.trim().length > 0
        ? title.trim()
        : undefined,
    content: content.trim(),
    tags: tags && tags.length > 0 ? tags.map((tag) => tag.trim()) : undefined,
  };
}

function readSearchMemoryInput(input: unknown): AgentHubSearchMemoryToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const query = record.query;
  const limit = record.limit;

  if (typeof query !== "string" || query.trim().length === 0) {
    return null;
  }

  return {
    query: query.trim(),
    scopes: readMemoryScopes(record.scopes),
    fromDate:
      typeof record.fromDate === "string" && record.fromDate.length > 0
        ? record.fromDate
        : undefined,
    toDate:
      typeof record.toDate === "string" && record.toDate.length > 0
        ? record.toDate
        : undefined,
    limit:
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 50)
        : undefined,
  };
}

function readReadMemoryInput(input: unknown): AgentHubReadMemoryToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const scope = record.scope;
  const maxBytes = record.maxBytes;

  if (scope !== "long_term" && scope !== "daily" && scope !== "transcript") {
    return null;
  }

  return {
    scope,
    date:
      typeof record.date === "string" && record.date.length > 0
        ? record.date
        : undefined,
    maxBytes:
      typeof maxBytes === "number" && Number.isFinite(maxBytes) && maxBytes > 0
        ? Math.min(Math.floor(maxBytes), 64 * 1024)
        : undefined,
  };
}

function readListGoalsInput(input: unknown): AgentHubListGoalsToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const status = (input as Record<string, unknown>).status;

  return typeof status === "string" && status.length > 0
    ? { status: status as AgentHubListGoalsToolInput["status"] }
    : {};
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

  const linkInfo = await lstat(resolvedPath);
  if (linkInfo.isSymbolicLink()) {
    throw new Error("upload_artifact.localPath cannot be a symlink.");
  }
  const info = await stat(resolvedPath);

  if (info.isDirectory()) {
    const files = await readWorkspaceDirectoryFiles({
      directoryPath: resolvedPath,
      maxBytes: maxDirectoryArtifactUploadBytes,
      maxFiles: maxDirectoryFileCount,
      workspacePath: input.workspacePath,
    });
    const zip = createStoredZip(files);
    const sourcePath = path
      .relative(input.workspacePath, resolvedPath)
      .split(path.sep)
      .join("/");
    const directoryName = path.basename(resolvedPath);
    const filename = input.input.filename ?? `${directoryName}.zip`;

    if (zip.byteLength > maxDirectoryArtifactUploadBytes) {
      throw new Error("upload_artifact directory is too large.");
    }

    return {
      ...input.input,
      filename,
      sourcePath,
      sizeBytes: zip.byteLength,
      contentBase64: zip.toString("base64"),
    };
  }

  if (!info.isFile()) {
    throw new Error("upload_artifact.localPath must point to a file or directory.");
  }

  if (info.size > maxArtifactUploadBytes) {
    throw new Error("upload_artifact file is too large.");
  }

  const content = await readFile(resolvedPath);
  const sourcePath = path
    .relative(input.workspacePath, resolvedPath)
    .split(path.sep)
    .join("/");

  return {
    ...input.input,
    filename: input.input.filename ?? path.basename(resolvedPath),
    sourcePath,
    sizeBytes: content.byteLength,
    contentBase64: content.toString("base64"),
  };
}

async function readStaticSiteDeployment(input: {
  input: AgentHubDeployStaticSiteToolInput;
  runId: RunId;
  workspacePath: string;
}): Promise<AgentRunStaticSiteDeploy> {
  const resolvedPath = path.resolve(input.workspacePath, input.input.localPath);

  if (!isPathInsideWorkspace(input.workspacePath, resolvedPath)) {
    throw new Error("deploy_static_site.localPath must stay inside this run workspace.");
  }

  const linkInfo = await lstat(resolvedPath);
  if (linkInfo.isSymbolicLink()) {
    throw new Error("deploy_static_site.localPath cannot be a symlink.");
  }
  const info = await stat(resolvedPath);
  if (!info.isDirectory()) {
    throw new Error("deploy_static_site.localPath must point to a directory.");
  }

  const entrypoint = normalizeRelativeFilePath(input.input.entrypoint ?? "index.html");
  const files = await readWorkspaceDirectoryFiles({
    directoryPath: resolvedPath,
    maxBytes: maxStaticSiteDeployBytes,
    maxFiles: maxDirectoryFileCount,
    workspacePath: input.workspacePath,
  });

  if (!files.some((file) => file.path === entrypoint)) {
    throw new Error("deploy_static_site.entrypoint was not found in the directory.");
  }

  return {
    ...input.input,
    entrypoint,
    files: files.map((file) => ({
      path: file.path,
      sizeBytes: file.content.byteLength,
      contentBase64: file.content.toString("base64"),
    })),
  };
}

interface DirectoryFile {
  content: Buffer;
  path: string;
}

async function readWorkspaceDirectoryFiles(input: {
  directoryPath: string;
  maxBytes: number;
  maxFiles: number;
  workspacePath: string;
}): Promise<DirectoryFile[]> {
  const files: DirectoryFile[] = [];
  let totalBytes = 0;

  async function visit(directoryPath: string): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const entryPath = path.join(directoryPath, entry.name);
      const entryInfo = await lstat(entryPath);

      if (entryInfo.isSymbolicLink()) {
        throw new Error("Directory uploads cannot include symlinks.");
      }

      if (!isPathInsideWorkspace(input.workspacePath, entryPath)) {
        throw new Error("Directory upload path escapes the run workspace.");
      }

      if (entryInfo.isDirectory()) {
        await visit(entryPath);
        continue;
      }

      if (!entryInfo.isFile()) {
        continue;
      }

      if (files.length >= input.maxFiles) {
        throw new Error("Directory upload includes too many files.");
      }

      totalBytes += entryInfo.size;
      if (totalBytes > input.maxBytes) {
        throw new Error("Directory upload is too large.");
      }

      const relativePath = normalizeRelativeFilePath(
        path.relative(input.directoryPath, entryPath).split(path.sep).join("/"),
      );
      files.push({
        content: await readFile(entryPath),
        path: relativePath,
      });
    }
  }

  await visit(input.directoryPath);
  return files;
}

function normalizeRelativeFilePath(filePath: string): string {
  const normalized = filePath.split(/[\\/]+/).filter(Boolean).join("/");

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Relative file path is invalid.");
  }

  return normalized;
}

function createStoredZip(files: DirectoryFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filename = Buffer.from(file.path, "utf8");
    const crc = crc32(file.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.content.byteLength, 18);
    localHeader.writeUInt32LE(file.content.byteLength, 22);
    localHeader.writeUInt16LE(filename.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, filename, file.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.content.byteLength, 20);
    centralHeader.writeUInt32LE(file.content.byteLength, 24);
    centralHeader.writeUInt16LE(filename.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, filename);

    offset += localHeader.byteLength + filename.byteLength + file.content.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function readListArtifactsInput(
  input: unknown,
): AgentHubListArtifactsToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;
  const limit = record.limit;

  return {
    goalId: typeof goalId === "string" && goalId.length > 0
      ? goalId
      : undefined,
    taskIndex: readTaskIndex(taskIndex) ?? undefined,
    limit:
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 50)
        : undefined,
  };
}

function readReadArtifactInput(
  input: unknown,
): AgentHubReadArtifactToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const artifactId = record.artifactId;

  return typeof artifactId === "string" && artifactId.length > 0
    ? {
        artifactId,
        goalId: typeof goalId === "string" && goalId.length > 0
          ? goalId
          : undefined,
      }
    : null;
}

async function readMessageAttachmentUpload(input: {
  attachment: NonNullable<AgentHubSendMessageToolInput["attachments"]>[number];
  index: number;
  messageTarget?: AgentHubSendMessageToolInput["target"];
  runId: RunId;
  workspacePath: string;
}): Promise<AgentRunArtifactUpload> {
  if (input.attachment.localPath === undefined) {
    throw new Error("send_message image attachment localPath is required.");
  }

  const resolvedPath = path.resolve(input.workspacePath, input.attachment.localPath);

  if (!isPathInsideWorkspace(input.workspacePath, resolvedPath)) {
    throw new Error("send_message attachment localPath must stay inside this run workspace.");
  }

  const linkInfo = await lstat(resolvedPath);
  if (linkInfo.isSymbolicLink()) {
    throw new Error("send_message attachment localPath cannot be a symlink.");
  }
  const info = await stat(resolvedPath);

  if (!info.isFile()) {
    throw new Error("send_message attachment localPath must point to a file.");
  }

  if (info.size > maxArtifactUploadBytes) {
    throw new Error("send_message attachment file is too large.");
  }

  const ext = path.extname(resolvedPath).toLowerCase();

  if (![".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) {
    throw new Error("send_message attachment must be an image file.");
  }

  const content = await readFile(resolvedPath);
  const sourcePath = path
    .relative(input.workspacePath, resolvedPath)
    .split(path.sep)
    .join("/");
  const filename = input.attachment.filename ?? path.basename(resolvedPath);

  return {
    title: input.attachment.title ?? filename,
    localPath: input.attachment.localPath,
    messageTarget: input.messageTarget,
    filename,
    sourcePath,
    sizeBytes: content.byteLength,
    contentBase64: content.toString("base64"),
  };
}

function readUploadArtifactInput(
  input: unknown,
): AgentHubUploadArtifactToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = readTaskIndex(record.taskIndex);
  const title = record.title;
  const localPath = record.localPath;
  const filename = record.filename;

  if (
    typeof goalId !== "string" ||
    goalId.length === 0 ||
    taskIndex === null ||
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 160 ||
    typeof localPath !== "string" ||
    localPath.trim().length === 0
  ) {
    return null;
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
  };
}

function readDeployStaticSiteInput(
  input: unknown,
): AgentHubDeployStaticSiteToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const title = record.title;
  const localPath = record.localPath;
  const entrypoint = record.entrypoint;
  const goalId = record.goalId;
  const taskIndex = readTaskIndex(record.taskIndex);

  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 160 ||
    typeof localPath !== "string" ||
    localPath.trim().length === 0
  ) {
    return null;
  }

  if (goalId !== undefined && typeof goalId !== "string") {
    return null;
  }

  if (record.taskIndex !== undefined && taskIndex === null) {
    return null;
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

function readCompleteTaskInput(input: unknown): AgentHubCompleteTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = readTaskIndex(record.taskIndex);
  const summary = record.summary;
  const artifactIds = Array.isArray(record.artifactIds)
    ? record.artifactIds.filter((artifactId): artifactId is string =>
        typeof artifactId === "string" && artifactId.length > 0,
      )
    : undefined;

  if (
    typeof goalId !== "string" ||
    goalId.length === 0 ||
    taskIndex === null ||
    typeof summary !== "string" ||
    summary.trim().length === 0
  ) {
    return null;
  }

  return {
    goalId,
    taskIndex,
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
  const target = readSendMessageTarget(record.target);

  if (record.target !== undefined && target === undefined) {
    return null;
  }

  const attachments = readSendMessageAttachments(record.attachments);

  return {
    content: content.trim(),
    target,
    attachments,
  };
}

function readSendMessageTarget(
  value: unknown,
): AgentHubSendMessageToolInput["target"] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (record.type === "current") {
    return { type: "current" };
  }

  if (record.type === "user") {
    return { type: "user" };
  }

  if (
    record.type === "group" &&
    typeof record.groupName === "string" &&
    record.groupName.trim().length > 0
  ) {
    return { type: "group", groupName: record.groupName.trim() };
  }

  return undefined;
}

function readSendMessageAttachments(
  value: unknown,
): AgentHubSendMessageToolInput["attachments"] | undefined {
  if (value === undefined || !Array.isArray(value)) {
    return undefined;
  }

  const attachments = value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (record.type !== "image") {
      return [];
    }

    const localPath = typeof record.localPath === "string"
      ? record.localPath.trim()
      : undefined;
    const artifactId = typeof record.artifactId === "string" && record.artifactId.length > 0
      ? record.artifactId
      : undefined;

    if ((localPath === undefined || localPath.length === 0) && artifactId === undefined) {
      return [];
    }

    return [
      {
        type: "image" as const,
        localPath: localPath && localPath.length > 0 ? localPath : undefined,
        artifactId,
        title:
          typeof record.title === "string" && record.title.trim().length > 0
            ? record.title.trim()
            : undefined,
        filename:
          typeof record.filename === "string" && record.filename.trim().length > 0
            ? record.filename.trim()
            : undefined,
      },
    ];
  });

  return attachments.length > 0 ? attachments : undefined;
}

function readCreateGoalInput(input: unknown): AgentHubCreateGoalToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const title = record.title;
  const description = record.description;

  if (
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 160
  ) {
    return null;
  }

  return {
    title: title.trim(),
    description:
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : undefined,
  };
}

function readCreateTaskInput(input: unknown): AgentHubCreateTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const title = record.title;
  const description = record.description;
  const assigneeAgentId = record.assigneeAgentId;
  const dependsOnTaskIndexes = Array.isArray(record.dependsOnTaskIndexes)
    ? compactUniqueNumbers(record.dependsOnTaskIndexes)
    : undefined;

  if (
    typeof goalId !== "string" ||
    goalId.length === 0 ||
    typeof title !== "string" ||
    title.trim().length === 0 ||
    title.trim().length > 160 ||
    typeof assigneeAgentId !== "string" ||
    assigneeAgentId.length === 0
  ) {
    return null;
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

function readApproveTaskInput(input: unknown): AgentHubApproveTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = readTaskIndex(record.taskIndex);

  return typeof goalId === "string" && goalId.length > 0 && taskIndex !== null
    ? { goalId, taskIndex }
    : null;
}

function readCancelTaskInput(input: unknown): AgentHubCancelTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = readTaskIndex(record.taskIndex);
  const reason = record.reason;

  if (typeof goalId !== "string" || goalId.length === 0 || taskIndex === null) {
    return null;
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

function readCompleteGoalInput(input: unknown): AgentHubCompleteGoalToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const summary = record.summary;

  if (typeof goalId !== "string" || goalId.length === 0) {
    return null;
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
