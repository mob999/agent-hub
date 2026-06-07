import type { IsoDateTime } from "./agent.js";
import type {
  Conversation,
  ConversationGoal,
  ConversationGoalTaskStatus,
  ConversationMessage,
} from "./conversation.js";

export interface WelcomeOnboardingPrerequisites {
  hasOnlineDaemon: boolean;
  hasReadyRuntime: boolean;
  hasReadyAgent: boolean;
  hasWorkspaceConversation: boolean;
}

export interface WelcomeOnboardingCounts {
  onlineDaemonCount: number;
  readyRuntimeCount: number;
  readyAgentCount: number;
  workspaceConversationCount: number;
}

export interface WelcomeOnboardingState {
  completedAt?: IsoDateTime;
  prerequisites: WelcomeOnboardingPrerequisites;
  counts: WelcomeOnboardingCounts;
  readyToComplete: boolean;
  completed: boolean;
}

export interface WelcomeRecentConversation {
  conversation: Conversation;
  latestMessage?: ConversationMessage;
}

export interface WelcomeRecentGoal {
  conversation: Conversation;
  goal: ConversationGoal;
  taskCounts: Partial<Record<ConversationGoalTaskStatus, number>>;
}

export interface WelcomeDashboardSummary {
  conversations: WelcomeRecentConversation[];
  goals: WelcomeRecentGoal[];
}

export interface WelcomeSummary {
  onboarding: WelcomeOnboardingState;
  dashboard: WelcomeDashboardSummary;
}

export interface GetWelcomeSummaryResponse {
  welcome: WelcomeSummary;
}

export interface CompleteWelcomeOnboardingResponse {
  welcome: WelcomeSummary;
}
