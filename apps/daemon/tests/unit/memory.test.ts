import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  appendMemory,
  appendMemoryTool,
  buildMemoryPrompt,
  initializeAgentMemory,
  readMemoryTool,
  searchMemoryTool,
} from "../../src/memory";

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agent-hub-memory-"));
}

describe("agent memory", () => {
  it("initializes long-term, daily, and transcript files", async () => {
    const workspacePath = await createTempDirectory();

    try {
      await initializeAgentMemory(workspacePath, new Date("2026-06-01T00:00:00.000Z"));

      await expect(readFile(path.join(workspacePath, "MEMORY.md"), "utf8"))
        .resolves.toContain("AgentHub Long-Term Memory");
      await expect(readFile(path.join(workspacePath, "memory", "2026-06-01.md"), "utf8"))
        .resolves.toContain("[Full conversation transcript](./transcripts/2026-06-01.md)");
      await expect(
        readFile(path.join(workspacePath, "memory", "transcripts", "2026-06-01.md"), "utf8"),
      ).resolves.toContain("AgentHub Conversation Transcript");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("appends memory and searches local files", async () => {
    const workspacePath = await createTempDirectory();

    try {
      await appendMemoryTool(workspacePath, {
        scope: "long_term",
        title: "Preference",
        content: "The user prefers concise implementation plans.",
        tags: ["preference"],
      });
      await appendMemory({
        workspacePath,
        kind: "transcript",
        date: "2026-06-01",
        dedupeKey: "message_1",
        content: "User: remember this transcript line",
      });
      await appendMemory({
        workspacePath,
        kind: "transcript",
        date: "2026-06-01",
        dedupeKey: "message_1",
        content: "User: duplicate line",
      });

      const search = await searchMemoryTool(workspacePath, {
        query: "concise transcript",
        scopes: ["long_term", "transcript"],
        fromDate: "2026-06-01",
        limit: 10,
      });
      const transcript = await readMemoryTool(workspacePath, {
        scope: "transcript",
        date: "2026-06-01",
      });

      expect(search.results.length).toBeGreaterThan(0);
      expect(transcript.content).toContain("message_1");
      expect(transcript.content).not.toContain("duplicate line");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("builds bounded memory prompt with transcript link", async () => {
    const workspacePath = await createTempDirectory();

    try {
      await initializeAgentMemory(workspacePath, new Date("2026-06-01T00:00:00.000Z"));
      const prompt = await buildMemoryPrompt({
        workspacePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
      });

      expect(prompt).toContain("<agenthub_memory>");
      expect(prompt).toContain("./memory/transcripts/2026-06-01.md");
      expect(prompt).toContain("read_memory");
    } finally {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });
});
