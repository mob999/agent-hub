import { describe, expect, it } from "vitest";

import {
  buildAgentIdentityInstructions,
  buildAgentGroupsPrompt,
  buildActiveRunsPrompt,
  buildAssignedTaskPrompt,
  buildConversationRunPrompt,
  orchestratorParallelSerialTaskInstructions,
  artifactUserFacingLinkInstructions,
  formatArtifactPromptLines,
  buildMentionedGroupChatRunPrompt,
  resolveTextMentionedAgentIds,
  type ConversationMessage,
} from "../../src";

function createMessage(
  overrides: Partial<ConversationMessage>,
): ConversationMessage {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    conversationId: "00000000-0000-4000-8000-000000000002",
    senderType: "user",
    content: "hello",
    status: "completed",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...overrides,
  };
}

describe("conversation prompt builder", () => {
  it("returns the current message when there is no history", () => {
    expect(
      buildConversationRunPrompt({
        currentUserMessage: "Ship this change.",
        messages: [],
      }),
    ).toBe("Ship this change.");
  });

  it("includes prior conversation messages before the current request", () => {
    const prompt = buildConversationRunPrompt({
      currentUserMessage: "Now add tests.",
      messages: [
        createMessage({ senderType: "user", content: "Build the page." }),
        createMessage({
          senderType: "agent",
          senderAgentId: "00000000-0000-4000-8000-000000000003",
          content: "The page is implemented.",
        }),
        createMessage({ senderType: "agent", content: "   " }),
      ],
      agentNamesById: {
        "00000000-0000-4000-8000-000000000003": "dudu",
      },
    });

    expect(prompt).toBe([
      "<conversation_history>",
      "User:\nBuild the page.",
      "",
      "dudu:\nThe page is implemented.",
      "</conversation_history>",
      "",
      "<user_request>",
      "Now add tests.",
      "</user_request>",
    ].join("\n"));
  });

  it("includes the assigned task id for MCP task completion tools", () => {
    const prompt = buildAssignedTaskPrompt({
      conversationTitle: "Research",
      goalId: "00000000-0000-4000-8000-000000000099",
      goalTitle: "Research report",
      taskId: "00000000-0000-4000-8000-000000000010",
      taskIndex: 0,
      taskTitle: "Write the report",
      taskDescription: "Summarize the findings.",
      dispatchMessage: "@dudu please write this report.",
    });

    expect(prompt).toContain("Goal ID: 00000000-0000-4000-8000-000000000099");
    expect(prompt).toContain("Task ID: 00000000-0000-4000-8000-000000000010");
    expect(prompt).toContain("Task Index: 0");
    expect(prompt).toContain(
      "Use the exact Goal ID and Task Index above when calling AgentHub MCP upload_artifact and complete_task.",
    );
  });

  it("formats artifact prompt data with an editor-first user-facing Markdown link", () => {
    expect(
      formatArtifactPromptLines({
        id: "artifact-1",
        ownerUserId: "user-1",
        conversationId: "conversation-1",
        runId: "run-1",
        creatorAgentId: "agent-1",
        creatorType: "agent",
        status: "ready",
        title: "implementation-report.md",
        filename: "implementation-report.md",
        sizeBytes: 1200,
        downloadUrl: "http://localhost:3000/artifacts/artifact-1/download",
        editorUrl: "http://localhost:5173/editor/conversation-1/artifact-1",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      }),
    ).toContain(
      "      userFacingLink: [implementation-report.md](http://localhost:5173/editor/conversation-1/artifact-1)",
    );
  });

  it("instructs orchestrators to use Markdown artifact links", () => {
    expect(artifactUserFacingLinkInstructions).toContain("always use Markdown links");
    expect(artifactUserFacingLinkInstructions).toContain("Prefer artifact.userFacingLink/editorUrl");
    expect(artifactUserFacingLinkInstructions).toContain("Do not show bare filenames");
  });

  it("falls back to the artifact download link when no editor link is available", () => {
    expect(
      formatArtifactPromptLines({
        id: "artifact-1",
        ownerUserId: "user-1",
        conversationId: "conversation-1",
        runId: "run-1",
        creatorAgentId: "agent-1",
        creatorType: "agent",
        status: "ready",
        title: "archive.zip",
        filename: "archive.zip",
        sizeBytes: 1200,
        downloadUrl: "http://localhost:3000/artifacts/artifact-1/download",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      }),
    ).toContain(
      "      userFacingLink: [archive.zip](http://localhost:3000/artifacts/artifact-1/download)",
    );
  });

  it("builds stable AgentHub identity instructions", () => {
    const prompt = buildAgentIdentityInstructions({
      agentDescription: "",
      agentName: "dudu",
      conversationTitle: "Design",
      isOrchestrator: true,
      scenario: "group chat",
    });

    expect(prompt).toContain("You are dudu in AgentHub.");
    expect(prompt).toContain("runtime is only the execution engine");
    expect(prompt).toContain("Do not introduce yourself as Codex");
    expect(prompt).toContain("You are the configured Orchestrator");
    expect(prompt).toContain("Profile: No description provided.");
  });

  it("only expands member details for the current group", () => {
    const prompt = buildAgentGroupsPrompt([
      {
        agents: [{ description: "Coordinates research.", id: "agent-all", name: "coco" }],
        conversationId: "00000000-0000-4000-8000-000000000020",
        groupName: "all",
        orchestratorAgentId: "agent-all",
        title: "all",
      },
      {
        agents: [
          { description: "Frontend implementation.", id: "agent-design-1", name: "dudu" },
          { id: "agent-design-2", name: "jojo" },
        ],
        conversationId: "00000000-0000-4000-8000-000000000021",
        groupName: "Design",
        orchestratorAgentId: "agent-design-1",
        title: "Design",
      },
    ], { currentConversationId: "00000000-0000-4000-8000-000000000021" });

    expect(prompt).toContain("- #all (groupName: all, conversationId:");
    expect(prompt).not.toContain("@coco");
    expect(prompt).toContain("- #Design (groupName: Design, conversationId:");
    expect(prompt).toContain("@dudu [Orchestrator]: Frontend implementation.");
    expect(prompt).toContain("@jojo: No description provided.");
    expect(prompt).toContain("Only the current group includes member details.");
    expect(prompt).toContain("target { type: \"group\", groupName }");
    expect(prompt).toContain("include @all");
    expect(prompt).toContain("do not mention @AgentName or @all");
    expect(prompt).toContain("forces AgentHub to start reply runs");
    expect(prompt).toContain("target { type: \"user\" }");
  });

  it("does not include group member rosters without a current group", () => {
    const prompt = buildAgentGroupsPrompt([
      {
        agents: [
          { description: "Coordinates research.", id: "agent-coco", name: "coco" },
        ],
        conversationId: "00000000-0000-4000-8000-000000000020",
        groupName: "Research",
        orchestratorAgentId: "agent-coco",
        title: "Research",
      },
    ]);

    expect(prompt).toContain("- #Research (groupName: Research, conversationId:");
    expect(prompt).not.toContain("@coco");
    expect(prompt).not.toContain("members:");
  });

  it("marks mentioned group chat runs when the mentioned agent is orchestrator", () => {
    const prompt = buildMentionedGroupChatRunPrompt({
      agentGroupsPrompt: "<agenthub_agent_groups />",
      agentName: "coco",
      agentNamesById: {},
      conversationTitle: "Design",
      currentMessage: "@coco can you coordinate this?",
      isOrchestrator: true,
      messages: [],
      senderAgentName: "dudu",
    });

    expect(prompt).toContain(
      "You are the configured Orchestrator for this group, even in Chat mode.",
    );
    expect(prompt).toContain(
      "You may coordinate other agents by sending visible messages with @AgentName or @all",
    );
    expect(prompt).toContain(
      "Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
    );
  });

  it("does not mark non-orchestrator group chat runs as orchestrator", () => {
    const prompt = buildMentionedGroupChatRunPrompt({
      agentGroupsPrompt: "<agenthub_agent_groups />",
      agentName: "jojo",
      agentNamesById: {},
      conversationTitle: "Design",
      currentMessage: "@jojo can you review this?",
      messages: [],
      senderAgentName: "dudu",
    });

    expect(prompt).not.toContain("configured Orchestrator");
  });

  it("limits mentioned group chat history to the 10 most recent messages", () => {
    const messages = Array.from({ length: 12 }, (_, index) =>
      createMessage({
        content: `history-${index + 1}`,
        createdAt: `2026-05-26T00:${String(index + 1).padStart(2, "0")}:00.000Z`,
      })
    );
    const prompt = buildMentionedGroupChatRunPrompt({
      agentGroupsPrompt: "<agenthub_agent_groups />",
      agentName: "jojo",
      agentNamesById: {},
      conversationTitle: "Design",
      currentMessage: "@jojo can you review this?",
      messages,
      senderAgentName: "dudu",
    });

    expect(prompt).toContain("Only the 10 most recent group messages");
    expect(prompt).not.toMatch(/^history-1$/m);
    expect(prompt).not.toMatch(/^history-2$/m);
    expect(prompt).toMatch(/^history-3$/m);
    expect(prompt).toMatch(/^history-12$/m);
  });

  it("formats only active prior runs for mentioned group chat context", () => {
    const prompt = buildActiveRunsPrompt([
      {
        createdAt: "2026-05-26T00:00:00.000Z",
        goalId: "00000000-0000-4000-8000-000000000099",
        latestEventType: "run.started",
        runId: "00000000-0000-4000-8000-000000000010",
        status: "running",
        taskId: "00000000-0000-4000-8000-000000000012",
        taskIndex: 0,
        taskTitle: "Implement landing page",
      },
      {
        createdAt: "2026-05-25T00:00:00.000Z",
        runId: "00000000-0000-4000-8000-000000000011",
        status: "failed",
      },
    ]);

    expect(prompt).toContain("<agenthub_active_runs>");
    expect(prompt).toContain("Run 00000000-0000-4000-8000-000000000010: running");
    expect(prompt).toContain("latestEvent: run.started");
    expect(prompt).toContain("continue that same assigned task");
    expect(prompt).toContain("Goal ID: 00000000-0000-4000-8000-000000000099");
    expect(prompt).toContain("Task ID: 00000000-0000-4000-8000-000000000012");
    expect(prompt).toContain("Task #0");
    expect(prompt).toContain("Task title: Implement landing page");
    expect(prompt).not.toContain("00000000-0000-4000-8000-000000000011");
  });

  it("omits active run context when no prior run is active", () => {
    expect(
      buildActiveRunsPrompt([
        {
          createdAt: "2026-05-25T00:00:00.000Z",
          runId: "00000000-0000-4000-8000-000000000011",
          status: "succeeded",
        },
      ]),
    ).toBeUndefined();
  });

  it("injects active run context into mentioned group chat prompts", () => {
    const prompt = buildMentionedGroupChatRunPrompt({
      activeRunsPrompt: buildActiveRunsPrompt([
        {
          createdAt: "2026-05-26T00:00:00.000Z",
          runId: "00000000-0000-4000-8000-000000000010",
          status: "queued",
        },
      ]),
      agentGroupsPrompt: "<agenthub_agent_groups />",
      agentName: "jojo",
      agentNamesById: {},
      conversationTitle: "Design",
      currentMessage: "@jojo can you continue?",
      messages: [],
      senderAgentName: "dudu",
    });

    expect(prompt).toContain("<agenthub_active_runs>");
    expect(prompt).toContain("Run 00000000-0000-4000-8000-000000000010: queued");
  });

  it("documents orchestrator parallel and serial task planning rules", () => {
    const prompt = orchestratorParallelSerialTaskInstructions.join("\n");

    expect(prompt).toContain("Parallel task rule");
    expect(prompt).toContain("different agents");
    expect(prompt).toContain("deliverables are clearly separated");
    expect(prompt).toContain("Serial task rule");
    expect(prompt).toContain("same assignee");
    expect(prompt).toContain("dependsOnTaskIndexes");
    expect(prompt).toContain("integration, verification, publishing, and final-summary");
  });

  it("resolves text mentions by longest agent name first", () => {
    const mentionedAgentIds = resolveTextMentionedAgentIds(
      "@jojo please pair with @Coco Team. @missing is ignored. @jojo again.",
      [
        { id: "agent-jo", name: "jo" },
        { id: "agent-jojo", name: "jojo" },
        { id: "agent-coco-team", name: "Coco Team" },
      ],
    );

    expect(mentionedAgentIds).toEqual(["agent-jojo", "agent-coco-team"]);
  });

  it("does not return the sender when resolving text mentions", () => {
    expect(
      resolveTextMentionedAgentIds(
        "@dudu please continue",
        [{ id: "agent-dudu", name: "dudu" }],
        { excludeAgentId: "agent-dudu" },
      ),
    ).toEqual([]);
  });

  it("resolves @all to every mentioned-scope agent", () => {
    expect(
      resolveTextMentionedAgentIds("@all please review", [
        { id: "agent-coco", name: "coco" },
        { id: "agent-dudu", name: "dudu" },
      ]),
    ).toEqual(["agent-coco", "agent-dudu"]);
  });

  it("resolves @all case-insensitively", () => {
    expect(
      resolveTextMentionedAgentIds("@ALL please review", [
        { id: "agent-coco", name: "coco" },
        { id: "agent-dudu", name: "dudu" },
      ]),
    ).toEqual(["agent-coco", "agent-dudu"]);
  });

  it("does not resolve @all inside longer words", () => {
    expect(
      resolveTextMentionedAgentIds("@alligator please review", [
        { id: "agent-coco", name: "coco" },
        { id: "agent-dudu", name: "dudu" },
      ]),
    ).toEqual([]);
  });

  it("excludes the sender from @all mentions", () => {
    expect(
      resolveTextMentionedAgentIds(
        "@all please review",
        [
          { id: "agent-coco", name: "coco" },
          { id: "agent-dudu", name: "dudu" },
        ],
        { excludeAgentId: "agent-coco" },
      ),
    ).toEqual(["agent-dudu"]);
  });

  it("deduplicates explicit mentions mixed with @all", () => {
    expect(
      resolveTextMentionedAgentIds("@all @dudu please review", [
        { id: "agent-coco", name: "coco" },
        { id: "agent-dudu", name: "dudu" },
      ]),
    ).toEqual(["agent-coco", "agent-dudu"]);
  });
});

