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
});
