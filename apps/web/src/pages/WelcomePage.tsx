import {
  InlineLoading,
  InlineNotification,
  Select,
  SelectItem,
  SkeletonText,
  Tag,
  TextArea,
  TextInput,
} from '@carbon/react'
import {
  ArrowLeft,
  ChatBot,
  CheckmarkFilled,
  CircleDash,
  Copy,
  Folder,
  Launch,
  Task,
} from '@carbon/react/icons'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import type { FormEvent } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgentMemberSelector } from '../components/AgentMemberSelector'
import {
  ApiRequestError,
  apiRequest,
  type AgentDetails,
  type Conversation,
  type CreateGroupConversationResponse,
  type CreateProjectConversationResponse,
  type DaemonDevice,
  type DaemonRegistrationCommandResponse,
  type RuntimeKind,
  type WelcomeSummary,
} from '../lib/api'
import { formatMessageTime } from '../lib/format'

interface WelcomePageProps {
  agents: AgentDetails[]
  devices: DaemonDevice[]
  error: string | null
  isLoading: boolean
  summary: WelcomeSummary | null
  onCreateAgentStarted: () => void
  onOpenConversation: (conversationId: string) => void
  onOpenCreateAgent: () => void
  onOpenCreateGroup: () => void
  onOpenCreateProject: () => void
  onOpenDaemon: () => void
  onOpenDeployments: (conversationId: string) => void
  onOpenGoal: (conversationId: string, goalId: string, taskIndex?: number | null) => void
  onOpenMessage: (conversationId: string, messageId: string) => void
  onRefreshData: () => void
  onWelcomeUpdated: (summary: WelcomeSummary) => void
}

const panelClass = 'rounded-2xl border border-[#e4e7ec] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]'
const subtleButton =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#d8dee6] bg-white px-3 text-sm font-semibold text-[#344054] shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-[#c7d0dc] hover:bg-[#f7f8fa] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:border-[#e1e5ea] disabled:bg-[#f4f4f4] disabled:text-[#a2a9b0] disabled:shadow-none'
const primaryButton =
  'inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#0f62fe] bg-[#0f62fe] px-3 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(15,23,42,0.12)] transition hover:border-[#0353e9] hover:bg-[#0353e9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:border-[#a6c8ff] disabled:bg-[#a6c8ff] disabled:text-white disabled:shadow-none'
const inlineLink =
  'cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const roundedFieldStyles = `
  .welcome-rounded-fields .cds--text-input,
  .welcome-rounded-fields .cds--text-area,
  .welcome-rounded-fields .cds--select-input {
    border: 1px solid #d8dee6;
    border-radius: 0.75rem;
    background: #fff;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
  }

  .welcome-rounded-fields .cds--text-input:focus,
  .welcome-rounded-fields .cds--text-area:focus,
  .welcome-rounded-fields .cds--select-input:focus {
    border-color: #b9c3cf;
    outline: 2px solid var(--cds-focus);
    outline-offset: 2px;
  }

  .welcome-rounded-fields .cds--text-input:disabled,
  .welcome-rounded-fields .cds--text-area:disabled,
  .welcome-rounded-fields .cds--select-input:disabled {
    border-color: #e1e5ea;
    background: #f4f4f4;
    box-shadow: none;
  }

  .welcome-card-deck {
    height: clamp(34rem, calc(100vh - 12rem), 44rem);
    min-height: 34rem;
  }

  .welcome-onboarding-card {
    transition:
      left 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      opacity 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      transform 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      box-shadow 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    will-change: left, transform, opacity;
  }

  @media (prefers-reduced-motion: reduce) {
    .welcome-onboarding-card {
      transition: none;
    }
  }

  @media (max-width: 900px) {
    .welcome-card-deck {
      height: auto;
      min-height: 0;
    }

    .welcome-onboarding-card {
      position: relative !important;
      left: auto !important;
      top: auto !important;
      transform: none !important;
      width: 100%;
      min-height: 0;
      margin-top: -0.75rem;
    }
  }
`

function detectDaemonCommandPlatform(): 'windows' | 'posix' {
  if (typeof navigator === 'undefined') {
    return 'posix'
  }

  return /Win/i.test(navigator.platform) ? 'windows' : 'posix'
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.agent.status === 'active' &&
    agent.runtimeBinding.status === 'ready' &&
    agent.workspace.status === 'ready'
}

function readyRuntimeDevices(devices: DaemonDevice[]): DaemonDevice[] {
  return devices
    .filter((device) => device.status === 'online')
    .map((device) => ({
      ...device,
      runtimes: device.runtimes.filter((runtime) => runtime.status === 'ready'),
    }))
    .filter((device) => device.runtimes.length > 0)
}

function compactPreview(value: string): string {
  const compacted = value.replace(/\s+/g, ' ').trim()
  if (compacted.length === 0) {
    return 'No text content'
  }

  return compacted.length > 110 ? `${compacted.slice(0, 107)}...` : compacted
}

function conversationLabel(conversation: Conversation): string {
  if (conversation.type === 'group') {
    return `#${conversation.title}`
  }

  if (conversation.type === 'project') {
    return conversation.title
  }

  return conversation.title
}

