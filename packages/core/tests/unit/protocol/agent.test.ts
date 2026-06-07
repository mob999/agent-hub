import { describe, expect, it } from "vitest";

import type {
  CreateAgentRequest,
  UpdateAgentRequest,
  UpdateAgentResponse,
} from "../../../src/protocol";
import {
  agentTagMaxCount,
  agentTagMaxLength,
  agentWorkspaceDirectoryNames,
  agentWorkspaceManifestFileName,
  agentWorkspaceMetadataDirectory,
  agentWorkspaceRuntimeFileName,
  normalizeAgentTags,
} from "../../../src/protocol/agent";

describe("agent workspace protocol", () => {
  it("defines the required local workspace layout", () => {
    expect(agentWorkspaceDirectoryNames).toEqual([
      ".agenthub",
      "memory",
      "skills",
      "files",
      "runs",
      "artifacts",
      "cache",
    ]);
  });

  it("defines metadata file names used by daemon workspaces", () => {
    expect(agentWorkspaceMetadataDirectory).toBe(".agenthub");
    expect(agentWorkspaceManifestFileName).toBe("manifest.json");
    expect(agentWorkspaceRuntimeFileName).toBe("runtime.json");
  });

  it("expresses agent profile updates", () => {
    const request: UpdateAgentRequest = {
      name: "Jojo",
      description: "Frontend tasks",
      tags: ["frontend", "review"],
    };
    const response: UpdateAgentResponse = {
      agent: {
        agent: {
          id: "00000000-0000-4000-8000-000000000001",
          ownerUserId: "00000000-0000-4000-8000-000000000002",
          name: request.name,
          description: request.description,
          tags: request.tags ?? [],
          defaultRuntimeKind: "codex",
          status: "active",
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:01.000Z",
        },
        runtimeBinding: {
          agentId: "00000000-0000-4000-8000-000000000001",
          daemonDeviceId: "local-dev",
          runtimeKind: "codex",
          capabilities: [],
          status: "ready",
        },
        workspace: {
          agentId: "00000000-0000-4000-8000-000000000001",
          daemonDeviceId: "local-dev",
          status: "ready",
          syncMode: "local-only",
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:01.000Z",
        },
      },
    };

    expect(response.agent.agent.name).toBe("Jojo");
    expect(response.agent.agent.description).toBe("Frontend tasks");
    expect(response.agent.agent.tags).toEqual(["frontend", "review"]);
  });

  it("expresses tags in create requests", () => {
    const request: CreateAgentRequest = {
      daemonDeviceId: "local-dev",
      name: "Dudu",
      runtimeKind: "codex",
      tags: ["docs", "qa"],
    };

    expect(request.tags).toEqual(["docs", "qa"]);
  });

  it("normalizes agent tags", () => {
    expect(normalizeAgentTags([" Frontend  Review ", "frontend review", "", "QA"]).tags)
      .toEqual(["Frontend Review", "QA"]);
    expect(normalizeAgentTags(Array.from({ length: agentTagMaxCount + 1 }, (_, index) => `tag-${index}`)).error)
      .toBe("too-many");
    expect(normalizeAgentTags(["x".repeat(agentTagMaxLength + 1)]).error)
      .toBe("too-long");
    expect(normalizeAgentTags(["valid", 123]).error)
      .toBe("invalid");
  });
});
