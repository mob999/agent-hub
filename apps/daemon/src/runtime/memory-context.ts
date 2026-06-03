import type { RunEvent, RuntimeKind } from "@agent-hub/core/protocol";
import type { DaemonRunAssignment } from "@agent-hub/core/protocol";

import {
  appendMemory,
  buildMemoryPrompt,
  hasDailyMemoryDedupeKey,
  readTranscriptForDailyMemoryRefresh,
} from "../memory";
import { createRuntimeEvent, nowIsoDateTime } from "./common";

export interface HiddenPromptInput {
  agentInstructions?: string;
  prompt: string;
  workspacePath: string;
}

export type HiddenPromptRunner = (input: HiddenPromptInput) => Promise<string>;

export interface RuntimeMemoryOptions {
  dailyMemoryRefreshIntervalMs: number;
  dailyMemoryRefreshTranscriptMaxBytes: number;
}

export interface RuntimeEventSink {
  push(event: RunEvent): void;
}

function periodicDailyMemoryDedupeKey(input: {
  date: string;
  intervalMs: number;
  now: Date;
}): string {
  const bucket = Math.floor(input.now.getTime() / input.intervalMs);

  return `periodic-daily-memory:${input.date}:${bucket}`;
}

async function maybeRefreshDailyMemory(input: {
  agentInstructions?: string;
  hiddenPrompt: HiddenPromptRunner;
  intervalMs: number;
  maxTranscriptBytes: number;
  workspacePath: string;
}): Promise<
  | {
      refreshed: false;
    }
  | {
      refreshed: true;
      date: string;
      summary: string;
      sourceChars: number;
      transcriptFile: string;
      truncated: boolean;
    }
> {
  if (input.intervalMs <= 0) {
    return { refreshed: false };
  }

  const now = new Date();
  const transcript = await readTranscriptForDailyMemoryRefresh({
    workspacePath: input.workspacePath,
    maxBytes: input.maxTranscriptBytes,
  });

  if (transcript.content.length === 0) {
    return { refreshed: false };
  }

  const dedupeKey = periodicDailyMemoryDedupeKey({
    date: transcript.date,
    intervalMs: input.intervalMs,
    now,
  });

  if (
    await hasDailyMemoryDedupeKey(input.workspacePath, {
      date: transcript.date,
      dedupeKey,
    })
  ) {
    return { refreshed: false };
  }

  const summary = await input.hiddenPrompt({
    agentInstructions: [
      input.agentInstructions,
      [
        "You are updating this AgentHub agent's daily memory from its local transcript.",
        "Return concise Markdown notes for durable context from today.",
        "Preserve user goals, decisions, side effects, task/artifact/deployment references, open questions, and follow-ups.",
        "Ignore routine chatter and do not produce a visible chat reply.",
        "Keep the memory entry under 6000 characters.",
      ].join("\n"),
    ].filter((line): line is string => line !== undefined).join("\n\n"),
    prompt: [
      `<transcript file="${transcript.file}" date="${transcript.date}" truncated="${transcript.truncated ? "true" : "false"}">`,
      transcript.content,
      "</transcript>",
    ].join("\n"),
    workspacePath: input.workspacePath,
  });

  if (summary.trim().length === 0) {
    return { refreshed: false };
  }

  await appendMemory({
    workspacePath: input.workspacePath,
    kind: "daily",
    title: "Periodic daily memory update",
    content: summary,
    tags: ["daily-memory", "periodic-summary"],
    dedupeKey,
  });

  return {
    refreshed: true,
    date: transcript.date,
    summary,
    sourceChars: transcript.content.length,
    transcriptFile: transcript.file,
    truncated: transcript.truncated,
  };
}

export async function buildPromptWithRuntimeMemory(input: {
  agentInstructions?: string;
  basePrompt: string;
  contextCompression?: DaemonRunAssignment["contextCompression"];
  eventSink: RuntimeEventSink;
  hiddenPrompt: HiddenPromptRunner;
  memoryOptions: RuntimeMemoryOptions;
  runId: string;
  runtimeKind: RuntimeKind;
  workspacePath: string;
}): Promise<string> {
  let runPrompt = input.basePrompt;
  let contextCompacted = false;

  if (
    input.contextCompression !== undefined &&
    input.contextCompression.compressibleText.length >=
      input.contextCompression.thresholdChars
  ) {
    const compressedContext = await input.hiddenPrompt({
      agentInstructions: [
        input.agentInstructions,
        "You are compacting older AgentHub conversation context. Return a concise factual Markdown summary. Do not include visible chat replies.",
      ].filter((line): line is string => line !== undefined).join("\n\n"),
      prompt: input.contextCompression.compressibleText,
      workspacePath: input.workspacePath,
    });

    await appendMemory({
      workspacePath: input.workspacePath,
      kind: "daily",
      title: "Context compression",
      content: compressedContext,
      tags: ["context-compression"],
      dedupeKey: `context-compression:${input.runId}`,
    });
    contextCompacted = true;
    input.eventSink.push(createRuntimeEvent(input.runId, {
      runtimeKind: input.runtimeKind,
      nativeType: "memory.compacted",
      payload: {
        compressedChars: compressedContext.length,
        sourceChars: input.contextCompression.compressibleText.length,
      },
    }));
    runPrompt = input.contextCompression.promptTemplate.replace(
      "{{compressed_context}}",
      compressedContext,
    );
  }

  if (!contextCompacted) {
    const periodicRefresh = await maybeRefreshDailyMemory({
      agentInstructions: input.agentInstructions,
      hiddenPrompt: input.hiddenPrompt,
      intervalMs: input.memoryOptions.dailyMemoryRefreshIntervalMs,
      maxTranscriptBytes: input.memoryOptions.dailyMemoryRefreshTranscriptMaxBytes,
      workspacePath: input.workspacePath,
    });

    if (periodicRefresh.refreshed) {
      input.eventSink.push(createRuntimeEvent(input.runId, {
        runtimeKind: input.runtimeKind,
        nativeType: "memory.periodic_refreshed",
        payload: {
          date: periodicRefresh.date,
          summaryChars: periodicRefresh.summary.length,
          sourceChars: periodicRefresh.sourceChars,
          transcriptFile: periodicRefresh.transcriptFile,
          truncated: periodicRefresh.truncated,
        },
      }, nowIsoDateTime()));
    }
  }

  const memoryPrompt = await buildMemoryPrompt({
    workspacePath: input.workspacePath,
  });

  return [memoryPrompt, runPrompt].join("\n\n");
}
