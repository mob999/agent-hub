import type { IsoDateTime } from "./agent.js";
import type {
  Conversation,
  ConversationDeployment,
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
}

export interface WelcomeRecentMessage {
  conversation: Conversation;
  message: ConversationMessage;
}

export interface WelcomeRecentGoal {
  conversation: Conversation;
  goal: ConversationGoal;
  taskCounts: Partial<Record<ConversationGoalTaskStatus, number>>;
}

export interface WelcomeRecentDeployment {
  conversation: Conversation;
  deployment: ConversationDeployment;
}

export interface WelcomeDashboardSummary {
  conversations: WelcomeRecentConversation[];
  messages: WelcomeRecentMessage[];
  goals: WelcomeRecentGoal[];
  deployments: WelcomeRecentDeployment[];
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
