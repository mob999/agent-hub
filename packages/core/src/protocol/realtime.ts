import type {
  Conversation,
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactId,
  ConversationId,
  ConversationGoal,
  ConversationGoalId,
  ConversationMessage,
} from "./conversation.js";
import type { AgentRun, RunEvent, RunId } from "./run.js";

export type RealtimeEventType =
  | "conversation.updated"
  | "conversation.message.created"
  | "conversation.message.updated"
  | "run.updated"
  | "run.event.created"
  | "task.updated"
  | "artifact.created"
  | "artifact.action.updated";

export interface RealtimeEventBase {
  createdAt: string;
  eventId: string;
  ownerUserId: string;
  type: RealtimeEventType;
}

export interface ConversationUpdatedRealtimeEvent extends RealtimeEventBase {
  conversation?: Conversation;
  conversationId: ConversationId;
  type: "conversation.updated";
}

export interface ConversationMessageCreatedRealtimeEvent
  extends RealtimeEventBase {
  conversationId: ConversationId;
  message: ConversationMessage;
  type: "conversation.message.created";
}

export interface ConversationMessageUpdatedRealtimeEvent
  extends RealtimeEventBase {
  conversationId: ConversationId;
  message: ConversationMessage;
  type: "conversation.message.updated";
}

export interface RunUpdatedRealtimeEvent extends RealtimeEventBase {
  conversationId?: ConversationId;
  run: AgentRun;
  type: "run.updated";
}

export interface RunEventCreatedRealtimeEvent extends RealtimeEventBase {
  conversationId?: ConversationId;
  event: RunEvent;
  runId: RunId;
  type: "run.event.created";
}

export interface TaskUpdatedRealtimeEvent extends RealtimeEventBase {
  conversationId: ConversationId;
  goal?: ConversationGoal;
  goalId?: ConversationGoalId;
  taskId?: string;
  type: "task.updated";
}

export interface ArtifactCreatedRealtimeEvent extends RealtimeEventBase {
  artifact: ConversationArtifact;
  conversationId: ConversationId;
  type: "artifact.created";
}

export interface ArtifactActionUpdatedRealtimeEvent extends RealtimeEventBase {
  action: ConversationArtifactAction;
  artifactId: ConversationArtifactId;
  conversationId: ConversationId;
  type: "artifact.action.updated";
}

export type RealtimeEvent =
  | ConversationUpdatedRealtimeEvent
  | ConversationMessageCreatedRealtimeEvent
  | ConversationMessageUpdatedRealtimeEvent
  | RunUpdatedRealtimeEvent
  | RunEventCreatedRealtimeEvent
  | TaskUpdatedRealtimeEvent
  | ArtifactCreatedRealtimeEvent
  | ArtifactActionUpdatedRealtimeEvent;
