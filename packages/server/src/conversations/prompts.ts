import type {
  ConversationArtifact,
  ConversationId,
  ConversationMessage,
  ConversationProject,
} from "@agent-hub/core";

import type { ActiveRunContext } from "./types.js";

export const orchestratorParallelSerialTaskInstructions = [
  "Parallel task rule: tasks may run in parallel only when they are assigned to different agents, each task has enough input to start, their deliverables are clearly separated, and neither task needs the other's report, code, screenshots, site artifact, decision, or verification result.",
  "Serial task rule: tasks must be serial when they share the same assignee, when one task depends on another task's output, when multiple agents must edit or verify the same deliverable, or when integration, validation, publishing, or final summarization must happen after earlier work.",
  "Planning pattern: create independent research, design, or separate-module tasks in parallel first; then create dependent integration, verification, publishing, and final-summary tasks with dependsOnTaskIndexes.",
  "If you are not certain two tasks are independent, make them serial by adding dependsOnTaskIndexes.",
];

function escapeMarkdownLinkText(value: string): string {
  return value.replace(/([\[\]])/g, "\\$1");
}

export const artifactUserFacingLinkInstructions =
  "When mentioning artifacts to the user, always use Markdown links in the form [title](editorUrl). Prefer artifact.userFacingLink/editorUrl; use downloadUrl only if editorUrl is missing. Do not show bare filenames or artifact ids as the deliverable entry.";

export function formatArtifactPromptLines(artifact: ConversationArtifact): string[] {
  const userFacingUrl = artifact.editorUrl ?? artifact.downloadUrl;
  const userFacingLink = userFacingUrl === undefined
    ? artifact.title
    : `[${escapeMarkdownLinkText(artifact.title)}](${userFacingUrl})`;

  return [
    "    artifact:",
    `      title: ${artifact.title}`,
    `      id: ${artifact.id}`,
    `      editorUrl: ${artifact.editorUrl ?? "none"}`,
    `      downloadUrl: ${artifact.downloadUrl ?? "none"}`,
    `      userFacingLink: ${userFacingLink}`,
  ];
}

export function conversationPromptRole(
  message: ConversationMessage,
  agentNamesById: Record<string, string> = {},
): string {
  if (message.senderType === "user") {
    return "User";
  }

  if (message.senderType === "agent") {
    return message.senderAgentId === undefined
      ? "Agent"
      : agentNamesById[message.senderAgentId] ?? "Agent";
  }

  return "System";
}

export function buildConversationRunPrompt(input: {
  agentNamesById?: Record<string, string>;
  currentUserMessage: string;
  messages: ConversationMessage[];
}): string {
  const history = input.messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => {
      const role = conversationPromptRole(message, input.agentNamesById);

      return `${role}:\n${message.content.trim()}`;
    });

  if (history.length === 0) {
    return input.currentUserMessage;
  }

  return [
    "<conversation_history>",
    history.join("\n\n"),
    "</conversation_history>",
    "",
    "<user_request>",
    input.currentUserMessage,
    "</user_request>",
  ].join("\n");
}

