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
  type GetProjectChangeFileContentResponse,
  type GetProjectFileContentResponse,
  type ListConversationProjectChangesResponse,
  type ListProjectChangeFilesResponse,
  type ListProjectFilesResponse,
  type RunEvent,
  type WelcomeSummary,
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
  projectFiles: (conversationId: string) => ['project', conversationId, 'files'] as const,
  projectFileContent: (conversationId: string, path: string) => ['project', conversationId, 'file', path] as const,
  projectFileContents: (conversationId: string) => ['project', conversationId, 'file'] as const,
  projectChanges: (conversationId: string) => ['project', conversationId, 'changes'] as const,
  projectChangeFiles: (conversationId: string, changeId: string) =>
    ['project', conversationId, 'change', changeId, 'files'] as const,
  projectChangeFileContent: (conversationId: string, changeId: string, path: string) =>
    ['project', conversationId, 'change', changeId, 'file', path] as const,
  welcome: () => ['welcome'] as const,
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

export async function fetchProjectFiles(conversationId: string): Promise<ListProjectFilesResponse> {
  return apiRequest<ListProjectFilesResponse>(`/conversations/${conversationId}/project/files`)
}

export async function fetchProjectFileContent(
  conversationId: string,
  path: string,
): Promise<GetProjectFileContentResponse> {
  const params = new URLSearchParams({ path })
  return apiRequest<GetProjectFileContentResponse>(
    `/conversations/${conversationId}/project/files/content?${params.toString()}`,
  )
}

export async function fetchProjectChanges(
  conversationId: string,
): Promise<ListConversationProjectChangesResponse> {
  return apiRequest<ListConversationProjectChangesResponse>(`/conversations/${conversationId}/project/changes`)
}

export async function fetchProjectChangeFiles(
  conversationId: string,
  changeId: string,
): Promise<ListProjectChangeFilesResponse> {
  return apiRequest<ListProjectChangeFilesResponse>(
    `/conversations/${conversationId}/project/changes/${changeId}/files`,
  )
}

export async function fetchProjectChangeFileContent(
  conversationId: string,
  changeId: string,
  path: string,
): Promise<GetProjectChangeFileContentResponse> {
  const params = new URLSearchParams({ path })
  return apiRequest<GetProjectChangeFileContentResponse>(
    `/conversations/${conversationId}/project/changes/${changeId}/files/content?${params.toString()}`,
  )
}

export async function fetchWelcomeSummary(): Promise<WelcomeSummary> {
  const response = await apiRequest<{ welcome: WelcomeSummary }>('/welcome')
  return response.welcome
}