function StepIcon({ complete }: { complete: boolean }) {
  return complete ? (
    <CheckmarkFilled className="text-[#24a148]" size={22} />
  ) : (
    <CircleDash className="text-[#8d8d8d]" size={22} />
  )
}

type OnboardingStepId = 'daemon' | 'agent' | 'workspace'
const onboardingSteps: Array<{
  description: string;
  id: OnboardingStepId;
  title: string;
}> = [
  {
    description: 'Run a local daemon so Tavro can detect Codex, Claude Code, or other runtimes.',
    id: 'daemon',
    title: 'Connect a daemon',
  },
  {
    description: 'Pick a ready runtime and create your first local coding agent.',
    id: 'agent',
    title: 'Create an agent',
  },
  {
    description: 'Groups are shared chat rooms where agents can receive tasks and report progress.',
    id: 'workspace',
    title: 'Create your first group',
  },
]

export function WelcomePage({
  agents,
  devices,
  error,
  isLoading,
  summary,
  onCreateAgentStarted,
  onOpenConversation,
  onOpenCreateAgent,
  onOpenCreateGroup,
  onOpenCreateProject,
  onOpenDaemon,
  onOpenDeployments,
  onOpenGoal,
  onOpenMessage,
  onRefreshData,
  onWelcomeUpdated,
}: WelcomePageProps) {
  const [deviceName, setDeviceName] = useState('My computer')
  const [daemonCommand, setDaemonCommand] = useState<DaemonRegistrationCommandResponse | null>(null)
  const [daemonError, setDaemonError] = useState<string | null>(null)
  const [daemonLoading, setDaemonLoading] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [agentName, setAgentName] = useState('Codex')
  const [agentDescription, setAgentDescription] = useState('')
  const [agentDaemonId, setAgentDaemonId] = useState('')
  const [agentRuntimeKind, setAgentRuntimeKind] = useState<RuntimeKind | ''>('')
  const [agentError, setAgentError] = useState<string | null>(null)
  const [agentLoading, setAgentLoading] = useState(false)
  const [createdAgentName, setCreatedAgentName] = useState<string | null>(null)
  const [groupTitle, setGroupTitle] = useState('team')
  const [groupDescription, setGroupDescription] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const [orchestratorAgentId, setOrchestratorAgentId] = useState('')
  const [workspaceMode, setWorkspaceMode] = useState<'group' | 'project'>('group')
  const [projectRemoteUrl, setProjectRemoteUrl] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [completeError, setCompleteError] = useState<string | null>(null)
  const [completeLoading, setCompleteLoading] = useState(false)
  const [forceOnboardingTutorial, setForceOnboardingTutorial] = useState(false)
  const [freshOnboardingPreview, setFreshOnboardingPreview] = useState(false)
  const [activeOnboardingStep, setActiveOnboardingStep] = useState<OnboardingStepId>('daemon')

  const devMode = import.meta.env.DEV
  const availableDevices = useMemo(
    () => freshOnboardingPreview ? [] : readyRuntimeDevices(devices),
    [devices, freshOnboardingPreview],
  )
  const selectedAgentDeviceId =
    availableDevices.some((device) => device.id === agentDaemonId)
      ? agentDaemonId
      : availableDevices[0]?.id ?? ''
  const selectedAgentDevice = availableDevices.find((device) => device.id === selectedAgentDeviceId) ?? null
  const selectedRuntimeKind =
    selectedAgentDevice?.runtimes.some((runtime) => runtime.runtimeKind === agentRuntimeKind)
      ? agentRuntimeKind
      : selectedAgentDevice?.runtimes[0]?.runtimeKind ?? ''
  const readyAgents = useMemo(
    () => freshOnboardingPreview ? [] : agents.filter(isAgentReady),
    [agents, freshOnboardingPreview],
  )
  const validSelectedAgentIds = selectedAgentIds.filter((agentId) =>
    readyAgents.some((agent) => agent.agent.id === agentId),
  )
  const defaultReadyAgentId = readyAgents[0]?.agent.id ?? ''
  const effectiveSelectedAgentIds =
    validSelectedAgentIds.length > 0
      ? validSelectedAgentIds
      : defaultReadyAgentId
        ? [defaultReadyAgentId]
        : []
  const validOrchestratorAgentId = effectiveSelectedAgentIds.includes(orchestratorAgentId)
    ? orchestratorAgentId
    : effectiveSelectedAgentIds[0] ?? ''
  const onboarding = summary?.onboarding ?? null
  const daemonStepComplete =
    !freshOnboardingPreview &&
    onboarding?.prerequisites.hasOnlineDaemon === true &&
    onboarding.prerequisites.hasReadyRuntime === true
  const agentStepComplete =
    !freshOnboardingPreview && onboarding?.prerequisites.hasReadyAgent === true
  const workspaceStepComplete =
    !freshOnboardingPreview && onboarding?.prerequisites.hasWorkspaceConversation === true
  const showDashboard =
    !forceOnboardingTutorial &&
    (summary?.onboarding.completed === true || summary?.onboarding.readyToComplete === true)
  const activeOnboardingStepIndex = onboardingSteps.findIndex((step) => step.id === activeOnboardingStep)
  const isOnboardingStepComplete = (stepId: OnboardingStepId): boolean =>
    stepId === 'daemon'
      ? daemonStepComplete
      : stepId === 'agent'
        ? agentStepComplete
        : workspaceStepComplete
  const activeOnboardingStepComplete = isOnboardingStepComplete(activeOnboardingStep)
  const canAdvanceOnboarding = devMode || activeOnboardingStepComplete
  const previousOnboardingStep =
    activeOnboardingStepIndex > 0
      ? onboardingSteps[activeOnboardingStepIndex - 1]!
      : null
  const nextOnboardingStep =
    activeOnboardingStepIndex >= 0 && activeOnboardingStepIndex < onboardingSteps.length - 1
      ? onboardingSteps[activeOnboardingStepIndex + 1]!
      : null

  const completeOnboarding = useCallback(async (conversationId: string | null) => {
    setCompleteLoading(true)
    setCompleteError(null)
    try {
      const response = await apiRequest<{ welcome: WelcomeSummary }>('/welcome/onboarding/complete', {
        method: 'POST',
      })
      onWelcomeUpdated(response.welcome)
      if (conversationId !== null) {
        onOpenConversation(conversationId)
      }
    } catch (error) {
      setCompleteError(error instanceof Error ? error.message : 'Unable to complete onboarding.')
    } finally {
      setCompleteLoading(false)
    }
  }, [onOpenConversation, onWelcomeUpdated])

  const goToNextOnboardingStep = () => {
    if (nextOnboardingStep !== null) {
      setActiveOnboardingStep(nextOnboardingStep.id)
      return
    }

    if (summary?.onboarding.completed === true) {
      setFreshOnboardingPreview(false)
      setForceOnboardingTutorial(false)
      return
    }

    if (summary?.onboarding.readyToComplete === true) {
      void completeOnboarding(null)
      return
    }

    if (devMode) {
      setActiveOnboardingStep('daemon')
    }
  }

  useEffect(() => {
    if (
      forceOnboardingTutorial ||
      onboarding?.completed === true ||
      onboarding?.readyToComplete !== true ||
      completeLoading
    ) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void completeOnboarding(null)
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [
    completeLoading,
    completeOnboarding,
    forceOnboardingTutorial,
    onboarding?.completed,
    onboarding?.readyToComplete,
  ])

  useEffect(() => {
    if (!forceOnboardingTutorial && (onboarding?.completed === true || onboarding?.readyToComplete === true)) {
      return
    }

    const intervalId = window.setInterval(onRefreshData, 5000)
    return () => window.clearInterval(intervalId)
  }, [forceOnboardingTutorial, onRefreshData, onboarding?.completed, onboarding?.readyToComplete])

  const generateDaemonCommand = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = deviceName.trim().replace(/\s+/g, ' ')

    if (name.length === 0 || name.length > 80) {
      setDaemonError('Device name must be 1-80 characters.')
      return
    }

    setDaemonLoading(true)
    setDaemonError(null)
    setCommandCopied(false)
    try {
      const response = await apiRequest<DaemonRegistrationCommandResponse>('/daemon/devices', {
        method: 'POST',
        body: JSON.stringify({
          name,
          platform: detectDaemonCommandPlatform(),
        }),
      })
      setDaemonCommand(response)
      onRefreshData()
    } catch (error) {
      setDaemonError(error instanceof Error ? error.message : 'Unable to generate daemon command.')
    } finally {
      setDaemonLoading(false)
    }
  }

  const copyDaemonCommand = async () => {
    if (daemonCommand?.command === undefined) {
      return
    }

    try {
      await navigator.clipboard.writeText(daemonCommand.command)
      setCommandCopied(true)
    } catch {
      setDaemonError('Copy failed. Select the command and copy it manually.')
    }
  }

  const createAgent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = agentName.trim()

    if (!selectedAgentDeviceId || selectedRuntimeKind === '' || name.length === 0) {
      setAgentError('Choose a ready daemon runtime and enter an agent name.')
      return
    }

    setAgentLoading(true)
    setAgentError(null)
    try {
      await apiRequest('/agents', {
        method: 'POST',
        body: JSON.stringify({
          avatar: DEFAULT_AVATAR_PATHS[0],
          daemonDeviceId: selectedAgentDeviceId,
          description: agentDescription.trim() || undefined,
          name,
          runtimeKind: selectedRuntimeKind,
        }),
      })
      setCreatedAgentName(name)
      onCreateAgentStarted()
      onRefreshData()
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'Unable to create the agent.')
    } finally {
      setAgentLoading(false)
    }
  }

  const toggleAgent = (agentId: string, checked: boolean) => {
    setSelectedAgentIds((current) =>
      checked
        ? [...current, agentId]
        : current.filter((selectedAgentId) => selectedAgentId !== agentId),
    )
    if (!checked && orchestratorAgentId === agentId) {
      setOrchestratorAgentId('')
    }
  }

  const selectOrchestrator = (agentId: string | null) => {
    setOrchestratorAgentId(agentId ?? '')
    if (agentId) {
      setSelectedAgentIds((current) => current.includes(agentId) ? current : [...current, agentId])
    }
  }

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (effectiveSelectedAgentIds.length === 0) {
      setWorkspaceError('Choose at least one ready agent.')
      return
    }

    setWorkspaceLoading(true)
    setWorkspaceError(null)
    try {
      const response =
        workspaceMode === 'group'
          ? await apiRequest<CreateGroupConversationResponse>('/conversations/groups', {
              method: 'POST',
              body: JSON.stringify({
                agentIds: effectiveSelectedAgentIds,
                description: groupDescription.trim() || undefined,
                orchestratorAgentId: validOrchestratorAgentId || undefined,
                title: groupTitle.trim(),
              }),
            })
          : await apiRequest<CreateProjectConversationResponse>('/conversations/projects', {
              method: 'POST',
              body: JSON.stringify({
                agentIds: effectiveSelectedAgentIds,
                description: groupDescription.trim() || undefined,
                orchestratorAgentId: validOrchestratorAgentId || undefined,
                remoteUrl: projectRemoteUrl.trim(),
                title: projectTitle.trim() || undefined,
              }),
            })

      onRefreshData()
      await completeOnboarding(response.conversation.id)
    } catch (error) {
      if (error instanceof ApiRequestError && error.code === 'GROUP_ALREADY_EXISTS') {
        setWorkspaceError('A group with this name already exists.')
      } else {
        setWorkspaceError(error instanceof Error ? error.message : 'Unable to create the workspace.')
      }
    } finally {
      setWorkspaceLoading(false)
    }
  }

  if (isLoading || summary === null) {
    return (
      <section className="h-full min-h-0 overflow-y-auto bg-white p-6" aria-label="Welcome">
        <div className="mx-auto grid max-w-5xl gap-5">
          <SkeletonText heading width="180px" />
          <SkeletonText paragraph lineCount={6} width="100%" />
        </div>
      </section>
    )
  }

  if (error !== null) {
    return (
      <section className="h-full min-h-0 overflow-y-auto bg-white p-6" aria-label="Welcome">
        <InlineNotification
          kind="error"
          title="Welcome unavailable"
          subtitle={error}
          lowContrast
          hideCloseButton
        />
      </section>
    )
  }

  if (showDashboard) {
    return (
      <section className="h-full min-h-0 overflow-y-auto bg-[#fafafa] p-6 max-[671px]:p-4" aria-label="Welcome dashboard">
        <div className="mx-auto grid max-w-6xl gap-5">
          <header className="flex items-start justify-between gap-4 max-[671px]:grid">
            <div className="grid gap-1">
              <h1 className="text-2xl font-semibold leading-8 text-[#161616]">Welcome back</h1>
              <p className="text-sm text-[#69707d]">Pick up recent conversations, tasks, and deployments.</p>
            </div>
            {devMode && (
              <div className="flex flex-wrap justify-end gap-2">
                <button
                  className={subtleButton}
                  type="button"
                  onClick={() => {
                    setActiveOnboardingStep('daemon')
                    setFreshOnboardingPreview(false)
                    setForceOnboardingTutorial(true)
                  }}
                >
                  <ArrowLeft size={16} />
                  Tutorial
                </button>
                <button
                  className={subtleButton}
                  type="button"
                  onClick={() => {
                    setActiveOnboardingStep('daemon')
                    setFreshOnboardingPreview(true)
                    setForceOnboardingTutorial(true)
                  }}
                >
                  Fresh start
                </button>
              </div>
            )}
          </header>

          <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] gap-5 max-[960px]:grid-cols-1">
            <section className={panelClass} aria-label="Continue chatting">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[#69707d]">Continue chatting</h2>
                <ChatBot size={20} />
              </div>
              {summary.dashboard.conversations.length === 0 ? (
                <p className="text-sm text-[#69707d]">No recent conversations yet.</p>
              ) : (
                <div className="grid gap-2">
                  {summary.dashboard.conversations.map(({ conversation }) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className="grid min-h-12 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border-0 bg-[#f7f8fa] px-3 py-2 text-left hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      onClick={() => onOpenConversation(conversation.id)}
                    >
                      <span className="min-w-0">
                        <strong className="block truncate text-[#161616]">{conversationLabel(conversation)}</strong>
                        <small className="text-[#69707d]">{formatMessageTime(conversation.lastMessageAt ?? conversation.updatedAt)}</small>
                      </span>
                      <Launch size={16} />
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className={panelClass} aria-label="Quick actions">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#69707d]">Quick actions</h2>
              <div className="grid gap-2">
                <button className={subtleButton} type="button" onClick={onOpenCreateAgent}>Create agent</button>
                <button className={subtleButton} type="button" onClick={onOpenCreateGroup}>Create group</button>
                <button className={subtleButton} type="button" onClick={onOpenCreateProject}>Create project</button>
                <button className={subtleButton} type="button" onClick={onOpenDaemon}>Manage daemon</button>
              </div>
            </section>
          </div>

          <section className={panelClass} aria-label="Recent messages">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[#69707d]">Recent messages</h2>
            {summary.dashboard.messages.length === 0 ? (
              <p className="text-sm text-[#69707d]">Messages from chats and projects will appear here.</p>
            ) : (
              <div className="grid gap-2">
                {summary.dashboard.messages.map(({ conversation, message }) => (
                  <button
                    key={message.id}
                    type="button"
                    className="grid cursor-pointer gap-1 rounded-xl border-0 bg-[#f7f8fa] px-3 py-2 text-left hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                    onClick={() => onOpenMessage(conversation.id, message.id)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <strong className="truncate text-sm text-[#161616]">{conversationLabel(conversation)}</strong>
                      <Tag size="sm" type={message.senderType === 'user' ? 'blue' : 'gray'}>{message.senderType}</Tag>
                      <time className="text-xs text-[#69707d]" dateTime={message.updatedAt}>{formatMessageTime(message.updatedAt)}</time>
                    </span>
                    <span className="text-sm text-[#596171]">{compactPreview(message.content)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 gap-5 max-[960px]:grid-cols-1">
            <section className={panelClass} aria-label="Recent goals and tasks">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[#69707d]">Recent goals / tasks</h2>
                <Task size={20} />
              </div>
              {summary.dashboard.goals.length === 0 ? (
                <p className="text-sm text-[#69707d]">Use Task mode in a group or project to create goals.</p>
              ) : (
                <div className="grid gap-2">
                  {summary.dashboard.goals.map(({ conversation, goal, taskCounts }) => (
                    <button
                      key={goal.id}
                      type="button"
                      className="grid cursor-pointer gap-2 rounded-xl border-0 bg-[#f7f8fa] px-3 py-2 text-left hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      onClick={() => onOpenGoal(conversation.id, goal.id)}
                    >
                      <span className="flex min-w-0 items-center justify-between gap-3">
                        <strong className="truncate text-[#161616]">{goal.title}</strong>
                        <Tag size="sm" type={goal.status === 'completed' ? 'green' : goal.status === 'failed' ? 'red' : 'blue'}>
                          {goal.status}
                        </Tag>
                      </span>
                      <span className="flex flex-wrap gap-1.5 text-xs text-[#69707d]">
                        <span>{conversationLabel(conversation)}</span>
                        {Object.entries(taskCounts).map(([status, count]) => (
                          <span key={status}>{status}: {count}</span>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className={panelClass} aria-label="Recent deployments">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[#69707d]">Recent deployments</h2>
                <Folder size={20} />
              </div>
              {summary.dashboard.deployments.length === 0 ? (
                <p className="text-sm text-[#69707d]">Static site deployments will appear here.</p>
              ) : (
                <div className="grid gap-2">
                  {summary.dashboard.deployments.map(({ conversation, deployment }) => (
                    <button
                      key={deployment.id}
                      type="button"
                      className="grid cursor-pointer gap-1 rounded-xl border-0 bg-[#f7f8fa] px-3 py-2 text-left hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      onClick={() => onOpenDeployments(conversation.id)}
                    >
                      <span className="flex min-w-0 items-center justify-between gap-3">
                        <strong className="truncate text-[#161616]">{deployment.title}</strong>
                        <Tag size="sm" type={deployment.status === 'ready' ? 'green' : 'red'}>{deployment.status}</Tag>
                      </span>
                      <span className="truncate text-xs text-[#69707d]">{conversationLabel(conversation)} · {deployment.entrypoint}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="h-full min-h-0 overflow-y-auto bg-[#fafafa] p-6 max-[671px]:p-4" aria-label="Welcome onboarding">
      <div className="flex min-h-full w-full flex-col gap-5">
        <header className="flex items-start justify-between gap-4 max-[671px]:grid">
          <div className="grid gap-1">
            <h1 className="text-2xl font-semibold leading-8 text-[#161616]">Set up Tavro</h1>
            <p className="text-sm text-[#69707d]">Let’s connect your local runtime, create an agent, and open your first workspace.</p>
          </div>
          {devMode && forceOnboardingTutorial && (
            <button
              className={subtleButton}
              type="button"
              onClick={() => {
                setFreshOnboardingPreview(false)
                setActiveOnboardingStep('daemon')
                setForceOnboardingTutorial(false)
              }}
            >
              Back to dashboard
            </button>
          )}
        </header>

        {completeError && (
          <InlineNotification
            kind="error"
            title="Onboarding was not completed"
            subtitle={completeError}
            lowContrast
            hideCloseButton
          />
        )}

        <div className="welcome-card-deck relative overflow-visible max-[900px]:grid max-[900px]:gap-0">
          <style>{roundedFieldStyles}</style>
          {onboardingSteps.map((step, stepIndex) => {
            const isActive = step.id === activeOnboardingStep
            const stepComplete = isOnboardingStepComplete(step.id)
            const distanceFromActive = Math.abs(stepIndex - activeOnboardingStepIndex)
            const horizontalOffset =
              stepIndex < activeOnboardingStepIndex
                ? `-${distanceFromActive * 0.35}rem`
                : stepIndex > activeOnboardingStepIndex
                  ? `${distanceFromActive * 0.35}rem`
                  : '0'
            const positionClass =
              stepIndex === 0
                ? 'left-0'
                : stepIndex === 1
                  ? 'left-[26%]'
                  : 'left-[52%]'
            const toneClass = isActive
              ? 'border-[#e4e7ec] bg-white shadow-[0_18px_42px_rgba(15,23,42,0.14)]'
              : distanceFromActive > 1
                ? 'border-[#c7d0dc] bg-[#d8dee6] shadow-[0_8px_18px_rgba(15,23,42,0.08)]'
                : 'border-[#d8dee6] bg-[#eef0f4] shadow-[0_12px_26px_rgba(15,23,42,0.1)]'

            return (
              <section
                key={step.id}
                aria-hidden={!isActive}
                aria-label={step.title}
                className={`welcome-onboarding-card welcome-rounded-fields absolute top-0 flex h-full min-h-[34rem] w-[48%] flex-col rounded-2xl border p-5 ${positionClass} ${toneClass} ${isActive ? 'pointer-events-auto' : 'pointer-events-none'} max-[900px]:h-auto max-[900px]:min-h-0 max-[900px]:w-full`}
                style={{
                  opacity: isActive ? 1 : distanceFromActive > 1 ? 0.82 : 0.92,
                  transform: isActive
                    ? 'translateX(0) translateY(0) scale(1)'
                    : `translateX(${horizontalOffset}) translateY(${distanceFromActive * 1.15}rem) scale(${distanceFromActive > 1 ? 0.92 : 0.95})`,
                  zIndex: isActive ? 30 : 20 - distanceFromActive,
                }}
              >
                {isActive ? (
                  <>
          <div className="flex items-start justify-between gap-4 border-b border-[#edf0f4] pb-5 max-[671px]:grid">
            <div className="flex min-w-0 items-start gap-3">
              <StepIcon complete={stepComplete} />
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                  Step {stepIndex + 1} of {onboardingSteps.length}
                </p>
                <h2 className="text-xl font-semibold leading-7 text-[#161616]">{step.title}</h2>
                <p className="mt-1 text-sm text-[#69707d]">{step.description}</p>
              </div>
            </div>
            <Tag type={stepComplete ? 'green' : 'gray'}>
              {stepComplete ? 'Completed' : 'Pending'}
            </Tag>
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-center py-8">
            {activeOnboardingStep === 'daemon' && (
              daemonStepComplete ? (
                <div className="grid max-w-2xl gap-4">
                  <Tag type="green">Connected</Tag>
                  <p className="text-sm text-[#69707d]">A daemon with a ready runtime is online. You can manage it from the Daemon page later.</p>
                  <div>
                    <button className={subtleButton} type="button" onClick={onOpenDaemon}>Manage daemon</button>
                  </div>
                </div>
              ) : (
                <form className="grid max-w-3xl gap-3" onSubmit={(event) => void generateDaemonCommand(event)}>
                  {daemonError && (
                    <InlineNotification kind="error" title="Daemon command failed" subtitle={daemonError} lowContrast hideCloseButton />
                  )}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 max-[671px]:grid-cols-1">
                    <TextInput
                      id="welcome-daemon-name"
                      labelText="Device name"
                      value={deviceName}
                      maxLength={80}
                      onChange={(event) => setDeviceName(event.target.value)}
                    />
                    <button className={primaryButton} type="submit" disabled={daemonLoading}>
                      {daemonLoading ? <InlineLoading description="Generating" /> : 'Generate command'}
                    </button>
                  </div>
                  {daemonCommand && (
                    <div className="grid gap-2">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                        <pre className="min-w-0 overflow-auto rounded-xl border border-[#dde1e6] bg-[#161616] p-3 text-xs leading-relaxed text-white">
                          {daemonCommand.command}
                        </pre>
                        <button className={subtleButton} type="button" onClick={() => void copyDaemonCommand()} aria-label="Copy daemon command">
                          {commandCopied ? <CheckmarkFilled size={16} /> : <Copy size={16} />}
                        </button>
                      </div>
                      <InlineNotification
                        kind="warning"
                        title="Waiting for daemon connection"
                        subtitle="Run the command in your terminal. This page refreshes while Tavro waits for the daemon."
                        lowContrast
                        hideCloseButton
                      />
                    </div>
                  )}
                </form>
              )
            )}

            {activeOnboardingStep === 'agent' && (
              agentStepComplete ? (
                <div className="grid max-w-2xl gap-4">
                  <Tag type="green">Ready agent available</Tag>
                  <p className="text-sm text-[#69707d]">Your first agent is ready. You can open it from the Agents area or create more agents later.</p>
                  <div>
                    <button className={subtleButton} type="button" onClick={onOpenCreateAgent}>Create another agent</button>
                  </div>
                </div>
              ) : (
                <form className="grid max-w-3xl gap-3" onSubmit={(event) => void createAgent(event)}>
                  {agentError && (
                    <InlineNotification kind="error" title="Agent was not created" subtitle={agentError} lowContrast hideCloseButton />
                  )}
                  {availableDevices.length === 0 && (
                    <InlineNotification
                      kind="warning"
                      title="No ready runtime"
                      subtitle="Connect a daemon with a ready runtime before creating an agent."
                      lowContrast
                      hideCloseButton
                    />
                  )}
                  <TextInput
                    id="welcome-agent-name"
                    labelText="Agent name"
                    value={agentName}
                    disabled={agentLoading}
                    maxLength={120}
                    onChange={(event) => setAgentName(event.target.value)}
                  />
                  <TextArea
                    id="welcome-agent-description"
                    labelText="Description"
                    rows={3}
                    value={agentDescription}
                    disabled={agentLoading}
                    onChange={(event) => setAgentDescription(event.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-3 max-[671px]:grid-cols-1">
                    <Select
                      id="welcome-agent-daemon"
                      labelText="Daemon"
                      value={selectedAgentDeviceId}
                      disabled={agentLoading || availableDevices.length === 0}
                      onChange={(event) => {
                        setAgentDaemonId(event.target.value)
                        setAgentRuntimeKind('')
                      }}
                    >
                      {availableDevices.length === 0 ? (
                        <SelectItem value="" text="No daemon available" />
                      ) : availableDevices.map((device) => (
                        <SelectItem key={device.id} value={device.id} text={device.name} />
                      ))}
                    </Select>
                    <Select
                      id="welcome-agent-runtime"
                      labelText="Runtime"
                      value={selectedRuntimeKind}
                      disabled={agentLoading || selectedAgentDevice === null}
                      onChange={(event) => setAgentRuntimeKind(event.target.value as RuntimeKind)}
                    >
                      {selectedAgentDevice?.runtimes.map((runtime) => (
                        <SelectItem
                          key={`${runtime.daemonDeviceId}-${runtime.runtimeKind}`}
                          value={runtime.runtimeKind}
                          text={runtime.runtimeVersion ? `${runtime.runtimeKind} (${runtime.runtimeVersion})` : runtime.runtimeKind}
                        />
                      ))}
                    </Select>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <button className={primaryButton} type="submit" disabled={agentLoading || availableDevices.length === 0}>
                      {agentLoading ? <InlineLoading description="Creating" /> : 'Create agent'}
                    </button>
                    {createdAgentName && (
                      <span className="text-sm text-[#69707d]">{createdAgentName} is provisioning. This page refreshes until it is ready.</span>
                    )}
                  </div>
                </form>
              )
            )}

            {activeOnboardingStep === 'workspace' && (
              workspaceStepComplete ? (
                <div className="grid max-w-2xl gap-4">
                  <Tag type="green">Workspace ready</Tag>
                  <p className="text-sm text-[#69707d]">Your first group or project is ready. You can return here for the dashboard after onboarding finishes.</p>
                  {completeLoading && <InlineLoading description="Finishing onboarding" />}
                </div>
              ) : (
                <form className="grid max-w-3xl gap-3" onSubmit={(event) => void createWorkspace(event)}>
                  {workspaceError && (
                    <InlineNotification kind="error" title="Workspace was not created" subtitle={workspaceError} lowContrast hideCloseButton />
                  )}
                  {readyAgents.length === 0 && (
                    <InlineNotification
                      kind="warning"
                      title="No ready agents"
                      subtitle="Wait for the agent to finish provisioning before creating a group."
                      lowContrast
                      hideCloseButton
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Tag type={workspaceMode === 'group' ? 'blue' : 'gray'}>Group</Tag>
                    <button
                      className={inlineLink}
                      type="button"
                      onClick={() => setWorkspaceMode(workspaceMode === 'group' ? 'project' : 'group')}
                    >
                      {workspaceMode === 'group' ? 'Create project instead' : 'Create group instead'}
                    </button>
                  </div>
                  {workspaceMode === 'group' ? (
                    <>
                      <TextInput
                        id="welcome-group-title"
                        labelText="Group name"
                        value={groupTitle}
                        disabled={workspaceLoading}
                        maxLength={80}
                        onChange={(event) => setGroupTitle(event.target.value)}
                      />
                      <TextArea
                        id="welcome-group-description"
                        labelText="Description"
                        rows={3}
                        value={groupDescription}
                        disabled={workspaceLoading}
                        onChange={(event) => setGroupDescription(event.target.value)}
                      />
                    </>
                  ) : (
                    <>
                      <TextInput
                        id="welcome-project-remote"
                        labelText="Git remote URL"
                        value={projectRemoteUrl}
                        disabled={workspaceLoading}
                        placeholder="https://github.com/acme/app.git"
                        onChange={(event) => setProjectRemoteUrl(event.target.value)}
                      />
                      <TextInput
                        id="welcome-project-title"
                        labelText="Project name"
                        value={projectTitle}
                        disabled={workspaceLoading}
                        maxLength={80}
                        placeholder="Inferred from remote if empty"
                        onChange={(event) => setProjectTitle(event.target.value)}
                      />
                    </>
                  )}
                  <AgentMemberSelector
                    agents={readyAgents}
                    disabled={workspaceLoading || readyAgents.length === 0}
                    helpText="The first ready agent is selected as orchestrator by default."
                    idPrefix="welcome-workspace-agent"
                    orchestratorAgentId={validOrchestratorAgentId}
                    selectedAgentIds={effectiveSelectedAgentIds}
                    onSelectOrchestrator={selectOrchestrator}
                    onToggleAgent={toggleAgent}
                  />
                  <button
                    className={primaryButton}
                    type="submit"
                    disabled={
                      workspaceLoading ||
                      readyAgents.length === 0 ||
                      effectiveSelectedAgentIds.length === 0 ||
                      (workspaceMode === 'group' ? groupTitle.trim().length === 0 : projectRemoteUrl.trim().length === 0)
                    }
                  >
                    {workspaceLoading ? <InlineLoading description="Creating" /> : workspaceMode === 'group' ? 'Create group' : 'Create project'}
                  </button>
                </form>
              )
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-[#edf0f4] pt-5 max-[671px]:grid">
            <button
              className={subtleButton}
              type="button"
              disabled={previousOnboardingStep === null}
              onClick={() => {
                if (previousOnboardingStep !== null) {
                  setActiveOnboardingStep(previousOnboardingStep.id)
                }
              }}
            >
              Back
            </button>
            <span className="text-center text-sm text-[#69707d]">
              {activeOnboardingStepComplete
                ? 'Step complete. Continue when ready.'
                : devMode
                  ? 'Development mode lets you preview the next step.'
                  : 'Complete this step to continue.'}
            </span>
            <button
              className={primaryButton}
              type="button"
              disabled={!canAdvanceOnboarding || completeLoading}
              onClick={goToNextOnboardingStep}
            >
              {nextOnboardingStep !== null
                ? 'Next'
                : completeLoading
                  ? <InlineLoading description="Finishing" />
                  : 'Finish'}
            </button>
          </footer>
                  </>
                ) : (
                  <div className="flex h-full min-h-0 flex-col gap-4">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <StepIcon complete={stepComplete} />
                        <div className="min-w-0">
                          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                            Step {stepIndex + 1} of {onboardingSteps.length}
                          </p>
                          <h3 className="truncate text-lg font-semibold leading-7 text-[#161616]">{step.title}</h3>
                        </div>
                      </div>
                      <Tag type={stepComplete ? 'green' : 'gray'}>
                        {stepComplete ? 'Completed' : 'Pending'}
                      </Tag>
                    </div>
                    <p className="line-clamp-3 text-sm leading-6 text-[#596171]">{step.description}</p>
                    <div className="mt-auto border-t border-black/10 pt-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[#69707d]">
                        {stepComplete ? 'Ready' : 'Upcoming'}
                      </p>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-[#596171]">
                        {stepComplete
                          ? 'This step is complete and stays available for review.'
                          : 'Select this step with Next or Back to continue setup.'}
                      </p>
                    </div>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}
