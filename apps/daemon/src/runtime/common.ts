import { execFileSync, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import type { Readable } from "node:stream";

import type { RunEvent, RunId, RuntimeRawEvent } from "@agent-hub/core/protocol";
import { LineDecoder, parseJsonLine } from "./jsonl";

export type RuntimeChildProcess = Pick<
  ChildProcess,
  "kill" | "once" | "stderr" | "stdout"
> & {
  stderr: Readable;
  stdout: Readable;
};

export type SpawnRuntimeProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => RuntimeChildProcess;

export type NativeSpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

export interface RuntimeEventSink {
  push(event: RunEvent): void;
}

interface AsyncQueueItem<T> {
  done: boolean;
  value?: T;
}

export class AsyncEventQueue<T> implements AsyncIterable<T> {
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

export function nowIsoDateTime(): string {
  return new Date().toISOString();
}

export function createLogLineEvent(
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

export function createRuntimeSpawnOptions(
  options: SpawnOptions,
): SpawnOptions {
  return options;
}

function findWindowsCommandCandidates(command: string): string[] {
  if (/[\\/]/.test(command) && existsSync(command)) {
    return [command];
  }

  try {
    return execFileSync("where.exe", [command], {
      encoding: "utf8",
      windowsHide: true,
    })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [command];
  }
}

function resolveNpmCmdShim(command: string, args: string[]): {
  args: string[];
  command: string;
} | undefined {
  if (extname(command).toLowerCase() !== ".cmd" || !existsSync(command)) {
    return undefined;
  }

  const commandDir = dirname(command);
  const content = readFileSync(command, "utf8");
  const exeMatch = /"%dp0%\\([^"]+\.exe)"\s+%[*]/i.exec(content);

  if (exeMatch !== null) {
    return {
      command: join(commandDir, exeMatch[1]),
      args,
    };
  }

  const nodeScriptMatch = /"%_prog%"\s+"%dp0%\\([^"]+\.js)"\s+%[*]/i.exec(content);

  if (nodeScriptMatch !== null) {
    const bundledNode = join(commandDir, "node.exe");

    return {
      command: existsSync(bundledNode) ? bundledNode : "node",
      args: [join(commandDir, nodeScriptMatch[1]), ...args],
    };
  }

  return undefined;
}

function resolveWindowsRuntimeCommand(command: string, args: string[]): {
  args: string[];
  command: string;
} {
  const candidates = findWindowsCommandCandidates(command);
  const cmdCandidates = candidates.filter(
    (candidate) => extname(candidate).toLowerCase() === ".cmd",
  );

  for (const candidate of cmdCandidates) {
    const resolved = resolveNpmCmdShim(candidate, args);

    if (resolved !== undefined) {
      return resolved;
    }
  }

  const executable = candidates.find(
    (candidate) => extname(candidate).toLowerCase() === ".exe",
  );

  return {
    command: executable ?? command,
    args,
  };
}

export function createRuntimeProcessSpawner(
  nativeSpawn: NativeSpawnProcess,
): SpawnRuntimeProcess {
  return (command, args, options) => {
    const resolved =
      process.platform === "win32"
        ? resolveWindowsRuntimeCommand(command, args)
        : { command, args };

    return nativeSpawn(
      resolved.command,
      resolved.args,
      options,
    ) as RuntimeChildProcess;
  };
}

export function createRuntimeEvent(
  runId: RunId,
  raw: RuntimeRawEvent,
  createdAt = nowIsoDateTime(),
): RunEvent {
  return {
    type: "runtime.event",
    runId,
    raw,
    createdAt,
  };
}

export function mapAbortReasonToRunStatus(
  reason: unknown,
): Extract<RunEvent, { type: "run.completed" }>["status"] {
  return reason === "interrupted" ? "interrupted" : "cancelled";
}

export function attachJsonLineRuntimeOutput(input: {
  eventSink: RuntimeEventSink;
  mapJsonValue(value: unknown): RunEvent[];
  process: RuntimeChildProcess;
  runId: RunId;
}): void {
  const stdout = new LineDecoder();
  const stderr = new LineDecoder();

  const handleStdoutLine = (line: string) => {
    const parsed = parseJsonLine(line);

    if (!parsed.ok) {
      input.eventSink.push(createLogLineEvent(input.runId, "stdout", parsed.line));
      return;
    }

    for (const event of input.mapJsonValue(parsed.value)) {
      input.eventSink.push(event);
    }
  };

  input.process.stdout.on("data", (chunk) => {
    for (const line of stdout.push(chunk)) {
      handleStdoutLine(line);
    }
  });
  input.process.stdout.on("end", () => {
    const line = stdout.flush();

    if (line !== undefined) {
      handleStdoutLine(line);
    }
  });

  input.process.stderr.on("data", (chunk) => {
    for (const line of stderr.push(chunk)) {
      input.eventSink.push(createLogLineEvent(input.runId, "stderr", line));
    }
  });
  input.process.stderr.on("end", () => {
    const line = stderr.flush();

    if (line !== undefined) {
      input.eventSink.push(createLogLineEvent(input.runId, "stderr", line));
    }
  });
}
