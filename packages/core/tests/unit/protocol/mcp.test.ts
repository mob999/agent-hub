import type {
  AgentHubApproveTaskToolInput,
  AgentHubCancelTaskToolInput,
  AgentHubCompleteGoalToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubCreateGoalToolInput,
  AgentHubCreateTaskToolInput,
  AgentHubCreateTaskToolResult,
  AgentHubDeployStaticSiteToolInput,
  AgentHubDeployStaticSiteToolResult,
  AgentHubDownloadArtifactToolInput,
  AgentHubDownloadArtifactToolResult,
  AgentHubAppendMemoryToolInput,
  AgentHubListGroupMessagesToolInput,
  AgentHubListArtifactsToolInput,
  AgentHubListGoalsToolResult,
  AgentHubMcpToolCall,
  AgentHubReadMemoryToolInput,
  AgentHubReadArtifactToolInput,
  AgentHubSearchGroupMessagesToolInput,
  AgentHubSearchMemoryToolInput,
  AgentHubSendMessageToolInput,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
} from "../../../src/protocol";
import {
  agentHubAllMcpTools,
  agentHubNonOrchestratorMcpTools,
} from "../../../src/protocol";
import { describe, expect, it } from "vitest";

describe("AgentHub MCP protocol", () => {
  it("defines orchestrator and non-orchestrator tool sets", () => {
    expect(agentHubAllMcpTools).toEqual([
      "send_message",
      "list_group_messages",
      "search_group_messages",
      "list_goals",
      "list_artifacts",
      "read_artifact",
      "download_artifact",
      "append_memory",
      "search_memory",
      "read_memory",
      "create_goal",
      "create_task",
      "approve_task",
      "cancel_task",
      "complete_goal",
    ]);
    expect(agentHubNonOrchestratorMcpTools).toEqual([
      "send_message",
      "list_group_messages",
      "search_group_messages",
      "list_goals",
      "list_artifacts",
      "read_artifact",
      "download_artifact",
      "append_memory",
      "search_memory",
      "read_memory",
      "upload_artifact",
      "deploy_static_site",
      "complete_task",
    ]);
  });

  it("expresses send_message with targets and image attachments", () => {
    const input: AgentHubSendMessageToolInput = {
      content: "Deploying this to @Codex",
      target: { type: "group", groupName: "Design" },
      attachments: [
        {
          type: "image",
          localPath: "artifacts/screenshot.png",
          title: "Screenshot",
        },
      ],
    };

    expect(input.target).toEqual({ type: "group", groupName: "Design" });
    expect(input.attachments?.[0]?.localPath).toBe("artifacts/screenshot.png");
  });

  it("expresses list_goals results with goal-local task indexes", () => {
    const result: AgentHubListGoalsToolResult = {
      accepted: true,
      goals: [
        {
          id: "00000000-0000-4000-8000-000000000020",
          ownerUserId: "00000000-0000-4000-8000-000000000021",
          conversationId: "00000000-0000-4000-8000-000000000022",
          orchestratorAgentId: "00000000-0000-4000-8000-000000000023",
          initialRunId: "00000000-0000-4000-8000-000000000024",
          title: "Ship report",
          status: "active",
          tasks: [
            {
              id: "00000000-0000-4000-8000-000000000002",
              goalId: "00000000-0000-4000-8000-000000000020",
              index: 0,
              title: "Write tests",
              assigneeAgentId: "00000000-0000-4000-8000-000000000001",
              dependsOnTaskIndexes: [],
              status: "running",
              resultArtifactIds: [],
              createdAt: "2026-05-26T00:00:00.000Z",
              updatedAt: "2026-05-26T00:00:00.000Z",
            },
          ],
          createdAt: "2026-05-26T00:00:00.000Z",
          updatedAt: "2026-05-26T00:00:00.000Z",
        },
      ],
    };

    expect(result.goals[0]?.tasks[0]?.index).toBe(0);
  });

  it("expresses create_goal and create_task tool calls", () => {
    const goalInput: AgentHubCreateGoalToolInput = {
      title: "Ship report",
      description: "Produce the final report.",
    };
    const input: AgentHubCreateTaskToolInput = {
      goalId: "00000000-0000-4000-8000-000000000020",
      title: "Write tests",
      description: "Cover the orchestrator dispatch path.",
      assigneeAgentId: "00000000-0000-4000-8000-000000000001",
      dependsOnTaskIndexes: [0],
    };
    const call: AgentHubMcpToolCall = {
      runId: "00000000-0000-4000-8000-000000000003",
      toolCallId: "tool_1",
      name: "create_task",
      input,
      createdAt: "2026-05-26T00:00:00.000Z",
    };
    const result: AgentHubCreateTaskToolResult = {
      accepted: true,
      task: {
        id: "00000000-0000-4000-8000-000000000002",
        goalId: input.goalId,
        index: 1,
        title: input.title,
        assigneeAgentId: input.assigneeAgentId,
        dependsOnTaskIndexes: input.dependsOnTaskIndexes,
        status: "waiting",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
    };

    expect(goalInput.title).toBe("Ship report");
    expect(call.name).toBe("create_task");
    expect(result.task.goalId).toBe(input.goalId);
    expect(result.task.dependsOnTaskIndexes).toEqual(input.dependsOnTaskIndexes);
  });

  it("expresses goal task control tools", () => {
    const approve: AgentHubApproveTaskToolInput = {
      goalId: "00000000-0000-4000-8000-000000000020",
      taskIndex: 1,
    };
    const cancel: AgentHubCancelTaskToolInput = {
      goalId: approve.goalId,
      taskIndex: approve.taskIndex,
      reason: "No longer needed.",
    };
    const complete: AgentHubCompleteGoalToolInput = {
      goalId: approve.goalId,
      summary: "Goal completed.",
    };

    expect(approve.taskIndex).toBe(cancel.taskIndex);
    expect(complete.summary).toContain("completed");
  });

  it("expresses group workspace artifact tools scoped by goal", () => {
    const list: AgentHubListArtifactsToolInput = {
      goalId: "00000000-0000-4000-8000-000000000020",
      taskIndex: 0,
      limit: 10,
    };
    const read: AgentHubReadArtifactToolInput = {
      goalId: list.goalId,
      artifactId: "00000000-0000-4000-8000-000000000011",
    };
    const download: AgentHubDownloadArtifactToolInput = {
      goalId: list.goalId,
      artifactId: read.artifactId,
      localPath: "inputs/report.md",
    };
    const result: AgentHubDownloadArtifactToolResult = {
      accepted: true,
      artifact: {
        id: read.artifactId,
        ownerUserId: "00000000-0000-4000-8000-000000000012",
        conversationId: "00000000-0000-4000-8000-000000000013",
        goalId: list.goalId,
        runId: "00000000-0000-4000-8000-000000000014",
        creatorAgentId: "00000000-0000-4000-8000-000000000015",
        creatorType: "agent",
        status: "ready",
        title: "Report",
        filename: "report.md",
        sizeBytes: 128,
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
      localPath: "inputs/report.md",
      sizeBytes: 128,
    };

    expect(list.limit).toBe(10);
    expect(read.goalId).toBe(list.goalId);
    expect(download.localPath).toBe("inputs/report.md");
    expect(result.artifact.id).toBe(download.artifactId);
  });

  it("expresses group message inspection tools", () => {
    const listInput: AgentHubListGroupMessagesToolInput = {
      beforeMessageId: "00000000-0000-4000-8000-000000000031",
      limit: 20,
    };
    const searchInput: AgentHubSearchGroupMessagesToolInput = {
      query: "deployment",
      limit: 10,
    };

    expect(listInput.limit).toBe(20);
    expect(searchInput.query).toBe("deployment");
  });

  it("expresses memory tools scoped to the current agent workspace", () => {
    const append: AgentHubAppendMemoryToolInput = {
      scope: "long_term",
      title: "User preference",
      content: "The user prefers concise implementation plans.",
      tags: ["preference"],
    };
    const search: AgentHubSearchMemoryToolInput = {
      query: "implementation plans",
      scopes: ["long_term", "daily", "transcript"],
      fromDate: "2026-06-01",
      toDate: "2026-06-01",
      limit: 5,
    };
    const read: AgentHubReadMemoryToolInput = {
      scope: "transcript",
      date: "2026-06-01",
      maxBytes: 4096,
    };

    expect(append.scope).toBe("long_term");
    expect(search.scopes).toContain("transcript");
    expect(read.scope).toBe("transcript");
  });

  it("expresses upload_artifact and complete_task tool calls", () => {
    const uploadInput: AgentHubUploadArtifactToolInput = {
      goalId: "00000000-0000-4000-8000-000000000020",
      taskIndex: 0,
      title: "Research report",
      localPath: "artifacts/report.md",
      filename: "report.md",
    };
    const uploadResult: AgentHubUploadArtifactToolResult = {
      accepted: true,
      artifact: {
        id: "00000000-0000-4000-8000-000000000011",
        ownerUserId: "00000000-0000-4000-8000-000000000012",
        conversationId: "00000000-0000-4000-8000-000000000013",
        goalId: uploadInput.goalId,
        taskIndex: uploadInput.taskIndex,
        runId: "00000000-0000-4000-8000-000000000014",
        creatorAgentId: "00000000-0000-4000-8000-000000000015",
        creatorType: "agent",
        status: "ready",
        title: uploadInput.title,
        filename: "report.md",
        sizeBytes: 128,
        downloadUrl:
          "http://localhost:3000/artifacts/00000000-0000-4000-8000-000000000011/download",
        editorUrl:
          "http://localhost:5173/editor/00000000-0000-4000-8000-000000000013/00000000-0000-4000-8000-000000000011",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
    };
    const completeInput: AgentHubCompleteTaskToolInput = {
      goalId: uploadInput.goalId,
      taskIndex: uploadInput.taskIndex,
      summary: "Report uploaded.",
      artifactIds: [uploadResult.artifact.id],
    };

    expect(uploadInput.localPath).toBe("artifacts/report.md");
    expect(uploadResult.artifact.filename).toBe("report.md");
    expect(uploadResult.artifact.editorUrl).toContain("/editor/");
    expect(completeInput.artifactIds).toEqual([uploadResult.artifact.id]);
  });

  it("expresses deploy_static_site tool calls", () => {
    const input: AgentHubDeployStaticSiteToolInput = {
      goalId: "00000000-0000-4000-8000-000000000020",
      taskIndex: 0,
      title: "Landing page",
      localPath: "dist",
      entrypoint: "index.html",
    };
    const result: AgentHubDeployStaticSiteToolResult = {
      accepted: true,
      deployment: {
        id: "00000000-0000-4000-8000-000000000030",
        ownerUserId: "00000000-0000-4000-8000-000000000012",
        conversationId: "00000000-0000-4000-8000-000000000013",
        goalId: input.goalId,
        taskIndex: input.taskIndex,
        runId: "00000000-0000-4000-8000-000000000014",
        creatorAgentId: "00000000-0000-4000-8000-000000000015",
        status: "ready",
        title: input.title,
        entrypoint: "index.html",
        url: "http://localhost:3000/deployments/00000000-0000-4000-8000-000000000030/",
        createdAt: "2026-05-26T00:00:00.000Z",
        updatedAt: "2026-05-26T00:00:00.000Z",
      },
    };

    expect(input.localPath).toBe("dist");
    expect(result.deployment.url).toContain("/deployments/");
  });

  it("expresses cross-conversation messages through send_message target", () => {
    const groupInput: AgentHubSendMessageToolInput = {
      target: { type: "group", groupName: "#Design" },
      content: "I found something relevant for this group.",
    };
    const userInput: AgentHubSendMessageToolInput = {
      target: { type: "user" },
      content: "I need your confirmation before continuing.",
    };
    const groupCall: AgentHubMcpToolCall = {
      runId: "00000000-0000-4000-8000-000000000003",
      toolCallId: "tool_group",
      name: "send_message",
      input: groupInput,
      createdAt: "2026-05-26T00:00:00.000Z",
    };

    expect(groupCall.name).toBe("send_message");
    expect(groupInput.target).toEqual({ type: "group", groupName: "#Design" });
    expect(userInput.target).toEqual({ type: "user" });
    expect(userInput.content).toContain("confirmation");
  });
});
