import type {
  AgentHubApproveTaskToolInput,
  AgentHubCancelTaskToolInput,
  AgentHubCompleteGoalToolInput,
  AgentHubCompleteTaskToolInput,
  AgentHubCreateGoalToolInput,
  AgentHubCreateTaskToolInput,
  AgentHubDeployStaticSiteToolInput,
  AgentHubDownloadArtifactToolInput,
  AgentHubListArtifactsToolInput,
  AgentHubListGroupMessagesToolInput,
  AgentHubListProjectChangesToolInput,
  AgentHubMergeProjectChangeToolInput,
  AgentHubReadArtifactToolInput,
  AgentHubReadProjectChangeToolInput,
  AgentHubRejectProjectChangeToolInput,
  AgentHubSearchGroupMessagesToolInput,
  AgentHubSendMessageToolInput,
  AgentHubUploadArtifactToolInput,
  ConversationGoal,
  ConversationProjectChange,
} from "@agent-hub/core";

function compactUniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => value !== undefined && value.length > 0),
    ),
  );
}

function compactUniqueNumbers(values: number[]): number[] {
  return Array.from(
    new Set(
      values.filter((value) => Number.isInteger(value) && value >= 0),
    ),
  );
}

export function readSendMessageToolInput(
  input: unknown,
): AgentHubSendMessageToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("content" in input)
  ) {
    return null;
  }

  const content = (input as AgentHubSendMessageToolInput).content;
  const record = input as Record<string, unknown>;

  return typeof content === "string" && content.trim().length > 0
    ? {
        content: content.trim(),
        target: readSendMessageTarget(record.target),
        attachments: readSendMessageAttachments(record.attachments),
      }
    : null;
}

function readSendMessageTarget(
  value: unknown,
): AgentHubSendMessageToolInput["target"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (record.type === "current") {
    return { type: "current" };
  }

  if (record.type === "user") {
    return { type: "user" };
  }

  if (
    record.type === "group" &&
    typeof record.groupName === "string" &&
    record.groupName.trim().length > 0
  ) {
    return { type: "group", groupName: record.groupName.trim() };
  }

  return undefined;
}

function readSendMessageAttachments(
  value: unknown,
): AgentHubSendMessageToolInput["attachments"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attachments = value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }

    const record = item as Record<string, unknown>;

    if (record.type !== "image") {
      return [];
    }

    const artifactId = typeof record.artifactId === "string" &&
      record.artifactId.length > 0
      ? record.artifactId
      : undefined;

    if (artifactId === undefined) {
      return [];
    }

    return [{
      type: "image" as const,
      artifactId,
      title: typeof record.title === "string" ? record.title.trim() : undefined,
      filename: typeof record.filename === "string" ? record.filename.trim() : undefined,
    }];
  });

  return attachments.length > 0 ? attachments : undefined;
}

export function readListGoalsToolInput(
  input: unknown,
): { status?: ConversationGoal["status"] } | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const status = (input as Record<string, unknown>).status;

  return typeof status === "string" && status.length > 0
    ? { status: status as ConversationGoal["status"] }
    : {};
}

export function readListGroupMessagesToolInput(
  input: unknown,
): AgentHubListGroupMessagesToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const limit = record.limit;
  const beforeMessageId = record.beforeMessageId;

  return {
    beforeMessageId:
      typeof beforeMessageId === "string" && beforeMessageId.length > 0
        ? beforeMessageId
        : undefined,
    limit:
      typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 100)
        : undefined,
  };
}

export function readSearchGroupMessagesToolInput(
  input: unknown,
): AgentHubSearchGroupMessagesToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const query = record.query;
  const limit = record.limit;

  return typeof query === "string" && query.trim().length > 0
    ? {
        query: query.trim(),
        limit:
          typeof limit === "number" && Number.isFinite(limit) && limit > 0
            ? Math.min(Math.floor(limit), 50)
            : undefined,
      }
    : null;
}

