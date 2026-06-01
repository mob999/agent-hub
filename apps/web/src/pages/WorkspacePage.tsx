import { InlineNotification, SkeletonText } from '@carbon/react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgentCreateModal } from '../components/AgentCreateModal'
import { AgentEditModal } from '../components/AgentEditModal'
import { AppRail } from '../components/AppRail'
import { ChannelWorkspace } from '../components/ChannelWorkspace'
import { ChatSidebar } from '../components/ChatSidebar'
import { GroupCreateModal } from '../components/GroupCreateModal'
import { GroupEditModal } from '../components/GroupEditModal'
import { GroupOrchestratorModal } from '../components/GroupOrchestratorModal'
import { RealtimeToastStack, type RealtimeToast } from '../components/RealtimeToastStack'
import { SearchWorkspace } from '../components/SearchWorkspace'
import { UserSettingsModal } from '../components/UserSettingsModal'
import {
  ApiRequestError,
  apiRequest,
  apiUrl,
  type ArchiveAgentResponse,
  type ArchiveGroupConversationResponse,
  type AgentDetails,
  type AgentRun,
  type AgentRunSummary,
  type AuthResponse,
  type Conversation,
  type ConversationArtifact,
  type ConversationDeployment,
  type ConversationGoal,
  type ConversationMessage,
  type CreateGroupConversationResponse,
  type DaemonDevice,
  type LocalRun,
  type RealtimeEvent,
  type RuntimeKind,
  type RunEvent,
  type SendConversationMessageMode,
  type SendConversationMessageResponse,
  type RestoreAgentResponse,
  type RestoreGroupConversationResponse,
  type SearchConversationsResponse,
  type SearchSort,
  type SearchTimeFilter,
  type UpdateAgentResponse,
  type UpdateGroupConversationResponse,
  type User,
  type WorkspaceView,
} from '../lib/api'
import { getSearchRouteState, searchRoutePath } from '../lib/search-route'
import { DaemonPage } from './DaemonPage'
import { RunsPage } from './RunsPage'
import type { ChatPanelRoute, GoalRouteState } from '../App'
import type { RoutePath, WorkspaceRoutePath } from './AuthPage'

const workspaceRouteByView: Record<WorkspaceView, WorkspaceRoutePath> = {
  chat: '/chat',
  runs: '/runs',
  daemon: '/daemon',
}
function workspaceViewFromRoute(route: WorkspaceRoutePath): WorkspaceView {
  if (route === '/runs') {
    return 'runs'
  }

  if (route === '/daemon') {
    return 'daemon'
  }

  return 'chat'
}
const conversationDraftsStoragePrefix = 'agenthub.workspace.conversationDrafts'
const authRedirectStorageKey = 'agenthub.auth.redirect'
const realtimeToastDurationMs = 5000
const maxRealtimeToasts = 4

function userScopedStorageKey(prefix: string, userId: string): string {
  return `${prefix}.${userId}`
}

function readConversationDrafts(userId: string): Record<string, string> {
  const rawValue = window.localStorage.getItem(
    userScopedStorageKey(conversationDraftsStoragePrefix, userId),
  )

  if (rawValue === null) {
    return {}
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return {}
  }
}

function readConversationDraft(userId: string, conversationId: string): string {
  return readConversationDrafts(userId)[conversationId] ?? ''
}

