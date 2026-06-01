import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("handles memory tools locally without depending on server RPC", async () => {
    const relay = await createStartedRelay();
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-memory-relay-"));
    const session = relay.createSession({
      runId: "run_1",
      workspacePath,
      enabledTools: ["append_memory", "read_memory", "search_memory"],
      onToolCall: () => {
        throw new Error("server unavailable");
      },
    });

    const appendResponse = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/append_memory`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_memory",
          input: {
            scope: "daily",
            title: "Cross-group note",
            content: "Sent a note to #Design.",
            tags: ["message"],
          },
        }),
      },
    );
    const readResponse = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/read_memory`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: { scope: "daily" },
        }),
      },
    );

    await expect(appendResponse.json()).resolves.toMatchObject({
      accepted: true,
      file: expect.stringContaining("memory/"),
    });
    await expect(readResponse.json()).resolves.toMatchObject({
      accepted: true,
      file: expect.stringContaining("memory/"),
      content: expect.stringContaining("Sent a note to #Design."),
    });
    expect(appendResponse.status).toBe(200);
    expect(readResponse.status).toBe(200);
    await rm(workspacePath, { recursive: true, force: true });
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

  it("uploads directories as zip artifacts", async () => {
    const relay = await createStartedRelay();
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-relay-dir-"));
    await mkdir(path.join(workspacePath, "site", "assets"), { recursive: true });
    await writeFile(path.join(workspacePath, "site", "index.html"), "<h1>Hello</h1>");
    await writeFile(path.join(workspacePath, "site", "assets", "app.js"), "console.log('hi')");
    const uploaded: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      workspacePath,
      enabledTools: ["upload_artifact"],
      onArtifactUpload: (upload) => {
        uploaded.push(upload);
        return Promise.resolve({
          accepted: true,
          artifact: {
            id: "artifact_zip",
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
      onToolCall: () => ({ accepted: true }),
    });

    const response = await fetch(
      `${session.relayUrl}/sessions/${session.token}/tools/upload_artifact`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: {
            goalId: "goal_1",
            taskIndex: 0,
            title: "Site source",
            localPath: "site",
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(uploaded).toEqual([
      expect.objectContaining({
        filename: "site.zip",
        sourcePath: "site",
        contentBase64: expect.any(String),
      }),
    ]);
    const zip = Buffer.from((uploaded[0] as { contentBase64: string }).contentBase64, "base64");
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    await rm(workspacePath, { recursive: true, force: true });
  });

  it("deploys static sites from inside the run workspace", async () => {
    const relay = await createStartedRelay();
    const workspacePath = await mkdtemp(path.join(tmpdir(), "agenthub-relay-site-"));
    await mkdir(path.join(workspacePath, "dist"), { recursive: true });
    await writeFile(path.join(workspacePath, "dist", "index.html"), "<script src=\"app.js\"></script>");
    await writeFile(path.join(workspacePath, "dist", "app.js"), "console.log('site')");
    const deployments: unknown[] = [];
    const calls: unknown[] = [];
    const session = relay.createSession({
      runId: "run_1",
      workspacePath,
      enabledTools: ["deploy_static_site"],
      onStaticSiteDeploy: (deployment) => {
        deployments.push(deployment);
        return Promise.resolve({
          accepted: true,
          deployment: {
            id: "deployment_1",
            ownerUserId: "user_1",
            conversationId: "conversation_1",
            goalId: deployment.goalId,
            taskIndex: deployment.taskIndex,
            runId: "run_1",
            creatorAgentId: "agent_1",
            status: "ready",
            title: deployment.title,
            entrypoint: deployment.entrypoint,
            url: "http://localhost:3000/deployments/deployment_1/",
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
      `${session.relayUrl}/sessions/${session.token}/tools/deploy_static_site`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          toolCallId: "tool_deploy",
          input: {
            goalId: "goal_1",
            taskIndex: 0,
            title: "Static site",
            localPath: "dist",
          },
        }),
      },
    );

    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      deployment: { id: "deployment_1" },
    });
    expect(response.status).toBe(200);
    expect(deployments).toEqual([
      expect.objectContaining({
        entrypoint: "index.html",
        files: expect.arrayContaining([
          expect.objectContaining({ path: "index.html" }),
          expect.objectContaining({ path: "app.js" }),
        ]),
      }),
    ]);
    expect(calls).toEqual([
      expect.objectContaining({
        name: "deploy_static_site",
        toolCallId: "tool_deploy",
      }),
    ]);
    await rm(workspacePath, { recursive: true, force: true });
  });
});
