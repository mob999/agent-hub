import type { ChildProcessByStdio, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import type { RunEvent, RunId, RuntimeRawEvent } from "@agent-hub/core/protocol";
import { LineDecoder, parseJsonLine } from "./jsonl";

export type RuntimeChildProcess = Pick<
  ChildProcessByStdio<Writable, Readable, Readable>,
  "kill" | "once" | "stderr" | "stdin" | "stdout"
>;

export type SpawnRuntimeProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => RuntimeChildProcess;

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
  options: SpawnOptionsWithoutStdio,
): SpawnOptionsWithoutStdio {
  return process.platform === "win32"
    ? {
        ...options,
        shell: true,
      }
    : options;
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
