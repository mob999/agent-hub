import { InlineNotification, SkeletonText } from '@carbon/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentCreateModal } from '../components/AgentCreateModal'
import { AgentEditModal } from '../components/AgentEditModal'
import { AppRail } from '../components/AppRail'
import { ChannelWorkspace, type MessageSendState } from '../components/ChannelWorkspace'
import { ChatSidebar } from '../components/ChatSidebar'
import { GroupCreateModal } from '../components/GroupCreateModal'
import { GroupEditModal } from '../components/GroupEditModal'
import { GroupOrchestratorModal } from '../components/GroupOrchestratorModal'
import { ProjectCreateModal } from '../components/ProjectCreateModal'
import { ProjectEditModal } from '../components/ProjectEditModal'
import { RealtimeToastStack, type RealtimeToast } from '../components/RealtimeToastStack'
import { SearchWorkspace } from '../components/SearchWorkspace'
import { UserSettingsModal } from '../components/UserSettingsModal'
import { WorkspacePanel } from '../components/WorkspacePanel'
import {
  ApiRequestError,
  apiRequest,
  apiUrl,
  type ArchiveAgentResponse,
  type ArchiveGroupConversationResponse,
  type AgentDetails,
  type AgentRunSummary,
  type AuthResponse,
  type Conversation,
  type ConversationArtifact,
  type ConversationDeployment,
  type ConversationGoal,
  type ConversationMessage,
  type CreateGroupConversationResponse,
  type CreateProjectConversationResponse,
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
  type WelcomeSummary,
  type WorkspaceView,
} from '../lib/api'
import { writePendingAuthRedirect } from '../lib/auth-redirect'
import {
  fetchAgents,
  fetchAuthMe,
  fetchConversationArtifacts,
  fetchConversationDeployments,
  fetchConversationMessages,
  fetchConversations,
  fetchConversationTasks,
  fetchDaemonDevices,
  fetchRun,
  fetchRunEvents,
  fetchRuns,
  fetchWelcomeSummary,
  queryKeys,
} from '../lib/query'
import { getSearchRouteState, searchRoutePath } from '../lib/search-route'
import { DaemonPage } from './DaemonPage'
import { RunsPage } from './RunsPage'
import { WelcomePage } from './WelcomePage'
import type { ChatPanelRoute, GoalRouteState } from '../App'
import type { RoutePath, WorkspaceRoutePath } from './AuthPage'

const workspaceRouteByView: Record<WorkspaceView, WorkspaceRoutePath> = {
  chat: '/welcome',
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
const realtimeToastDurationMs = 5000
const maxRealtimeToasts = 4
type AgentCreateAfterSubmit = 'open-direct' | 'stay'

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

function getMessageSenderAvatar(
  message: ConversationMessage,
  agents: AgentDetails[],
  userAvatar: string | null | undefined,
): string | null {
  if (message.senderType === 'user') {
    return userAvatar ?? null
  }

  if (message.senderAgentId !== undefined) {
    const agent = agents.find((item) => item.agent.id === message.senderAgentId)

    return agent?.agent.avatar ?? null
  }

  return null
}

function getRealtimeToastSenderInitials(senderName: string): string {
  const trimmedName = senderName.trim()

  if (trimmedName.length === 0) {
    return 'A'
  }

  const words = trimmedName.split(/\s+/).filter((word) => word.length > 0)

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join('')
      .toUpperCase()
  }

  return Array.from(trimmedName).slice(0, 2).join('').toUpperCase()
}

