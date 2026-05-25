import { pathToFileURL } from "node:url";

import { loadDaemonEnv } from "@agent-hub/config";
import type {
  AgentRuntimeBinding,
  DaemonClientMessage,
  DaemonServerMessage,
  RunId,
} from "@agent-hub/core";
import WebSocket from "ws";

import { CodexAdapter } from "./runtime/codex";
import { assertPathInsideWorkspace } from "./workspace";

function nowIsoDateTime(): string {
  return new Date().toISOString();
}

function toDaemonWebSocketUrl(apiUrl: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/daemon/connect";
  url.search = "";
  return url.toString();
}

function send(ws: WebSocket, message: DaemonClientMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function parseServerMessage(data: WebSocket.RawData): DaemonServerMessage | undefined {
  try {
    return JSON.parse(data.toString()) as DaemonServerMessage;
  } catch {
    return undefined;
  }
}

export async function startDaemon(): Promise<void> {
  const env = loadDaemonEnv();
  const adapter = new CodexAdapter({
    executablePath: env.CODEX_EXECUTABLE_PATH,
  });
  const abortControllers = new Map<RunId, AbortController>();
  const ws = new WebSocket(toDaemonWebSocketUrl(env.AGENTHUB_API_URL));

  ws.on("open", async () => {
    let capabilities: AgentRuntimeBinding[] = [];

    try {
      capabilities = [
        {
          ...(await adapter.detect()),
          agentId: "codex",
          daemonDeviceId: env.AGENTHUB_DEVICE_ID,
        },
      ];
    } catch (error) {
      console.warn(
        `Codex runtime detection failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    send(ws, {
      type: "daemon.hello",
      deviceId: env.AGENTHUB_DEVICE_ID,
      token: env.AGENTHUB_DAEMON_TOKEN,
      capabilities,
      sentAt: nowIsoDateTime(),
    });
  });

  const heartbeat = setInterval(() => {
    send(ws, {
      type: "daemon.heartbeat",
      deviceId: env.AGENTHUB_DEVICE_ID,
      runningRunIds: Array.from(abortControllers.keys()),
      sentAt: nowIsoDateTime(),
    });
  }, 10_000);

  ws.on("message", (data) => {
    const message = parseServerMessage(data);

    if (message === undefined) {
      return;
    }

    if (message.type === "daemon.hello.ack") {
      console.log(`Daemon connected as ${message.deviceId}`);
      return;
    }

    if (message.type === "run.cancel") {
      abortControllers.get(message.runId)?.abort();
      return;
    }

    if (message.type !== "run.assigned") {
      return;
    }

    if (abortControllers.has(message.run.id)) {
      return;
    }

    try {
      assertPathInsideWorkspace(
        env.AGENTHUB_WORKSPACE_ROOT,
        message.workspacePath,
      );
    } catch (error) {
      send(ws, {
        type: "run.rejected",
        runId: message.run.id,
        reason: error instanceof Error ? error.message : String(error),
        sentAt: nowIsoDateTime(),
      });
      return;
    }

    const abortController = new AbortController();
    abortControllers.set(message.run.id, abortController);
    send(ws, {
      type: "run.accepted",
      runId: message.run.id,
      sentAt: nowIsoDateTime(),
    });

    void (async () => {
      try {
        for await (const event of adapter.run({
          run: message.run,
          prompt: message.prompt,
          workspacePath: message.workspacePath,
          runtime: message.runtime,
          abortSignal: abortController.signal,
        })) {
          send(ws, {
            type: "run.event",
            runId: message.run.id,
            event,
            sentAt: nowIsoDateTime(),
          });
        }
      } catch (error) {
        send(ws, {
          type: "run.event",
          runId: message.run.id,
          event: {
            type: "run.completed",
            runId: message.run.id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
            createdAt: nowIsoDateTime(),
          },
          sentAt: nowIsoDateTime(),
        });
      } finally {
        abortControllers.delete(message.run.id);
      }
    })();
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    for (const abortController of abortControllers.values()) {
      abortController.abort();
    }
  });

  ws.on("error", (error) => {
    console.error(`Daemon websocket error: ${error.message}`);
  });
}

export function isDirectDaemonEntry(importMetaUrl: string): boolean {
  return process.argv[1] !== undefined &&
    importMetaUrl === pathToFileURL(process.argv[1]).href;
}
