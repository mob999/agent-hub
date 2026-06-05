import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type {
  AgentHubListGoalsToolResult,
  AgentHubMcpToolName,
  Conversation,
  ConversationGoal,
  ConversationMessage,
  RealtimeEvent,
  RunEvent,
  RuntimeKind,
} from "@agent-hub/core";
import {
  agentHubAllMcpTools,
  agentHubNonOrchestratorMcpTools,
  inferArtifactFileInfo,
} from "@agent-hub/core";
import {
  applyRunDispatchPreparation,
  buildAgentGroupsPrompt,
  buildConversationRunPrompt,
  conversationArtifactStorageKey,
  createRealtimeEvent,
  getConversationDeploymentFileForUser,
  listActiveAgentGroupContexts,
  listConversationMessagesForUser,
  prepareProjectRunJobForConversation,
  prepareRunDispatch,
  publishRealtimeEvent,
  readArtifactContent,
  sanitizeArtifactFilename,
  type RunnableAgent,
  type RunQueueJob,
  type UserMessageAttachmentUpload,
  createDaemonDeviceToken,
  writeArtifactBuffer,
} from "@agent-hub/server";

import type { ApiContext } from "../context.js";

export function createApiServices(context: ApiContext) {
  const { db, env, redis, logger } = context;
  const execFileAsync = promisify(execFile);
  const runtimeKinds = new Set<RuntimeKind>([
    "claude-code",
    "codex",
    "opencode",
    "custom",
  ]);
  const projectChangeStatuses = new Set(["open", "merged", "rejected", "failed"]);
  const orchestratorParallelSerialTaskInstructions = [
    "Parallel task rule: tasks may run in parallel only when they are assigned to different agents, each task has enough input to start, their deliverables are clearly separated, and neither task needs the other's report, code, screenshots, site artifact, decision, or verification result.",
    "Serial task rule: tasks must be serial when they share the same assignee, when one task depends on another task's output, when multiple agents must edit or verify the same deliverable, or when integration, validation, publishing, or final summarization must happen after earlier work.",
    "Planning pattern: create independent research, design, or separate-module tasks in parallel first; then create dependent integration, verification, publishing, and final-summary tasks with dependsOnTaskIndexes.",
    "If you are not certain two tasks are independent, make them serial by adding dependsOnTaskIndexes.",
  ];
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const daemonDeviceIdPattern = /^[A-Za-z0-9_.:-]{1,120}$/;
  const repositoryRoot = context.repositoryRoot;
  
  function powerShellQuote(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
  }
  
  function posixShellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`;
  }
  
  function buildDaemonSourceCommand(input: {
    deviceId: string;
    gatewayUrl: string;
    token: string;
    platform: "windows" | "posix";
  }): string {
    if (input.platform === "posix") {
      return [
        `cd ${posixShellQuote(repositoryRoot)}`,
        [
          `AGENTHUB_DAEMON_GATEWAY_URL=${posixShellQuote(input.gatewayUrl)}`,
          `AGENTHUB_DAEMON_TOKEN=${posixShellQuote(input.token)}`,
          `AGENTHUB_DEVICE_ID=${posixShellQuote(input.deviceId)}`,
          "pnpm --filter @agent-hub/daemon dev",
        ].join(" "),
      ].join(" && ");
    }
  
    return [
      `cd ${powerShellQuote(repositoryRoot)}`,
      `$env:AGENTHUB_DAEMON_GATEWAY_URL=${powerShellQuote(input.gatewayUrl)}`,
      `$env:AGENTHUB_DAEMON_TOKEN=${powerShellQuote(input.token)}`,
      `$env:AGENTHUB_DEVICE_ID=${powerShellQuote(input.deviceId)}`,
      "pnpm --filter @agent-hub/daemon dev",
    ].join("; ");
  }

  function buildDaemonNpxCommand(input: {
    deviceId: string;
    gatewayUrl: string;
    token: string;
    platform: "windows" | "posix";
  }): string {
    const quote = input.platform === "windows" ? powerShellQuote : posixShellQuote;

    return [
      "npx",
      "-y",
      "@tavro/daemon@latest",
      "connect",
      "--gateway-url",
      quote(input.gatewayUrl),
      "--device-id",
      quote(input.deviceId),
      "--token",
      quote(input.token),
    ].join(" ");
  }

  function requireDaemonTokenSecret(): string {
    if (env.AGENTHUB_DAEMON_TOKEN_SECRET !== undefined) {
      return env.AGENTHUB_DAEMON_TOKEN_SECRET;
    }

    if (env.NODE_ENV !== "production") {
      return env.AGENTHUB_DAEMON_TOKEN;
    }

    throw new Error("AGENTHUB_DAEMON_TOKEN_SECRET is required in production.");
  }

  function daemonTokenForDevice(deviceId: string): string {
    if (env.NODE_ENV !== "production") {
      return env.AGENTHUB_DAEMON_TOKEN;
    }

    return createDaemonDeviceToken({
      deviceId,
      secret: requireDaemonTokenSecret(),
    });
  }

  function buildDaemonCommand(input: {
    deviceId: string;
    gatewayUrl: string;
    platform: "windows" | "posix";
  }): string {
    const token = daemonTokenForDevice(input.deviceId);

    if (env.NODE_ENV !== "production") {
      return buildDaemonSourceCommand({
        ...input,
        token,
      });
    }

    return buildDaemonNpxCommand({
      ...input,
      token,
    });
  }
  
  function parseDaemonCommandPlatform(value: string | undefined): "windows" | "posix" {
    return value === "posix" ? "posix" : "windows";
  }
  
  function normalizeDaemonDeviceName(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
  
    const name = value.trim().replace(/\s+/g, " ");
    return name.length > 0 && name.length <= 80 ? name : null;
  }
  
  function daemonDeviceCommandResponse(input: {
    device: {
      id: string;
      name: string;
      ownerUserId: string | null;
      registrationShell: string | null;
      status: string;
      lastSeenAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
    };
    platform: "windows" | "posix";
  }) {
    const gatewayUrl = env.AGENTHUB_DAEMON_GATEWAY_URL;
  
    return {
      command: buildDaemonCommand({
        deviceId: input.device.id,
        gatewayUrl,
        platform: input.platform,
      }),
      device: {
        id: input.device.id,
        ownerUserId: input.device.ownerUserId ?? undefined,
        name: input.device.name,
        status: input.device.status,
        registrationShell: input.device.registrationShell ?? undefined,
        lastSeenAt: input.device.lastSeenAt?.toISOString() ?? null,
        createdAt: input.device.createdAt.toISOString(),
        updatedAt: input.device.updatedAt.toISOString(),
        deletedAt: input.device.deletedAt?.toISOString(),
      },
      deviceId: input.device.id,
      gatewayUrl,
      shell: input.platform === "windows" ? "powershell" : "sh",
    };
  }
  
  function isMissingFileError(error: unknown): boolean {
    return typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT";
  }
  
  type SseClient = {
    controller: ReadableStreamDefaultController<Uint8Array>;
    heartbeat: ReturnType<typeof setInterval> | null;
    id: string;
  };
  
  const sseEncoder = new TextEncoder();
  const sseClientsByUserId = new Map<string, Set<SseClient>>();
  
  function sseFrame(event: string, data: unknown): Uint8Array {
    return sseEncoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
  
  function unregisterSseClient(ownerUserId: string, client: SseClient): void {
    if (client.heartbeat !== null) {
      clearInterval(client.heartbeat);
      client.heartbeat = null;
    }
  
    const clients = sseClientsByUserId.get(ownerUserId);
    clients?.delete(client);
  
    if (clients !== undefined && clients.size === 0) {
      sseClientsByUserId.delete(ownerUserId);
    }
  }
  
  function deliverRealtimeEvent(event: RealtimeEvent): void {
    const clients = sseClientsByUserId.get(event.ownerUserId);
  
    if (clients === undefined) {
      return;
    }
  
    for (const client of [...clients]) {
      try {
        client.controller.enqueue(sseFrame(event.type, event));
      } catch (error) {
        logger.warn(
          { err: error, eventId: event.eventId, ownerUserId: event.ownerUserId },
          "Failed to deliver SSE event",
        );
        unregisterSseClient(event.ownerUserId, client);
      }
    }
  }
  
  async function publishRealtimeEvents(events: RealtimeEvent[]): Promise<void> {
    await Promise.all(
      events.map(async (event) => {
        try {
          await publishRealtimeEvent(redis, event);
        } catch (error) {
          logger.warn(
            { err: error, eventId: event.eventId, type: event.type },
            "Failed to publish realtime event",
          );
        }
      }),
    );
  }
  
  function queuedRunEventForJob(job: RunQueueJob): RunEvent {
    return {
      type: "run.queued",
      runId: job.run.id,
      agentId: job.run.agentId,
      daemonDeviceId: job.run.daemonDeviceId,
      createdAt: job.run.createdAt,
    };
  }
  
  function realtimeEventsForCreatedRuns(input: {
    conversation: Conversation;
    jobs: RunQueueJob[];
    messages: ConversationMessage[];
    ownerUserId: string;
  }): RealtimeEvent[] {
    return [
      createRealtimeEvent({
        conversation: input.conversation,
        conversationId: input.conversation.id,
        ownerUserId: input.ownerUserId,
        type: "conversation.updated",
      }),
      ...input.messages.map((message) =>
        createRealtimeEvent({
          conversationId: message.conversationId,
          message,
          ownerUserId: input.ownerUserId,
          type: "conversation.message.created" as const,
        }),
      ),
      ...input.messages.flatMap((message) =>
        (message.attachments ?? []).map((attachment) =>
          createRealtimeEvent({
            artifact: attachment.artifact,
            conversationId: message.conversationId,
            ownerUserId: input.ownerUserId,
            type: "artifact.created" as const,
          })
        )
      ),
      ...input.jobs.flatMap((job) => {
        const queuedEvent = queuedRunEventForJob(job);
  
        return [
          createRealtimeEvent({
            conversationId: input.conversation.id,
            ownerUserId: input.ownerUserId,
            run: job.run,
            type: "run.updated" as const,
          }),
          createRealtimeEvent({
            conversationId: input.conversation.id,
            event: queuedEvent,
            ownerUserId: input.ownerUserId,
            runId: job.run.id,
            type: "run.event.created" as const,
          }),
        ];
      }),
    ];
  }
  
  function isRuntimeKind(value: unknown): value is RuntimeKind {
    return typeof value === "string" && runtimeKinds.has(value as RuntimeKind);
  }
  
  function isValidAgentIdList(value: unknown): value is string[] {
    return (
      Array.isArray(value) &&
      value.length > 0 &&
      value.length <= 20 &&
      value.every((agentId) =>
        typeof agentId === "string" && uuidPattern.test(agentId)
      ) &&
      new Set(value).size === value.length
    );
  }
  
  const maxMessageAttachmentCount = 10;
  const maxMessageAttachmentBytes = 25 * 1024 * 1024;
  const maxMessageAttachmentTotalBytes = 100 * 1024 * 1024;
  
  type UploadedFileLike = File;
  
  function isUploadedFile(value: FormDataEntryValue): value is UploadedFileLike {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { size?: unknown }).size === "number"
    );
  }
  
  function getFormString(form: FormData, name: string): string | undefined {
    const value = form.get(name);
  
    return typeof value === "string" ? value : undefined;
  }
  
  function isImageUpload(file: UploadedFileLike, filename: string): boolean {
    if (typeof file.type === "string" && file.type.toLowerCase().startsWith("image/")) {
      return true;
    }
  
    return inferArtifactFileInfo({ filename }).category === "image";
  }
  
  function artifactPromptBlockForUserAttachments(
    attachments: UserMessageAttachmentUpload[],
    input: { conversationId: string },
  ): string {
    if (attachments.length === 0) {
      return "";
    }
  
    return [
      "<agenthub_user_message_attachments>",
      "The user's latest message includes these attachments. Use read_artifact({ artifactId }) to inspect them when needed.",
      ...attachments.map((attachment) => {
        const mimeType = inferArtifactFileInfo({ filename: attachment.filename }).mimeType;
        const editorUrl = new URL(
          `/editor/${input.conversationId}/${attachment.artifactId}`,
          env.AGENTHUB_PUBLIC_WEB_URL,
        ).toString();
        const downloadUrl = new URL(
          `/artifacts/${attachment.artifactId}/download`,
          env.AGENTHUB_PUBLIC_API_URL,
        ).toString();
  
        return [
          `- ${attachment.title}`,
          `  artifactId: ${attachment.artifactId}`,
          `  filename: ${attachment.filename}`,
          `  type: ${attachment.attachmentType}`,
          `  mimeType: ${mimeType}`,
          `  sizeBytes: ${attachment.sizeBytes}`,
          `  editorUrl: ${editorUrl}`,
          `  downloadUrl: ${downloadUrl}`,
        ].join("\n");
      }),
      "</agenthub_user_message_attachments>",
    ].join("\n");
  }
  
  function userMessageForPrompt(
    content: string,
    attachments: UserMessageAttachmentUpload[],
    input: { conversationId: string },
  ): string {
    const attachmentBlock = artifactPromptBlockForUserAttachments(attachments, input);
  
    if (attachmentBlock.length === 0) {
      return content;
    }
  
    return [
      content.length > 0 ? content : "(The user sent attachments without text.)",
      attachmentBlock,
    ].join("\n\n");
  }
  
  async function writeUserMessageAttachments(input: {
    conversationId: string;
    files: UploadedFileLike[];
  }): Promise<UserMessageAttachmentUpload[]> {
    const attachments: UserMessageAttachmentUpload[] = [];
  
    for (const file of input.files) {
      const filename = sanitizeArtifactFilename(file.name);
      const artifactId = randomUUID();
      const storageKey = conversationArtifactStorageKey({
        artifactId,
        conversationId: input.conversationId,
        filename,
      });
      const content = Buffer.from(await file.arrayBuffer());
      const sizeBytes = await writeArtifactBuffer({
        content,
        storageKey,
        storageRoot: env.AGENTHUB_STORAGE_ROOT,
      });
  
      attachments.push({
        artifactId,
        attachmentType: isImageUpload(file, filename) ? "image" : "file",
        filename,
        sizeBytes,
        storageKey,
        title: filename,
      });
    }
  
    return attachments;
  }
  
  function validateUploadFiles(files: UploadedFileLike[]): string | null {
    if (files.length > maxMessageAttachmentCount) {
      return `You can attach up to ${maxMessageAttachmentCount} files.`;
    }
  
    let totalSize = 0;
  
    for (const file of files) {
      totalSize += file.size;
  
      if (file.size > maxMessageAttachmentBytes) {
        return "Each attachment must be 25MB or smaller.";
      }
    }
  
    if (totalSize > maxMessageAttachmentTotalBytes) {
      return "Attachments must be 100MB or smaller in total.";
    }
  
    return null;
  }
  
  function parseOptionalAgentId(value: unknown): string | undefined {
    return typeof value === "string" && uuidPattern.test(value)
      ? value
      : undefined;
  }
  
  function parseRecordStatusFilter(
    value: unknown,
  ): "active" | "archived" | "all" | undefined | null {
    if (value === undefined) {
      return undefined;
    }
  
    return value === "active" || value === "archived" || value === "all"
      ? value
      : null;
  }
  
  function parseSearchSort(value: unknown): "relevant" | "recent" | undefined | null {
    if (value === undefined) {
      return undefined;
    }
  
    return value === "relevant" || value === "recent" ? value : null;
  }
  
  function parseSearchTimeFilter(
    value: unknown,
  ): "any" | "24h" | "7d" | "30d" | undefined | null {
    if (value === undefined) {
      return undefined;
    }
  
    return value === "any" || value === "24h" || value === "7d" || value === "30d"
      ? value
      : null;
  }
  
  function parseSenderType(
    value: unknown,
  ): "user" | "agent" | "system" | undefined | null {
    if (value === undefined) {
      return undefined;
    }
  
    return value === "user" || value === "agent" || value === "system"
      ? value
      : null;
  }
  
  const memoryDatePattern = /^\d{4}-\d{2}-\d{2}$/;
  
  function todayUtcDate(): string {
    return new Date().toISOString().slice(0, 10);
  }
  
  async function readAgentMemoryFile(input: {
    file: string;
    label: string;
    scope: "long_term" | "daily" | "transcript";
    workspacePath: string;
  }): Promise<{
    content: string;
    exists: boolean;
    file: string;
    label: string;
    scope: "long_term" | "daily" | "transcript";
  }> {
    const fullPath = path.join(input.workspacePath, input.file);
  
    try {
      return {
        content: await readFile(fullPath, "utf8"),
        exists: true,
        file: input.file.replace(/\\/g, "/"),
        label: input.label,
        scope: input.scope,
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {
          content: "",
          exists: false,
          file: input.file.replace(/\\/g, "/"),
          label: input.label,
          scope: input.scope,
        };
      }
  
      throw error;
    }
  }
  
  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      switch (character) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case "\"":
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return character;
      }
    });
  }
  
  function previewUnavailableResponse(input: {
    message: string;
    previewUrl?: string;
    status?: number;
  }): Response {
    const status = input.status ?? 502;
    const previewLine = input.previewUrl === undefined
      ? ""
      : `<p class="url">${escapeHtml(input.previewUrl)}</p>`;
  
    return new Response(
      `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Preview unavailable</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: #ffffff;
          color: #161616;
          font-family: IBM Plex Sans, Inter, system-ui, sans-serif;
        }
        main {
          max-width: 36rem;
          padding: 1rem;
        }
        h1 {
          margin: 0 0 0.5rem;
          font-size: 1rem;
          line-height: 1.4;
        }
        p {
          margin: 0;
          color: #525252;
          line-height: 1.5;
        }
        .url {
          margin-top: 0.75rem;
          overflow-wrap: anywhere;
          font-family: IBM Plex Mono, ui-monospace, monospace;
          font-size: 0.875rem;
        }
      </style>
    </head>
    <body>
      <main>
        <h1>Preview unavailable</h1>
        <p>${escapeHtml(input.message)}</p>
        ${previewLine}
      </main>
    </body>
  </html>`,
      {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
        status,
      },
    );
  }
  
  function groupChatMcpToolsForAgent(input: {
    agentId: string;
    orchestratorAgentId?: string;
  }): AgentHubMcpToolName[] {
    return input.orchestratorAgentId === input.agentId
      ? [...agentHubAllMcpTools]
      : [...agentHubNonOrchestratorMcpTools];
  }
  
  function toMcpGoalList(
    goals: ConversationGoal[],
  ): AgentHubListGoalsToolResult["goals"] {
    return goals.map((goal) => ({
      ...goal,
      tasks: goal.tasks.map((task) => ({ ...task })),
    }));
  }
  
  function conversationMessageCompressionRole(
    message: ConversationMessage,
    agentNamesById: Record<string, string>,
  ): string {
    if (message.senderType === "user") {
      return "User";
    }
  
    if (message.senderType === "agent") {
      return message.senderAgentId === undefined
        ? "Agent"
        : agentNamesById[message.senderAgentId] ?? "Agent";
    }
  
    return "System";
  }
  
  function buildCompressibleConversationText(
    messages: ConversationMessage[],
    agentNamesById: Record<string, string>,
  ): string {
    const history = messages
      .filter((message) => message.content.trim().length > 0)
      .map((message) =>
        [
          `${conversationMessageCompressionRole(message, agentNamesById)}:`,
          message.content.trim(),
        ].join("\n")
      );
  
    return [
      "Summarize the older AgentHub conversation history below for future context.",
      "Preserve user goals, decisions, constraints, open questions, task/artifact references, and agent responsibilities.",
      "Write a concise Markdown memory entry. Do not produce a visible chat reply.",
      "",
      "<older_conversation_history>",
      history.join("\n\n"),
      "</older_conversation_history>",
    ].join("\n");
  }
  
  function applyContextCompressionToJob(
    job: RunQueueJob,
    input: {
      agentNamesById: Record<string, string>;
      currentUserMessage: string;
      messages: ConversationMessage[];
    },
  ): RunQueueJob {
    const recentMessageCount = 20;
  
    if (input.messages.length <= recentMessageCount) {
      return job;
    }
  
    const olderMessages = input.messages.slice(0, -recentMessageCount);
    const recentMessages = input.messages.slice(-recentMessageCount);
    const compressibleText = buildCompressibleConversationText(
      olderMessages,
      input.agentNamesById,
    );
  
    if (compressibleText.length < env.AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD) {
      return job;
    }
  
    const fullConversationPrompt = buildConversationRunPrompt({
      agentNamesById: input.agentNamesById,
      currentUserMessage: input.currentUserMessage,
      messages: input.messages,
    });
    const recentConversationPrompt = buildConversationRunPrompt({
      agentNamesById: input.agentNamesById,
      currentUserMessage: input.currentUserMessage,
      messages: recentMessages,
    });
    const compactedConversationPrompt = [
      "<compressed_older_context>",
      "{{compressed_context}}",
      "</compressed_older_context>",
      "",
      recentConversationPrompt,
    ].join("\n");
    const promptTemplate = job.prompt.includes(fullConversationPrompt)
      ? job.prompt.replace(fullConversationPrompt, compactedConversationPrompt)
      : [job.prompt, "", compactedConversationPrompt].join("\n");
  
    return {
      ...job,
      prompt: promptTemplate.replace("{{compressed_context}}", "(pending context compression)"),
      contextCompression: {
        compressibleText,
        promptTemplate,
        thresholdChars: env.AGENTHUB_CONTEXT_COMPACT_CHAR_THRESHOLD,
      },
    };
  }
  
  function resolveProjectFilePath(baseRepoPath: string, requestedPath?: string): string {
    const relativePath = (requestedPath ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    const resolved = path.resolve(baseRepoPath, relativePath);
    const root = path.resolve(baseRepoPath);
  
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Path is outside the project repository.");
    }
  
    return resolved;
  }
  
  async function listProjectFileTree(input: {
    baseRepoPath: string;
    relativePath?: string;
    depth?: number;
  }): Promise<Array<{ path: string; sizeBytes?: number; type: "directory" | "file" }>> {
    const depth = input.depth ?? 0;
  
    if (depth > 5) {
      return [];
    }
  
    const directory = resolveProjectFilePath(input.baseRepoPath, input.relativePath);
    const entries = await readdir(directory, { withFileTypes: true });
    const rows: Array<{ path: string; sizeBytes?: number; type: "directory" | "file" }> = [];
  
    for (const entry of entries) {
      if (entry.name === ".git") {
        continue;
      }
  
      const relativePath = [input.relativePath, entry.name]
        .filter((segment): segment is string => segment !== undefined && segment.length > 0)
        .join("/");
      const fullPath = resolveProjectFilePath(input.baseRepoPath, relativePath);
  
      if (entry.isDirectory()) {
        rows.push({ path: relativePath, type: "directory" });
        rows.push(...await listProjectFileTree({
          baseRepoPath: input.baseRepoPath,
          relativePath,
          depth: depth + 1,
        }));
      } else if (entry.isFile()) {
        const fileStat = await stat(fullPath);
        rows.push({ path: relativePath, sizeBytes: fileStat.size, type: "file" });
      }
    }
  
    return rows;
  }
  
  async function git(
    args: string[],
    options: { cwd?: string; maxBuffer?: number } = {},
  ): Promise<string> {
    const result = await execFileAsync("git", args, {
      cwd: options.cwd,
      maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024,
    });
  
    return result.stdout.trim();
  }
  
  type ProjectChangedFileStatus = "added" | "modified" | "deleted" | "renamed" | "binary";
  
  interface ProjectChangedFile {
    binary: boolean;
    oldPath?: string;
    path: string;
    status: ProjectChangedFileStatus;
  }
  
  function toProjectChangedFileStatus(statusCode: string): ProjectChangedFileStatus {
    if (statusCode.startsWith("A")) {
      return "added";
    }
  
    if (statusCode.startsWith("D")) {
      return "deleted";
    }
  
    if (statusCode.startsWith("R")) {
      return "renamed";
    }
  
    return "modified";
  }
  
  async function listProjectChangedFiles(input: {
    baseCommit?: string;
    headCommit?: string;
    worktreePath: string;
  }): Promise<ProjectChangedFile[]> {
    if (input.headCommit === undefined) {
      return [];
    }
  
    const output = input.baseCommit === undefined
      ? await git(["diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-M", input.headCommit], {
          cwd: input.worktreePath,
          maxBuffer: 20 * 1024 * 1024,
        })
      : await git(["diff", "--name-status", "-M", input.baseCommit, input.headCommit], {
          cwd: input.worktreePath,
          maxBuffer: 20 * 1024 * 1024,
        });
  
    if (output.length === 0) {
      return [];
    }
  
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const [statusCode, firstPath, secondPath] = line.split("\t");
        const status = toProjectChangedFileStatus(statusCode);
        const pathValue = status === "renamed" ? secondPath : firstPath;
        const oldPath = status === "renamed" ? firstPath : undefined;
        const fileInfo = inferArtifactFileInfo({ filename: pathValue ?? firstPath ?? "" });
  
        return {
          binary: !fileInfo.canEdit,
          oldPath,
          path: pathValue ?? firstPath ?? "",
          status: !fileInfo.canEdit ? "binary" : status,
        };
      })
      .filter((file) => file.path.length > 0);
  }
  
  async function readProjectFileAtCommit(input: {
    commit?: string;
    filePath?: string;
    worktreePath: string;
  }): Promise<string> {
    if (input.commit === undefined || input.filePath === undefined) {
      return "";
    }
  
    return git(["show", `${input.commit}:${input.filePath}`], {
      cwd: input.worktreePath,
      maxBuffer: 20 * 1024 * 1024,
    }).catch(() => "");
  }
  
  async function commitProjectBaseFile(input: {
    baseRepoPath: string;
    relativePath: string;
  }): Promise<string | undefined> {
    await git(["add", "--", input.relativePath], { cwd: input.baseRepoPath });
  
    const status = await git(["status", "--porcelain", "--", input.relativePath], {
      cwd: input.baseRepoPath,
    });
  
    if (status.length > 0) {
      await git(
        [
          "-c",
          "user.name=AgentHub",
          "-c",
          "user.email=agenthub@example.local",
          "commit",
          "-m",
          `User edit ${input.relativePath}`,
        ],
        {
          cwd: input.baseRepoPath,
          maxBuffer: 20 * 1024 * 1024,
        },
      );
    }
  
    return git(["rev-parse", "HEAD"], {
      cwd: input.baseRepoPath,
    }).catch(() => undefined);
  }
  
  async function listAgentDailyMemoryFiles(input: {
    fallbackDate: string;
    workspacePath: string;
  }): Promise<string[]> {
    const memoryDirectory = path.join(input.workspacePath, "memory");
  
    try {
      const files = await readdir(memoryDirectory);
      const dailyFiles = files
        .filter((file) => /^\d{4}-\d{2}-\d{2}\.md$/.test(file))
        .sort()
        .reverse();
  
      return dailyFiles.length === 0 ? [`${input.fallbackDate}.md`] : dailyFiles;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [`${input.fallbackDate}.md`];
      }
  
      throw error;
    }
  }
  
  async function prepareApiRunJobDispatch(
    job: RunQueueJob,
    input: {
      conversationId?: string;
      ownerUserId: string;
    },
  ): Promise<{ job: RunQueueJob; realtimeEvents: RealtimeEvent[] }> {
    const preparation = await prepareRunDispatch(db, {
      agentId: job.run.agentId,
      conversationId: input.conversationId ?? job.conversationId,
      createdAt: new Date(job.run.createdAt),
      daemonDeviceId: job.daemonDeviceId,
      newRunId: job.run.id,
      ownerUserId: input.ownerUserId,
    });
  
    return {
      job: await prepareProjectRunJobForConversation(db, {
        conversationId: input.conversationId ?? job.conversationId ?? "",
        job: applyRunDispatchPreparation(job, preparation),
      }),
      realtimeEvents: preparation.realtimeEvents,
    };
  }
  
  async function prepareApiRunJobsDispatch(
    jobs: RunQueueJob[],
    input: {
      conversationId?: string;
      ownerUserId: string;
    },
  ): Promise<{ jobs: RunQueueJob[]; realtimeEvents: RealtimeEvent[] }> {
    const preparedJobs: RunQueueJob[] = [];
    const realtimeEvents: RealtimeEvent[] = [];
  
    for (const job of jobs) {
      const prepared = await prepareApiRunJobDispatch(job, input);
      preparedJobs.push(prepared.job);
      realtimeEvents.push(...prepared.realtimeEvents);
    }
  
    return { jobs: preparedJobs, realtimeEvents };
  }
  
  async function buildAgentGroupsPromptForAgent(input: {
    agentId: string;
    currentConversationId?: string;
    ownerUserId: string;
  }): Promise<string> {
    return buildAgentGroupsPrompt(
      await listActiveAgentGroupContexts(db, {
        agentId: input.agentId,
        ownerUserId: input.ownerUserId,
      }),
      { currentConversationId: input.currentConversationId },
    );
  }
  
  function buildGroupChatAgentInstructions(input: {
    agentIdentityInstructions: string;
    conversationTitle: string;
    isOrchestrator?: boolean;
    projectProtocolPrompt?: string;
  }): string {
    return [
      input.agentIdentityInstructions,
      input.projectProtocolPrompt,
      `You are participating in the AgentHub group chat #${input.conversationTitle}.`,
      input.isOrchestrator === true
        ? "You are the configured Orchestrator for this group, even in Chat mode."
        : undefined,
      "Visible group replies must be sent with the AgentHub MCP tool send_message.",
      "For ordinary replies or progress updates, do not include @AgentName or @all. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
      "Do not answer a group chat by writing normal assistant text.",
    ].filter((line): line is string => line !== undefined && line.trim().length > 0)
      .join("\n\n");
  }
  
  function buildGroupChatRunPrompt(input: {
    agentGroupsPrompt?: string;
    agentNamesById?: Record<string, string>;
    agentName: string;
    conversationTitle: string;
    currentUserMessage: string;
    directMessagesPrompt?: string;
    isOrchestrator?: boolean;
    messages: Awaited<ReturnType<typeof listConversationMessagesForUser>>;
    projectProtocolPrompt?: string;
  }): string {
    const recentMessages = (input.messages ?? []).slice(-10);
    const conversationPrompt = buildConversationRunPrompt({
      agentNamesById: input.agentNamesById,
      currentUserMessage: input.currentUserMessage,
      messages: recentMessages,
    });
  
    return [
      "<agenthub_group_chat_protocol>",
      `You are ${input.agentName} in #${input.conversationTitle}.`,
      input.isOrchestrator === true
        ? "You are the configured Orchestrator for this group, even in Chat mode."
        : undefined,
      input.isOrchestrator === true
        ? "You may coordinate other agents by sending visible messages with @AgentName or @all, but only reply when useful."
        : undefined,
      "Decide whether you should reply to the user's latest message.",
      "If you should reply, call the MCP tool send_message with { content: string }.",
      "For ordinary replies, do not include @AgentName or @all. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
      "If the user explicitly asks you to reply, you should normally call send_message.",
      "If you should not reply, do not call send_message.",
      "Never use normal assistant text as the visible group reply. Normal assistant text is ignored by AgentHub group chat.",
      "Only the 10 most recent group messages are included below. Use list_group_messages or search_group_messages when you need older group context.",
      "</agenthub_group_chat_protocol>",
      "",
      input.projectProtocolPrompt,
      input.projectProtocolPrompt === undefined ? undefined : "",
      input.agentGroupsPrompt,
      input.agentGroupsPrompt === undefined ? undefined : "",
      input.directMessagesPrompt,
      input.directMessagesPrompt === undefined ? undefined : "",
      conversationPrompt,
    ].filter((line): line is string => line !== undefined).join("\n");
  }
  
  function buildGroupTaskOrchestratorInstructions(input: {
    agentIdentityInstructions: string;
    conversationTitle: string;
    projectProtocolPrompt?: string;
  }): string {
    return [
      input.agentIdentityInstructions,
      input.projectProtocolPrompt,
      `You are the configured Orchestrator for AgentHub group #${input.conversationTitle}.`,
      "In Task mode, first create a goal for the user's objective with create_goal.",
      "Then create agent tasks under that goal with create_task({ goalId, title, description, assigneeAgentId, dependsOnTaskIndexes? }).",
      ...orchestratorParallelSerialTaskInstructions,
      "Within one Goal, tasks for the same assignee agent must be serial. Do not create multiple independent no-dependency tasks for the same assignee.",
      "If the same assignee needs multiple tasks, create an explicit chain: each later task must set dependsOnTaskIndexes to the previous task index for that assignee.",
      "If you are unsure whether same-assignee work can safely run in parallel, default to serial dependencies.",
      "Tasks without dependencies are dispatched immediately by create_task: AgentHub creates the visible assignment message and starts the assignee run automatically.",
      "After create_task, do not send an additional @AgentName message to the assignee. @AgentName and @all force ordinary chat runs and can duplicate the task.",
      "Tasks with dependencies wait until upstream tasks succeed.",
      "When a checkpoint run starts after a task completes, review the goal, then use approve_task to launch ready downstream tasks, create_task for follow-up or recovery tasks, cancel_task for obsolete tasks, and complete_goal only when the goal is done.",
      "approve_task also creates the visible assignment message and starts the assignee run automatically; do not follow it with a send_message that mentions the assignee.",
      "Use list_goals, list_artifacts, and read_artifact to inspect goal state and group workspace artifacts.",
      "Use send_message only for progress updates, decisions, or final user-facing notes.",
      "Do not assign a task to yourself unless you are intentionally doing part of the work.",
    ].filter((line): line is string => line !== undefined && line.trim().length > 0)
      .join("\n\n");
  }
  
  function buildGroupTaskOrchestratorPrompt(input: {
    agentGroupsPrompt?: string;
    agentNamesById?: Record<string, string>;
    agentName: string;
    agents: RunnableAgent[];
    conversationTitle: string;
    currentUserMessage: string;
    messages: Awaited<ReturnType<typeof listConversationMessagesForUser>>;
    orchestratorAgentId?: string;
    projectProtocolPrompt?: string;
  }): string {
    const recentMessages = (input.messages ?? []).slice(-10);
    const conversationPrompt = buildConversationRunPrompt({
      agentNamesById: input.agentNamesById,
      currentUserMessage: input.currentUserMessage,
      messages: recentMessages,
    });
    const roster = input.agents.map((agent) => {
      const description = agent.agent.description?.trim();
      const role = agent.agent.id === input.orchestratorAgentId
        ? " [Orchestrator]"
        : "";
  
      return `- @${agent.agent.name}${role}: ${agent.agent.id}; ${
        description === undefined || description.length === 0
          ? "No description provided."
          : description
      }`;
    });
  
    return [
      "<agenthub_group_task_protocol>",
      `You are ${input.agentName}, the Orchestrator in #${input.conversationTitle}.`,
      "Available group agents:",
      ...roster,
      "",
      "Create tasks only for agents listed above.",
      "Start by calling create_goal({ title, description }) for the user's objective.",
      "Then call create_task({ goalId, title, description, assigneeAgentId, dependsOnTaskIndexes? }) for each agent task. Tasks without dependencies start immediately because AgentHub automatically creates the visible assignment message and assignee run.",
      ...orchestratorParallelSerialTaskInstructions,
      "Same-assignee tasks within one Goal must be serial. Never create multiple parallel no-dependency tasks for the same agent.",
      "For multiple tasks assigned to the same agent, use dependsOnTaskIndexes to point each later task to that agent's previous task index.",
      "When in doubt, make same-assignee tasks serial rather than parallel.",
      "Do not call send_message with @AgentName or @all after create_task. That is not needed for task dispatch and can start duplicate ordinary chat runs.",
      "Dependent tasks wait until their dependencies succeed.",
      "Ready downstream tasks do not start automatically. In checkpoint runs, call approve_task({ goalId, taskIndex }) after you review and decide to continue.",
      "approve_task also automatically creates the visible assignment message and assignee run; do not send an extra @AgentName message afterward.",
      "Use list_artifacts/read_artifact when later tasks need reports or files uploaded by earlier tasks.",
      "Only the 10 most recent group messages are included below. Use list_group_messages or search_group_messages when you need older group context.",
      "Do not use send_message to dispatch tasks. Use send_message only for progress updates, decisions, or final notes, and omit @AgentName/@all unless you intentionally want a separate ordinary chat reply run.",
      "Call complete_goal only after there are no waiting, ready, assigned, or running tasks.",
      "Normal assistant text is not visible in group task mode.",
      "</agenthub_group_task_protocol>",
      "",
      input.projectProtocolPrompt,
      input.projectProtocolPrompt === undefined ? undefined : "",
      input.agentGroupsPrompt,
      input.agentGroupsPrompt === undefined ? undefined : "",
      conversationPrompt,
    ].filter((line): line is string => line !== undefined).join("\n");
  }
  
  
  async function deploymentResponse(input: {
    deploymentId: string;
    ownerUserId: string;
    requestedPath?: string;
  }) {
    const record = await getConversationDeploymentFileForUser(db, {
      deploymentId: input.deploymentId,
      ownerUserId: input.ownerUserId,
      publicApiBaseUrl: env.AGENTHUB_PUBLIC_API_URL,
      requestedPath: input.requestedPath,
      storageRoot: env.AGENTHUB_STORAGE_ROOT,
    }).catch((error: unknown) => {
      if (isMissingFileError(error)) {
        return null;
      }
  
      throw error;
    });
  
    if (record === null) {
      return previewUnavailableResponse({
        message: "Deployment file was not found.",
        status: 404,
      });
    }
  
    const fileInfo = inferArtifactFileInfo({
      filename: record.filename,
    });
    const body = record.content;
    const arrayBuffer = body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
  
    return new Response(arrayBuffer, {
      headers: {
        "cache-control": "no-store",
        "content-type": fileInfo.mimeType,
      },
      status: 200,
    });
  }
  
  function getDeploymentRequestedPath(input: {
    deploymentId: string;
    requestUrl: string;
  }): string | undefined {
    const pathname = new URL(input.requestUrl).pathname;
    const prefix = `/deployments/${input.deploymentId}/`;
  
    if (!pathname.startsWith(prefix)) {
      return undefined;
    }
  
    const requestedPath = pathname.slice(prefix.length);
    return requestedPath.length === 0
      ? undefined
      : decodeURIComponent(requestedPath);
  }
  
  

  return {
    parseDaemonCommandPlatform,
    normalizeDaemonDeviceName,
    daemonDeviceCommandResponse,
    isMissingFileError,
    deliverRealtimeEvent,
    publishRealtimeEvents,
    queuedRunEventForJob,
    realtimeEventsForCreatedRuns,
    isRuntimeKind,
    isValidAgentIdList,
    isUploadedFile,
    getFormString,
    userMessageForPrompt,
    writeUserMessageAttachments,
    validateUploadFiles,
    parseOptionalAgentId,
    parseRecordStatusFilter,
    parseSearchSort,
    parseSearchTimeFilter,
    parseSenderType,
    todayUtcDate,
    readAgentMemoryFile,
    previewUnavailableResponse,
    groupChatMcpToolsForAgent,
    toMcpGoalList,
    applyContextCompressionToJob,
    listProjectFileTree,
    listProjectChangedFiles,
    readProjectFileAtCommit,
    commitProjectBaseFile,
    listAgentDailyMemoryFiles,
    prepareApiRunJobDispatch,
    prepareApiRunJobsDispatch,
    buildAgentGroupsPromptForAgent,
    buildGroupChatAgentInstructions,
    buildGroupChatRunPrompt,
    buildGroupTaskOrchestratorInstructions,
    buildGroupTaskOrchestratorPrompt,
    deploymentResponse,
    getDeploymentRequestedPath,
    buildDaemonSourceCommand,
    buildDaemonCommand,
    buildDaemonNpxCommand,
    daemonDeviceIdPattern,
    memoryDatePattern,
    projectChangeStatuses,
    resolveProjectFilePath,
    sseClientsByUserId,
    sseFrame,
    unregisterSseClient,
    uuidPattern,
  };
}

export type ApiServices = ReturnType<typeof createApiServices>;
