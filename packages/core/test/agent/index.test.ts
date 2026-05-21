import { describe, expect, it } from "vitest";

import {
  agentWorkspaceDirectoryNames,
  agentWorkspaceManifestFileName,
  agentWorkspaceMetadataDirectory,
  agentWorkspaceRuntimeFileName,
} from "../../src/agent";

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
});