function createPendingUserMessage(input: {
  content: string
  conversationId: string
  id: string
  timestamp: string
}): ConversationMessage {
  return {
    id: input.id,
    conversationId: input.conversationId,
    senderType: 'user',
    content: input.content,
    status: 'completed',
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  }
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
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const authQuery = useQuery({
    queryFn: fetchAuthMe,
    queryKey: queryKeys.authMe(),
    retry: false,
  })
  const initialSearchRouteState = readCurrentSearchRouteState()
  const user = authQuery.data?.user ?? null
  const welcomeQuery = useQuery({
    enabled: user !== null,
    queryFn: fetchWelcomeSummary,
    queryKey: queryKeys.welcome(),
  })
  const authLoading = authQuery.isPending
  const authError =
    authQuery.error === null ||
    (authQuery.error instanceof ApiRequestError && authQuery.error.status === 401)
      ? null
      : 'Unable to load your session.'
  const [devices, setDevices] = useState<DaemonDevice[]>([])
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDetails[]>([])
  const [agentsLoaded, setAgentsLoaded] = useState(false)
  const [archivedAgents, setArchivedAgents] = useState<AgentDetails[]>([])
  const [agentError, setAgentError] = useState<string | null>(null)
  const [agentCreateError, setAgentCreateError] = useState<string | null>(null)
  const [isCreatingAgent, setIsCreatingAgent] = useState(false)
  const [agentModalOpen, setAgentModalOpen] = useState(false)
  const [agentCreateAfterSubmit, setAgentCreateAfterSubmit] = useState<AgentCreateAfterSubmit>('open-direct')
  const [agentEditError, setAgentEditError] = useState<string | null>(null)
  const [isSavingAgent, setIsSavingAgent] = useState(false)
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [groupCreateError, setGroupCreateError] = useState<string | null>(null)
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [groupEditError, setGroupEditError] = useState<string | null>(null)
  const [isSavingGroup, setIsSavingGroup] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [projectCreateError, setProjectCreateError] = useState<string | null>(null)
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [projectModalOpen, setProjectModalOpen] = useState(false)
  const [defaultAgentDaemonId, setDefaultAgentDaemonId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [conversationsLoaded, setConversationsLoaded] = useState(false)
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([])
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ConversationMessage[]>>({})
  const [messageSendStates, setMessageSendStates] = useState<Record<string, MessageSendState>>({})
  const [goalsByConversation, setGoalsByConversation] = useState<Record<string, ConversationGoal[]>>({})
  const [artifactsByConversation, setArtifactsByConversation] = useState<Record<string, ConversationArtifact[]>>({})
  const [loadingConversationIds, setLoadingConversationIds] = useState<Record<string, true>>({})
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
  const [savedOpen, setSavedOpen] = useState(false)
  const [tutorialRequestId, setTutorialRequestId] = useState(0)
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
  const messageSendStatesRef = useRef<Record<string, MessageSendState>>({})

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
  const editingProject = useMemo(
    () => conversations.find((conversation) => conversation.id === editingProjectId) ?? null,
    [conversations, editingProjectId],
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
  const isActiveConversationLoading =
    activeConversationId !== null && loadingConversationIds[activeConversationId] === true

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
    messageSendStatesRef.current = messageSendStates
  }, [messageSendStates])

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
      const devices = await queryClient.fetchQuery({
        queryFn: fetchDaemonDevices,
        queryKey: queryKeys.daemonDevices(),
      })
      setDevices(devices)
      setDeviceError(null)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setDeviceError(error.message)
      } else {
        setDeviceError('Unable to load daemon devices.')
      }
    }
  }, [queryClient])

  const loadAgents = useCallback(async () => {
    try {
      const agents = await queryClient.fetchQuery({
        queryFn: () => fetchAgents('default'),
        queryKey: queryKeys.agents('default'),
      })
      setAgents(agents)
      agentsRef.current = agents
      setRuns((current) =>
        current.map((localRun) => {
          const runAgent = agents.find((agent) => agent.agent.id === localRun.run.agentId)

          return {
            ...localRun,
            agentName: runAgent?.agent.name ?? localRun.agentName,
          }
        }),
      )
      setAgentError(null)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentError(error.message)
      } else {
        setAgentError('Unable to load agents.')
      }
    } finally {
      setAgentsLoaded(true)
    }
  }, [queryClient])

  const loadArchivedAgents = useCallback(async () => {
    try {
      const agents = await queryClient.fetchQuery({
        queryFn: () => fetchAgents('archived'),
        queryKey: queryKeys.agents('archived'),
      })
      setArchivedAgents(agents)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentError(error.message)
      } else {
        setAgentError('Unable to load archived agents.')
      }
    }
  }, [queryClient])

  const loadConversations = useCallback(async () => {
    try {
      const conversations = await queryClient.fetchQuery({
        queryFn: () => fetchConversations('default'),
        queryKey: queryKeys.conversations('default'),
      })

      setConversations(conversations)
      const conversationIds = new Set(conversations.map((conversation) => conversation.id))
      const nextConversationId =
        routeConversationId !== null && conversationIds.has(routeConversationId)
          ? routeConversationId
          : null

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
    } finally {
      setConversationsLoaded(true)
    }
  }, [activateConversation, activeConversationId, queryClient, routeConversationId, user])

  const loadArchivedConversations = useCallback(async () => {
    try {
      const conversations = await queryClient.fetchQuery({
        queryFn: () => fetchConversations('archived'),
        queryKey: queryKeys.conversations('archived'),
      })
      setArchivedConversations(conversations)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to load archived conversations.')
      }
    }
  }, [queryClient])

  const loadMessages = useCallback(async (conversationId: string) => {
    try {
      const messages = await queryClient.fetchQuery({
        queryFn: () => fetchConversationMessages(conversationId),
        queryKey: queryKeys.conversationMessages(conversationId),
      })
      setMessagesByConversation((current) => ({
        ...current,
        [conversationId]: messages,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [queryClient])

  const prefetchConversationMessages = useCallback((conversationId: string) => {
    void queryClient.prefetchQuery({
      queryFn: () => fetchConversationMessages(conversationId),
      queryKey: queryKeys.conversationMessages(conversationId),
    })
  }, [queryClient])

  const loadTasks = useCallback(async (conversationId: string) => {
    try {
      const goals = await queryClient.fetchQuery({
        queryFn: () => fetchConversationTasks(conversationId),
        queryKey: queryKeys.conversationTasks(conversationId),
      })
      setGoalsByConversation((current) => ({
        ...current,
        [conversationId]: goals,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [queryClient])

  const loadArtifacts = useCallback(async (conversationId: string) => {
    try {
      const artifacts = await queryClient.fetchQuery({
        queryFn: () => fetchConversationArtifacts(conversationId),
        queryKey: queryKeys.conversationArtifacts(conversationId),
      })
      setArtifactsByConversation((current) => ({
        ...current,
        [conversationId]: artifacts,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [queryClient])

  const loadConversationDetails = useCallback(async (conversationId: string) => {
    const cachedMessages = queryClient.getQueryData<ConversationMessage[]>(
      queryKeys.conversationMessages(conversationId),
    )

    if (cachedMessages === undefined) {
      setLoadingConversationIds((current) => ({ ...current, [conversationId]: true }))
    } else {
      setMessagesByConversation((current) => ({
        ...current,
        [conversationId]: cachedMessages,
      }))
    }

    try {
      await loadMessages(conversationId)
    } finally {
      setLoadingConversationIds((current) => {
        if (current[conversationId] !== true) {
          return current
        }

        const next = { ...current }
        delete next[conversationId]
        return next
      })
    }

    void loadTasks(conversationId)
    void loadArtifacts(conversationId)
  }, [loadArtifacts, loadMessages, loadTasks, queryClient])

  const loadDeployments = useCallback(async (conversationId: string) => {
    try {
      const deployments = await queryClient.fetchQuery({
        queryFn: () => fetchConversationDeployments(conversationId),
        queryKey: queryKeys.conversationDeployments(conversationId),
      })
      setDeploymentsByConversation((current) => ({
        ...current,
        [conversationId]: deployments,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [queryClient])

  const loadRuns = useCallback(async () => {
    try {
      const runs = await queryClient.fetchQuery({
        queryFn: fetchRuns,
        queryKey: queryKeys.runs(),
      })
      const loadedRuns = runs.map((run) => toLocalRun(run, agentsRef.current))

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
  }, [queryClient])

  const refreshRun = useCallback(async (runId: string) => {
    try {
      const [run, events] = await Promise.all([
        queryClient.fetchQuery({
          queryFn: () => fetchRun(runId),
          queryKey: queryKeys.run(runId),
        }),
        queryClient.fetchQuery({
          queryFn: () => fetchRunEvents(runId),
          queryKey: queryKeys.runEvents(runId),
        }),
      ])

      setRuns((current) =>
        current.map((localRun) =>
          localRun.run.id === runId
            ? {
                ...localRun,
                run,
              }
            : localRun,
        ),
      )
      setEventsByRun((current) => ({
        ...current,
        [runId]: events,
      }))
    } catch (error) {
      if (error instanceof ApiRequestError && error.status !== 404) {
        setRunError(error.message)
      }
    }
  }, [queryClient])

  const invalidateAgentCatalog = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['agents'] })
    void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.welcome() })
  }, [queryClient])

  const invalidateConversationCatalog = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.welcome() })
  }, [queryClient])

  const invalidateConversationDetail = useCallback((conversationId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] })
    void queryClient.invalidateQueries({ queryKey: queryKeys.welcome() })
  }, [queryClient])

  useEffect(() => {
    if (!authQuery.error) {
      return
    }

    if (authQuery.error instanceof ApiRequestError && authQuery.error.status === 401) {
      writePendingAuthRedirect(window.location.pathname)
      navigate('/login')
      return
    }
  }, [authQuery.error, navigate])

  useEffect(() => {
    if (!user) {
      return
    }

    void window.tavroDesktop?.daemon?.ensureAutoStart?.().catch(() => undefined)
  }, [user])

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
      void loadConversationDetails(activeConversationId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [activeConversationId, loadConversationDetails])

  useEffect(() => {
    if (!user || routeConversationId === null) {
      return
    }

    const timer = window.setTimeout(() => {
      activateConversation(routeConversationId)
      void loadConversationDetails(routeConversationId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [
    activateConversation,
    loadConversationDetails,
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
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents('default') })
      void queryClient.invalidateQueries({ queryKey: queryKeys.welcome() })
      void loadAgents()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [agents, loadAgents, queryClient])

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
    attachments: File[] = [],
  ): Promise<boolean> => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if ((!trimmedPrompt && attachments.length === 0) || isCreatingRun) {
      return false
    }

    if (activeConversation === null) {
      setRunError('Select a conversation before sending a message.')
      return false
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
      return false
    }

    if (
      activeConversation.type === 'group' &&
      mode === 'task' &&
      activeConversation.orchestratorAgentId === undefined
    ) {
      setRunError('Set a group orchestrator in settings before using Task mode.')
      return false
    }

    setRunError(null)
    setIsCreatingRun(true)
    const pendingMessageId = `pending-${crypto.randomUUID()}`
    const pendingMessage = createPendingUserMessage({
      content: trimmedPrompt,
      conversationId: activeConversation.id,
      id: pendingMessageId,
      timestamp: new Date().toISOString(),
    })

    setMessageSendStates((current) => ({
      ...current,
      [pendingMessageId]: {
        attachmentCount: attachments.length,
        conversationId: activeConversation.id,
        status: 'queued',
      },
    }))
    setMessagesByConversation((current) => {
      const currentMessages = current[activeConversation.id] ?? []

      return {
        ...current,
        [activeConversation.id]: [
          ...currentMessages.filter((message) => message.id !== pendingMessageId),
          pendingMessage,
        ],
      }
    })
    queryClient.setQueryData<ConversationMessage[]>(
      queryKeys.conversationMessages(activeConversation.id),
      (currentMessages = []) => [
        ...currentMessages.filter((message) => message.id !== pendingMessageId),
        pendingMessage,
      ],
    )

    try {
      const body = attachments.length > 0
        ? (() => {
            const formData = new FormData()
            formData.set('content', trimmedPrompt)
            formData.set('mode', mode)
            attachments.forEach((file) => formData.append('attachments', file))

            return formData
          })()
        : JSON.stringify({
            content: trimmedPrompt,
            mode,
          })
      const response = await apiRequest<SendConversationMessageResponse>(
        `/conversations/${activeConversation.id}/messages`,
        {
          method: 'POST',
          body,
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
      queryClient.setQueryData<Conversation[]>(queryKeys.conversations('default'), (current = []) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ])
      setMessagesByConversation((current) => {
        const currentMessages = current[activeConversation.id] ?? []
        const nextMessages = [
          ...currentMessages.filter(
            (message) =>
              message.id !== pendingMessageId &&
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
      queryClient.setQueryData<ConversationMessage[]>(
        queryKeys.conversationMessages(activeConversation.id),
        (currentMessages = []) => [
          ...currentMessages.filter(
            (message) =>
              message.id !== pendingMessageId &&
              message.id !== response.messages.user.id &&
              !assistantMessages.some((assistant) => assistant.id === message.id),
          ),
          response.messages.user,
          ...assistantMessages,
        ],
      )
      setMessageSendStates((current) => {
        return Object.fromEntries(
          Object.entries(current).filter(([messageId]) => messageId !== pendingMessageId),
        )
      })
      responseRuns.forEach((run) => {
        queryClient.setQueryData(queryKeys.run(run.id), run)
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationTasks(activeConversation.id) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.conversationArtifacts(activeConversation.id) })
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
      return true
    } catch (error) {
      const message = error instanceof ApiRequestError
        ? error.message
        : 'Unable to create the run. Try again in a moment.'
      setMessageSendStates((current) => ({
        ...current,
        [pendingMessageId]: {
          attachmentCount: attachments.length,
          conversationId: activeConversation.id,
          error: message,
          status: 'failed',
        },
      }))
      setRunError(null)
      return false
    } finally {
      setIsCreatingRun(false)
    }
  }

  const logout = async () => {
    await apiRequest<{ ok: true }>('/auth/logout', { method: 'POST' }).catch(() => null)
    queryClient.clear()
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

      queryClient.setQueryData(queryKeys.authMe(), response)
      setSettingsOpen(false)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setSettingsError(error.message)
      } else {
        setSettingsError(t('settings.saveFallbackError'))
      }
    } finally {
      setIsSavingSettings(false)
    }
  }

  const refreshWelcomeData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.daemonDevices() })
    void queryClient.invalidateQueries({ queryKey: queryKeys.welcome() })
    invalidateAgentCatalog()
    invalidateConversationCatalog()
    void loadDevices()
    void loadAgents()
    void loadConversations()
  }, [
    invalidateAgentCatalog,
    invalidateConversationCatalog,
    loadAgents,
    loadConversations,
    loadDevices,
    queryClient,
  ])

  const openOnboardingTutorial = useCallback(() => {
    refreshWelcomeData()
    setTutorialRequestId((requestId) => requestId + 1)
    navigate('/welcome')
  }, [navigate, refreshWelcomeData])

  const updateWelcomeSummary = useCallback((summary: WelcomeSummary) => {
    queryClient.setQueryData(queryKeys.welcome(), summary)
  }, [queryClient])

  useEffect(() => {
    if (!user) {
      return
    }

    const refreshAfterReconnect = () => {
      invalidateConversationCatalog()
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() })
      void loadConversations()
      void loadArchivedConversations()
      void loadRuns()

      if (activeConversationId !== null) {
        invalidateConversationDetail(activeConversationId)
        void loadMessages(activeConversationId)
        void loadTasks(activeConversationId)
        void loadArtifacts(activeConversationId)
      }
    }
    const upsertMessage = (message: ConversationMessage) => {
      const queuedPendingMessageIds = message.senderType === 'user'
        ? new Set(
            Object.entries(messageSendStatesRef.current)
              .filter(([, state]) =>
                state.status === 'queued' &&
                state.conversationId === message.conversationId,
              )
              .map(([messageId]) => messageId),
          )
        : new Set<string>()

      setMessagesByConversation((current) => {
        const currentMessages = current[message.conversationId] ?? []
        const nextMessages = [
          ...currentMessages.filter((item) =>
            item.id !== message.id && !queuedPendingMessageIds.has(item.id),
          ),
          message,
        ].sort((first, second) =>
          new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
        )

        return {
          ...current,
          [message.conversationId]: nextMessages,
        }
      })
      queryClient.setQueryData<ConversationMessage[]>(
        queryKeys.conversationMessages(message.conversationId),
        (currentMessages = []) => [
          ...currentMessages.filter((item) =>
            item.id !== message.id && !queuedPendingMessageIds.has(item.id),
          ),
          message,
        ].sort((first, second) =>
          new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
        ),
      )
      if (queuedPendingMessageIds.size > 0) {
        setMessageSendStates((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([messageId]) => !queuedPendingMessageIds.has(messageId)),
          ),
        )
      }
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
      const senderName = getMessageSenderName(message, agentsSnapshot)
      const toast: RealtimeToast = {
        id: message.id,
        conversationId: message.conversationId,
        title: getConversationToastTitle(conversation, agentsSnapshot),
        senderName,
        senderAvatar: getMessageSenderAvatar(message, agentsSnapshot, user?.avatar),
        senderInitials: getRealtimeToastSenderInitials(senderName),
        senderKind: message.senderType,
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
      queryClient.setQueryData(queryKeys.run(event.run.id), event.run)
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs() })
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
      queryClient.setQueryData<RunEvent[]>(queryKeys.runEvents(event.runId), (currentEvents = []) => {
        const exists = currentEvents.some(
          (item) =>
            item.type === event.event.type &&
            item.createdAt === event.event.createdAt &&
            item.runId === event.event.runId,
        )

        return exists ? currentEvents : [...currentEvents, event.event]
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
      queryClient.setQueryData<ConversationGoal[]>(
        queryKeys.conversationTasks(goal.conversationId),
        (currentGoals = []) => [
          goal,
          ...currentGoals.filter((item) => item.id !== goal.id),
        ],
      )
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
      queryClient.setQueryData<ConversationArtifact[]>(
        queryKeys.conversationArtifacts(artifact.conversationId),
        (currentArtifacts = []) => [
          artifact,
          ...currentArtifacts.filter((item) => item.id !== artifact.id),
        ],
      )
    }
    const handleRealtimeEvent = (event: RealtimeEvent) => {
      switch (event.type) {
        case 'conversation.updated':
          if (event.conversation !== undefined) {
            setConversations((current) => [
              event.conversation as Conversation,
              ...current.filter((conversation) => conversation.id !== event.conversationId),
            ])
            queryClient.setQueryData<Conversation[]>(queryKeys.conversations('default'), (current = []) => [
              event.conversation as Conversation,
              ...current.filter((conversation) => conversation.id !== event.conversationId),
            ])
          } else {
            const existingConversation = conversationsRef.current.find(
              (conversation) => conversation.id === event.conversationId,
            )

            if (existingConversation === undefined || existingConversation.type === 'project') {
              invalidateConversationCatalog()
              void loadConversations()
            }

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
            queryClient.setQueryData<Conversation[]>(queryKeys.conversations('default'), (current = []) => {
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
        case 'conversation.message.updated':
          upsertMessage(event.message)
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
            void queryClient.invalidateQueries({ queryKey: queryKeys.conversationTasks(event.conversationId) })
            void loadTasks(event.conversationId)
          }
          break
        case 'artifact.created':
          upsertArtifact(event.artifact)
          break
        case 'artifact.action.updated':
          void queryClient.invalidateQueries({ queryKey: queryKeys.conversationArtifacts(event.conversationId) })
          void loadArtifacts(event.conversationId)
          break
      }
    }
    const source = new EventSource(apiUrl('/events'), { withCredentials: true })
    const eventTypes: RealtimeEvent['type'][] = [
      'conversation.updated',
      'conversation.message.created',
      'conversation.message.updated',
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
    invalidateConversationCatalog,
    invalidateConversationDetail,
    loadArchivedConversations,
    loadArtifacts,
    loadConversations,
    loadMessages,
    loadRuns,
    loadTasks,
    queryClient,
    user,
  ])

  const navigateToView = (view: WorkspaceView) => {
    navigate(workspaceRouteByView[view])
  }
  const openSearch = useCallback(() => {
    const path = searchRoutePath({
      channelId: searchSelectedChannelId,
      query: searchQuery,
      sender: searchSelectedSender,
      sort: searchSort,
      time: searchTime,
    })
    window.history.pushState({}, '', path)
    navigate('/chat/search')
  }, [navigate, searchQuery, searchSelectedChannelId, searchSelectedSender, searchSort, searchTime])

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.key.toLowerCase() !== 'k' || (!event.ctrlKey && !event.metaKey)) {
        return
      }

      event.preventDefault()
      openSearch()
      window.setTimeout(() => {
        document.getElementById('workspace-search-input')?.focus()
      }, 0)
    }

    window.addEventListener('keydown', handleSearchShortcut)

    return () => {
      window.removeEventListener('keydown', handleSearchShortcut)
    }
  }, [openSearch])
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
    activateConversation(conversationId)
    navigate(`/chat/${encodeURIComponent(conversationId)}` as RoutePath)
    void loadConversationDetails(conversationId)
  }
  const upsertConversation = (conversation: Conversation) => {
    setConversations((current) => [
      conversation,
      ...current.filter((item) => item.id !== conversation.id),
    ])
    queryClient.setQueryData<Conversation[]>(
      queryKeys.conversations('default'),
      (current = []) => [
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ],
    )
  }
  const openAgentConversation = async (input: { agentId: string; conversationId?: string }) => {
    if (input.conversationId !== undefined) {
      selectConversation(input.conversationId)
      return
    }

    const existingConversation = conversationsRef.current.find(
      (conversation) =>
        conversation.type === 'direct' && conversation.directAgentId === input.agentId,
    )

    if (existingConversation !== undefined) {
      selectConversation(existingConversation.id)
      return
    }

    try {
      const response = await apiRequest<{ conversation: Conversation }>('/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ agentId: input.agentId }),
      })

      upsertConversation(response.conversation)
      invalidateConversationCatalog()
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
  const openCreateAgent = (
    daemonDeviceId?: string,
    options: { afterSubmit?: AgentCreateAfterSubmit } = {},
  ) => {
    setDefaultAgentDaemonId(daemonDeviceId ?? null)
    setAgentCreateAfterSubmit(options.afterSubmit ?? 'open-direct')
    setAgentCreateError(null)
    setAgentModalOpen(true)
  }
  const openCreateGroup = () => {
    setGroupCreateError(null)
    setGroupModalOpen(true)
  }
  const openCreateProject = () => {
    setProjectCreateError(null)
    setProjectModalOpen(true)
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
      return
    }

    if (activeConversation.type === 'project') {
      setGroupEditError(null)
      setEditingProjectId(activeConversation.id)
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
      queryClient.setQueryData(queryKeys.conversationMessages(response.conversation.id), [])
      invalidateConversationCatalog()
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
      invalidateConversationCatalog()
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
  const updateProject = async (input: { title: string; description?: string; agentIds: string[]; orchestratorAgentId?: string }) => {
    if (editingProject === null) {
      return
    }

    setIsSavingGroup(true)
    setGroupEditError(null)

    try {
      const response = await apiRequest<UpdateGroupConversationResponse>(
        `/conversations/projects/${editingProject.id}`,
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
      setEditingProjectId(null)
      invalidateConversationCatalog()
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setGroupEditError(error.message)
      } else {
        setGroupEditError('Unable to update the project. Try again in a moment.')
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
      invalidateConversationCatalog()
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
      invalidateConversationCatalog()
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
      invalidateConversationCatalog()
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
  const createProject = async (input: {
    title?: string
    description?: string
    remoteUrl: string
    agentIds: string[]
    orchestratorAgentId?: string
  }) => {
    setIsCreatingProject(true)
    setProjectCreateError(null)

    try {
      const response = await apiRequest<CreateProjectConversationResponse>('/conversations/projects', {
        method: 'POST',
        body: JSON.stringify(input),
      })

      setConversations((current) => [
        response.conversation,
        ...current.filter((conversation) => conversation.id !== response.conversation.id),
      ])
      setMessagesByConversation((current) => ({
        ...current,
        [response.conversation.id]: [],
      }))
      queryClient.setQueryData(queryKeys.conversationMessages(response.conversation.id), [])
      invalidateConversationCatalog()
      if (user) {
        writeConversationDraft(user.id, response.conversation.id, '')
      }
      setSelectedRunId(null)
      if (response.conversation.project?.cloneStatus === 'ready') {
        selectConversation(response.conversation.id)
      }
      setProjectModalOpen(false)
      void loadConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setProjectCreateError(error.message)
      } else {
        setProjectCreateError('Unable to create the project. Try again in a moment.')
      }
    } finally {
      setIsCreatingProject(false)
    }
  }
  const deleteArchivedGroup = async (conversationId: string) => {
    setRunError(null)

    try {
      await apiRequest<{ ok: boolean }>(
        `/conversations/groups/${conversationId}`,
        { method: 'DELETE' },
      )

      setArchivedConversations((current) =>
        current.filter((item) => item.id !== conversationId),
      )
      invalidateConversationCatalog()
      void loadArchivedConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to permanently delete the group. Try again in a moment.')
      }
    }
  }
  const createAgent = async (input: {
    name: string
    description?: string
    tags: string[]
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
      invalidateAgentCatalog()
      void queryClient.invalidateQueries({ queryKey: queryKeys.welcome() })
      setSelectedRunId(null)
      if (agentCreateAfterSubmit === 'stay') {
        setAgentModalOpen(false)
        return
      }

      const conversationResponse = await apiRequest<{ conversation: Conversation }>('/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ agentId: response.agent.agent.id }),
      })
      setConversations((current) => [
        conversationResponse.conversation,
        ...current.filter((conversation) => conversation.id !== conversationResponse.conversation.id),
      ])
      invalidateConversationCatalog()
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
  const updateAgent = async (input: { name: string; description?: string; tags: string[]; avatar: string }) => {
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
      invalidateAgentCatalog()
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
      invalidateAgentCatalog()
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
      invalidateAgentCatalog()
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
  const deleteArchivedAgent = async (agentId: string) => {
    setRunError(null)

    try {
      await apiRequest<{ ok: boolean }>(
        `/agents/${agentId}`,
        { method: 'DELETE' },
      )

      setArchivedAgents((current) => current.filter((item) => item.agent.id !== agentId))
      setArchivedConversations((current) =>
        current.filter((conversation) => conversation.directAgentId !== agentId),
      )
      invalidateAgentCatalog()
      void loadArchivedAgents()
      void loadArchivedConversations()
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setRunError(error.message)
      } else {
        setRunError('Unable to permanently delete the agent. Try again in a moment.')
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
          ? 'fixed inset-0 grid min-h-0 grid-cols-[3.5rem_18rem_minmax(0,1fr)] overflow-hidden bg-[#fafafa] max-[1055px]:grid-cols-[3.25rem_15rem_minmax(0,1fr)] max-[671px]:grid-cols-[3.25rem_minmax(0,1fr)]'
          : 'fixed inset-0 grid min-h-0 grid-cols-[3.5rem_minmax(0,1fr)] overflow-hidden bg-[#fafafa] max-[1055px]:grid-cols-[3.25rem_minmax(0,1fr)]'
      }
      aria-label="AgentHub workspace"
    >
      <AppRail
        activeView={activeView}
        openHome={() => navigate('/')}
        setActiveView={navigateToView}
        openTutorial={openOnboardingTutorial}
        openSettings={() => {
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
            isCatalogLoading={!agentsLoaded || !conversationsLoaded}
            unreadCounts={unreadByConversationId}
            savedOpen={savedOpen}
            onOpenSearch={openSearch}
            onCreateAgent={() => openCreateAgent()}
            onCreateGroup={openCreateGroup}
            onCreateProject={openCreateProject}
            onOpenActivity={() => navigateToView('runs')}
            onDeleteAgent={(agentId) => {
              void deleteArchivedAgent(agentId)
            }}
            onDeleteGroup={(conversationId) => {
              void deleteArchivedGroup(conversationId)
            }}
            onRestoreAgent={(agentId) => {
              void restoreAgent(agentId)
            }}
            onRestoreGroup={(conversationId) => {
              void restoreGroup(conversationId)
            }}
            onToggleSaved={() => setSavedOpen((open) => !open)}
            onPrefetchConversation={prefetchConversationMessages}
            selectGroup={selectConversation}
            selectProject={selectConversation}
            selectAgent={(input) => {
              void openAgentConversation(input)
            }}
          />
          <WorkspacePanel>
            {route === '/welcome' ? (
              <WelcomePage
                agents={agents}
                devices={devices}
                error={
                  welcomeQuery.error instanceof ApiRequestError
                    ? welcomeQuery.error.message
                    : welcomeQuery.error
                      ? 'Unable to load welcome.'
                      : null
                }
                isLoading={welcomeQuery.isPending}
                summary={welcomeQuery.data ?? null}
                onOpenConversation={selectConversation}
                onOpenCreateAgent={(daemonDeviceId) => openCreateAgent(daemonDeviceId, { afterSubmit: 'stay' })}
                onOpenCreateGroup={openCreateGroup}
                onOpenCreateProject={openCreateProject}
                onOpenDaemon={() => navigateToView('daemon')}
                onOpenGoal={openGoalRoute}
                onRefreshData={refreshWelcomeData}
                onWelcomeUpdated={updateWelcomeSummary}
                tutorialRequestId={tutorialRequestId}
              />
            ) : isSearchRoute ? (
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
                messageSendStates={messageSendStates}
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
                  void openAgentConversation({ agentId })
                }}
                openEditConversation={openEditActiveConversation}
                openArtifactEditor={openArtifactEditor}
                openRun={openRun}
                focusedGoalRoute={focusedGoalRoute}
                focusedMessageId={focusedMessageId}
                isConversationLoading={isActiveConversationLoading}
                taskRouteActive={route === `/chat/${activeConversation?.id}/tasks`}
                deploymentRouteActive={chatPanelRoute === 'deployments'}
                welcomeActive={false}
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
                    void queryClient.invalidateQueries({ queryKey: queryKeys.conversationArtifacts(activeConversation.id) })
                    void loadArtifacts(activeConversation.id)
                  }
                }}
                refreshDeployments={() => {
                  if (activeConversation?.id) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.conversationDeployments(activeConversation.id) })
                    void loadDeployments(activeConversation.id)
                  }
                }}
              />
            )}
          </WorkspacePanel>
        </>
      ) : activeView === 'daemon' ? (
        <DaemonPage
          devices={devices}
          deviceError={deviceError}
          onDevicesChanged={() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.daemonDevices() })
            void loadDevices()
          }}
        />
      ) : (
        <RunsPage
          runs={orderedRuns}
          activeRunCount={activeRunCount}
          devices={devices}
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
      {projectModalOpen && (
        <ProjectCreateModal
          open={projectModalOpen}
          agents={agents}
          devices={devices}
          error={projectCreateError}
          isCreating={isCreatingProject}
          onClose={() => setProjectModalOpen(false)}
          onCreate={createProject}
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
      {editingProject && (
        <ProjectEditModal
          key={editingProject.id}
          open={editingProject !== null}
          agents={agents}
          conversation={editingProject}
          error={groupEditError}
          isSaving={isSavingGroup}
          onClose={() => setEditingProjectId(null)}
          onSave={updateProject}
        />
      )}
      {settingsOpen && user && (
        <UserSettingsModal
          key={user.avatar ?? 'user-settings'}
          open={settingsOpen}
          user={user}
          error={settingsError}
          isSaving={isSavingSettings}
          onClose={() => setSettingsOpen(false)}
          onLogout={logout}
          onSave={(input) => {
            void updateUserSettings(input)
          }}
        />
      )}
    </main>
  )
}