function writeConversationDraft(userId: string, conversationId: string, draft: string): void {
  const key = userScopedStorageKey(conversationDraftsStoragePrefix, userId)
  const drafts = readConversationDrafts(userId)
  const trimmedDraft = draft.trim()

  if (trimmedDraft.length === 0) {
    delete drafts[conversationId]
  } else {
    drafts[conversationId] = draft
  }

  if (Object.keys(drafts).length === 0) {
    window.localStorage.removeItem(key)
    return
  }

  window.localStorage.setItem(key, JSON.stringify(drafts))
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function compactMessagePreview(content: string): string {
  const compacted = content.replace(/\s+/g, ' ').trim()

  if (compacted.length === 0) {
    return 'New message'
  }

  return compacted.length > 120 ? `${compacted.slice(0, 117)}...` : compacted
}

function getConversationToastTitle(conversation: Conversation | undefined, agents: AgentDetails[]): string {
  if (conversation === undefined) {
    return 'Conversation'
  }

  if (conversation.type === 'group') {
    return `#${conversation.title}`
  }

  if (conversation.directAgentId !== undefined) {
    const agent = agents.find((item) => item.agent.id === conversation.directAgentId)

    if (agent !== undefined) {
      return agent.agent.name
    }
  }

  return conversation.title
}

function getMessageSenderName(message: ConversationMessage, agents: AgentDetails[]): string {
  if (message.senderAgentId !== undefined) {
    const agent = agents.find((item) => item.agent.id === message.senderAgentId)

    if (agent !== undefined) {
      return agent.agent.name
    }
  }

  return message.senderType === 'system' ? 'AgentHub' : 'Agent'
}

function readCurrentSearchRouteState() {
  return getSearchRouteState(`${window.location.pathname}${window.location.search}`)
}

function toLocalRun(summary: AgentRunSummary, agents: AgentDetails[] = []): LocalRun {
  const runAgent = agents.find((agent) => agent.agent.id === summary.run.agentId)

  return {
    channelId: summary.conversationId ?? 'runs',
    agentName: runAgent?.agent.name,
    prompt: summary.prompt,
    run: summary.run,
  }
}

interface WorkspacePageProps {
  chatConversationId?: string | null
  chatPanelRoute?: ChatPanelRoute
  focusedMessageId?: string | null
  goalRoute?: GoalRouteState | null
  route: WorkspaceRoutePath
  editorRoute?: { artifactId: string | null; conversationId: string } | null
  navigate: (path: RoutePath) => void
}

export function WorkspacePage({
  route,
  chatConversationId = null,
  chatPanelRoute = null,
  focusedMessageId = null,
  goalRoute = null,
  editorRoute = null,
  navigate,
}: WorkspacePageProps) {
  const initialSearchRouteState = readCurrentSearchRouteState()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [devices, setDevices] = useState<DaemonDevice[]>([])
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDetails[]>([])
  const [archivedAgents, setArchivedAgents] = useState<AgentDetails[]>([])
  const [agentError, setAgentError] = useState<string | null>(null)
  const [agentCreateError, setAgentCreateError] = useState<string | null>(null)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)
  const [agentModalOpen, setAgentModalOpen] = useState(false)
  const [agentEditError, setAgentEditError] = useState<string | null>(null)
  const [isSavingAgent, setIsSavingAgent] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null)
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [groupEditError, setGroupEditError] = useState<string | null>(null)
  const [isSavingGroup, setIsSavingGroup] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [defaultAgentDaemonId, setDefaultAgentDaemonId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([])
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ConversationMessage[]>>({})
  const [goalsByConversation, setGoalsByConversation] = useState<Record<string, ConversationGoal[]>>({})
  const [artifactsByConversation, setArtifactsByConversation] = useState<Record<string, ConversationArtifact[]>>({})
  const [deploymentsByConversation, setDeploymentsByConversation] = useState<Record<string, ConversationDeployment[]>>({})
  const [unreadByConversationId, setUnreadByConversationId] = useState<Record<string, number>>({})
  const [realtimeToasts, setRealtimeToasts] = useState<RealtimeToast[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [runs, setRuns] = useState<LocalRun[]>([])
  const [eventsByRun, setEventsByRun] = useState<Record<string, RunEvent[]>>({})
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isCreatingRun, setIsCreatingRun] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [accountExpanded, setAccountExpanded] = useState(false)
  const [savedOpen, setSavedOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState(initialSearchRouteState.query)
  const [searchSelectedChannelId, setSearchSelectedChannelId] = useState<string | undefined>(initialSearchRouteState.channelId)
  const [searchSelectedSender, setSearchSelectedSender] = useState<string | undefined>(initialSearchRouteState.sender)
  const [searchSort, setSearchSort] = useState<SearchSort>(initialSearchRouteState.sort)
  const [searchTime, setSearchTime] = useState<SearchTimeFilter>(initialSearchRouteState.time)
  const [searchResults, setSearchResults] = useState<SearchConversationsResponse | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [isSearchLoading, setIsSearchLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [isSavingSettings, setIsSavingSettings] = useState(false)
  const notifiedMessageIdsRef = useRef<Set<string>>(new Set())
  const activeConversationIdRef = useRef<string | null>(null)
  const agentsRef = useRef<AgentDetails[]>([])
  const conversationsRef = useRef<Conversation[]>([])

  const routeConversationId = editorRoute?.conversationId ?? chatConversationId
  const isSearchRoute = route === '/chat/search'
  const activeView = workspaceViewFromRoute(route)
  const activeRunCount = useMemo(
    () =>
      runs.filter((localRun) => localRun.run.status === 'queued' || localRun.run.status === 'running')
        .length,
    [runs],
  )
  const orderedRuns = useMemo(() => runs, [runs])
  const readyAgentCount = useMemo(() => agents.filter(isAgentReady).length, [agents])
  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === activeConversationId) ?? null,
    [activeConversationId, conversations],
  )
  const editingAgent = useMemo(
    () => agents.find((agent) => agent.agent.id === editingAgentId) ?? null,
    [agents, editingAgentId],
  )
  const editingGroup = useMemo(
    () => conversations.find((conversation) => conversation.id === editingGroupId) ?? null,
    [conversations, editingGroupId],
  )
  const canEditActiveConversation =
    activeConversation !== null &&
    (activeConversation.type === 'direct'
      ? activeConversation.directAgentId !== undefined
      : true)
  const activeConversationMessages = useMemo(
    () => (activeConversationId === null ? [] : messagesByConversation[activeConversationId] ?? []),
    [activeConversationId, messagesByConversation],
  )
  const activeConversationGoals = useMemo(
    () => (activeConversationId === null ? [] : goalsByConversation[activeConversationId] ?? []),
    [activeConversationId, goalsByConversation],
  )
  const focusedGoalRoute = useMemo(() =>
    goalRoute !== null && goalRoute.conversationId === activeConversation?.id
      ? { goalId: goalRoute.goalId, taskIndex: goalRoute.taskIndex }
      : null,
    [
      activeConversation?.id,
      goalRoute,
    ],
  )
  const activeConversationArtifacts = useMemo(
    () => (activeConversationId === null ? [] : artifactsByConversation[activeConversationId] ?? []),
    [activeConversationId, artifactsByConversation],
  )
  const activeConversationDeployments = useMemo(
    () => (activeConversationId === null ? [] : deploymentsByConversation[activeConversationId] ?? []),
    [activeConversationId, deploymentsByConversation],
  )

  const clearConversationUnread = useCallback((conversationId: string) => {
    setUnreadByConversationId((current) => {
      if ((current[conversationId] ?? 0) === 0) {
        return current
      }

      const next = { ...current }
      delete next[conversationId]

      return next
    })
  }, [])

  const activateConversation = useCallback((conversationId: string) => {
    if (user) {
      setPrompt(readConversationDraft(user.id, conversationId))
    } else {
      setPrompt('')
    }

    setActiveConversationId(conversationId)
    clearConversationUnread(conversationId)
  }, [clearConversationUnread, user])

  const clearActiveConversation = useCallback(() => {
    setPrompt('')
    setSelectedRunId(null)
    setActiveConversationId(null)
    navigate('/chat')
  }, [navigate])

  const updatePrompt = useCallback((value: string) => {
    setPrompt(value)

    if (user && activeConversationId !== null) {
      writeConversationDraft(user.id, activeConversationId, value)
    }
  }, [activeConversationId, user])

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    agentsRef.current = agents
  }, [agents])

  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  useEffect(() => {
    if (realtimeToasts.length === 0) {
      return
    }

    const nextExpiry = Math.min(...realtimeToasts.map((toast) => toast.expiresAt))
    const timeoutId = window.setTimeout(() => {
      const now = Date.now()
      setRealtimeToasts((current) => current.filter((toast) => toast.expiresAt > now))
    }, Math.max(nextExpiry - Date.now(), 0))

    return () => window.clearTimeout(timeoutId)
  }, [realtimeToasts])

  const loadDevices = useCallback(async () => {
    try {
      const response = await apiRequest<{ devices: DaemonDevice[] }>('/daemon/devices')
      setDevices(response.devices)
      setDeviceError(null)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setDeviceError(error.message)
      } else {
        setDeviceError('Unable to load daemon devices.')
      }
    }
  }, [])

  const loadAgents = useCallback(async () => {
    try {
      const response = await apiRequest<{ agents: AgentDetails[] }>('/agents')
      setAgents(response.agents)
      setAgentError(null)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentError(error.message)
      } else {
        setAgentError('Unable to load agents.')
      }
    }
  }, [])

  const loadArchivedAgents = useCallback(async () => {
    try {
      const response = await apiRequest<{ agents: AgentDetails[] }>('/agents?status=archived')
      setArchivedAgents(response.agents)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentError(error.message)
      } else {
        setAgentError('Unable to load archived agents.')
      }
    }
  }, [])

  const loadConversations = useCallback(async () => {
    try {
      const defaultResponse = await apiRequest<{ conversation: Conversation }>('/conversations/default-group', {
        method: 'POST',
      })
      const response = await apiRequest<{ conversations: Conversation[] }>('/conversations')
      const conversations = response.conversations.some(
        (conversation) => conversation.id === defaultResponse.conversation.id,
      )
        ? response.conversations
        : [defaultResponse.conversation, ...response.conversations]

      setConversations(conversations)
      const conversationIds = new Set(conversations.map((conversation) => conversation.id))
      const nextConversationId =
        routeConversationId !== null && conversationIds.has(routeConversationId)
          ? routeConversationId
          : routeConversationId === null && route === '/chat'
            ? conversations[0]?.id ?? null
            : null

      if (routeConversationId === null && route === '/chat' && nextConversationId !== null) {
        navigate(`/chat/${encodeURIComponent(nextConversationId)}` as RoutePath)
      }

      if (nextConversationId !== activeConversationId) {
        if (nextConversationId === null || !user) {
          setPrompt('')
          setActiveConversationId(nextConversationId)
        } else {
          activateConversation(nextConversationId)
        }
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to load conversations.')
      }
    }
  }, [activateConversation, activeConversationId, navigate, route, routeConversationId, user])

  const loadArchivedConversations = useCallback(async () => {
    try {
      const response = await apiRequest<{ conversations: Conversation[] }>('/conversations?status=archived')
      setArchivedConversations(response.conversations)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to load archived conversations.')
      }
    }
  }, [])

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const response = await apiRequest<{ messages: ConversationMessage[] }>(
        `/conversations/${conversationId}/messages`,
      )
      setMessagesByConversation((current) => ({
        ...current,
        [conversationId]: response.messages,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [])

  const loadTasks = useCallback(async (conversationId: string) => {
    try {
      const response = await apiRequest<{ goals: ConversationGoal[] }>(
        `/conversations/${conversationId}/tasks`,
      )
      setGoalsByConversation((current) => ({
        ...current,
        [conversationId]: response.goals,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [])

  const loadArtifacts = useCallback(async (conversationId: string) => {
    try {
      const response = await apiRequest<{ artifacts: ConversationArtifact[] }>(
        `/conversations/${conversationId}/artifacts`,
      )
      setArtifactsByConversation((current) => ({
        ...current,
        [conversationId]: response.artifacts,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [])

  const loadDeployments = useCallback(async (conversationId: string) => {
    try {
      const response = await apiRequest<{ deployments: ConversationDeployment[] }>(
        `/conversations/${conversationId}/deployments`,
      )
      setDeploymentsByConversation((current) => ({
        ...current,
        [conversationId]: response.deployments,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const response = await apiRequest<{ runs: AgentRunSummary[] }>('/runs')
      const loadedRuns = response.runs.map((run) => toLocalRun(run))

      setRuns(loadedRuns)
      setSelectedRunId((current) => {
        if (current !== null && loadedRuns.some((localRun) => localRun.run.id === current)) {
          return current
        }

        return loadedRuns[0]?.run.id ?? null
      })
      setRunError(null)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to load runs.')
      }
    }
  }, [])

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const [runResponse, eventResponse] = await Promise.all([
        apiRequest<{ run: AgentRun }>(`/runs/${runId}`),
        apiRequest<{ events: RunEvent[] }>(`/runs/${runId}/events`),
      ])

      setRuns((current) =>
        current.map((localRun) =>
          localRun.run.id === runId
            ? {
                ...localRun,
                run: runResponse.run,
              }
            : localRun,
        ),
      )
      setEventsByRun((current) => ({
        ...current,
        [runId]: eventResponse.events,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [])

  useEffect(() => {
    let active = true

    const loadUser = async () => {
      try {
        const response = await apiRequest<AuthResponse>('/auth/me')
        if (!active) {
          return
        }
        setUser(response.user)
        setAuthError(null)
      } catch (error) {
        if (!active) {
          return
        }
        if (error instanceof ApiRequestError && error.status === 401) {
          window.sessionStorage.setItem(authRedirectStorageKey, window.location.pathname)
          navigate('/login')
          return
        }
        setAuthError('Unable to load your session.')
      } finally {
        if (active) {
          setAuthLoading(false)
        }
      }
    }

    void loadUser()

    return () => {
      active = false
    }
  }, [navigate])

  useEffect(() => {
    if (!user) {
      return
    }

    const initialTimer = window.setTimeout(() => {
      void loadDevices()
    }, 0)
    const timer = window.setInterval(() => {
      void loadDevices()
    }, 10000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [loadDevices, user])

  useEffect(() => {
    if (!user) {
      return
    }

    const initialTimer = window.setTimeout(() => {
      void loadAgents()
      void loadArchivedAgents()
    }, 0)
    const timer = window.setInterval(() => {
      void loadAgents()
      void loadArchivedAgents()
    }, 10000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [loadAgents, loadArchivedAgents, user])

  useEffect(() => {
    if (!user) {
      return
    }

    const initialTimer = window.setTimeout(() => {
      void loadConversations()
      void loadArchivedConversations()
    }, 0)

    return () => {
      window.clearTimeout(initialTimer)
    }
  }, [loadArchivedConversations, loadConversations, user])

  useEffect(() => {
    if (!user) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadRuns()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [loadRuns, user])

  useEffect(() => {
    if (activeConversationId === null) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadMessages(activeConversationId)
      void loadTasks(activeConversationId)
      void loadArtifacts(activeConversationId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeConversationId, loadArtifacts, loadMessages, loadTasks])

  useEffect(() => {
    if (!user || routeConversationId === null) {
      return
    }

    const timer = window.setTimeout(() => {
      activateConversation(routeConversationId)
      void loadMessages(routeConversationId)
      void loadTasks(routeConversationId)
      void loadArtifacts(routeConversationId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    activateConversation,
    loadArtifacts,
    loadMessages,
    loadTasks,
    routeConversationId,
    user,
  ])

  useEffect(() => {
    if (!user || !isSearchRoute) {
      return
    }

    const trimmedQuery = searchQuery.trim()
    if (trimmedQuery.length === 0) {
      return
    }

    let active = true

    const timer = window.setTimeout(() => {
      if (!active) {
        return
      }
      setIsSearchLoading(true)
      setSearchError(null)
      void (async () => {
        try {
          const params = new URLSearchParams()
          params.set('query', trimmedQuery)
          params.set('sort', searchSort)
          params.set('timeFilter', searchTime)
          if (searchSelectedChannelId) {
            params.set('channelId', searchSelectedChannelId)
          }
          if (searchSelectedSender === 'user') {
            params.set('senderType', 'user')
          } else if (searchSelectedSender) {
            params.set('senderType', 'agent')
            params.set('senderAgentId', searchSelectedSender)
          }
          const response = await apiRequest<SearchConversationsResponse>(`/search?${params.toString()}`)
          if (!active) {
            return
          }
          setSearchResults(response)
        } catch (error) {
          if (!active) {
            return
          }
          if (error instanceof ApiRequestError) {
            setSearchError(error.message)
          } else {
            setSearchError('Unable to search conversations.')
          }
        } finally {
          if (active) {
            setIsSearchLoading(false)
          }
        }
      })()
    }, 150)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [
    isSearchRoute,
    searchQuery,
    searchSelectedChannelId,
    searchSelectedSender,
    searchSort,
    searchTime,
    user,
  ])

  useEffect(() => {
    if (!isSearchRoute) {
      return
    }

    const onPopState = () => {
      const next = readCurrentSearchRouteState()
      setSearchQuery(next.query)
      setSearchSelectedChannelId(next.channelId)
      setSearchSelectedSender(next.sender)
      setSearchSort(next.sort)
      setSearchTime(next.time)

      if (next.query.trim().length === 0) {
        setSearchResults(null)
        setSearchError(null)
        setIsSearchLoading(false)
      }
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isSearchRoute])

  useEffect(() => {
    if (!agents.some((agent) => agent.runtimeBinding.status === 'pending' || agent.workspace.status === 'pending')) {
      return
    }

    const timer = window.setInterval(() => {
      void loadAgents()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [agents, loadAgents])

  useEffect(() => {
    if (selectedRunId === null) {
      return
    }

    const timer = window.setTimeout(() => {
      void refreshRun(selectedRunId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshRun, selectedRunId])

  const submitRun = async (
    event: FormEvent<HTMLFormElement>,
    mode: SendConversationMessageMode,
  ) => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isCreatingRun) {
      return
    }

    if (activeConversation === null) {
      setRunError('Select a conversation before sending a message.')
      return
    }

    const selectedAgent =
      activeConversation.type === 'direct'
        ? agents.find((agent) => agent.agent.id === activeConversation.directAgentId) ?? null
        : null

    if (
      activeConversation.type === 'direct' &&
      (selectedAgent === null || !isAgentReady(selectedAgent))
    ) {
      setRunError(
        'Selected agent is not ready to receive messages.',
      )
      return
    }

    if (
      activeConversation.type === 'group' &&
      mode === 'task' &&
      activeConversation.orchestratorAgentId === undefined
    ) {
      setRunError('Set a group orchestrator in settings before using Task mode.')
      return
    }

    setRunError(null)
    setIsCreatingRun(true)

    try {
      const response = await apiRequest<SendConversationMessageResponse>(
        `/conversations/${activeConversation.id}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content: trimmedPrompt,
            mode,
          }),
        },
      )
      const responseRuns = response.runs.length > 0
        ? response.runs
        : response.run === undefined
          ? []
          : [response.run]
      const assistantMessages = [
        ...response.messages.assistants,
        ...(response.messages.assistant === undefined ||
        response.messages.assistants.some((message) => message.id === response.messages.assistant?.id)
          ? []
          : [response.messages.assistant]),
      ]

      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ])
      setMessagesByConversation((current) => {
        const currentMessages = current[activeConversation.id] ?? []
        const nextMessages = [
          ...currentMessages.filter(
            (message) =>
              message.id !== response.messages.user.id &&
              !assistantMessages.some((assistant) => assistant.id === message.id),
          ),
          response.messages.user,
          ...assistantMessages,
        ]

        return {
          ...current,
          [activeConversation.id]: nextMessages,
        }
      })
      setRuns((current) => [
        ...responseRuns.map((run) => {
          const runAgent = agents.find((agent) => agent.agent.id === run.agentId)

          return {
            channelId: activeConversation.id,
            agentName: runAgent?.agent.name,
            prompt: trimmedPrompt,
            run,
          }
        }),
        ...current,
      ])
      setSelectedRunId(responseRuns[0]?.id ?? null)
      if (user) {
        writeConversationDraft(user.id, activeConversation.id, '')
      }
      setPrompt('')
      responseRuns.forEach((run) => {
        void refreshRun(run.id)
      })
      void loadMessages(activeConversation.id)
      void loadTasks(activeConversation.id)
      void loadArtifacts(activeConversation.id)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to create the run. Try again in a moment.')
      }
    } finally {
      setIsCreatingRun(false)
    }
  }

  const logout = async () => {
    await apiRequest<{ ok: true }>('/auth/logout', { method: 'POST' }).catch(() => null)
    notifiedMessageIdsRef.current.clear()
    setUnreadByConversationId({})
    setRealtimeToasts([])
    navigate('/login')
  }

  const updateUserSettings = async (input: { avatar: string }) => {
    setSettingsError(null)
    setIsSavingSettings(true)

    try {
      const response = await apiRequest<AuthResponse>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(input),
      })

      setUser(response.user)
      setSettingsOpen(false)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSettingsError(error.message)
      } else {
        setSettingsError('Unable to save settings. Try again in a moment.')
      }
    } finally {
      setIsSavingSettings(false)
    }
  }

  const refreshWorkspace = () => {
    void loadDevices()
    void loadAgents()
    void loadArchivedAgents()
    void loadConversations()
    void loadArchivedConversations()
    void loadRuns()
    if (activeConversationId !== null) {
      void loadMessages(activeConversationId)
      void loadTasks(activeConversationId)
      void loadArtifacts(activeConversationId)
    }
    runs.forEach((localRun) => {
      void refreshRun(localRun.run.id)
    })
  }

  useEffect(() => {
    if (!user) {
      return
    }

    const refreshAfterReconnect = () => {
      void loadConversations()
      void loadArchivedConversations()
      void loadRuns()

      if (activeConversationId !== null) {
        void loadMessages(activeConversationId)
        void loadTasks(activeConversationId)
        void loadArtifacts(activeConversationId)
      }
    }
    const upsertMessage = (message: ConversationMessage) => {
      setMessagesByConversation((current) => {
        const currentMessages = current[message.conversationId] ?? []
        const nextMessages = [
          ...currentMessages.filter((item) => item.id !== message.id),
          message,
        ].sort((first, second) =>
          new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
        )

        return {
          ...current,
          [message.conversationId]: nextMessages,
        }
      })
    }
    const notifyRealtimeMessage = (message: ConversationMessage) => {
      if (notifiedMessageIdsRef.current.has(message.id)) {
        return
      }

      notifiedMessageIdsRef.current.add(message.id)

      if (
        message.senderType === 'user' ||
        message.conversationId === activeConversationIdRef.current
      ) {
        return
      }

      setUnreadByConversationId((current) => ({
        ...current,
        [message.conversationId]: (current[message.conversationId] ?? 0) + 1,
      }))

      const agentsSnapshot = agentsRef.current
      const conversation = conversationsRef.current.find(
        (item) => item.id === message.conversationId,
      )
      const toast: RealtimeToast = {
        id: message.id,
        conversationId: message.conversationId,
        title: getConversationToastTitle(conversation, agentsSnapshot),
        senderName: getMessageSenderName(message, agentsSnapshot),
        preview: compactMessagePreview(message.content),
        expiresAt: Date.now() + realtimeToastDurationMs,
      }

      setRealtimeToasts((current) => [
        ...current.filter((item) => item.id !== toast.id),
        toast,
      ].slice(-maxRealtimeToasts))
    }
    const upsertRun = (event: Extract<RealtimeEvent, { type: 'run.updated' }>) => {
      setRuns((current) => {
        const existing = current.find((localRun) => localRun.run.id === event.run.id)
        const runAgent = agentsRef.current.find((agent) => agent.agent.id === event.run.agentId)
        const nextRun: LocalRun = {
          channelId: event.conversationId ?? existing?.channelId ?? 'runs',
          agentName: runAgent?.agent.name ?? existing?.agentName,
          prompt: existing?.prompt ?? '',
          run: event.run,
        }

        return [
          nextRun,
          ...current.filter((localRun) => localRun.run.id !== event.run.id),
        ]
      })
    }
    const upsertRunEvent = (event: Extract<RealtimeEvent, { type: 'run.event.created' }>) => {
      setEventsByRun((current) => {
        const currentEvents = current[event.runId] ?? []
        const exists = currentEvents.some(
          (item) =>
            item.type === event.event.type &&
            item.createdAt === event.event.createdAt &&
            item.runId === event.event.runId,
        )

        return {
          ...current,
          [event.runId]: exists ? currentEvents : [...currentEvents, event.event],
        }
      })
    }
    const upsertGoal = (goal: ConversationGoal) => {
      setGoalsByConversation((current) => {
        const currentGoals = current[goal.conversationId] ?? []

        return {
          ...current,
          [goal.conversationId]: [
            goal,
            ...currentGoals.filter((item) => item.id !== goal.id),
          ],
        }
      })
    }
    const upsertArtifact = (artifact: ConversationArtifact) => {
      setArtifactsByConversation((current) => {
        const currentArtifacts = current[artifact.conversationId] ?? []

        return {
          ...current,
          [artifact.conversationId]: [
            artifact,
            ...currentArtifacts.filter((item) => item.id !== artifact.id),
          ],
        }
      })
    }
    const handleRealtimeEvent = (event: RealtimeEvent) => {
      switch (event.type) {
        case 'conversation.updated':
          if (event.conversation !== undefined) {
            setConversations((current) => [
              event.conversation as Conversation,
              ...current.filter((conversation) => conversation.id !== event.conversationId),
            ])
          } else {
            setConversations((current) => {
              const existing = current.find((conversation) => conversation.id === event.conversationId)

              if (existing === undefined) {
                return current
              }

              return [
                {
                  ...existing,
                  lastMessageAt: event.createdAt,
                  updatedAt: event.createdAt,
                },
                ...current.filter((conversation) => conversation.id !== event.conversationId),
              ]
            })
          }
          break
        case 'conversation.message.created':
          upsertMessage(event.message)
          notifyRealtimeMessage(event.message)
          break
        case 'run.updated':
          upsertRun(event)
          break
        case 'run.event.created':
          upsertRunEvent(event)
          break
        case 'task.updated':
          if (event.goal !== undefined) {
            upsertGoal(event.goal)
          } else {
            void loadTasks(event.conversationId)
          }
          break
        case 'artifact.created':
          upsertArtifact(event.artifact)
          break
        case 'artifact.action.updated':
          void loadArtifacts(event.conversationId)
          break
      }
    }
    const source = new EventSource(apiUrl('/events'), { withCredentials: true })
    const eventTypes: RealtimeEvent['type'][] = [
      'conversation.updated',
      'conversation.message.created',
      'run.updated',
      'run.event.created',
      'task.updated',
      'artifact.created',
      'artifact.action.updated',
    ]

    source.addEventListener('connected', refreshAfterReconnect)
    eventTypes.forEach((eventType) => {
      source.addEventListener(eventType, (messageEvent) => {
        const event = JSON.parse((messageEvent as MessageEvent).data) as RealtimeEvent
        handleRealtimeEvent(event)
      })
    })

    return () => {
      source.close()
    }
  }, [
    activeConversationId,
    agents,
    loadArchivedConversations,
    loadArtifacts,
    loadConversations,
    loadMessages,
    loadRuns,
    loadTasks,
    user,
  ])

  const navigateToView = (view: WorkspaceView) => {
    navigate(workspaceRouteByView[view])
  }
  const openSearch = () => {
    const path = searchRoutePath({
      channelId: searchSelectedChannelId,
      query: searchQuery,
      sender: searchSelectedSender,
      sort: searchSort,
      time: searchTime,
    })
    window.history.pushState({}, '', path)
    navigate('/chat/search')
  }
  const openRun = (runId: string) => {
    setSelectedRunId(runId)
    navigate('/runs')
    void loadRuns()
    void refreshRun(runId)
  }

  const openConversationEditor = (conversationId: string, artifactId?: string | null) => {
    navigate(
      artifactId
        ? `/editor/${encodeURIComponent(conversationId)}/${encodeURIComponent(artifactId)}` as RoutePath
        : `/editor/${encodeURIComponent(conversationId)}` as RoutePath,
    )
  }
  const openArtifactEditor = (artifactId: string) => {
    const artifact = Object.values(artifactsByConversation)
      .flat()
      .find((item) => item.id === artifactId)
    const conversationId = artifact?.conversationId ?? activeConversationId

    if (conversationId !== null) {
      openConversationEditor(conversationId, artifactId)
    }
  }
  const closeArtifactEditor = () => {
    navigate(
      activeConversationId === null
        ? '/chat'
        : `/chat/${encodeURIComponent(activeConversationId)}` as RoutePath,
    )
  }
  const openGoalRoute = (conversationId: string, goalId: string, taskIndex?: number | null) => {
    navigate(
      taskIndex === undefined || taskIndex === null
        ? `/chat/${encodeURIComponent(conversationId)}/goals/${encodeURIComponent(goalId)}` as RoutePath
        : `/chat/${encodeURIComponent(conversationId)}/goals/${encodeURIComponent(goalId)}/tasks/${taskIndex}` as RoutePath,
    )
  }
  const openTasksRoute = (conversationId: string) => {
    navigate(`/chat/${encodeURIComponent(conversationId)}/tasks` as RoutePath)
  }
  const openDeploymentsRoute = (conversationId: string) => {
    navigate(`/chat/${encodeURIComponent(conversationId)}/deployments` as RoutePath)
  }
  const openMessageRoute = (conversationId: string, messageId: string) => {
    navigate(`/chat/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}` as RoutePath)
  }
  const closeConversationRoute = (conversationId: string) => {
    navigate(`/chat/${encodeURIComponent(conversationId)}` as RoutePath)
  }
  const selectConversation = (conversationId: string) => {
    if (activeConversationId !== conversationId) {
      setSelectedRunId(null)
    }
    setRunError(null)
    navigate(`/chat/${encodeURIComponent(conversationId)}` as RoutePath)
    activateConversation(conversationId)
    void loadMessages(conversationId)
    void loadTasks(conversationId)
    void loadArtifacts(conversationId)
  }
  const selectAgentConversation = async (agentId: string) => {
    try {
      const response = await apiRequest<{ conversation: Conversation }>('/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ agentId }),
      })

      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ])
      selectConversation(response.conversation.id)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to open the conversation.')
      }
    }
  }
  const dismissRealtimeToast = (toastId: string) => {
    setRealtimeToasts((current) => current.filter((toast) => toast.id !== toastId))
  }
  const openRealtimeToastConversation = (conversationId: string) => {
    setRealtimeToasts((current) =>
      current.filter((toast) => toast.conversationId !== conversationId),
    )
    selectConversation(conversationId)
  }
  const openCreateAgent = (daemonDeviceId?: string) => {
    setDefaultAgentDaemonId(daemonDeviceId ?? null)
    setAgentCreateError(null)
    setAgentModalOpen(true)
  }
  const openCreateGroup = () => {
    setGroupCreateError(null)
    setGroupModalOpen(true)
  }
  const openEditActiveConversation = () => {
    if (activeConversation === null) {
      return
    }

    if (activeConversation.type === 'direct' && activeConversation.directAgentId) {
      setAgentEditError(null)
      setEditingAgentId(activeConversation.directAgentId)
      return
    }

    if (activeConversation.type === 'group') {
      setGroupEditError(null)
      setEditingGroupId(activeConversation.id)
    }
  }
  const createGroup = async (input: { title: string; description?: string; agentIds: string[]; orchestratorAgentId?: string }) => {
    setIsCreatingGroup(true)
    setGroupCreateError(null)

    try {
      const response = await apiRequest<CreateGroupConversationResponse>('/conversations/groups', {
        method: 'POST',
        body: JSON.stringify(input),
      })

      setConversations((current) => {
        const existingConversation = current.find(
          (conversation) => conversation.id === response.conversation.id,
        )
        const conversation = {
          ...response.conversation,
          agentIds: response.conversation.agentIds ?? existingConversation?.agentIds,
        }

        return [
          conversation,
          ...current.filter((item) => item.id !== response.conversation.id),
        ]
      })
      setMessagesByConversation((current) => ({
        ...current,
        [response.conversation.id]: [],
      }))
      if (user) {
        writeConversationDraft(user.id, response.conversation.id, '')
      }
      setSelectedRunId(null)
      selectConversation(response.conversation.id)
      setGroupModalOpen(false)
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setGroupCreateError(
          error.code === 'GROUP_ALREADY_EXISTS'
            ? 'A group with this name already exists.'
            : error.message,
        )
      } else {
        setGroupCreateError('Unable to create the group. Try again in a moment.')
      }
    } finally {
      setIsCreatingGroup(false)
    }
  }
  const updateGroup = async (input: { title: string; description?: string; agentIds: string[]; orchestratorAgentId?: string }) => {
    if (editingGroup === null) {
      return
    }

    setIsSavingGroup(true)
    setGroupEditError(null)

    try {
      const response = await apiRequest<UpdateGroupConversationResponse>(
        `/conversations/groups/${editingGroup.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
        },
      )

      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ])
      activateConversation(response.conversation.id)
      setEditingGroupId(null)
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setGroupEditError(
          error.code === 'GROUP_ALREADY_EXISTS'
            ? 'A group with this name already exists.'
            : error.message,
        )
      } else {
        setGroupEditError('Unable to update the group. Try again in a moment.')
      }
    } finally {
      setIsSavingGroup(false)
    }
  }
  const updateGroupOrchestrator = async (input: { orchestratorAgentId?: string }) => {
    if (editingGroup === null) {
      return
    }

    setIsSavingGroup(true)
    setGroupEditError(null)

    try {
      const response = await apiRequest<UpdateGroupConversationResponse>(
        `/conversations/${editingGroup.id}/orchestrator`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
        },
      )

      setConversations((current) =>
        current.map((conversation) =>
          conversation.id === response.conversation.id ? response.conversation : conversation,
        ),
      )
      setEditingGroupId(null)
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setGroupEditError(error.message)
      } else {
        setGroupEditError('Unable to update the group. Try again in a moment.')
      }
    } finally {
      setIsSavingGroup(false)
    }
  }
  const archiveGroup = async () => {
    if (editingGroup === null || editingGroup.key === 'all') {
      return
    }

    const archivedGroupId = editingGroup.id
    setIsSavingGroup(true)
    setGroupEditError(null)

    try {
      const response = await apiRequest<ArchiveGroupConversationResponse>(
        `/conversations/groups/${archivedGroupId}/archive`,
        { method: 'PATCH' },
      )

      setConversations((current) =>
        current.filter((conversation) => conversation.id !== archivedGroupId),
      )
      setArchivedConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== archivedGroupId),
      ])
      if (activeConversationId === archivedGroupId) {
        clearActiveConversation()
      }
      setEditingGroupId(null)
      void loadConversations()
      void loadArchivedConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setGroupEditError(error.message)
      } else {
        setGroupEditError('Unable to archive the group. Try again in a moment.')
      }
    } finally {
      setIsSavingGroup(false)
    }
  }
  const restoreGroup = async (conversationId: string) => {
    setRunError(null)

    try {
      const response = await apiRequest<RestoreGroupConversationResponse>(
        `/conversations/groups/${conversationId}/restore`,
        { method: 'PATCH' },
      )

      setArchivedConversations((current) =>
        current.filter((conversation) => conversation.id !== conversationId),
      )
      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== conversationId),
      ])
      void loadConversations()
      void loadArchivedConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to restore the group. Try again in a moment.')
      }
    }
  }
  const createAgent = async (input: {
    name: string
    description?: string
    avatar: string
    daemonDeviceId: string
    runtimeKind: RuntimeKind
  }) => {
    setIsCreatingAgent(true)
    setAgentCreateError(null)

    try {
      const response = await apiRequest<{ agent: AgentDetails; queueMessageId: string }>('/agents', {
        method: 'POST',
        body: JSON.stringify(input),
      })

      setAgents((current) => [response.agent, ...current])
      setSelectedRunId(null)
      const conversationResponse = await apiRequest<{ conversation: Conversation }>('/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ agentId: response.agent.agent.id }),
      })
      setConversations((current) => [
        conversationResponse.conversation,
        ...current.filter((conversation) => conversation.id !== conversationResponse.conversation.id),
      ])
      if (user) {
        writeConversationDraft(user.id, conversationResponse.conversation.id, '')
      }
      selectConversation(conversationResponse.conversation.id)
      setAgentModalOpen(false)
      void loadAgents()
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentCreateError(error.message)
      } else {
        setAgentCreateError('Unable to create the agent. Try again in a moment.')
      }
    } finally {
      setIsCreatingAgent(false)
    }
  }
  const updateAgent = async (input: { name: string; description?: string; avatar: string }) => {
    if (editingAgent === null) {
      return
    }

    setIsSavingAgent(true)
    setAgentEditError(null)

    try {
      const response = await apiRequest<UpdateAgentResponse>(
        `/agents/${editingAgent.agent.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify(input),
        },
      )

      setAgents((current) =>
        current.map((agent) =>
          agent.agent.id === response.agent.agent.id ? response.agent : agent,
        ),
      )
      setConversations((current) =>
        current.map((conversation) =>
          conversation.directAgentId === response.agent.agent.id
            ? {
                ...conversation,
                title: response.agent.agent.name,
                updatedAt: response.agent.agent.updatedAt,
              }
            : conversation,
        ),
      )
      setEditingAgentId(null)
      void loadAgents()
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentEditError(error.message)
      } else {
        setAgentEditError('Unable to update the agent. Try again in a moment.')
      }
    } finally {
      setIsSavingAgent(false)
    }
  }
  const archiveAgent = async () => {
    if (editingAgent === null) {
      return
    }

    const archivedAgentId = editingAgent.agent.id
    setIsSavingAgent(true)
    setAgentEditError(null)

    try {
      const response = await apiRequest<ArchiveAgentResponse>(
        `/agents/${archivedAgentId}/archive`,
        { method: 'PATCH' },
      )

      setAgents((current) => current.filter((agent) => agent.agent.id !== archivedAgentId))
      setArchivedAgents((current) => [
        response.agent,
        ...current.filter((agent) => agent.agent.id !== archivedAgentId),
      ])
      setConversations((current) =>
        current.filter((conversation) => conversation.directAgentId !== archivedAgentId),
      )
      if (activeConversation?.directAgentId === archivedAgentId) {
        clearActiveConversation()
      }
      setEditingAgentId(null)
      void loadAgents()
      void loadArchivedAgents()
      void loadConversations()
      void loadArchivedConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentEditError(error.message)
      } else {
        setAgentEditError('Unable to archive the agent. Try again in a moment.')
      }
    } finally {
      setIsSavingAgent(false)
    }
  }
  const restoreAgent = async (agentId: string) => {
    setRunError(null)

    try {
      const response = await apiRequest<RestoreAgentResponse>(
        `/agents/${agentId}/restore`,
        { method: 'PATCH' },
      )

      setArchivedAgents((current) => current.filter((agent) => agent.agent.id !== agentId))
      setAgents((current) => [
        response.agent,
        ...current.filter((agent) => agent.agent.id !== agentId),
      ])
      void loadAgents()
      void loadArchivedAgents()
      void loadConversations()
      void loadArchivedConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to restore the agent. Try again in a moment.')
      }
    }
  }

  const updateSearchFilters = (input: {
    channelId?: string
    query?: string
    sender?: string
    sort?: SearchSort
    time?: SearchTimeFilter
  }) => {
    const next = {
      channelId: 'channelId' in input ? input.channelId : searchSelectedChannelId,
      query: 'query' in input ? (input.query ?? '') : searchQuery,
      sender: 'sender' in input ? input.sender : searchSelectedSender,
      sort: 'sort' in input ? (input.sort ?? 'relevant') : searchSort,
      time: 'time' in input ? (input.time ?? 'any') : searchTime,
    }

    setSearchSelectedChannelId(next.channelId)
    setSearchQuery(next.query)
    setSearchSelectedSender(next.sender)
    setSearchSort(next.sort)
    setSearchTime(next.time)

    if (next.query.trim().length === 0) {
      setSearchResults(null)
      setSearchError(null)
      setIsSearchLoading(false)
    }

    const path = searchRoutePath(next)
    window.history.pushState({}, '', path)
  }

  if (authLoading) {
    return (
      <main className="grid min-h-screen content-center gap-6 bg-[var(--cds-background)] p-12" aria-label="Loading workspace">
        <SkeletonText heading width="220px" />
        <SkeletonText paragraph lineCount={5} width="100%" />
      </main>
    )
  }

  if (authError) {
    return (
      <main className="grid min-h-screen content-center gap-6 bg-[var(--cds-background)] p-12" aria-label="Session error">
        <InlineNotification
          kind="error"
          title="Session unavailable"
          subtitle={authError}
          lowContrast
          aria-label="Close notification"
        />
      </main>
    )
  }

  return (
    <main
      className={
        activeView === 'chat'
          ? 'grid h-screen grid-cols-[3.5rem_18rem_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)] max-[1055px]:grid-cols-[3.25rem_15rem_minmax(0,1fr)] max-[671px]:grid-cols-[3.25rem_minmax(0,1fr)]'
          : 'grid h-screen grid-cols-[3.5rem_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)] max-[1055px]:grid-cols-[3.25rem_minmax(0,1fr)]'
      }
      aria-label="AgentHub workspace"
    >
      <AppRail
        user={user}
        activeView={activeView}
        accountExpanded={accountExpanded}
        toggleAccount={() => setAccountExpanded((expanded) => !expanded)}
        setActiveView={navigateToView}
        refreshWorkspace={refreshWorkspace}
        logout={logout}
        openSettings={() => {
          setAccountExpanded(false)
          setSettingsError(null)
          setSettingsOpen(true)
        }}
      />
      {activeView === 'chat' ? (
        <>
          <ChatSidebar
            conversations={conversations}
            archivedAgents={archivedAgents}
            archivedConversations={archivedConversations}
            activeRunCount={activeRunCount}
            agents={agents}
            activeConversationId={activeConversationId}
            unreadCounts={unreadByConversationId}
            savedOpen={savedOpen}
            onOpenSearch={openSearch}
            onCreateAgent={() => openCreateAgent()}
            onCreateGroup={openCreateGroup}
            onOpenActivity={() => navigateToView('runs')}
            onRestoreAgent={(agentId) => {
              void restoreAgent(agentId)
            }}
            onRestoreGroup={(conversationId) => {
              void restoreGroup(conversationId)
            }}
            onToggleSaved={() => setSavedOpen((open) => !open)}
            selectGroup={selectConversation}
            selectAgent={(agentId) => {
              void selectAgentConversation(agentId)
            }}
          />
          {isSearchRoute ? (
            <SearchWorkspace
              agents={agents}
              conversations={conversations}
              error={searchError}
              isLoading={isSearchLoading}
              query={searchQuery}
              results={searchResults}
              selectedChannelId={searchSelectedChannelId}
              selectedSender={searchSelectedSender}
              sort={searchSort}
              time={searchTime}
              onChannelChange={(value) => updateSearchFilters({ channelId: value })}
              onOpenConversation={(conversationId) => {
                selectConversation(conversationId)
              }}
              onOpenMessage={(conversationId, messageId) => {
                openMessageRoute(conversationId, messageId)
              }}
              onQueryChange={(value) => updateSearchFilters({ query: value })}
              onSenderChange={(value) => updateSearchFilters({ sender: value })}
              onSortChange={(value) => updateSearchFilters({ sort: value })}
              onTimeChange={(value) => updateSearchFilters({ time: value })}
            />
          ) : (
            <ChannelWorkspace
              activeConversation={activeConversation}
              messages={activeConversationMessages}
              goals={activeConversationGoals}
              artifacts={activeConversationArtifacts}
              deployments={activeConversationDeployments}
              agents={agents}
              user={user}
              prompt={prompt}
              isCreatingRun={isCreatingRun}
              runError={runError ?? agentError}
              readyAgentCount={readyAgentCount}
              canEditConversation={canEditActiveConversation}
              setPrompt={updatePrompt}
              submitRun={submitRun}
              openCreateAgent={() => openCreateAgent()}
              openAgentConversation={(agentId) => {
                void selectAgentConversation(agentId)
              }}
              openEditConversation={openEditActiveConversation}
              openArtifactEditor={openArtifactEditor}
              openRun={openRun}
              focusedGoalRoute={focusedGoalRoute}
              focusedMessageId={focusedMessageId}
              taskRouteActive={route === `/chat/${activeConversation?.id}/tasks`}
              deploymentRouteActive={chatPanelRoute === 'deployments'}
              openGoalRoute={(goalId, taskIndex) => {
                if (activeConversation?.id) {
                  openGoalRoute(activeConversation.id, goalId, taskIndex)
                }
              }}
              openTasksRoute={() => {
                if (activeConversation?.id) {
                  openTasksRoute(activeConversation.id)
                }
              }}
              openDeploymentsRoute={() => {
                if (activeConversation?.id) {
                  openDeploymentsRoute(activeConversation.id)
                }
              }}
              closeConversationRoute={() => {
                if (activeConversation?.id) {
                  closeConversationRoute(activeConversation.id)
                }
              }}
              openConversationEditor={(conversationId) => openConversationEditor(conversationId)}
              closeArtifactEditor={closeArtifactEditor}
              activeEditorArtifactId={editorRoute?.artifactId ?? null}
              editorConversationId={editorRoute?.conversationId ?? null}
              onActiveEditorArtifactChange={openArtifactEditor}
              refreshArtifacts={() => {
                if (activeConversation?.id) {
                  void loadArtifacts(activeConversation.id)
                }
              }}
              refreshDeployments={() => {
                if (activeConversation?.id) {
                  void loadDeployments(activeConversation.id)
                }
              }}
            />
          )}
        </>
      ) : activeView === 'daemon' ? (
        <DaemonPage
          devices={devices}
          agents={agents}
          deviceError={deviceError}
          openCreateAgent={openCreateAgent}
        />
      ) : (
        <RunsPage
          runs={orderedRuns}
          activeRunCount={activeRunCount}
          eventsByRun={eventsByRun}
          selectedRunId={selectedRunId}
          selectRun={setSelectedRunId}
        />
      )}
      <RealtimeToastStack
        toasts={realtimeToasts}
        onDismiss={dismissRealtimeToast}
        onOpenConversation={openRealtimeToastConversation}
      />
      {agentModalOpen && (
        <AgentCreateModal
          open={agentModalOpen}
          devices={devices}
          defaultDaemonDeviceId={defaultAgentDaemonId}
          error={agentCreateError}
          isCreating={isCreatingAgent}
          onClose={() => setAgentModalOpen(false)}
          onCreate={createAgent}
        />
      )}
      {groupModalOpen && (
        <GroupCreateModal
          open={groupModalOpen}
          agents={agents}
          error={groupCreateError}
          isCreating={isCreatingGroup}
          onClose={() => setGroupModalOpen(false)}
          onCreate={createGroup}
        />
      )}
      {editingAgent && (
        <AgentEditModal
          key={editingAgent.agent.id}
          open={editingAgent !== null}
          agent={editingAgent}
          error={agentEditError}
          isSaving={isSavingAgent}
          onClose={() => setEditingAgentId(null)}
          onArchive={archiveAgent}
          onSave={updateAgent}
        />
      )}
      {editingGroup && (
        editingGroup.key === 'all' ? (
          <GroupOrchestratorModal
            key={editingGroup.id}
            open={editingGroup !== null}
            agents={agents}
            conversation={editingGroup}
            error={groupEditError}
            isSaving={isSavingGroup}
            onClose={() => setEditingGroupId(null)}
            onSave={updateGroupOrchestrator}
          />
        ) : (
          <GroupEditModal
            key={editingGroup.id}
            open={editingGroup !== null}
            agents={agents}
            conversation={editingGroup}
            error={groupEditError}
            isSaving={isSavingGroup}
            onClose={() => setEditingGroupId(null)}
            onArchive={archiveGroup}
            onSave={updateGroup}
          />
        )
      )}
      {settingsOpen && user && (
        <UserSettingsModal
          key={user.avatar ?? 'user-settings'}
          open={settingsOpen}
          user={user}
          error={settingsError}
          isSaving={isSavingSettings}
          onClose={() => setSettingsOpen(false)}
          onSave={(input) => {
            void updateUserSettings(input)
          }}
        />
      )}
    </main>
  )
}
