import { describe, expect, it } from "vitest";

import {
  createChildLogger,
  createLogger,
  defaultRedactPaths,
} from "../../src";

function createMemoryDestination() {
  const lines: string[] = [];

  return {
    destination: {
      write(message: string) {
        lines.push(message);
      },
    },
    readLastLog() {
      const lastLine = lines.at(-1);

      if (lastLine === undefined) {
        throw new Error("Expected at least one log line.");
      }

      return JSON.parse(lastLine) as Record<string, unknown>;
    },
  };
}

describe("logger", () => {
  it("creates a named logger with bindings", () => {
    const { destination, readLastLog } = createMemoryDestination();
    const logger = createLogger({
      bindings: { service: "api" },
      destination,
      level: "info",
      name: "agent-hub-test",
    });

    logger.info("ready");

    expect(readLastLog()).toMatchObject({
      msg: "ready",
      name: "agent-hub-test",
      service: "api",
    });
  });

  it("creates child loggers with additional bindings", () => {
    const { destination, readLastLog } = createMemoryDestination();
    const parent = createLogger({
      bindings: { service: "worker" },
      destination,
      level: "info",
    });
    const child = createChildLogger(parent, { runId: "run_123" });

    child.info("running");

    expect(readLastLog()).toMatchObject({
      msg: "running",
      runId: "run_123",
      service: "worker",
    });
  });

  it("redacts sensitive fields by default", () => {
    const { destination, readLastLog } = createMemoryDestination();
    const logger = createLogger({ destination, level: "info" });

    logger.info(
      {
        password: "secret",
        headers: {
          authorization: "Bearer token",
        },
      },
      "login",
    );

    expect(readLastLog()).toMatchObject({
      headers: {
        authorization: "[Redacted]",
      },
      msg: "login",
      password: "[Redacted]",
    });
    expect(defaultRedactPaths).toContain("password");
    expect(defaultRedactPaths).toContain("headers.authorization");
  });
});