export function readCreateGoalToolInput(
  input: unknown,
): AgentHubCreateGoalToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("title" in input)
  ) {
    return null;
  }

  const goalInput = input as AgentHubCreateGoalToolInput;
  const title = goalInput.title.trim();
  const description = goalInput.description?.trim();

  return title.length > 0 && title.length <= 160
    ? {
        title,
        description: description && description.length > 0 ? description : undefined,
      }
    : null;
}

export function readDownloadArtifactToolInput(
  input: unknown,
): AgentHubDownloadArtifactToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const artifactId = record.artifactId;
  const goalId = record.goalId;
  const localPath = record.localPath;

  return typeof artifactId === "string" && artifactId.length > 0
    ? {
        artifactId,
        goalId: typeof goalId === "string" && goalId.length > 0
          ? goalId
          : undefined,
        localPath:
          typeof localPath === "string" && localPath.trim().length > 0
            ? localPath.trim()
            : undefined,
      }
    : null;
}

export function readCreateTaskToolInput(
  input: unknown,
): AgentHubCreateTaskToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("goalId" in input) ||
    !("title" in input) ||
    !("assigneeAgentId" in input)
  ) {
    return null;
  }

  const taskInput = input as AgentHubCreateTaskToolInput;
  const title = taskInput.title.trim();
  const description = taskInput.description?.trim();

  return typeof taskInput.goalId === "string" &&
    taskInput.goalId.length > 0 &&
    title.length > 0 &&
    title.length <= 160 &&
    typeof taskInput.assigneeAgentId === "string" &&
    taskInput.assigneeAgentId.length > 0
    ? {
        goalId: taskInput.goalId,
        title,
        description: description && description.length > 0 ? description : undefined,
        assigneeAgentId: taskInput.assigneeAgentId,
        dependsOnTaskIndexes: Array.isArray(taskInput.dependsOnTaskIndexes)
          ? compactUniqueNumbers(taskInput.dependsOnTaskIndexes)
          : undefined,
      }
    : null;
}

export function readApproveTaskToolInput(
  input: unknown,
): AgentHubApproveTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;

  return typeof goalId === "string" &&
    goalId.length > 0 &&
    typeof taskIndex === "number" &&
    Number.isInteger(taskIndex) &&
    taskIndex >= 0
    ? { goalId, taskIndex }
    : null;
}

export function readCancelTaskToolInput(
  input: unknown,
): AgentHubCancelTaskToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;
  const reason = record.reason;

  return typeof goalId === "string" &&
    goalId.length > 0 &&
    typeof taskIndex === "number" &&
    Number.isInteger(taskIndex) &&
    taskIndex >= 0
    ? {
        goalId,
        taskIndex,
        reason: typeof reason === "string" && reason.trim().length > 0
          ? reason.trim()
          : undefined,
      }
    : null;
}

export function readCompleteGoalToolInput(
  input: unknown,
): AgentHubCompleteGoalToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const summary = record.summary;

  return typeof goalId === "string" && goalId.length > 0
    ? {
        goalId,
        summary: typeof summary === "string" && summary.trim().length > 0
          ? summary.trim()
          : undefined,
      }
    : null;
}

export function readListArtifactsToolInput(
  input: unknown,
): AgentHubListArtifactsToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const taskIndex = record.taskIndex;
  const limit = record.limit;

  return {
    goalId: typeof goalId === "string" && goalId.length > 0
      ? goalId
      : undefined,
    taskIndex: typeof taskIndex === "number" &&
      Number.isInteger(taskIndex) &&
      taskIndex >= 0
      ? taskIndex
      : undefined,
    limit: typeof limit === "number" && Number.isInteger(limit) && limit > 0
      ? Math.min(limit, 50)
      : undefined,
  };
}

export function readListProjectChangesToolInput(
  input: unknown,
): AgentHubListProjectChangesToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  const status = (input as Record<string, unknown>).status;

  return typeof status === "string" && status.length > 0
    ? { status: status as ConversationProjectChange["status"] }
    : {};
}

export function readReadProjectChangeToolInput(
  input: unknown,
): AgentHubReadProjectChangeToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const changeId = (input as Record<string, unknown>).changeId;

  return typeof changeId === "string" && changeId.length > 0
    ? { changeId }
    : null;
}

