import { spawn as spawnChildProcess } from "node:child_process";
import type { ChildProcessByStdio, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import type {
  AgentAdapter,
  AgentRunInput,
} from "@agent-hub/core/runtime";
import type {
  AgentRuntimeConfig,
  DaemonRuntime,
  RunEvent,
  RunId,
} from "@agent-hub/core/protocol";

import { LineDecoder, parseJsonLine } from "./jsonl";

type SpawnedProcess = Pick<
  ChildProcessByStdio<Writable, Readable, Readable>,
  "kill" | "once" | "stderr" | "stdin" | "stdout"
>;

export type SpawnCodexProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => SpawnedProcess;

export interface CodexAdapterOptions {
  executablePath?: string;
  spawnProcess?: SpawnCodexProcess;
}

interface AsyncQueueItem<T> {
  done: boolean;
  value?: T;
}

class AsyncEventQueue<T> implements AsyncIterable<T> {
  #ended = false;
  #items: T[] = [];
  #resolvers: Array<(item: AsyncQueueItem<T>) => void> = [];

  push(item: T): void {
    if (this.#ended) {
      return;
    }

    const resolve = this.#resolvers.shift();

    if (resolve === undefined) {
      this.#items.push(item);
      return;
    }

    resolve({ done: false, value: item });
  }

  end(): void {
    if (this.#ended) {
      return;
    }

    this.#ended = true;

    for (const resolve of this.#resolvers.splice(0)) {
      resolve({ done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.#items.length > 0) {
        yield this.#items.shift() as T;
        continue;
      }

      if (this.#ended) {
        return;
      }

      const item = await new Promise<AsyncQueueItem<T>>((resolve) => {
        this.#resolvers.push(resolve);
      });

      if (item.done) {
        return;
      }

      yield item.value as T;
    }
  }
}

function nowIsoDateTime(): string {
  return new Date().toISOString();
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readStringProperty(
  value: Record<string, unknown>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const property = value[name];

    if (typeof property === "string" && property.length > 0) {
      return property;
    }
  }

  return undefined;
}

function readRecordProperty(
  value: Record<string, unknown>,
  names: string[],
): Record<string, unknown> | undefined {
  for (const name of names) {
    const property = value[name];

    if (
      typeof property === "object" &&
      property !== null &&
      !Array.isArray(property)
    ) {
      return property as Record<string, unknown>;
    }
  }

  return undefined;
}

function mapCodexJsonEvent(
  value: unknown,
  runId: RunId,
): RunEvent | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const type = readStringProperty(record, ["type", "event", "kind"]);

  if (type === undefined) {
    return undefined;
  }

  const createdAt = nowIsoDateTime();
  const item = readRecordProperty(record, ["item"]);
  const itemType =
    item === undefined ? undefined : readStringProperty(item, ["type"]);
  const itemText =
    item === undefined
      ? undefined
      : toText(item.text) ?? toText(item.content) ?? toText(item.delta);

  if (
    itemText !== undefined &&
    type === "item.completed" &&
    itemType === "agent_message"
  ) {
    return {
      type: "message.delta",
      runId,
      content: itemText,
      createdAt,
    };
  }

  const content = toText(record.delta) ?? toText(record.content) ?? toText(record.text);

  if (
    content !== undefined &&
    (type.includes("message") ||
      type.includes("assistant") ||
      type.includes("response"))
  ) {
    return {
      type: "message.delta",
      runId,
      content,
      createdAt,
    };
  }

  if (type.includes("tool") && type.includes("start")) {
    return {
      type: "tool.call.started",
      runId,
      toolCallId:
        readStringProperty(record, ["toolCallId", "tool_call_id", "id"]) ??
        `${runId}:tool:${createdAt}`,
      name:
        readStringProperty(record, ["name", "toolName", "tool_name"]) ??
        "unknown",
      input: readRecordProperty(record, ["input", "arguments", "args"]),
      createdAt,
    };
  }

  if (
    type.includes("tool") &&
    (type.includes("complete") || type.includes("finish") || type.includes("end"))
  ) {
    const error = toText(record.error);

    return {
      type: "tool.call.completed",
      runId,
      toolCallId:
        readStringProperty(record, ["toolCallId", "tool_call_id", "id"]) ??
        `${runId}:tool:${createdAt}`,
      status: error === undefined ? "succeeded" : "failed",
      output: record.output,
      error,
      createdAt,
    };
  }

  return undefined;
}

function toLogLine(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function createLogLineEvent(
  runId: RunId,
  stream: "stdout" | "stderr",
  line: string,
): RunEvent {
  return {
    type: "log.line",
    runId,
    stream,
    line,
    createdAt: nowIsoDateTime(),
  };
}

function createCodexSpawnOptions(
  options: SpawnOptionsWithoutStdio,
): SpawnOptionsWithoutStdio {
  return process.platform === "win32"
    ? {
        ...options,
        shell: true,
      }
    : options;
}

function createCodexDeveloperInstructionsConfig(
  agentInstructions: string | undefined,
): string | undefined {
  const trimmedInstructions = agentInstructions?.trim();

  if (trimmedInstructions === undefined || trimmedInstructions.length === 0) {
    return undefined;
  }

  return `developer_instructions=${JSON.stringify(trimmedInstructions)}`;
}

export class CodexAdapter implements AgentAdapter {
  readonly runtimeKind = "codex" as const;

  #executablePath: string;
  #spawnProcess: SpawnCodexProcess;

  constructor(options: CodexAdapterOptions = {}) {
    this.#executablePath = options.executablePath ?? "codex";
    this.#spawnProcess = options.spawnProcess ?? spawnChildProcess;
  }

  async detect(): Promise<DaemonRuntime> {
    const process = this.#spawnProcess(this.#executablePath, ["--version"], {
      ...createCodexSpawnOptions({
        stdio: "pipe",
      }),
    });
    const stdout = new LineDecoder();
    const stderr = new LineDecoder();
    const output: string[] = [];
    const errors: string[] = [];

    process.stdout.on("data", (chunk) => output.push(...stdout.push(chunk)));
    process.stderr.on("data", (chunk) => errors.push(...stderr.push(chunk)));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      process.once("error", reject);
      process.once("close", resolve);
    });

    const lastStdout = stdout.flush();
    const lastStderr = stderr.flush();

    if (lastStdout !== undefined) {
      output.push(lastStdout);
    }

    if (lastStderr !== undefined) {
      errors.push(lastStderr);
    }

    if (exitCode !== 0) {
      throw new Error(
        `Codex runtime detection failed: ${errors.join("\n") || exitCode}`,
      );
    }

    return {
      daemonDeviceId: "",
      runtimeKind: "codex",
      runtimeVersion: output.join("\n").trim() || undefined,
      executablePath: this.#executablePath,
      capabilities: [
        { name: "json-events", enabled: true },
        { name: "ephemeral-runs", enabled: true },
      ],
      status: "ready",
      lastSeenAt: nowIsoDateTime(),
    };
  }

  run(input: AgentRunInput): AsyncIterable<RunEvent> {
    const queue = new AsyncEventQueue<RunEvent>();
    const developerInstructionsConfig = createCodexDeveloperInstructionsConfig(
      input.agentInstructions,
    );
    const args = [
      "exec",
      "--json",
      "--ephemeral",
      "--cd",
      input.workspacePath,
      "--skip-git-repo-check",
      "--dangerously-bypass-approvals-and-sandbox",
      ...(developerInstructionsConfig === undefined
        ? []
        : ["-c", developerInstructionsConfig]),
      "-",
    ];
    const process = this.#spawnProcess(this.#executablePath, args, {
      ...createCodexSpawnOptions({
        cwd: input.workspacePath,
        stdio: "pipe",
      }),
    });
    const stdout = new LineDecoder();
    const stderr = new LineDecoder();
    let completed = false;
    let aborted = false;

    const complete = (
      status: Extract<RunEvent, { type: "run.completed" }>["status"],
      error?: string,
    ) => {
      if (completed) {
        return;
      }

      completed = true;
      queue.push({
        type: "run.completed",
        runId: input.run.id,
        status,
        error,
        createdAt: nowIsoDateTime(),
      });
      queue.end();
    };

    const handleStdoutLine = (line: string) => {
      const parsed = parseJsonLine(line);

      if (!parsed.ok) {
        queue.push(createLogLineEvent(input.run.id, "stdout", parsed.line));
        return;
      }

      const event = mapCodexJsonEvent(parsed.value, input.run.id);

      queue.push(
        event ?? createLogLineEvent(input.run.id, "stdout", toLogLine(parsed.value)),
      );
    };

    process.stdout.on("data", (chunk) => {
      for (const line of stdout.push(chunk)) {
        handleStdoutLine(line);
      }
    });
    process.stdout.on("end", () => {
      const line = stdout.flush();

      if (line !== undefined) {
        handleStdoutLine(line);
      }
    });

    process.stderr.on("data", (chunk) => {
      for (const line of stderr.push(chunk)) {
        queue.push(createLogLineEvent(input.run.id, "stderr", line));
      }
    });
    process.stderr.on("end", () => {
      const line = stderr.flush();

      if (line !== undefined) {
        queue.push(createLogLineEvent(input.run.id, "stderr", line));
      }
    });

    process.once("error", (error) => {
      complete("failed", error instanceof Error ? error.message : String(error));
    });
    process.once("close", (exitCode) => {
      if (aborted) {
        complete("cancelled");
        return;
      }

      complete(
        exitCode === 0 ? "succeeded" : "failed",
        exitCode === 0 ? undefined : `Codex exited with code ${exitCode}`,
      );
    });

    input.abortSignal?.addEventListener(
      "abort",
      () => {
        aborted = true;
        process.kill("SIGTERM");
      },
      { once: true },
    );

    queue.push({
      type: "run.started",
      runId: input.run.id,
      workspacePath: input.workspacePath,
      createdAt: nowIsoDateTime(),
    });
    process.stdin.write(input.prompt);
    process.stdin.end();

    return queue;
  }

  async cancel(): Promise<void> {
    return Promise.resolve();
  }
}

export function createCodexAdapter(
  options?: CodexAdapterOptions,
): CodexAdapter {
  return new CodexAdapter(options);
}
