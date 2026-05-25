import { InlineNotification, SkeletonText } from '@carbon/react'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgentCreateModal } from '../components/AgentCreateModal'
import { AppRail } from '../components/AppRail'
import { ChannelWorkspace } from '../components/ChannelWorkspace'
import { ChatSidebar } from '../components/ChatSidebar'
import {
  ApiRequestError,
  apiRequest,
  type AgentDetails,
  type AgentRun,
  type AuthResponse,
  type DaemonDevice,
  type LocalRun,
  type RuntimeKind,
  type RunEvent,
  type User,
  type WorkspaceView,
} from '../lib/api'
import { getChatTargetId, groupChatId, type ChatTarget } from '../lib/chat'
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

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
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
  const [defaultAgentDaemonId, setDefaultAgentDaemonId] = useState<string | null>(null)
  const [activeChatTarget, setActiveChatTarget] = useState<ChatTarget | null>(null)
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
  const orderedRuns = useMemo(() => [...runs].reverse(), [runs])
  const readyAgentCount = useMemo(() => agents.filter(isAgentReady).length, [agents])
  const activeChatId = useMemo(
    () => (activeChatTarget === null ? null : getChatTargetId(activeChatTarget)),
    [activeChatTarget],
  )
  const visibleRuns = useMemo(
    () => (activeChatId === null ? [] : orderedRuns.filter((localRun) => localRun.channelId === activeChatId)),
    [activeChatId, orderedRuns],
  )
  const selectedAgent = useMemo(
    () =>
      activeChatTarget?.type === 'agent'
        ? agents.find((agent) => agent.agent.id === activeChatTarget.id) ?? null
        : null,
    [activeChatTarget, agents],
  )
  const defaultReadyAgent = useMemo(() => agents.find(isAgentReady) ?? null, [agents])
  const runAgent =
    activeChatTarget?.type === 'agent'
      ? selectedAgent
      : activeChatTarget?.type === 'group'
        ? defaultReadyAgent
        : null
  const selectedRunVisible = visibleRuns.some((localRun) => localRun.run.id === selectedRunId)

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
      setActiveChatTarget((current) => {
        if (
          current?.type === 'agent' &&
          !response.agents.some((agent) => agent.agent.id === current.id)
        ) {
          return null
        }

        return current
      })
      setAgentError(null)
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setAgentError(error.message)
      } else {
        setAgentError('Unable to load agents.')
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

  const submitRun = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt || isCreatingRun) {
      return
    }

    if (activeChatTarget === null || activeChatId === null) {
      setRunError('Select a conversation before sending a message.')
      return
    }

    if (!runAgent || !isAgentReady(runAgent)) {
      setRunError(
        activeChatTarget.type === 'agent'
          ? 'Selected agent is not ready to receive messages.'
          : 'Create a ready agent before sending a group message.',
      )
      return
    }

    setRunError(null)
    setIsCreatingRun(true)

    try {
      const response = await apiRequest<{ run: AgentRun; queueMessageId: string }>('/runs', {
        method: 'POST',
        body: JSON.stringify({
          prompt: trimmedPrompt,
          agentId: runAgent.agent.id,
        }),
      })

      setRuns((current) => [
        {
          channelId: activeChatId,
          agentName: runAgent.agent.name,
          prompt: trimmedPrompt,
          run: response.run,
        },
        ...current,
      ])
      setSelectedRunId(response.run.id)
      setPrompt('')
      void refreshRun(response.run.id)
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
    runs.forEach((localRun) => {
      void refreshRun(localRun.run.id)
    })
  }
  const navigateToView = (view: WorkspaceView) => {
    navigate(workspaceRouteByView[view])
  }
  const selectChatTarget = (target: ChatTarget) => {
    if (activeChatId !== getChatTargetId(target)) {
      setPrompt('')
      setSelectedRunId(null)
    }
    setRunError(null)
    setActiveChatTarget(target)
  }
  const openCreateAgent = (daemonDeviceId?: string) => {
    setDefaultAgentDaemonId(daemonDeviceId ?? null)
    setAgentCreateError(null)
    setAgentModalOpen(true)
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
      setPrompt('')
      setSelectedRunId(null)
      setActiveChatTarget({ type: 'agent', id: response.agent.agent.id })
      setAgentModalOpen(false)
      void loadAgents()
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
            runs={runs}
            activeRunCount={activeRunCount}
            agents={agents}
            activeChatTarget={activeChatTarget}
            onCreateAgent={() => openCreateAgent()}
            selectGroup={() => selectChatTarget({ type: 'group', id: groupChatId })}
            selectAgent={(agentId) => selectChatTarget({ type: 'agent', id: agentId })}
          />
          <ChannelWorkspace
            runs={visibleRuns}
            eventsByRun={eventsByRun}
            prompt={prompt}
            isCreatingRun={isCreatingRun}
            runError={runError ?? agentError}
            selectedRunId={selectedRunVisible ? selectedRunId : null}
            activeChatTarget={activeChatTarget}
            selectedAgent={selectedAgent}
            runAgent={runAgent}
            readyAgentCount={readyAgentCount}
            setPrompt={setPrompt}
            submitRun={submitRun}
            selectRun={setSelectedRunId}
            openCreateAgent={() => openCreateAgent()}
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
    </main>
  )
}
