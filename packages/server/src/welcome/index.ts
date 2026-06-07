import type {
  Conversation,
  ConversationGoalTask,
  ConversationGoalTaskStatus,
  WelcomeDashboardSummary,
  WelcomeOnboardingCounts,
  WelcomeOnboardingPrerequisites,
  WelcomeSummary,
} from "@agent-hub/core";
import {
  agentRuntimeBindings,
  agents,
  agentWorkspaces,
  conversationDeployments,
  conversationGoalTasks,
  conversationGoals,
  conversationMessages,
  conversations,
  daemonDevices,
  daemonRuntimes,
  type Db,
  users,
} from "@agent-hub/db";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import { toConversationsWithAgentIds } from "../conversations/helpers.js";
import {
  toConversationDeployment,
  toConversationGoal,
  toConversationGoalTask,
  toConversationMessage,
} from "../conversations/mappers.js";

const dashboardLimits = {
  conversations: 6,
  deployments: 5,
  goals: 5,
  messages: 8,
} as const;

export type CompleteWelcomeOnboardingResult =
  | { status: "completed"; welcome: WelcomeSummary }
  | { status: "not-ready"; welcome: WelcomeSummary }
  | { status: "not-found" };

function workspaceConversationCondition(ownerUserId: string) {
  return and(
    eq(conversations.ownerUserId, ownerUserId),
    eq(conversations.status, "active"),
    or(
      eq(conversations.type, "project"),
      and(
        eq(conversations.type, "group"),
        or(isNull(conversations.key), ne(conversations.key, "all")),
      ),
    ),
  );
}

function userDaemonCondition(ownerUserId: string) {
  return and(
    or(eq(daemonDevices.ownerUserId, ownerUserId), isNull(daemonDevices.ownerUserId)),
    isNull(daemonDevices.deletedAt),
  );
}

function taskCounts(tasks: ConversationGoalTask[]): Partial<Record<ConversationGoalTaskStatus, number>> {
  const counts: Partial<Record<ConversationGoalTaskStatus, number>> = {};

  for (const task of tasks) {
    counts[task.status] = (counts[task.status] ?? 0) + 1;
  }

  return counts;
}

async function conversationMapForRows(
  db: Db,
  rows: Array<typeof conversations.$inferSelect>,
  ownerUserId: string,
): Promise<Map<string, Conversation>> {
  const uniqueRows = [
    ...new Map(rows.map((row) => [row.id, row])).values(),
  ];
  const mapped = await toConversationsWithAgentIds(db, uniqueRows, { ownerUserId });

  return new Map(mapped.map((conversation) => [conversation.id, conversation]));
}

async function getWelcomeOnboardingCounts(
  db: Db,
  ownerUserId: string,
): Promise<WelcomeOnboardingCounts> {
  const [onlineDaemonRows, readyRuntimeRows, readyAgentRows, workspaceConversationRows] =
    await Promise.all([
      db
        .select({ id: daemonDevices.id })
        .from(daemonDevices)
        .where(and(userDaemonCondition(ownerUserId), eq(daemonDevices.status, "online")))
        .limit(100),
      db
        .select({ id: daemonRuntimes.id })
        .from(daemonRuntimes)
        .innerJoin(daemonDevices, eq(daemonDevices.id, daemonRuntimes.daemonDeviceId))
        .where(
          and(
            userDaemonCondition(ownerUserId),
            eq(daemonDevices.status, "online"),
            eq(daemonRuntimes.status, "ready"),
          ),
        )
        .limit(100),
      db
        .select({ id: agents.id })
        .from(agents)
        .innerJoin(agentRuntimeBindings, eq(agentRuntimeBindings.agentId, agents.id))
        .innerJoin(agentWorkspaces, eq(agentWorkspaces.agentId, agents.id))
        .where(
          and(
            eq(agents.ownerUserId, ownerUserId),
            eq(agents.status, "active"),
            eq(agentRuntimeBindings.status, "ready"),
            eq(agentWorkspaces.status, "ready"),
          ),
        )
        .limit(100),
      db
        .select({ id: conversations.id })
        .from(conversations)
        .where(workspaceConversationCondition(ownerUserId))
        .limit(100),
    ]);

  return {
    onlineDaemonCount: onlineDaemonRows.length,
    readyRuntimeCount: readyRuntimeRows.length,
    readyAgentCount: readyAgentRows.length,
    workspaceConversationCount: workspaceConversationRows.length,
  };
}

function onboardingPrerequisitesFromCounts(
  counts: WelcomeOnboardingCounts,
): WelcomeOnboardingPrerequisites {
  return {
    hasOnlineDaemon: counts.onlineDaemonCount > 0,
    hasReadyRuntime: counts.readyRuntimeCount > 0,
    hasReadyAgent: counts.readyAgentCount > 0,
    hasWorkspaceConversation: counts.workspaceConversationCount > 0,
  };
}

function prerequisitesComplete(prerequisites: WelcomeOnboardingPrerequisites): boolean {
  return (
    prerequisites.hasOnlineDaemon &&
    prerequisites.hasReadyRuntime &&
    prerequisites.hasReadyAgent &&
    prerequisites.hasWorkspaceConversation
  );
}

