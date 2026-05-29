import type {
  AgentHubCreateTaskToolInput,
  AgentHubCreateTaskToolResult,
  AgentHubApproveTaskToolInput,
  AgentHubCancelTaskToolInput,
  AgentHubCompleteWorkflowToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubListArtifactsToolInput,
  AgentHubReadArtifactToolInput,
  AgentHubListTasksToolResult,
  AgentHubMcpToolCall,
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
      "list_tasks",
      "list_artifacts",
      "read_artifact",
      "create_task",
      "approve_task",
      "cancel_task",
      "upload_artifact",
      "complete_task",
      "complete_workflow",
    ]);
    expect(agentHubNonOrchestratorMcpTools).toEqual([
      "send_message",
      "list_tasks",
      "list_artifacts",
      "read_artifact",
      "upload_artifact",
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

  it("expresses list_tasks results with task ids", () => {
    const result: AgentHubListTasksToolResult = {
      accepted: true,
      tasks: [
        {
          id: "00000000-0000-4000-8000-000000000002",
          title: "Write tests",
          assigneeAgentId: "00000000-0000-4000-8000-000000000001",
          workflowId: "00000000-0000-4000-8000-000000000004",
          dependsOnTaskIds: ["00000000-0000-4000-8000-000000000003"],
          status: "running",
          resultArtifactIds: [],
        },
      ],
    };

    expect(result.tasks[0]?.id).toBe("00000000-0000-4000-8000-000000000002");
  });

  it("expresses create_task tool calls and results", () => {
    const input: AgentHubCreateTaskToolInput = {
      title: "Write tests",
      description: "Cover the orchestrator dispatch path.",
      assigneeAgentId: "00000000-0000-4000-8000-000000000001",
      dependsOnTaskIds: ["00000000-0000-4000-8000-000000000010"],
      taskId: "00000000-0000-4000-8000-000000000002",
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
        id: input.taskId,
        title: input.title,
        assigneeAgentId: input.assigneeAgentId,
        dependsOnTaskIds: input.dependsOnTaskIds,
        status: "waiting",
      },
    };

    expect(call.name).toBe("create_task");
    expect(result.task.id).toBe(input.taskId);
    expect(result.task.dependsOnTaskIds).toEqual(input.dependsOnTaskIds);
  });

  it("expresses task graph control tools", () => {
    const approve: AgentHubApproveTaskToolInput = {
      taskId: "00000000-0000-4000-8000-000000000002",
    };
    const cancel: AgentHubCancelTaskToolInput = {
      taskId: approve.taskId,
      reason: "No longer needed.",
    };
    const complete: AgentHubCompleteWorkflowToolInput = {
      summary: "Workflow completed.",
    };

    expect(approve.taskId).toBe(cancel.taskId);
    expect(complete.summary).toContain("completed");
  });

  it("expresses group workspace artifact tools", () => {
    const list: AgentHubListArtifactsToolInput = {
      taskId: "00000000-0000-4000-8000-000000000010",
      limit: 10,
    };
    const read: AgentHubReadArtifactToolInput = {
      artifactId: "00000000-0000-4000-8000-000000000011",
    };

    expect(list.limit).toBe(10);
    expect(read.artifactId).toBe("00000000-0000-4000-8000-000000000011");
  });

  it("expresses upload_artifact and complete_task tool calls", () => {
    const uploadInput: AgentHubUploadArtifactToolInput = {
      taskId: "00000000-0000-4000-8000-000000000010",
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
        taskId: uploadInput.taskId,
        runId: "00000000-0000-4000-8000-000000000014",
        creatorAgentId: "00000000-0000-4000-8000-000000000015",
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
      taskId: uploadInput.taskId,
      summary: "Report uploaded.",
      artifactIds: [uploadResult.artifact.id],
    };

    expect(uploadInput.localPath).toBe("artifacts/report.md");
    expect(uploadResult.artifact.filename).toBe("report.md");
    expect(uploadResult.artifact.editorUrl).toContain("/editor/");
    expect(completeInput.artifactIds).toEqual([uploadResult.artifact.id]);
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
