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