async function getWelcomeDashboardSummary(
  db: Db,
  input: {
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<WelcomeDashboardSummary> {
  const recentConversationRows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.ownerUserId, input.ownerUserId), eq(conversations.status, "active")))
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.updatedAt))
    .limit(dashboardLimits.conversations);
  const recentConversations = await toConversationsWithAgentIds(db, recentConversationRows, {
    ownerUserId: input.ownerUserId,
  });

  const messageRows = await db
    .select({
      conversation: conversations,
      message: conversationMessages,
    })
    .from(conversationMessages)
    .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
    .where(and(eq(conversations.ownerUserId, input.ownerUserId), eq(conversations.status, "active")))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(dashboardLimits.messages);
  const messageConversationMap = await conversationMapForRows(
    db,
    messageRows.map((row) => row.conversation),
    input.ownerUserId,
  );

  const goalRows = await db
    .select({
      conversation: conversations,
      goal: conversationGoals,
    })
    .from(conversationGoals)
    .innerJoin(conversations, eq(conversations.id, conversationGoals.conversationId))
    .where(
      and(
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.status, "active"),
        or(eq(conversations.type, "group"), eq(conversations.type, "project")),
      ),
    )
    .orderBy(desc(conversationGoals.updatedAt))
    .limit(dashboardLimits.goals);
  const goalIds = goalRows.map((row) => row.goal.id);
  const goalTaskRows =
    goalIds.length === 0
      ? []
      : await db
          .select()
          .from(conversationGoalTasks)
          .where(inArray(conversationGoalTasks.goalId, goalIds))
          .orderBy(asc(conversationGoalTasks.index));
  const tasksByGoalId = new Map<string, ConversationGoalTask[]>();

  for (const taskRow of goalTaskRows) {
    const goalConversationId = goalRows.find((row) => row.goal.id === taskRow.goalId)
      ?.goal.conversationId;
    const tasks = tasksByGoalId.get(taskRow.goalId) ?? [];
    tasks.push(
      toConversationGoalTask(taskRow, [], {
        conversationId: goalConversationId,
        publicWebBaseUrl: input.publicWebBaseUrl,
      }),
    );
    tasksByGoalId.set(taskRow.goalId, tasks);
  }
  const goalConversationMap = await conversationMapForRows(
    db,
    goalRows.map((row) => row.conversation),
    input.ownerUserId,
  );

  const deploymentRows = await db
    .select({
      conversation: conversations,
      deployment: conversationDeployments,
    })
    .from(conversationDeployments)
    .innerJoin(conversations, eq(conversations.id, conversationDeployments.conversationId))
    .where(and(eq(conversations.ownerUserId, input.ownerUserId), eq(conversations.status, "active")))
    .orderBy(desc(conversationDeployments.createdAt))
    .limit(dashboardLimits.deployments);
  const deploymentConversationMap = await conversationMapForRows(
    db,
    deploymentRows.map((row) => row.conversation),
    input.ownerUserId,
  );

  return {
    conversations: recentConversations.map((conversation) => ({ conversation })),
    messages: messageRows.flatMap((row) => {
      const conversation = messageConversationMap.get(row.conversation.id);
      return conversation === undefined
        ? []
        : [{ conversation, message: toConversationMessage(row.message) }];
    }),
    goals: goalRows.flatMap((row) => {
      const conversation = goalConversationMap.get(row.conversation.id);
      const tasks = tasksByGoalId.get(row.goal.id) ?? [];

      return conversation === undefined
        ? []
        : [{
            conversation,
            goal: toConversationGoal(row.goal, tasks, {
              publicWebBaseUrl: input.publicWebBaseUrl,
            }),
            taskCounts: taskCounts(tasks),
          }];
    }),
    deployments: deploymentRows.flatMap((row) => {
      const conversation = deploymentConversationMap.get(row.conversation.id);
      return conversation === undefined
        ? []
        : [{
            conversation,
            deployment: toConversationDeployment(row.deployment, {
              publicApiBaseUrl: input.publicApiBaseUrl,
            }),
          }];
    }),
  };
}

export async function getWelcomeSummaryForUser(
  db: Db,
  input: {
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<WelcomeSummary | null> {
  const [user] = await db
    .select({
      welcomeOnboardingCompletedAt: users.welcomeOnboardingCompletedAt,
    })
    .from(users)
    .where(eq(users.id, input.ownerUserId))
    .limit(1);

  if (user === undefined) {
    return null;
  }

  const [counts, dashboard] = await Promise.all([
    getWelcomeOnboardingCounts(db, input.ownerUserId),
    getWelcomeDashboardSummary(db, input),
  ]);
  const prerequisites = onboardingPrerequisitesFromCounts(counts);
  const readyToComplete = prerequisitesComplete(prerequisites);
  const completedAt = user.welcomeOnboardingCompletedAt?.toISOString();

  return {
    onboarding: {
      completedAt,
      prerequisites,
      counts,
      readyToComplete,
      completed: completedAt !== undefined,
    },
    dashboard,
  };
}

export async function completeWelcomeOnboardingForUser(
  db: Db,
  input: {
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<CompleteWelcomeOnboardingResult> {
  const current = await getWelcomeSummaryForUser(db, input);

  if (current === null) {
    return { status: "not-found" };
  }

  if (current.onboarding.completed) {
    return { status: "completed", welcome: current };
  }

  if (!current.onboarding.readyToComplete) {
    return { status: "not-ready", welcome: current };
  }

  await db
    .update(users)
    .set({
      welcomeOnboardingCompletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, input.ownerUserId));

  const welcome = await getWelcomeSummaryForUser(db, input);

  if (welcome === null) {
    return { status: "not-found" };
  }

  return { status: "completed", welcome };
}
