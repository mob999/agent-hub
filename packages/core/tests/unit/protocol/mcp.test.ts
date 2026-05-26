import type {
  AgentHubCreateTaskToolInput,
  AgentHubCreateTaskToolResult,
  AgentHubCompleteTaskToolInput,
  AgentHubMcpToolCall,
  AgentHubSendMessageToolInput,
  AgentHubUploadArtifactToolInput,
  AgentHubUploadArtifactToolResult,
} from "../../../src/protocol";
import { describe, expect, it } from "vitest";

describe("AgentHub MCP protocol", () => {
  it("expresses send_message with mentions and task ids", () => {
    const input: AgentHubSendMessageToolInput = {
      content: "Deploying this to @Codex",
      mentions: [
        {
          type: "agent",
          agentId: "00000000-0000-4000-8000-000000000001",
          label: "Codex",
        },
      ],
      taskIds: ["00000000-0000-4000-8000-000000000002"],
    };

    expect(input.mentions?.[0]?.label).toBe("Codex");
    expect(input.taskIds).toHaveLength(1);
  });

  it("expresses create_task tool calls and results", () => {
    const input: AgentHubCreateTaskToolInput = {
      title: "Write tests",
      description: "Cover the orchestrator dispatch path.",
      assigneeAgentId: "00000000-0000-4000-8000-000000000001",
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
      },
    };

    expect(call.name).toBe("create_task");
    expect(result.task.id).toBe(input.taskId);
  });

  it("expresses upload_artifact and complete_task tool calls", () => {
    const uploadInput: AgentHubUploadArtifactToolInput = {
      taskId: "00000000-0000-4000-8000-000000000010",
      title: "Research report",
      localPath: "artifacts/report.md",
      filename: "report.md",
      kind: "diff",
      metadata: {
        targetPath: "src/page.tsx",
      },
      mimeType: "text/markdown",
      targetPath: "src/page.tsx",
      displayMode: "diff",
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
        kind: uploadInput.kind,
        status: "ready",
        title: uploadInput.title,
        filename: "report.md",
        mimeType: "text/markdown",
        sizeBytes: 128,
        downloadUrl:
          "http://localhost:3000/artifacts/00000000-0000-4000-8000-000000000011/download",
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
    expect(uploadResult.artifact.kind).toBe("diff");
    expect(uploadInput.targetPath).toBe("src/page.tsx");
    expect(completeInput.artifactIds).toEqual([uploadResult.artifact.id]);
  });
});
