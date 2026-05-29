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

  it("relays create_task calls scoped to a goal", async () => {
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
            id: "task_1",
            goalId: (call.input as { goalId: string }).goalId,
            index: 0,
            title: (call.input as { title: string }).title,
            assigneeAgentId: (call.input as { assigneeAgentId: string }).assigneeAgentId,
            status: "assigned",
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
            goalId: "goal_1",
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
    expect(body.task.id).toBe("task_1");
    expect(calls).toEqual([
      expect.objectContaining({
        runId: "run_1",
        toolCallId: "tool_2",
        name: "create_task",
        input: expect.objectContaining({
          title: "Write tests",
          description: "Cover dispatch.",
          assigneeAgentId: "agent_2",
          goalId: "goal_1",
        }),
      }),
    ]);
  });

  it("relays list_goals calls to the active run session", async () => {
    const relay = await createStartedRelay();
    const calls: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      enabledTools: ["list_goals"],
      onToolCall: (call) => {
        calls.push(call);
        return {
          accepted: true,
          goals: [
            {
              id: "goal_1",
              title: "Research market",
              status: "active",
              tasks: [],
            },
          ],
        };
      },
    });

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/list_goals`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_list",
          input: { status: "active" },
        }),
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      goals: [{ id: "goal_1" }],
    });
    expect(response.status).toBe(200);
    expect(calls).toEqual([
      expect.objectContaining({
        runId: "run_1",
        toolCallId: "tool_list",
        name: "list_goals",
        input: { status: "active" },
      }),
    ]);
  });

  it("relays cross-conversation send_message targets to the active run session", async () => {
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

    const groupResponse = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/send_message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_group",
          input: {
            target: { type: "group", groupName: " Design " },
            content: " hello group ",
          },
        }),
      },
    );
    const userResponse = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/send_message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_user",
          input: { target: { type: "user" }, content: " hello user " },
        }),
      },
    );
    const rejected = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/send_message`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { target: { type: "group", groupName: " " }, content: "hello" },
        }),
      },
    );

    expect(groupResponse.status).toBe(200);
    expect(userResponse.status).toBe(200);
    expect(rejected.status).toBe(400);
    expect(calls).toEqual([
      expect.objectContaining({
        name: "send_message",
        toolCallId: "tool_group",
        input: {
          target: { type: "group", groupName: "Design" },
          content: "hello group",
          attachments: undefined,
        },
      }),
      expect.objectContaining({
        name: "send_message",
        toolCallId: "tool_user",
        input: {
          target: { type: "user" },
          content: "hello user",
          attachments: undefined,
        },
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
            goalId: upload.goalId,
            taskIndex: upload.taskIndex,
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
            goalId: "goal_1",
            taskIndex: 0,
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
            goalId: "goal_1",
            taskIndex: 0,
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
        goalId: "goal_1",
        taskIndex: 0,
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
