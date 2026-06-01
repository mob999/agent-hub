import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

import type {
  AgentHubAppendMemoryToolInput,
  AgentHubAppendMemoryToolResult,
  AgentHubMemoryScope,
  AgentHubReadMemoryToolInput,
  AgentHubReadMemoryToolResult,
  AgentHubSearchMemoryToolInput,
  AgentHubSearchMemoryToolResult,
} from "@agent-hub/core";

import { getAgentWorkspaceLayoutPaths, resolveWorkspacePath } from "../workspace";

const memoryHeader = "# AgentHub Long-Term Memory\n\n";
const dailyHeader = (date: string) =>
  [
    `# AgentHub Daily Memory - ${date}`,
    "",
    `[Full conversation transcript](./transcripts/${date}.md)`,
    "",
  ].join("\n");
const transcriptHeader = (date: string) =>
  [`# AgentHub Conversation Transcript - ${date}`, ""].join("\n");
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const maxMemoryEntryBytes = 8 * 1024;
const maxMemoryTitleLength = 120;
const maxMemoryTags = 12;

export interface MemoryAppendInput {
  content: string;
  date?: string;
  dedupeKey?: string;
  kind: "daily" | "transcript";
  tags?: string[];
  title?: string;
  workspacePath: string;
}

export interface MemoryAppendResult {
  entryId: string;
  file: string;
}

export interface MemoryPromptInput {
  longTermMaxBytes?: number;
  dailyMaxBytes?: number;
  workspacePath: string;
  now?: Date;
}

function todayUtc(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function assertDate(value: string): void {
  if (!datePattern.test(value)) {
    throw new Error(`Invalid memory date: ${value}`);
  }
}

function truncateBytes(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const buffer = Buffer.from(value, "utf8");

  if (buffer.byteLength <= maxBytes) {
    return { text: value, truncated: false };
  }

  return {
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}

function sanitizeTitle(value: string | undefined): string | undefined {
  const title = value?.trim();

  return title === undefined || title.length === 0
    ? undefined
    : title.slice(0, maxMemoryTitleLength);
}

function sanitizeTags(values: string[] | undefined): string[] {
  return (values ?? [])
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
    .slice(0, maxMemoryTags);
}

function validateContent(content: string): string {
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    throw new Error("memory content is required.");
  }

  if (Buffer.byteLength(trimmed, "utf8") > maxMemoryEntryBytes) {
    throw new Error("memory content is too large.");
  }

  return trimmed;
}

async function readOptionalFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "";
    }

    throw error;
  }
}

async function ensureFile(filePath: string, initialContent: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const existing = await readOptionalFile(filePath);

  if (existing.length === 0) {
    await writeFile(filePath, initialContent, "utf8");
  }
}

function relativeMemoryPath(workspacePath: string, filePath: string): string {
  return path.relative(workspacePath, filePath).split(path.sep).join("/");
}

function memoryFileForScope(
  workspacePath: string,
  scope: AgentHubMemoryScope,
  date?: string,
): string {
  const paths = getAgentWorkspaceLayoutPaths(workspacePath);

  if (scope === "long_term") {
    return resolveWorkspacePath(workspacePath, "MEMORY.md");
  }

  const targetDate = date ?? todayUtc();
  assertDate(targetDate);

  if (scope === "daily") {
    return path.join(paths.memory, `${targetDate}.md`);
  }

  return path.join(paths.memory, "transcripts", `${targetDate}.md`);
}

async function ensureMemoryFiles(workspacePath: string, date = todayUtc()): Promise<void> {
  assertDate(date);
  await ensureFile(memoryFileForScope(workspacePath, "long_term"), memoryHeader);
  await ensureFile(memoryFileForScope(workspacePath, "daily", date), dailyHeader(date));
  await ensureFile(memoryFileForScope(workspacePath, "transcript", date), transcriptHeader(date));
}

function formatMemoryEntry(input: {
  content: string;
  dedupeKey?: string;
  entryId: string;
  tags?: string[];
  title?: string;
  timestamp: string;
}): string {
  const tags = sanitizeTags(input.tags);
  const metadata = [
    `id: ${input.entryId}`,
    `createdAt: ${input.timestamp}`,
    input.dedupeKey === undefined ? undefined : `dedupeKey: ${input.dedupeKey}`,
    tags.length === 0 ? undefined : `tags: ${tags.join(", ")}`,
  ].filter((line): line is string => line !== undefined);

  return [
    `<!-- agenthub-memory-entry:${input.entryId} -->`,
    `## ${sanitizeTitle(input.title) ?? "Memory entry"}`,
    "",
    ...metadata,
    "",
    input.content,
    "",
  ].join("\n");
}

