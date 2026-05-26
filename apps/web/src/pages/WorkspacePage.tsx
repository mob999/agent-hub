import { InlineNotification, SkeletonText } from '@carbon/react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgentCreateModal } from '../components/AgentCreateModal'
import { AgentEditModal } from '../components/AgentEditModal'
import { AppRail } from '../components/AppRail'
import { ChannelWorkspace } from '../components/ChannelWorkspace'
import { ChatSidebar } from '../components/ChatSidebar'
import { GroupCreateModal } from '../components/GroupCreateModal'
import { GroupEditModal } from '../components/GroupEditModal'
import { GroupOrchestratorModal } from '../components/GroupOrchestratorModal'
import {
  ApiRequestError,
  apiRequest,
  type AgentDetails,
  type AgentRun,
  type AgentRunSummary,
  type AuthResponse,
  type Conversation,
  type ConversationArtifact,
  type ConversationMessage,
  type ConversationTask,
  type CreateGroupConversationResponse,
  type DaemonDevice,
  type LocalRun,
  type ConversationMention,
  type RuntimeKind,
  type RunEvent,
  type SendConversationMessageMode,
  type SendConversationMessageResponse,
  type UpdateAgentResponse,
  type UpdateGroupConversationResponse,
  type User,
  type WorkspaceView,
} from '../lib/api'
import { DaemonPage } from './DaemonPage'
import { RunsPage } from './RunsPage'
import type { RoutePath, WorkspaceRoutePath } from './AuthPage'

const workspaceRouteByView: Record<WorkspaceView, WorkspaceRoutePath> = {
  chat: '/chat',
  runs: '/runs',
  daemon: '/daemon',
}
const workspaceViewByRoute: Record<WorkspaceRoutePath, WorkspaceView> = {
  '/chat': 'chat',
  '/runs': 'runs',
  '/daemon': 'daemon',
}
const selectedConversationStoragePrefix = 'agenthub.workspace.selectedConversation'
const conversationDraftsStoragePrefix = 'agenthub.workspace.conversationDrafts'

function userScopedStorageKey(prefix: string, userId: string): string {
  return `${prefix}.${userId}`
}

function readSelectedConversationId(userId: string): string | null {
  return window.localStorage.getItem(
    userScopedStorageKey(selectedConversationStoragePrefix, userId),
  )
}

function writeSelectedConversationId(userId: string, conversationId: string): void {
  window.localStorage.setItem(
    userScopedStorageKey(selectedConversationStoragePrefix, userId),
    conversationId,
  )
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
  route: WorkspaceRoutePath
  navigate: (path: RoutePath) => void
}