export function buildAgentIdentityInstructions(input: {
  agentDescription?: string | null;
  agentName: string;
  agentTags?: string[];
  conversationTitle?: string;
  isOrchestrator?: boolean;
  scenario: string;
}): string {
  const description = input.agentDescription?.trim();
  const tags = input.agentTags?.map((tag) => tag.trim()).filter((tag) => tag.length > 0) ?? [];

  return [
    "<agenthub_agent_identity>",
    `You are ${input.agentName} in AgentHub.`,
    `Current scenario: ${input.scenario}.`,
    input.conversationTitle === undefined
      ? undefined
      : `Current conversation: #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group."
      : undefined,
    "Your runtime may be Codex, Claude Code, OpenCode, or another adapter, but that runtime is only the execution engine.",
    "Do not introduce yourself as Codex, Claude Code, OpenCode, or the runtime.",
    "Stay in character as this AgentHub agent and follow the role/profile below.",
    tags.length === 0
      ? "Tags: none"
      : `Tags: ${tags.join(", ")}`,
    description === undefined || description.length === 0
      ? "Profile: No description provided."
      : ["Profile:", description].join("\n"),
    "</agenthub_agent_identity>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function buildAssignedTaskInstructions(input: {
  agentName: string;
  agentDescription?: string;
  agentTags?: string[];
  conversationTitle: string;
  projectProtocolPrompt?: string;
}): string {
  return [
    buildAgentIdentityInstructions({
      agentDescription: input.agentDescription,
      agentName: input.agentName,
      agentTags: input.agentTags,
      conversationTitle: input.conversationTitle,
      scenario: "assigned task",
    }),
    input.projectProtocolPrompt,
    `You are working inside AgentHub group #${input.conversationTitle}.`,
    "Visible task updates must be sent with send_message. Use list_artifacts plus download_artifact when you need previous agents' images, zip files, source packages, site artifacts, large files, or binary resources locally; use read_artifact only for small text inspection. Completed files must be reported with upload_artifact. Editable static websites should be uploaded with upload_artifact kind=site so the user can edit and publish them in AgentHub. Use deploy_static_site only for quick temporary deployment previews. Always finish assigned work with complete_task.",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n\n");
}

export function buildMentionedGroupChatAgentInstructions(input: {
  agentName: string;
  agentDescription?: string;
  agentTags?: string[];
  conversationTitle: string;
  isOrchestrator?: boolean;
  projectProtocolPrompt?: string;
}): string {
  return [
    buildAgentIdentityInstructions({
      agentDescription: input.agentDescription,
      agentName: input.agentName,
      agentTags: input.agentTags,
      conversationTitle: input.conversationTitle,
      isOrchestrator: input.isOrchestrator,
      scenario: "mentioned group chat",
    }),
    input.projectProtocolPrompt,
    `You are participating in the AgentHub group chat #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group, even in Chat mode."
      : undefined,
    "Visible group replies must be sent with the AgentHub MCP tool send_message.",
    "For ordinary replies or progress updates, do not include @AgentName or @all. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
    "Do not answer a group chat by writing normal assistant text.",
  ].filter((line): line is string => line !== undefined && line.trim().length > 0)
    .join("\n\n");
}

export function buildProjectProtocolPrompt(input: {
  conversationTitle: string;
  isOrchestrator?: boolean;
  project?: ConversationProject;
}): string {
  return [
    "<agenthub_project_protocol>",
    `This conversation is an AgentHub Project named ${input.conversationTitle}.`,
    input.project === undefined ? undefined : `Remote URL: ${input.project.remoteUrl}`,
    input.project?.defaultBranch === undefined ? undefined : `Default branch: ${input.project.defaultBranch}`,
    input.project?.baseHead === undefined ? undefined : `Current base head: ${input.project.baseHead}`,
    "Your execution workspace for Project runs is a per-run Git worktree and branch created from the Project base repository.",
    "Make code changes only inside the current execution workspace. Do not write code changes into another agent's worktree or the shared base repository directly.",
    "Agent memory is stored in your own AgentHub memory workspace, not in the Project repository. Do not create or update MEMORY.md or memory/ inside the Project repo unless the user explicitly asks for repository documentation.",
    "When a run finishes with code changes, AgentHub will commit the worktree changes and create an internal Project change proposal with branch, diff, and summary.",
    input.isOrchestrator === true
      ? "As the Project Orchestrator, inspect internal changes with list_project_changes/read_project_change and decide merge_project_change or reject_project_change. You may merge/reject automatically; user confirmation is not required."
      : "If you are not the Orchestrator, do not merge or reject Project changes. Produce useful code changes in your worktree and explain progress with send_message when helpful.",
    "Use ordinary artifacts only for reports, screenshots, deployments, or supporting files. The primary code collaboration surface for this Project is the Git worktree and internal Project changes.",
    "</agenthub_project_protocol>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export interface AgentGroupContext {
  agents: Array<{ id: string; name: string; tags: string[] }>;
  conversationId: ConversationId;
  groupName: string;
  orchestratorAgentId?: string;
  title: string;
}

export function buildAgentGroupsPrompt(
  groups: AgentGroupContext[],
  options: { currentConversationId?: string } = {},
): string {
  const groupLines = groups.length === 0
    ? ["You are not a member of any active AgentHub groups."]
    : [
        "You are a member of these active AgentHub groups:",
        ...groups.flatMap((group) => {
          const isCurrentGroup = group.conversationId === options.currentConversationId;

          if (!isCurrentGroup) {
            return [
              `- #${group.title} (groupName: ${group.groupName}, conversationId: ${group.conversationId})`,
            ];
          }

          const orchestrator = group.orchestratorAgentId === undefined
            ? undefined
            : group.agents.find((agent) => agent.id === group.orchestratorAgentId);
          const memberLines = group.agents.length === 0
            ? ["  members: none"]
            : [
                "  members:",
                ...group.agents.map((agent) => {
                  const role = agent.id === group.orchestratorAgentId
                    ? " [Orchestrator]"
                    : "";
                  const tags = agent.tags
                    .map((tag) => tag.trim())
                    .filter((tag) => tag.length > 0);

                  return `  - @${agent.name}${role}: tags: ${
                    tags.length === 0 ? "none" : tags.join(", ")
                  }`;
                }),
              ];

          return [
            `- #${group.title} (groupName: ${group.groupName}, conversationId: ${group.conversationId}; orchestrator: ${
              orchestrator === undefined ? "none" : `@${orchestrator.name}`
            })`,
            ...memberLines,
          ];
        }),
      ];

  return [
    "<agenthub_agent_groups>",
    ...groupLines,
    "Only the current group includes member details. Other groups are listed without member rosters.",
    "Use send_message with target { type: \"group\", groupName } to send a visible message to one of these groups.",
    "To wake another agent in a group, include @AgentName in the message content. To wake all other ready agents in the target group, include @all.",
    "If you are only replying to the current conversation or giving a status update, do not mention @AgentName or @all; mentioning an agent or @all forces AgentHub to start reply runs.",
    "Use send_message with target { type: \"user\" } to send a visible private message to the current user.",
    "Archived groups are not listed and cannot be targeted.",
    "</agenthub_agent_groups>",
  ].join("\n");
}