export function readMergeProjectChangeToolInput(
  input: unknown,
): AgentHubMergeProjectChangeToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const changeId = record.changeId;
  const message = record.message;

  return typeof changeId === "string" && changeId.length > 0
    ? {
        changeId,
        message: typeof message === "string" && message.trim().length > 0
          ? message.trim()
          : undefined,
      }
    : null;
}

export function readRejectProjectChangeToolInput(
  input: unknown,
): AgentHubRejectProjectChangeToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const changeId = record.changeId;
  const reason = record.reason;

  return typeof changeId === "string" && changeId.length > 0
    ? {
        changeId,
        reason: typeof reason === "string" && reason.trim().length > 0
          ? reason.trim()
          : undefined,
      }
    : null;
}

export function readReadArtifactToolInput(
  input: unknown,
): AgentHubReadArtifactToolInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const goalId = record.goalId;
  const artifactId = record.artifactId;

  return typeof artifactId === "string" &&
    artifactId.length > 0
    ? {
        artifactId,
        goalId: typeof goalId === "string" && goalId.length > 0
          ? goalId
          : undefined,
      }
    : null;
}

export function readUploadArtifactToolInput(
  input: unknown,
): AgentHubUploadArtifactToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("goalId" in input) ||
    !("taskIndex" in input) ||
    !("title" in input) ||
    !("localPath" in input)
  ) {
    return null;
  }

  const artifactInput = input as AgentHubUploadArtifactToolInput;
  const title = artifactInput.title.trim();
  const localPath = artifactInput.localPath.trim();
  const filename = artifactInput.filename?.trim();

  return title.length > 0 &&
    title.length <= 160 &&
    typeof artifactInput.goalId === "string" &&
    artifactInput.goalId.length > 0 &&
    typeof artifactInput.taskIndex === "number" &&
    Number.isInteger(artifactInput.taskIndex) &&
    artifactInput.taskIndex >= 0 &&
    localPath.length > 0
    ? {
        goalId: artifactInput.goalId,
        taskIndex: artifactInput.taskIndex,
        title,
        localPath,
        filename: filename && filename.length > 0 ? filename : undefined,
      }
    : null;
}

export function readDeployStaticSiteToolInput(
  input: unknown,
): AgentHubDeployStaticSiteToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("title" in input) ||
    !("localPath" in input)
  ) {
    return null;
  }

  const deploymentInput = input as AgentHubDeployStaticSiteToolInput;
  const title = deploymentInput.title.trim();
  const localPath = deploymentInput.localPath.trim();
  const entrypoint = deploymentInput.entrypoint?.trim();

  return title.length > 0 &&
    title.length <= 160 &&
    localPath.length > 0 &&
    (deploymentInput.goalId === undefined ||
      typeof deploymentInput.goalId === "string") &&
    (deploymentInput.taskIndex === undefined ||
      (typeof deploymentInput.taskIndex === "number" &&
        Number.isInteger(deploymentInput.taskIndex) &&
        deploymentInput.taskIndex >= 0))
    ? {
        goalId: deploymentInput.goalId,
        taskIndex: deploymentInput.taskIndex,
        title,
        localPath,
        entrypoint: entrypoint && entrypoint.length > 0 ? entrypoint : undefined,
      }
    : null;
}

export function readCompleteTaskToolInput(
  input: unknown,
): AgentHubCompleteTaskToolInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("goalId" in input) ||
    !("taskIndex" in input) ||
    !("summary" in input)
  ) {
    return null;
  }

  const taskInput = input as AgentHubCompleteTaskToolInput;
  const summary = taskInput.summary.trim();
  const artifactIds = Array.isArray(taskInput.artifactIds)
    ? compactUniqueStrings(taskInput.artifactIds)
    : undefined;

  return typeof taskInput.goalId === "string" &&
    taskInput.goalId.length > 0 &&
    typeof taskInput.taskIndex === "number" &&
    Number.isInteger(taskInput.taskIndex) &&
    taskInput.taskIndex >= 0 &&
    summary.length > 0
    ? {
        goalId: taskInput.goalId,
        taskIndex: taskInput.taskIndex,
        summary,
        artifactIds,
      }
    : null;
}