function formatTranscriptEntry(input: {
  content: string;
  dedupeKey?: string;
  entryId: string;
  timestamp: string;
  title?: string;
}): string {
  return [
    `<!-- agenthub-transcript-entry:${input.entryId} -->`,
    `## ${sanitizeTitle(input.title) ?? input.timestamp}`,
    "",
    `id: ${input.entryId}`,
    `createdAt: ${input.timestamp}`,
    input.dedupeKey === undefined ? undefined : `dedupeKey: ${input.dedupeKey}`,
    "",
    input.content,
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
}

export async function initializeAgentMemory(workspacePath: string, now = new Date()): Promise<void> {
  await ensureMemoryFiles(workspacePath, todayUtc(now));
}

export async function appendMemory(input: MemoryAppendInput): Promise<MemoryAppendResult> {
  const date = input.date ?? todayUtc();
  assertDate(date);
  await ensureMemoryFiles(input.workspacePath, date);

  const scope: AgentHubMemoryScope = input.kind === "daily" ? "daily" : "transcript";
  const filePath = memoryFileForScope(input.workspacePath, scope, date);
  const existing = await readOptionalFile(filePath);

  if (
    input.dedupeKey !== undefined &&
    existing.includes(`dedupeKey: ${input.dedupeKey}`)
  ) {
    return {
      entryId: input.dedupeKey,
      file: relativeMemoryPath(input.workspacePath, filePath),
    };
  }

  const entryId = randomUUID();
  const content = validateContent(input.content);
  const timestamp = new Date().toISOString();
  const entry = input.kind === "daily"
    ? formatMemoryEntry({
        content,
        dedupeKey: input.dedupeKey,
        entryId,
        tags: input.tags,
        timestamp,
        title: input.title,
      })
    : formatTranscriptEntry({
        content,
        dedupeKey: input.dedupeKey,
        entryId,
        timestamp,
        title: input.title,
      });

  await appendFile(filePath, entry, "utf8");

  return {
    entryId,
    file: relativeMemoryPath(input.workspacePath, filePath),
  };
}

export async function appendMemoryTool(
  workspacePath: string,
  input: AgentHubAppendMemoryToolInput,
): Promise<AgentHubAppendMemoryToolResult> {
  const scope = input.scope ?? "long_term";

  if (scope === "daily") {
    const result = await appendMemory({
      workspacePath,
      kind: "daily",
      title: input.title,
      content: input.content,
      tags: input.tags,
    });

    return { accepted: true, ...result };
  }

  const filePath = memoryFileForScope(workspacePath, "long_term");
  await ensureMemoryFiles(workspacePath);

  const entryId = randomUUID();
  const entry = formatMemoryEntry({
    content: validateContent(input.content),
    entryId,
    tags: input.tags,
    timestamp: new Date().toISOString(),
    title: input.title,
  });
  await appendFile(filePath, entry, "utf8");

  return {
    accepted: true,
    entryId,
    file: relativeMemoryPath(workspacePath, filePath),
  };
}

export async function readMemoryTool(
  workspacePath: string,
  input: AgentHubReadMemoryToolInput,
): Promise<AgentHubReadMemoryToolResult> {
  const filePath = memoryFileForScope(workspacePath, input.scope, input.date);
  await ensureMemoryFiles(workspacePath, input.date ?? todayUtc());
  const content = await readOptionalFile(filePath);
  const clipped = truncateBytes(content, input.maxBytes ?? 32 * 1024);

  return {
    accepted: true,
    content: clipped.text,
    file: relativeMemoryPath(workspacePath, filePath),
    truncated: clipped.truncated,
  };
}

function scoreLine(line: string, terms: string[]): number {
  const lower = line.toLowerCase();
  return terms.reduce(
    (score, term) => score + (lower.includes(term) ? 1 : 0),
    0,
  );
}

export async function searchMemoryTool(
  workspacePath: string,
  input: AgentHubSearchMemoryToolInput,
): Promise<AgentHubSearchMemoryToolResult> {
  const query = input.query.trim().toLowerCase();

  if (query.length === 0) {
    throw new Error("search_memory.query is required.");
  }

  const terms = query.split(/\s+/).filter((term) => term.length > 0);
  const scopes = input.scopes ?? ["long_term", "daily", "transcript"];
  const dates = new Set(
    [input.fromDate, input.toDate, todayUtc()]
      .filter((value): value is string => value !== undefined),
  );
  const files: Array<{ scope: AgentHubMemoryScope; filePath: string }> = [];

  for (const scope of scopes) {
    if (scope === "long_term") {
      files.push({ scope, filePath: memoryFileForScope(workspacePath, scope) });
      continue;
    }

    for (const date of dates) {
      assertDate(date);
      files.push({ scope, filePath: memoryFileForScope(workspacePath, scope, date) });
    }
  }
  const results = [];

  for (const file of files) {
    const content = await readOptionalFile(file.filePath);
    const lines = content.split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const score = scoreLine(line, terms);

      if (score > 0) {
        results.push({
          file: relativeMemoryPath(workspacePath, file.filePath),
          line: index + 1,
          score,
          scope: file.scope,
          snippet: line.slice(0, 240),
        });
      }
    }
  }

  return {
    accepted: true,
    results: results
      .sort((first, second) => second.score - first.score)
      .slice(0, input.limit ?? 10),
  };
}

export async function buildMemoryPrompt(input: MemoryPromptInput): Promise<string> {
  const date = todayUtc(input.now);
  await ensureMemoryFiles(input.workspacePath, date);

  const longTerm = await readMemoryTool(input.workspacePath, {
    scope: "long_term",
    maxBytes: input.longTermMaxBytes ?? 16 * 1024,
  });
  const daily = await readMemoryTool(input.workspacePath, {
    scope: "daily",
    date,
    maxBytes: input.dailyMaxBytes ?? 12 * 1024,
  });

  return [
    "<agenthub_memory>",
    `Today: ${date}`,
    `Full transcript: ./memory/transcripts/${date}.md`,
    "Use read_memory({ scope: \"transcript\", date }) when you need the full conversation transcript.",
    "",
    "Long-term memory:",
    longTerm.content.trim() || "(empty)",
    longTerm.truncated ? "\n[Long-term memory truncated]" : undefined,
    "",
    "Daily memory:",
    daily.content.trim() || "(empty)",
    daily.truncated ? "\n[Daily memory truncated]" : undefined,
    "</agenthub_memory>",
  ].filter((line): line is string => line !== undefined).join("\n");
}
