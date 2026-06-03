import type { ChildProcessByStdio, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

import type { RunEvent, RunId, RuntimeRawEvent } from "@agent-hub/core/protocol";

type SpawnedProcess = Pick<
  ChildProcessByStdio<Writable, Readable, Readable>,
  "kill" | "once" | "stderr" | "stdin" | "stdout"
>;

export type SpawnRuntimeProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio,
) => SpawnedProcess;

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
