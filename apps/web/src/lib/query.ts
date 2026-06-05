import { QueryClient } from '@tanstack/react-query'
import {
  apiRequest,
  type AgentDetails,
  type AgentRun,
  type AgentRunSummary,
  type AuthResponse,
  type Conversation,
  type ConversationArtifact,
  type ConversationDeployment,
  type ConversationGoal,
  type ConversationMessage,
  type DaemonDevice,
  type RunEvent,
} from './api'

export type RecordStatusFilter = 'default' | 'active' | 'archived' | 'all'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 15_000,
    },
  },
})

export const queryKeys = {
  authMe: () => ['auth', 'me'] as const,
  daemonDevices: () => ['daemon', 'devices'] as const,
  agents: (status: RecordStatusFilter = 'default') => ['agents', status] as const,
  conversations: (status: RecordStatusFilter = 'default') => ['conversations', status] as const,
  conversationMessages: (conversationId: string) => ['conversation', conversationId, 'messages'] as const,
  conversationTasks: (conversationId: string) => ['conversation', conversationId, 'tasks'] as const,
  conversationArtifacts: (conversationId: string) => ['conversation', conversationId, 'artifacts'] as const,
  conversationDeployments: (conversationId: string) => ['conversation', conversationId, 'deployments'] as const,
  runs: () => ['runs'] as const,
  run: (runId: string) => ['run', runId] as const,
  runEvents: (runId: string) => ['run', runId, 'events'] as const,
}

function statusQuery(status: RecordStatusFilter): string {
  return status === 'default' ? '' : `?status=${encodeURIComponent(status)}`
}

export async function fetchAuthMe(): Promise<AuthResponse> {
  return apiRequest<AuthResponse>('/auth/me')
}

export async function fetchDaemonDevices(): Promise<DaemonDevice[]> {
  const response = await apiRequest<{ devices: DaemonDevice[] }>('/daemon/devices')
  return response.devices
}

export async function fetchAgents(status: RecordStatusFilter = 'default'): Promise<AgentDetails[]> {
  const response = await apiRequest<{ agents: AgentDetails[] }>(`/agents${statusQuery(status)}`)
  return response.agents
}

export async function fetchConversations(status: RecordStatusFilter = 'default'): Promise<Conversation[]> {
  if (status !== 'default') {
    const response = await apiRequest<{ conversations: Conversation[] }>(`/conversations${statusQuery(status)}`)
    return response.conversations
  }

  const defaultResponse = await apiRequest<{ conversation: Conversation }>('/conversations/default-group', {
    method: 'POST',
  })
  const response = await apiRequest<{ conversations: Conversation[] }>('/conversations')

  return response.conversations.some((conversation) => conversation.id === defaultResponse.conversation.id)
    ? response.conversations
    : [defaultResponse.conversation, ...response.conversations]
}

export async function fetchConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const response = await apiRequest<{ messages: ConversationMessage[] }>(
    `/conversations/${conversationId}/messages`,
  )
  return response.messages
}

export async function fetchConversationTasks(conversationId: string): Promise<ConversationGoal[]> {
  const response = await apiRequest<{ goals: ConversationGoal[] }>(
    `/conversations/${conversationId}/tasks`,
  )
  return response.goals
}

export async function fetchConversationArtifacts(conversationId: string): Promise<ConversationArtifact[]> {
  const response = await apiRequest<{ artifacts: ConversationArtifact[] }>(
    `/conversations/${conversationId}/artifacts`,
  )
  return response.artifacts
}

export async function fetchConversationDeployments(conversationId: string): Promise<ConversationDeployment[]> {
  const response = await apiRequest<{ deployments: ConversationDeployment[] }>(
    `/conversations/${conversationId}/deployments`,
  )
  return response.deployments
}

export async function fetchRuns(): Promise<AgentRunSummary[]> {
  const response = await apiRequest<{ runs: AgentRunSummary[] }>('/runs')
  return response.runs
}

export async function fetchRun(runId: string): Promise<AgentRun> {
  const response = await apiRequest<{ run: AgentRun }>(`/runs/${runId}`)
  return response.run
}

export async function fetchRunEvents(runId: string): Promise<RunEvent[]> {
  const response = await apiRequest<{ events: RunEvent[] }>(`/runs/${runId}/events`)
  return response.events
}
