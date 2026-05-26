import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AgentHubMcpRelay } from "../../src/mcp";

const relays: AgentHubMcpRelay[] = [];

async function createStartedRelay(): Promise<AgentHubMcpRelay> {
  const relay = new AgentHubMcpRelay();
  await relay.start();
  relays.push(relay);
  return relay;
}

afterEach(async () => {
  await Promise.all(relays.splice(0).map((relay) => relay.stop()));
});

describe("AgentHubMcpRelay", () => {
  it("relays send_message calls to the active run session", async () => {
    const relay = await createStartedRelay();
    const calls: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      enabledTools: ["send_message"],
      onToolCall: (call) => {
        calls.push(call);
        return { accepted: true };
      },
    });

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/send_message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_1",
          input: { content: "hello" },
        }),
      },
    );

    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({
        runId: "run_1",
        toolCallId: "tool_1",
        name: "send_message",
        input: { content: "hello" },
      }),
    ]);
  });

  it("relays create_task calls with a daemon-generated task id", async () => {
    const relay = await createStartedRelay();
    const calls: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      enabledTools: ["create_task"],
      onToolCall: (call) => {
        calls.push(call);
        return {
          accepted: true,
          task: {
            id: (call.input as { taskId: string }).taskId,
            title: (call.input as { title: string }).title,
            assigneeAgentId: (call.input as { assigneeAgentId: string }).assigneeAgentId,
          },
        };
      },
    });

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/create_task`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_2",
          input: {
            title: "Write tests",
            description: "Cover dispatch.",
            assigneeAgentId: "agent_2",
          },
        }),
      },
    );

    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      accepted: true,
      task: {
        title: "Write tests",
        assigneeAgentId: "agent_2",
      },
    });
    expect(body.task.id).toEqual(expect.any(String));
    expect(calls).toEqual([
      expect.objectContaining({
        runId: "run_1",
        toolCallId: "tool_2",
        name: "create_task",
        input: expect.objectContaining({
          title: "Write tests",
          description: "Cover dispatch.",
          assigneeAgentId: "agent_2",
          taskId: body.task.id,
        }),
      }),
    ]);
  });

  it("relays list_tasks calls to the active run session", async () => {
    const relay = await createStartedRelay();
    const calls: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      enabledTools: ["list_tasks"],
      onToolCall: (call) => {
        calls.push(call);
        return {
          accepted: true,
          tasks: [
            {
              id: "task_1",
              title: "Research market",
              assigneeAgentId: "agent_2",
              status: "running",
            },
          ],
        };
      },
    });

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/list_tasks`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_list",
          input: { status: "running" },
        }),
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      tasks: [{ id: "task_1" }],
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({
        runId: "run_1",
        toolCallId: "tool_list",
        name: "list_tasks",
        input: { status: "running" },
      }),
    ]);
  });

  it("rejects calls after the session is closed", async () => {
    const relay = await createStartedRelay();
    const session = relay.createSession({
      runId: "run_1",
      enabledTools: ["send_message"],
      onToolCall: () => ({ accepted: true }),
    });

    session.close();

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/send_message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { content: "hello" },
        }),
      },
    );

    expect(response.status).toBe(404);
  });

  it("uploads artifacts only from inside the run workspace", async () => {
    const relay = await createStartedRelay();
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-relay-"));
    await mkdir(path.join(workspacePath, "artifacts"), { recursive: true });
    await writeFile(path.join(workspacePath, "artifacts", "report.md"), "# Report\n");
    const uploaded: unknown[] = [];
    const calls: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      workspacePath,
      enabledTools: ["upload_artifact"],
      onArtifactUpload: (upload) => {
        uploaded.push(upload);
        return Promise.resolve({
          accepted: true,
          artifact: {
            id: "artifact_1",
            ownerUserId: "user_1",
            conversationId: "conversation_1",
            taskId: upload.taskId,
            runId: "run_1",
            creatorAgentId: "agent_1",
            status: "ready",
            title: upload.title,
            filename: upload.filename,
            sizeBytes: upload.sizeBytes,
            createdAt: "2026-05-26T00:00:00.000Z",
            updatedAt: "2026-05-26T00:00:00.000Z",
          },
        });
      },
      onToolCall: (call) => {
        calls.push(call);
        return { accepted: true };
      },
    });

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/upload_artifact`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_3",
          input: {
            taskId: "task_1",
            title: "Report",
            localPath: "artifacts/report.md",
          },
        }),
      },
    );
    const rejected = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/upload_artifact`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            taskId: "task_1",
            title: "Report",
            localPath: "../outside.md",
          },
        }),
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      artifact: {
        id: "artifact_1",
      },
    });
    expect(response.status).toBe(200);
    expect(rejected.status).toBe(500);
    expect(uploaded).toEqual([
      expect.objectContaining({
        taskId: "task_1",
        filename: "report.md",
        sourcePath: "artifacts/report.md",
        contentBase64: expect.any(String),
      }),
    ]);
    expect(calls).toEqual([
      expect.objectContaining({
        name: "upload_artifact",
        toolCallId: "tool_3",
      }),
    ]);
  });
});
