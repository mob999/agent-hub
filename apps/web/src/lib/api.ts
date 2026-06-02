const apiBaseUrl = import.meta.env.VITE_AGENTHUB_API_URL ?? 'http://localhost:3000'

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path}`
}

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type DeviceStatus = 'online' | 'offline' | string
export type WorkspaceView = 'chat' | 'runs' | 'daemon'
export type RuntimeKind = 'claude-code' | 'codex' | 'opencode' | 'custom'
export type AgentStatus = 'active' | 'disabled' | 'archived'
export type RuntimeBindingStatus = 'pending' | 'ready' | 'unavailable' | 'disabled'
export type AgentWorkspaceStatus = 'pending' | 'ready' | 'missing' | 'unavailable'

export interface RuntimeCapability {
  name: string
  enabled: boolean
  description?: string
}

export interface DaemonRuntime {
  daemonDeviceId: string
  runtimeKind: RuntimeKind
  runtimeVersion?: string
  executablePath?: string
  capabilities: RuntimeCapability[]
  status: 'ready' | 'unavailable' | 'disabled'
  lastSeenAt?: string
}

export interface User {
  id: string
  email: string
  name: string | null
  avatar: string | null
}

export interface AuthResponse {
  user: User
}

interface ApiErrorPayload {
  error?: {
    code?: string
    message?: string
  }
}

export interface DaemonDevice {
  id: string
  status: DeviceStatus
  lastSeenAt: string | null
  runningRunIds: string[]
  runtimes: DaemonRuntime[]
}

export interface Agent {
  id: string
  ownerUserId: string
  name: string
  description?: string
  avatar?: string
  defaultRuntimeKind: RuntimeKind
  status: AgentStatus
  createdAt: string
  updatedAt: string
}

export interface AgentRuntimeBinding {
  agentId: string
  daemonDeviceId: string
  runtimeKind: RuntimeKind
  runtimeVersion?: string
  executablePath?: string
  capabilities: RuntimeCapability[]
  status: RuntimeBindingStatus
  lastSeenAt?: string
  error?: string
}

export interface AgentWorkspace {
  agentId: string
  daemonDeviceId: string
  workspacePath?: string
  status: AgentWorkspaceStatus
  syncMode: 'local-only'
  createdAt: string
  updatedAt: string
  error?: string
}

export interface AgentDetails {
  agent: Agent
  runtimeBinding: AgentRuntimeBinding
  workspace: AgentWorkspace
}

export type AgentMemoryScope = 'long_term' | 'daily' | 'transcript'

export interface AgentMemoryFile {
  content: string
  exists: boolean
  file: string
  label: string
  scope: AgentMemoryScope
}

export interface AgentMemoryResponse {
  date: string
  files: AgentMemoryFile[]
  workspaceReady: boolean
}

export interface UpdateAgentRequest {
  name: string
  description?: string
  avatar?: string
}

export interface UpdateAgentResponse {
  agent: AgentDetails
}

export interface ArchiveAgentResponse {
  agent: AgentDetails
}

export interface RestoreAgentResponse {
  agent: AgentDetails
}

export interface AgentRun {
  id: string
  agentId: string
  daemonDeviceId: string
  status: RunStatus
  createdAt: string
  updatedAt: string
}

export interface AgentRunSummary {
  run: AgentRun
  prompt: string
  conversationId?: string
}

export type ConversationType = 'group' | 'direct'
export type ConversationStatus = 'active' | 'archived'
export type ConversationMessageSenderType = 'user' | 'agent' | 'system'
export type ConversationMessageStatus = 'completed' | 'streaming' | 'failed' | 'cancelled'
export type ConversationGoalStatus = 'active' | 'completed' | 'cancelled' | 'failed'
export type ConversationGoalTaskStatus =
  | 'waiting'
  | 'ready'
  | 'assigned'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'blocked'
export type ConversationArtifactStatus = 'pending' | 'ready' | 'failed' | 'deleted'
export type ConversationArtifactActionType = 'apply' | 'publish' | 'preview'
export type ConversationArtifactActionStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export type SearchSort = 'relevant' | 'recent'
export type SearchTimeFilter = 'any' | '24h' | '7d' | '30d'
export type SearchSenderType = 'user' | 'agent' | 'system'

export interface Conversation {
  id: string
  ownerUserId: string
  type: ConversationType
  key?: string
  title: string
  description?: string
  directAgentId?: string
  agentIds?: string[]
  orchestratorAgentId?: string
  status: ConversationStatus
  createdAt: string
  updatedAt: string
  lastMessageAt?: string
}

export interface ConversationGoalTask {
  id: string
  goalId: string
  index: number
  assigneeAgentId: string
  assigneeRunId?: string
  dispatchMessageId?: string
  title: string
  description?: string
  status: ConversationGoalTaskStatus
  dependsOnTaskIndexes?: number[]
  blockedReason?: string
  summary?: string
  resultArtifactIds?: string[]
  artifacts?: ConversationArtifact[]
  completedAt?: string
  checkpointRunId?: string
  webUrl?: string
  createdAt: string
  updatedAt: string
}

export interface ConversationGoal {
  id: string
  ownerUserId: string
  conversationId: string
  orchestratorAgentId: string
  initialRunId: string
  title: string
  description?: string
  status: ConversationGoalStatus
  summary?: string
  tasks: ConversationGoalTask[]
  completedAt?: string
  webUrl?: string
  createdAt: string
  updatedAt: string
}

export interface ConversationArtifact {
  id: string
  ownerUserId: string
  conversationId: string
  goalId?: string
  goalTaskId?: string
  taskIndex?: number
  runId?: string
  creatorAgentId?: string
  creatorType: 'agent' | 'user'
  creatorUserId?: string
  status: ConversationArtifactStatus
  title: string
  filename: string
  sizeBytes: number
  downloadUrl?: string
  editorUrl?: string
  latestRevisionId?: string
  createdAt: string
  updatedAt: string
}

export interface ConversationArtifactRevision {
  id: string
  artifactId: string
  ownerUserId: string
  conversationId: string
  runId?: string
  editorUserId?: string
  contentHash: string
  summary?: string
  createdAt: string
}

export interface ConversationArtifactAction {
  id: string
  artifactId: string
  revisionId?: string
  type: ConversationArtifactActionType
  status: ConversationArtifactActionStatus
  runId?: string
  error?: string
  result?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ConversationDeployment {
  id: string
  ownerUserId: string
  conversationId: string
  goalId?: string
  taskIndex?: number
  runId: string
  creatorAgentId: string
  title: string
  entrypoint: string
  status: 'ready' | 'failed' | 'deleted'
  url?: string
  createdAt: string
  updatedAt: string
}

export interface ConversationArtifactDetails {
  artifact: ConversationArtifact
  latestRevision?: ConversationArtifactRevision
  actions: ConversationArtifactAction[]
  availableActions: ConversationArtifactActionType[]
}

export interface GetConversationArtifactContentResponse {
  content: string
  revision?: ConversationArtifactRevision
}

export interface CreateConversationArtifactRevisionResponse {
  revision: ConversationArtifactRevision
}

export interface CreateConversationArtifactActionResponse {
  action: ConversationArtifactAction
}

export interface ConversationMessage {
  id: string
  conversationId: string
  senderType: ConversationMessageSenderType
  senderAgentId?: string
  runId?: string
  content: string
  status: ConversationMessageStatus
  error?: string
  attachments?: ConversationMessageAttachment[]
  createdAt: string
  updatedAt: string
}

export interface ConversationMessageAttachment {
  id: string
  messageId: string
  artifactId: string
  type: 'image' | 'file'
  artifact: ConversationArtifact
  createdAt: string
}

export interface ConversationSearchHit {
  type: 'conversation'
  conversationId: string
  conversationType: ConversationType
  title: string
  subtitle: string
  matchedFields: Array<'title' | 'description' | 'agentName' | 'agentDescription'>
  updatedAt: string
}

export interface MessageSearchHit {
  type: 'message'
  conversationId: string
  messageId: string
  senderType: SearchSenderType
  senderAgentId?: string
  senderLabel: string
  conversationLabel: string
  snippet: string
  matchedFields: Array<'content' | 'senderName' | 'conversationTitle'>
  createdAt: string
}

export interface SearchConversationsResponse {
  query: string
  filters: {
    channelId?: string
    senderAgentId?: string
    senderType?: SearchSenderType
    timeFilter: SearchTimeFilter
    sort: SearchSort
    limit: number
    scope: ConversationStatus
  }
  conversationHits: ConversationSearchHit[]
  messageHits: MessageSearchHit[]
  totalCount: number
}

export type SendConversationMessageMode = 'chat' | 'task'

export interface SendConversationMessageRequest {
  content: string
  mode?: SendConversationMessageMode
  agentId?: string
}

export interface SendConversationMessageResponse {
  conversation: Conversation
  messages: {
    user: ConversationMessage
    assistant?: ConversationMessage
    assistants: ConversationMessage[]
  }
  run?: AgentRun
  runs: AgentRun[]
  queueMessageId?: string
  queueMessageIds: string[]
}

export interface CreateGroupConversationRequest {
  title: string
  description?: string
  agentIds: string[]
  orchestratorAgentId?: string
}

export interface CreateGroupConversationResponse {
  conversation: Conversation
}

export interface UpdateGroupConversationRequest {
  title: string
  description?: string
  agentIds: string[]
  orchestratorAgentId?: string
}

export interface UpdateGroupConversationResponse {
  conversation: Conversation
}

export interface ArchiveGroupConversationResponse {
  conversation: Conversation
}

export interface RestoreGroupConversationResponse {
  conversation: Conversation
}

export interface RuntimeRawEvent {
  runtimeKind: RuntimeKind
  nativeType?: string
  payload: unknown
}

export interface RunEvent {
  type: string
  runId: string
  createdAt: string
  content?: string
  status?: RunStatus
  error?: string
  stream?: 'stdout' | 'stderr'
  line?: string
  name?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
  raw?: RuntimeRawEvent
}

export interface LocalRun {
  channelId: string
  agentName?: string
  prompt: string
  run: AgentRun
}

export type RealtimeEvent =
  | {
      type: 'conversation.updated'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId: string
      conversation?: Conversation
    }
  | {
      type: 'conversation.message.created'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId: string
      message: ConversationMessage
    }
  | {
      type: 'run.updated'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId?: string
      run: AgentRun
    }
  | {
      type: 'run.event.created'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId?: string
      runId: string
      event: RunEvent
    }
  | {
      type: 'task.updated'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId: string
      goalId?: string
      taskId?: string
      goal?: ConversationGoal
    }
  | {
      type: 'artifact.created'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId: string
      artifact: ConversationArtifact
    }
  | {
      type: 'artifact.action.updated'
      eventId: string
      ownerUserId: string
      createdAt: string
      conversationId: string
      artifactId: string
      action: ConversationArtifactAction
    }

export class ApiRequestError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = code
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | T | null

  if (!response.ok) {
    const error = (payload as ApiErrorPayload | null)?.error
    throw new ApiRequestError(
      response.status,
      error?.message ?? 'Something went wrong. Please try again.',
      error?.code,
    )
  }

  return payload as T
}