export function buildActiveRunsPrompt(
  activeRuns: ActiveRunContext[],
): string | undefined {
  const filteredRuns = activeRuns.filter((run) =>
    run.status === "queued" || run.status === "running"
  );

  if (filteredRuns.length === 0) {
    return undefined;
  }

  return [
    "<agenthub_active_runs>",
    "You already have active runs in this conversation.",
    "Do not assume they are complete. Coordinate with the visible conversation state and avoid duplicating the exact same work unless the user explicitly asks.",
    "If a listed run is tied to a Goal/Task and this new run is continuing after an interruption, continue that same assigned task. Do not restart from scratch if useful artifacts or partial progress already exist. Use list_artifacts, read_artifact, and download_artifact to inspect previous output. Finish with complete_task for the same Goal ID and Task Index.",
    ...filteredRuns.map((run) => {
      const details = [
        `Run ${run.runId}: ${run.status}`,
        `createdAt: ${run.createdAt}`,
        run.latestEventType === undefined
          ? undefined
          : `latestEvent: ${run.latestEventType}`,
        run.goalId === undefined ? undefined : `Goal ID: ${run.goalId}`,
        run.taskId === undefined ? undefined : `Task ID: ${run.taskId}`,
        run.taskIndex === undefined ? undefined : `Task #${run.taskIndex}`,
        run.taskTitle === undefined ? undefined : `Task title: ${run.taskTitle}`,
        run.taskDescription === undefined ? undefined : `Task description: ${run.taskDescription}`,
      ].filter((detail): detail is string => detail !== undefined);

      return `- ${details.join(", ")}`;
    }),
    "</agenthub_active_runs>",
  ].join("\n");
}

