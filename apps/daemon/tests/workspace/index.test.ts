import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createRunWorkspace,
  getAgentWorkspaceLayoutPaths,
  getAgentWorkspacePath,
  initializeAgentWorkspace,
  isPathInsideWorkspace,
  readAgentWorkspaceManifest,
  resolveWorkspacePath,
} from "../../src/workspace";

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-hub-daemon-"));
}

async function expectDirectory(directoryPath: string): Promise<void> {
  await expect(stat(directoryPath)).resolves.toMatchObject({
    isDirectory: expect.any(Function),
  });
  expect((await stat(directoryPath)).isDirectory()).toBe(true);
}

describe("agent workspace", () => {
  it("creates the required workspace layout and local-only manifest", async () => {
    const basePath = await createTempDirectory();
    const workspacePath = getAgentWorkspacePath(basePath, {
      agentId: "agent_1",
      daemonDeviceId: "device_1",
    });

    try {
      const initialized = await initializeAgentWorkspace({
        agentId: "agent_1",
        daemonDeviceId: "device_1",
        workspacePath,
        createdAt: new Date("2026-05-21T00:00:00.000Z"),
        runtime: {
          runtimeKind: "codex",
          runtimeVersion: "1.0.0",
          executablePath: "/usr/local/bin/codex",
          capabilities: [{ name: "code-edit", enabled: true }],
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      });
      const paths = getAgentWorkspaceLayoutPaths(workspacePath);

      await expectDirectory(paths.metadata);
      await expectDirectory(paths.memory);
      await expectDirectory(paths.skills);
      await expectDirectory(paths.files);
      await expectDirectory(paths.runs);
      await expectDirectory(paths.artifacts);
      await expectDirectory(paths.cache);

      await expect(readAgentWorkspaceManifest(workspacePath)).resolves.toEqual({
        schemaVersion: 1,
        agentId: "agent_1",
        daemonDeviceId: "device_1",
        syncMode: "local-only",
        createdAt: "2026-05-21T00:00:00.000Z",
      });
      expect(JSON.parse(await readFile(paths.runtime, "utf8"))).toMatchObject({
        runtimeKind: "codex",
        runtimeVersion: "1.0.0",
        executablePath: "/usr/local/bin/codex",
      });
      expect(initialized.workspace).toMatchObject({
        agentId: "agent_1",
        daemonDeviceId: "device_1",
        status: "ready",
        syncMode: "local-only",
      });
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("binds the same agent to different device workspaces", async () => {
    const basePath = await createTempDirectory();

    try {
      expect(
        getAgentWorkspacePath(basePath, {
          agentId: "agent_1",
          daemonDeviceId: "device_a",
        }),
      ).not.toBe(
        getAgentWorkspacePath(basePath, {
          agentId: "agent_1",
          daemonDeviceId: "device_b",
        }),
      );
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });

  it("rejects workspace path traversal", () => {
    const workspacePath = path.join(tmpdir(), "agent-hub-workspace");

    expect(isPathInsideWorkspace(workspacePath, workspacePath)).toBe(true);
    expect(
      isPathInsideWorkspace(workspacePath, path.join(workspacePath, "files")),
    ).toBe(true);
    expect(() => resolveWorkspacePath(workspacePath, "..", "escape")).toThrow(
      /escapes agent workspace/,
    );
  });

  it("creates run workspaces only below the agent workspace", async () => {
    const basePath = await createTempDirectory();
    const workspacePath = getAgentWorkspacePath(basePath, {
      agentId: "agent_1",
      daemonDeviceId: "device_1",
    });

    try {
      await initializeAgentWorkspace({
        agentId: "agent_1",
        daemonDeviceId: "device_1",
        workspacePath,
        runtime: {
          runtimeKind: "claude-code",
          capabilities: [],
          updatedAt: "2026-05-21T00:00:00.000Z",
        },
      });

      const runWorkspacePath = await createRunWorkspace(
        workspacePath,
        "run_1",
      );

      expect(isPathInsideWorkspace(workspacePath, runWorkspacePath)).toBe(true);
      expect(runWorkspacePath).toBe(
        path.join(getAgentWorkspaceLayoutPaths(workspacePath).runs, "run_1"),
      );
      await expectDirectory(runWorkspacePath);
      await expect(createRunWorkspace(workspacePath, "../run_2")).rejects.toThrow(
        /Unsafe workspace path segment/,
      );
    } finally {
      await rm(basePath, { recursive: true, force: true });
    }
  });
});