export function WorkspacePage({ route, navigate }: WorkspacePageProps) {
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [devices, setDevices] = useState<DaemonDevice[]>([])
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [agents, setAgents] = useState<AgentDetails[]>([])
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
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ConversationMessage[]>>({})
  const [tasksByConversation, setTasksByConversation] = useState<Record<string, ConversationTask[]>>({})
  const [artifactsByConversation, setArtifactsByConversation] = useState<Record<string, ConversationArtifact[]>>({})
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [runs, setRuns] = useState<LocalRun[]>([])
  const [eventsByRun, setEventsByRun] = useState<Record<string, RunEvent[]>>({})
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [isCreatingRun, setIsCreatingRun] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [accountExpanded, setAccountExpanded] = useState(false)

  const activeView = workspaceViewByRoute[route]
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
  const activeConversationTasks = useMemo(
    () => (activeConversationId === null ? [] : tasksByConversation[activeConversationId] ?? []),
    [activeConversationId, tasksByConversation],
  )
  const activeConversationArtifacts = useMemo(
    () => (activeConversationId === null ? [] : artifactsByConversation[activeConversationId] ?? []),
    [activeConversationId, artifactsByConversation],
  )

  const activateConversation = useCallback((conversationId: string) => {
    if (user) {
      writeSelectedConversationId(user.id, conversationId)
      setPrompt(readConversationDraft(user.id, conversationId))
    } else {
      setPrompt('')
    }

    setActiveConversationId(conversationId)
  }, [user])

  const updatePrompt = useCallback((value: string) => {
    setPrompt(value)

    if (user && activeConversationId !== null) {
      writeConversationDraft(user.id, activeConversationId, value)
    }
  }, [activeConversationId, user])

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
      const savedConversationId = user ? readSelectedConversationId(user.id) : null
      const nextConversationId =
        activeConversationId !== null && conversationIds.has(activeConversationId)
          ? activeConversationId
          : savedConversationId !== null && conversationIds.has(savedConversationId)
            ? savedConversationId
            : conversations[0]?.id ?? null

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
  }, [activateConversation, activeConversationId, user])

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
      const response = await apiRequest<{ tasks: ConversationTask[] }>(
        `/conversations/${conversationId}/tasks`,
      )
      setTasksByConversation((current) => ({
        ...current,
        [conversationId]: response.tasks,
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
    }, 0)
    const timer = window.setInterval(() => {
      void loadAgents()
    }, 10000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [loadAgents, user])

  useEffect(() => {
    if (!user) {
      return
    }

    const initialTimer = window.setTimeout(() => {
      void loadConversations()
    }, 0)
    const timer = window.setInterval(() => {
      void loadConversations()
    }, 10000)

    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [loadConversations, user])

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
    if (!agents.some((agent) => agent.runtimeBinding.status === 'pending' || agent.workspace.status === 'pending')) {
      return
    }

    const timer = window.setInterval(() => {
      void loadAgents()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [agents, loadAgents])

  useEffect(() => {
    const activeRunIds = runs
      .filter((localRun) => localRun.run.status === 'queued' || localRun.run.status === 'running')
      .map((localRun) => localRun.run.id)

    if (activeRunIds.length === 0) {
      return
    }

    const timer = window.setInterval(() => {
      activeRunIds.forEach((runId) => {
        void refreshRun(runId)
      })
    }, 2000)

    return () => window.clearInterval(timer)
  }, [refreshRun, runs])

  useEffect(() => {
    if (selectedRunId === null) {
      return
    }

    const timer = window.setTimeout(() => {
      void refreshRun(selectedRunId)
    }, 0)

    return () => window.clearTimeout(timer)
  }, [refreshRun, selectedRunId])

  useEffect(() => {
    const hasActiveConversationRuns =
      activeConversationId !== null &&
      runs.some(
        (localRun) =>
          localRun.channelId === activeConversationId &&
          (localRun.run.status === 'queued' || localRun.run.status === 'running'),
      )

    if (
      activeConversationId === null ||
      (!hasActiveConversationRuns &&
        !activeConversationMessages.some((message) => message.status === 'streaming'))
    ) {
      return
    }

    const timer = window.setInterval(() => {
      void loadMessages(activeConversationId)
      void loadTasks(activeConversationId)
      void loadArtifacts(activeConversationId)
    }, 2000)

    return () => window.clearInterval(timer)
  }, [activeConversationId, activeConversationMessages, loadArtifacts, loadMessages, loadTasks, runs])

  const submitRun = async (
    event: FormEvent<HTMLFormElement>,
    mode: SendConversationMessageMode,
    mentions: ConversationMention[],
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
            ...(activeConversation.type === 'group' && mentions.length > 0
              ? { mentions }
              : {}),
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
    navigate('/login')
  }

  const refreshWorkspace = () => {
    void loadDevices()
    void loadAgents()
    void loadConversations()
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
  const navigateToView = (view: WorkspaceView) => {
    navigate(workspaceRouteByView[view])
  }
  const selectConversation = (conversationId: string) => {
    if (activeConversationId !== conversationId) {
      setSelectedRunId(null)
    }
    setRunError(null)
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
      activateConversation(response.conversation.id)
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
  const createAgent = async (input: {
    name: string
    description?: string
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
      activateConversation(conversationResponse.conversation.id)
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
  const updateAgent = async (input: { name: string; description?: string }) => {
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
      />
      {activeView === 'chat' ? (
        <>
          <ChatSidebar
            conversations={conversations}
            activeRunCount={activeRunCount}
            agents={agents}
            activeConversationId={activeConversationId}
            onCreateAgent={() => openCreateAgent()}
            onCreateGroup={openCreateGroup}
            selectGroup={selectConversation}
            selectAgent={(agentId) => {
              void selectAgentConversation(agentId)
            }}
          />
          <ChannelWorkspace
            activeConversation={activeConversation}
            messages={activeConversationMessages}
            tasks={activeConversationTasks}
            artifacts={activeConversationArtifacts}
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
            openEditConversation={openEditActiveConversation}
            refreshArtifacts={() => {
              if (activeConversation?.id) {
                void loadArtifacts(activeConversation.id)
              }
            }}
          />
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
            onSave={updateGroup}
          />
        )
      )}
    </main>
  )
}