export function buildAssignedTaskPrompt(input: {
  agentGroupsPrompt?: string;
  conversationTitle: string;
  continuationMessage?: string;
  goalId: string;
  goalTitle: string;
  taskId: string;
  taskIndex: number;
  taskTitle: string;
  taskDescription?: string;
  dispatchMessage: string;
  projectProtocolPrompt?: string;
}): string {
  return [
    "<agenthub_assigned_task>",
    `Group: #${input.conversationTitle}`,
    `Goal ID: ${input.goalId}`,
    `Goal: ${input.goalTitle}`,
    `Task ID: ${input.taskId}`,
    `Task Index: ${input.taskIndex}`,
    `Task: ${input.taskTitle}`,
    input.taskDescription ? `Description: ${input.taskDescription}` : undefined,
    "",
    "You were assigned this task by the group orchestrator.",
    input.continuationMessage === undefined
      ? undefined
      : "You are continuing the same assigned task after the previous run was interrupted by a newer run.",
    input.continuationMessage === undefined
      ? undefined
      : "Do not restart from scratch if useful artifacts or partial progress already exist. Use list_artifacts, read_artifact, and download_artifact to inspect previous output.",
    input.continuationMessage === undefined
      ? undefined
      : `Latest mention or handoff message: ${input.continuationMessage}`,
    "Create the requested report or result file in your current workspace.",
    "You can inspect prior group workspace artifacts before producing your result. Use list_artifacts to find ids, read_artifact for small text snippets, and download_artifact to save images, zip files, source packages, site artifacts, large files, or binary resources into your current workspace.",
    "Do not use curl/wget against artifact downloadUrl or editorUrl for internal resource access; those links are user-facing and require browser authentication.",
    "Use the exact Goal ID and Task Index above when calling AgentHub MCP upload_artifact and complete_task.",
    "If the result is a report, screenshot, zip, or source package, upload it with upload_artifact. If the result is a runnable static HTML/CSS/JavaScript website that the user should review, edit, and publish, upload the site directory with upload_artifact using kind=site and entrypoint=index.html. Use deploy_static_site only for quick temporary deployment previews, not as the primary editable deliverable.",
    "After uploading/deploying, call complete_task with a concise summary and any uploaded artifact ids.",
    "Use send_message only for optional visible progress updates. Do not use normal assistant text as the visible group reply.",
    "</agenthub_assigned_task>",
    "",
    input.projectProtocolPrompt,
    input.projectProtocolPrompt === undefined ? undefined : "",
    input.agentGroupsPrompt,
    input.agentGroupsPrompt === undefined ? undefined : "",
    "<orchestrator_dispatch_message>",
    input.dispatchMessage,
    "</orchestrator_dispatch_message>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

export function buildMentionedGroupChatRunPrompt(input: {
  activeRunsPrompt?: string;
  agentGroupsPrompt: string;
  agentName: string;
  agentNamesById: Record<string, string>;
  conversationTitle: string;
  currentMessage: string;
  directMessagesPrompt?: string;
  isOrchestrator?: boolean;
  messages: ConversationMessage[];
  projectProtocolPrompt?: string;
  senderAgentName: string;
}): string {
  const recentMessages = input.messages.slice(-10);
  const conversationPrompt = buildConversationRunPrompt({
    agentNamesById: input.agentNamesById,
    currentUserMessage: [
      "<mentioned_message>",
      `From: ${input.senderAgentName}`,
      "Content:",
      input.currentMessage,
      "</mentioned_message>",
    ].join("\n"),
    messages: recentMessages,
  });

  return [
    "<agenthub_group_chat_protocol>",
    `You are ${input.agentName} in #${input.conversationTitle}.`,
    input.isOrchestrator === true
      ? "You are the configured Orchestrator for this group, even in Chat mode."
      : undefined,
    input.isOrchestrator === true
      ? "You may coordinate other agents by sending visible messages with @AgentName or @all, but only reply when useful."
      : undefined,
    `${input.senderAgentName} explicitly mentioned you in the latest message.`,
    "If you should reply, call the MCP tool send_message with { content: string }.",
    "For ordinary replies, do not include @AgentName or @all. Only include @AgentName when you intentionally want AgentHub to start that agent's reply run, or @all when you intentionally want all other ready agents in the group to run.",
    "If you should not reply, do not call send_message.",
    "Never use normal assistant text as the visible group reply. Normal assistant text is ignored by AgentHub group chat.",
    "Only the 10 most recent group messages are included below. Use list_group_messages or search_group_messages when you need older group context.",
    "</agenthub_group_chat_protocol>",
    "",
    input.projectProtocolPrompt,
    input.projectProtocolPrompt === undefined ? undefined : "",
    input.agentGroupsPrompt,
    "",
    input.directMessagesPrompt,
    input.directMessagesPrompt === undefined ? undefined : "",
    input.activeRunsPrompt,
    input.activeRunsPrompt === undefined ? undefined : "",
    conversationPrompt,
  ].filter((line): line is string => line !== undefined).join("\n");
}
