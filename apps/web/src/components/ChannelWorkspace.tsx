import { Form, IconButton, InlineLoading, InlineNotification, Loading, Tag } from '@carbon/react'
import { Attachment, ChatBot, CheckmarkFilled, ChevronDown, ChevronRight, CircleDash, CircleFilled, Close, Code, Document, Folder, Image as ImageIcon, InProgress, IncompleteError, Launch, PauseOutline, Return, Settings, StopFilled, Task, UserAdmin, WarningSquare } from '@carbon/react/icons'
import type { CarbonIconType } from '@carbon/react/icons'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentDetails, Conversation, ConversationArtifact, ConversationDeployment, ConversationGoal, ConversationGoalTaskStatus, ConversationMessage, User } from '../lib/api'
import { apiUrl } from '../lib/api'
import { formatMessageTime } from '../lib/format'
import { getProjectIcon } from '../lib/projectIcon'
import { ArtifactWorkspace } from './ArtifactWorkspace'
import { MessageContent } from './MessageContent'
import { ProjectWorkspace } from './ProjectWorkspace'

const inlineLink =
  'cursor-pointer border-0 bg-transparent p-0 font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const messageBodyClass = 'block whitespace-pre-wrap break-words text-base leading-5'
const taskStatusOrder = [
  'waiting',
  'ready',
  'assigned',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'blocked',
] as const satisfies readonly ConversationGoalTaskStatus[]

type TaskAggregationMode = 'goal' | 'status'
type GoalTask = ConversationGoal['tasks'][number]
type StatusIconState = ConversationGoal['status'] | ConversationGoalTaskStatus

interface ChannelWorkspaceProps {
  activeConversation: Conversation | null
  messages: ConversationMessage[]
  goals: ConversationGoal[]
  artifacts: ConversationArtifact[]
  deployments: ConversationDeployment[]
  agents: AgentDetails[]
  user: User | null
  prompt: string
  isCreatingRun: boolean
  runError: string | null
  readyAgentCount: number
  canEditConversation: boolean
  setPrompt: (value: string) => void
  submitRun: (
    event: FormEvent<HTMLFormElement>,
    mode: 'chat' | 'task',
    attachments: File[],
  ) => Promise<boolean>
  openCreateAgent: () => void
  openAgentConversation: (agentId: string) => void
  openEditConversation: () => void
  openArtifactEditor: (artifactId: string) => void
  openGoalRoute: (goalId: string, taskIndex?: number | null) => void
  openTasksRoute: () => void
  openDeploymentsRoute: () => void
  closeConversationRoute: () => void
  openRun: (runId: string) => void
  openConversationEditor?: (conversationId: string) => void
  closeArtifactEditor?: () => void
  activeEditorArtifactId?: string | null
  editorConversationId?: string | null
  onActiveEditorArtifactChange?: (artifactId: string) => void
  refreshArtifacts?: () => void
  refreshDeployments?: () => void
  focusedGoalRoute?: { goalId: string; taskIndex: number | null } | null
  focusedMessageId?: string | null
  isConversationLoading?: boolean
  taskRouteActive?: boolean
  deploymentRouteActive?: boolean
  welcomeActive?: boolean
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function displayNameInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

function taskStatusBoardStyle(status: ConversationGoalTaskStatus): {
  column: string
  dot: string
  count: string
} {
  switch (status) {
    case 'ready':
      return {
        column: 'border-[#d8e6ff] bg-[#f3f7ff]',
        dot: 'border-[#0f62fe] bg-[#0f62fe]',
        count: 'bg-[#d8e6ff] text-[#0f3f9c]',
      }
    case 'running':
      return {
        column: 'border-[#f0dfb4] bg-[#fffaf0]',
        dot: 'border-[#d89400] bg-[#d89400]',
        count: 'bg-[#f9e8b8] text-[#6f5200]',
      }
    case 'succeeded':
      return {
        column: 'border-[#d7eadc] bg-[#f2faf5]',
        dot: 'border-[#24a148] bg-[#24a148]',
        count: 'bg-[#d7eadc] text-[#0e6027]',
      }
    case 'failed':
      return {
        column: 'border-[#f4d4d4] bg-[#fff5f5]',
        dot: 'border-[#da1e28] bg-[#da1e28]',
        count: 'bg-[#f4d4d4] text-[#8a1118]',
      }
    case 'blocked':
      return {
        column: 'border-[#efd6e4] bg-[#fff6fb]',
        dot: 'border-[#d02670] bg-[#d02670]',
        count: 'bg-[#efd6e4] text-[#7f1743]',
      }
    case 'waiting':
    case 'assigned':
    case 'cancelled':
    case 'interrupted':
      return {
        column: 'border-[#e5e5e5] bg-[#f8f8f8]',
        dot: 'border-[#8d8d8d] bg-white',
        count: 'bg-[#e8e8e8] text-[#525252]',
      }
  }
}

function goalStatusPanelStyle(status: ConversationGoal['status']): {
  panel: string
  pill: string
} {
  switch (status) {
    case 'active':
      return {
        panel: 'border-[#d8e6ff] bg-[#f8fbff]',
        pill: 'bg-[#d8e6ff] text-[#0f3f9c]',
      }
    case 'completed':
      return {
        panel: 'border-[#d7eadc] bg-[#f8fcf9]',
        pill: 'bg-[#d7eadc] text-[#0e6027]',
      }
    case 'failed':
      return {
        panel: 'border-[#f4d4d4] bg-[#fff8f8]',
        pill: 'bg-[#f4d4d4] text-[#8a1118]',
      }
    case 'cancelled':
      return {
        panel: 'border-[#e5e5e5] bg-[#fafafa]',
        pill: 'bg-[#e8e8e8] text-[#525252]',
      }
  }
}

function statusIconStyle(status: StatusIconState): {
  color: string
  Icon: CarbonIconType
} {
  switch (status) {
    case 'completed':
    case 'succeeded':
      return {
        color: 'text-[#24a148]',
        Icon: CheckmarkFilled,
      }
    case 'active':
    case 'ready':
      return {
        color: 'text-[#0f62fe]',
        Icon: CircleFilled,
      }
    case 'running':
      return {
        color: 'text-[#d89400]',
        Icon: InProgress,
      }
    case 'assigned':
      return {
        color: 'text-[#6929c4]',
        Icon: CircleFilled,
      }
    case 'waiting':
      return {
        color: 'text-[#6f6f6f]',
        Icon: CircleDash,
      }
    case 'failed':
      return {
        color: 'text-[#da1e28]',
        Icon: IncompleteError,
      }
    case 'blocked':
      return {
        color: 'text-[#d02670]',
        Icon: WarningSquare,
      }
    case 'interrupted':
      return {
        color: 'text-[#d89400]',
        Icon: PauseOutline,
      }
    case 'cancelled':
      return {
        color: 'text-[#525252]',
        Icon: StopFilled,
      }
  }
}

function StatusIcon({ status }: { status: StatusIconState }) {
  const style = statusIconStyle(status)
  const Icon = style.Icon

  return (
    <span
      className={`grid h-5 w-5 shrink-0 place-items-center ${style.color}`}
      title={status}
      aria-label={status}
    >
      <Icon size={20} />
    </span>
  )
}

function mentionSearchTerm(value: string): string | null {
  const match = /(?:^|\s)@([\p{L}\p{N}_-]*)$/u.exec(value)

  return match?.[1]?.toLowerCase() ?? null
}

function replaceActiveMention(value: string, agentName: string): string {
  return value.replace(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u, (match) => {
    const prefix = match.startsWith('@') ? '' : ' '

    return `${prefix}@${agentName} `
  })
}

type MentionSuggestion =
  | { id: 'all'; type: 'all' }
  | { agent: AgentDetails; id: string; type: 'agent' }

interface PendingComposerAttachment {
  file: File
  id: string
  kind: 'image' | 'file'
  previewUrl?: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mentionsFromPrompt(
  value: string,
  agents: AgentDetails[],
): string[] {
  return agents
    .filter((agent) => {
      const pattern = new RegExp(
        `(^|\\s)@${escapeRegExp(agent.agent.name)}(?=$|\\s|[.,!?;:])`,
        'i',
      )

      return pattern.test(value)
    })
    .map((agent) => agent.agent.id)
}

function mentionsAllFromPrompt(value: string): boolean {
  return /(^|\s)@all(?=$|\s|[.,!?;:])/i.test(value)
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ChannelWorkspace({
  activeConversation,
  messages,
  goals,
  artifacts,
  deployments,
  agents,
  user,
  prompt,
  isCreatingRun,
  runError,
  readyAgentCount,
  canEditConversation,
  setPrompt,
  submitRun,
  openCreateAgent,
  openAgentConversation,
  openEditConversation,
  openArtifactEditor,
  openGoalRoute,
  openTasksRoute,
  openDeploymentsRoute,
  closeConversationRoute,
  openRun,
  openConversationEditor,
  closeArtifactEditor,
  activeEditorArtifactId = null,
  editorConversationId = null,
  onActiveEditorArtifactChange,
  refreshArtifacts,
  refreshDeployments,
  focusedGoalRoute = null,
  focusedMessageId = null,
  isConversationLoading = false,
  taskRouteActive = false,
  deploymentRouteActive = false,
  welcomeActive = false,
}: ChannelWorkspaceProps) {
  const [composerMode, setComposerMode] = useState<'chat' | 'task'>('chat')
  const [workspacePanel, setWorkspacePanel] = useState<{
    conversationId: string
    view: 'tasks' | 'deployments' | 'project'
  } | null>(null)
  const [taskAggregationMode, setTaskAggregationMode] = useState<TaskAggregationMode>('goal')
  const [expandedGoalIds, setExpandedGoalIds] = useState<string[]>([])
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingComposerAttachment[]>([])
  const [pendingAttachmentConversationId, setPendingAttachmentConversationId] = useState<string | null>(null)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingAttachmentsRef = useRef<PendingComposerAttachment[]>([])
  const hasSelectedConversation = activeConversation !== null

  useEffect(() => {
    pendingAttachmentsRef.current = pendingAttachments
  }, [pendingAttachments])

  useEffect(() => {
    return () => {
      pendingAttachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl !== undefined) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
      })
    }
  }, [])

  const expandedGoalIdSet = useMemo(() => new Set(expandedGoalIds), [expandedGoalIds])
  const flattenedGoalTasks = useMemo(
    () => goals.flatMap((goal) => goal.tasks.map((task) => ({ goal, task }))),
    [goals],
  )
  const goalTasksByStatus = useMemo(() => {
    const grouped = new Map<ConversationGoalTaskStatus, Array<{ goal: ConversationGoal; task: GoalTask }>>(
      taskStatusOrder.map((status) => [status, []]),
    )

    flattenedGoalTasks.forEach((item) => {
      grouped.get(item.task.status)?.push(item)
    })

    return grouped
  }, [flattenedGoalTasks])
  const focusedTaskKey =
    focusedGoalRoute?.taskIndex === null || focusedGoalRoute === null
      ? null
      : `${focusedGoalRoute.goalId}:${focusedGoalRoute.taskIndex}`
  const focusedGoalId = focusedGoalRoute?.goalId ?? null
  const focusedGoalTaskIndex = focusedGoalRoute?.taskIndex ?? null
  const isAgentDirectMessage = activeConversation?.type === 'direct'
  const isProjectConversation = activeConversation?.type === 'project'
  const isMemberConversation =
    activeConversation?.type === 'group' || activeConversation?.type === 'project'
  const selectedAgent = isAgentDirectMessage
    ? agents.find((agent) => agent.agent.id === activeConversation.directAgentId) ?? null
    : null
  const memberAgentIds = isMemberConversation
    ? activeConversation.agentIds ?? []
    : []
  const readyMemberAgentCount =
    !isMemberConversation
      ? 0
      : activeConversation.key === 'all'
        ? readyAgentCount
        : agents.filter(
            (agent) =>
              memberAgentIds.includes(agent.agent.id) &&
              isAgentReady(agent),
          ).length
  const mentionableAgents = useMemo(() => {
    if (activeConversation?.type !== 'group' && activeConversation?.type !== 'project') {
      return []
    }

    const memberIds = activeConversation.agentIds ?? []

    return agents
      .filter(
        (agent) =>
          memberIds.includes(agent.agent.id) &&
          isAgentReady(agent),
      )
      .sort((first, second) => first.agent.name.localeCompare(second.agent.name))
  }, [activeConversation, agents])
  const promptMentionIds = useMemo(
    () => mentionsFromPrompt(prompt, mentionableAgents),
    [mentionableAgents, prompt],
  )
  const promptMentionsAll = useMemo(() => mentionsAllFromPrompt(prompt), [prompt])
  const mentionTerm = hasSelectedConversation && !isAgentDirectMessage ? mentionSearchTerm(prompt) : null
  const mentionSuggestions: MentionSuggestion[] =
    mentionTerm === null
      ? []
      : [
          ...(!promptMentionsAll && 'all'.includes(mentionTerm)
            ? [{ id: 'all', type: 'all' } satisfies MentionSuggestion]
            : []),
          ...mentionableAgents
            .filter(
              (agent) =>
                agent.agent.name.toLowerCase().includes(mentionTerm) &&
                !promptMentionIds.includes(agent.agent.id),
            )
            .slice(0, promptMentionsAll || !'all'.includes(mentionTerm) ? 6 : 5)
            .map((agent) => ({
              agent,
              id: agent.agent.id,
              type: 'agent',
            }) satisfies MentionSuggestion),
        ]
  const normalizedMentionIndex = mentionSuggestions.length === 0
    ? 0
    : Math.min(activeMentionIndex, mentionSuggestions.length - 1)
  const activeMentionSuggestion = mentionSuggestions[normalizedMentionIndex] ?? null
  const selectedAgentReady = isAgentDirectMessage
    ? selectedAgent !== null && isAgentReady(selectedAgent)
    : hasSelectedConversation &&
      readyMemberAgentCount > 0
  const visiblePendingAttachments =
    pendingAttachmentConversationId === activeConversation?.id
      ? pendingAttachments
      : []
  const createAgentLink = (
    <button className={inlineLink} type="button" onClick={openCreateAgent}>
      create an agent
    </button>
  )
  const chatTitle = !hasSelectedConversation
    ? welcomeActive
      ? 'Welcome'
      : 'Chat'
    : isAgentDirectMessage
      ? selectedAgent?.agent.name ?? activeConversation.title
      : activeConversation.title
  const chatDisplayName =
    hasSelectedConversation && activeConversation.type === 'group' ? `#${activeConversation.title}` : chatTitle
  const chatDescription = !hasSelectedConversation
    ? welcomeActive
      ? 'Choose a conversation or create a new workspace from the sidebar.'
      : 'No conversation selected'
    : isAgentDirectMessage
      ? selectedAgent?.agent.description?.trim() || 'Private conversation with this agent'
      : activeConversation.type === 'project'
        ? activeConversation.description?.trim() || activeConversation.project?.remoteUrl || 'Project conversation'
        : activeConversation.key === 'all'
          ? 'General channel for members and agent runs'
          : activeConversation.description?.trim() || 'Group channel for selected agents'
  const emptyTitle = !hasSelectedConversation
    ? welcomeActive
      ? 'Welcome to Tavro'
      : 'No conversation selected'
    : isAgentDirectMessage
      ? 'No private messages yet'
      : 'No messages yet'
  const emptyMessage = !hasSelectedConversation
    ? welcomeActive
      ? 'Pick an existing chat, open a project, or start by creating an agent.'
      : readyAgentCount > 0
        ? 'Choose #all or an agent from the sidebar.'
        : (
            <>
              Choose #all after you{' '}
              {createAgentLink}
              .
            </>
          )
    : isAgentDirectMessage
      ? selectedAgentReady && selectedAgent
        ? `Message ${selectedAgent.agent.name} to start a private run.`
        : 'This agent is not ready to receive messages yet.'
      : readyMemberAgentCount > 0
        ? `Message ${chatDisplayName} to start a run.`
        : (
            <>
              First, {createAgentLink}; then message #all to start a run.
            </>
          )
  const warningTitle = isAgentDirectMessage
    ? 'Agent is not ready'
    : 'No ready agent available'
  const warningSubtitle = isAgentDirectMessage
    ? 'Wait for provisioning to finish, or choose another ready agent.'
    : 'Choose a conversation with a ready agent before sending a message.'
  const composerPlaceholder = !hasSelectedConversation
    ? 'Select a conversation first'
    : selectedAgentReady
      ? isAgentDirectMessage
        ? `Message ${selectedAgent?.agent.name ?? activeConversation.title}`
        : `Message ${chatDisplayName}`
      : isAgentDirectMessage
        ? 'Agent is not ready yet'
        : 'Create a ready agent first'
  const chatAriaLabel = !hasSelectedConversation
    ? 'Chat'
    : isAgentDirectMessage
      ? `Private chat ${chatTitle}`
      : isProjectConversation
        ? `Project ${chatDisplayName}`
        : `Group ${chatDisplayName}`
  const projectIcon = isProjectConversation && activeConversation !== null
    ? getProjectIcon(activeConversation)
    : null
  const isAgentTyping =
    isAgentDirectMessage &&
    messages.some(
      (message) => message.senderType === 'agent' && message.status === 'streaming',
    )
  const visibleMessages = messages.filter(
    (message) =>
      !(
        message.senderType === 'agent' &&
        message.status === 'streaming' &&
        message.content.trim().length === 0 &&
        !message.error
      ),
  )
  const userDisplayName = user?.name?.trim() || user?.email || 'User'
  const canSendMessage =
    (prompt.trim().length > 0 || visiblePendingAttachments.length > 0) &&
    selectedAgentReady &&
    !isCreatingRun
  const showComposerModeSwitch = hasSelectedConversation && !isAgentDirectMessage
  const canOpenWorkspacePanel = hasSelectedConversation
  const showConversationToolbar = !welcomeActive
  const chatTitleClassName =
    'min-w-0 truncate text-base font-semibold leading-5 text-[var(--cds-text-primary)]'
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveMentionIndex((current) => (current + 1) % mentionSuggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }

      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey) || event.key === 'Tab') {
        if (activeMentionSuggestion !== null) {
          event.preventDefault()
          selectMention(activeMentionSuggestion)
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setActiveMentionIndex(0)
        return
      }
    }

    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) {
      return
    }

    event.preventDefault()
    if (canSendMessage) {
      event.currentTarget.form?.requestSubmit()
    }
  }
  const selectMention = (suggestion: MentionSuggestion) => {
    setPrompt(replaceActiveMention(prompt, suggestion.type === 'all' ? 'all' : suggestion.agent.agent.name))
  }
  const appendMention = (agent: AgentDetails) => {
    const separator = prompt.length === 0 || /\s$/.test(prompt) ? '' : ' '
    setPrompt(`${prompt}${separator}@${agent.agent.name} `)
    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus()
    })
  }
  const addPendingFiles = (files: File[]) => {
    const conversationId = activeConversation?.id ?? null

    if (conversationId === null) {
      return
    }

    setAttachmentError(null)
    if (pendingAttachmentConversationId !== conversationId) {
      pendingAttachments.forEach((attachment) => {
        if (attachment.previewUrl !== undefined) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
      })
      setPendingAttachmentConversationId(conversationId)
      setPendingAttachments([])
    }
    setPendingAttachments((current) => {
      const scopedCurrent = pendingAttachmentConversationId === conversationId ? current : []
      const remainingSlots = Math.max(0, 10 - scopedCurrent.length)
      const acceptedFiles = files.slice(0, remainingSlots)
      const rejectedForSize = acceptedFiles.find((file) => file.size > 25 * 1024 * 1024)

      if (files.length > remainingSlots) {
        setAttachmentError('You can attach up to 10 files.')
      } else if (rejectedForSize !== undefined) {
        setAttachmentError('Each attachment must be 25MB or smaller.')
      }

      const nextFiles = acceptedFiles
        .filter((file) => file.size <= 25 * 1024 * 1024)
        .map((file) => {
          const kind = file.type.startsWith('image/') ? 'image' : 'file'

          return {
            file,
            id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
            kind,
            previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
          } satisfies PendingComposerAttachment
        })

      const totalSize = [...scopedCurrent, ...nextFiles].reduce((sum, attachment) => sum + attachment.file.size, 0)

      if (totalSize > 100 * 1024 * 1024) {
        nextFiles.forEach((attachment) => {
          if (attachment.previewUrl !== undefined) {
            URL.revokeObjectURL(attachment.previewUrl)
          }
        })
        setAttachmentError('Attachments must be 100MB or smaller in total.')
        return scopedCurrent
      }

      return [...scopedCurrent, ...nextFiles]
    })
  }
  const handleAttachmentInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    addPendingFiles(Array.from(event.target.files ?? []))
    event.target.value = ''
  }
  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((current) =>
      current.filter((attachment) => {
        if (attachment.id !== attachmentId) {
          return true
        }

        if (attachment.previewUrl !== undefined) {
          URL.revokeObjectURL(attachment.previewUrl)
        }

        return false
      }),
    )
  }
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    const sent = await submitRun(
      event,
      composerMode,
      visiblePendingAttachments.map((attachment) => attachment.file),
    )

    if (sent) {
      visiblePendingAttachments.forEach((attachment) => {
        if (attachment.previewUrl !== undefined) {
          URL.revokeObjectURL(attachment.previewUrl)
        }
      })
      setPendingAttachments([])
      setPendingAttachmentConversationId(null)
      setAttachmentError(null)
    }
  }
  const handlePromptChange = (value: string) => {
    if (mentionSearchTerm(value) !== mentionTerm) {
      setActiveMentionIndex(0)
    }
    setPrompt(value)
  }
  const toggleGoalExpanded = (goalId: string) => {
    setExpandedGoalIds((current) =>
      current.includes(goalId)
        ? current.filter((id) => id !== goalId)
        : [...current, goalId],
    )
  }

  const showFiles =
    editorConversationId !== null &&
    editorConversationId === activeConversation?.id &&
    canOpenWorkspacePanel
  const showTasks =
    !showFiles &&
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'tasks'
  const showDeployments =
    !showFiles &&
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'deployments'
  const showProjectWorkspace =
    !showFiles &&
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'project'
  const showWorkspacePage =
    (showTasks || showFiles || showDeployments || showProjectWorkspace) &&
    canOpenWorkspacePanel
  const showComposer = !showWorkspacePage && !welcomeActive
  const lastVisibleMessage = visibleMessages.at(-1)
  const openArtifactEditorPanel = (artifactId: string) => {
    setWorkspacePanel(null)
    openArtifactEditor(artifactId)
  }
  const openConversationEditorPanel = (conversationId: string) => {
    setWorkspacePanel(null)
    openConversationEditor?.(conversationId)
  }

  useEffect(() => {
    if (showWorkspacePage || focusedMessageId !== null) {
      return
    }

    const scrollContainer = scrollContainerRef.current
    const messagesEnd = messagesEndRef.current

    if (scrollContainer === null || messagesEnd === null) {
      return
    }

    requestAnimationFrame(() => {
      messagesEnd.scrollIntoView({ block: 'end' })
    })
  }, [
    activeConversation?.id,
    lastVisibleMessage?.content,
    lastVisibleMessage?.id,
    lastVisibleMessage?.status,
    focusedMessageId,
    showWorkspacePage,
    visibleMessages.length,
  ])

  useEffect(() => {
    if (showWorkspacePage || focusedMessageId === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      document
        .getElementById(`message-${focusedMessageId}`)
        ?.scrollIntoView({ block: 'center' })
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [
    focusedMessageId,
    showWorkspacePage,
    visibleMessages.length,
  ])

  useEffect(() => {
    if (activeConversation?.id === undefined || focusedGoalId === null) {
      return
    }

    const timeout = window.setTimeout(() => {
      setWorkspacePanel({ conversationId: activeConversation.id, view: 'tasks' })
      setTaskAggregationMode('goal')
      setExpandedGoalIds((current) =>
        current.includes(focusedGoalId)
          ? current
          : [...current, focusedGoalId],
      )
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [activeConversation?.id, focusedGoalId])

  useEffect(() => {
    if (activeConversation?.id === undefined || !taskRouteActive) {
      return
    }

    const timeout = window.setTimeout(() => {
      setWorkspacePanel({ conversationId: activeConversation.id, view: 'tasks' })
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [activeConversation?.id, taskRouteActive])

  useEffect(() => {
    if (activeConversation?.id === undefined || !deploymentRouteActive) {
      return
    }

    const timeout = window.setTimeout(() => {
      setWorkspacePanel({ conversationId: activeConversation.id, view: 'deployments' })
      refreshDeployments?.()
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [activeConversation?.id, deploymentRouteActive, refreshDeployments])

  useEffect(() => {
    if (!showTasks || taskAggregationMode !== 'goal' || focusedGoalId === null) {
      return
    }

    const elementId =
      focusedGoalTaskIndex === null
        ? `goal-${focusedGoalId}`
        : `goal-task-${focusedGoalId}-${focusedGoalTaskIndex}`
    const timeout = window.setTimeout(() => {
      document.getElementById(elementId)?.scrollIntoView({ block: 'center' })
    }, 0)

    return () => window.clearTimeout(timeout)
  }, [
    expandedGoalIds,
    focusedGoalId,
    focusedGoalTaskIndex,
    showTasks,
    taskAggregationMode,
  ])

  const renderGoalTaskCard = (
    goal: ConversationGoal,
    task: GoalTask,
    options: { compact?: boolean; showGoal?: boolean } = {},
  ) => {
    const assignee = agents.find((agent) => agent.agent.id === task.assigneeAgentId)
    const focused = focusedTaskKey === `${goal.id}:${task.index}`

    if (options.compact === true) {
      return (
        <button
          key={`${goal.id}:${task.id}`}
          className="grid cursor-pointer gap-2 rounded-lg border border-[#e0e0e0] bg-white p-3 text-left text-sm text-[var(--cds-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-[box-shadow,transform,border-color] duration-150 hover:-translate-y-0.5 hover:border-[#c6c6c6] hover:shadow-[0_6px_16px_rgba(0,0,0,0.10)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
          type="button"
          onClick={() => openGoalRoute(goal.id, task.index)}
        >
          <span className="w-fit rounded-md border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-semibold text-[var(--cds-text-secondary)]">
              Goal: {goal.id.slice(0, 8)} #{task.index}
          </span>
          <h4 className="min-w-0 overflow-hidden text-sm font-semibold leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
            {task.title}
          </h4>
          {options.showGoal && (
            <p className="truncate text-xs leading-4 text-[var(--cds-text-secondary)]">
              {goal.title}
            </p>
          )}
        </button>
      )
    }

    return (
      <section
        id={`goal-task-${goal.id}-${task.index}`}
        key={`${goal.id}:${task.id}`}
        className={`grid gap-3 rounded-xl border bg-white p-3 text-sm text-[var(--cds-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)] ${
          focused ? 'border-[var(--cds-border-strong-01)] outline outline-2 outline-offset-[-2px] outline-[var(--cds-focus)]' : 'border-[#e0e0e0]'
        }`}
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <span className="shrink-0 rounded-md border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-semibold text-[var(--cds-text-secondary)]">
              #{task.index}
            </span>
            <div className="min-w-0">
              <h4 className="truncate text-sm font-semibold leading-5">{task.title}</h4>
              {options.showGoal && (
                <p className="mt-0.5 truncate text-xs text-[var(--cds-text-secondary)]">
                  {goal.title}
                </p>
              )}
              {task.description && (
                <p className="mt-1 overflow-hidden text-xs leading-4 text-[var(--cds-text-secondary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                  {task.description}
                </p>
              )}
            </div>
          </div>
          <StatusIcon status={task.status} />
        </div>
        <div className="grid gap-1.5 text-sm leading-5 text-[var(--cds-text-secondary)]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold uppercase text-[var(--cds-text-primary)]">Assignee</span>
            {assignee ? (
              <button
                className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                type="button"
                onClick={() => openAgentConversation(assignee.agent.id)}
              >
                {assignee.agent.name}
              </button>
            ) : (
              <span>{task.assigneeAgentId}</span>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-semibold uppercase text-[var(--cds-text-primary)]">Run</span>
            {task.assigneeRunId ? (
              <button
                className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                type="button"
                onClick={() => openRun(task.assigneeRunId as string)}
              >
                {task.assigneeRunId.slice(0, 8)}
              </button>
            ) : (
              <span>Not dispatched</span>
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold uppercase text-[var(--cds-text-primary)]">Depends on</span>
            {task.dependsOnTaskIndexes && task.dependsOnTaskIndexes.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {task.dependsOnTaskIndexes.map((index) => (
                  <button
                    key={index}
                    className="cursor-pointer rounded-md border border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.5 text-xs font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:bg-[var(--cds-layer-hover-01)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                    type="button"
                    onClick={() => openGoalRoute(goal.id, index)}
                  >
                    #{index}
                  </button>
                ))}
              </span>
            ) : (
              <span>None</span>
            )}
          </div>
        </div>
        {task.blockedReason && (
          <div className="text-xs text-[var(--cds-text-secondary)]">
            <span className="font-semibold text-[var(--cds-text-primary)]">Blocked:</span>{' '}
            {task.blockedReason}
          </div>
        )}
        {task.summary && (
          <div className="rounded-lg bg-[#f8f8f8] p-3">
            <h5 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">Summary</h5>
            <MessageContent className="mt-1 block text-sm leading-5" content={task.summary} />
          </div>
        )}
        {task.artifacts && task.artifacts.length > 0 && (
          <div className="grid gap-1 rounded-lg bg-[#f8f8f8] p-3">
            <h5 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">Reports</h5>
            {task.artifacts.map((artifact) => (
              <button
                key={artifact.id}
                className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                type="button"
                onClick={() => openArtifactEditorPanel(artifact.id)}
              >
                {artifact.title}
              </button>
            ))}
          </div>
        )}
      </section>
    )
  }

  const renderGoalListView = () => (
    <div className="grid gap-3">
      {goals.map((goal) => {
        const orchestrator = agents.find((agent) => agent.agent.id === goal.orchestratorAgentId)
        const expanded = expandedGoalIdSet.has(goal.id)
        const focused = focusedGoalRoute?.goalId === goal.id
        const goalStyle = goalStatusPanelStyle(goal.status)

        return (
          <article
            id={`goal-${goal.id}`}
            key={goal.id}
            className={`grid overflow-hidden rounded-2xl border text-sm text-[var(--cds-text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${
              focused ? 'border-[var(--cds-border-strong-01)] outline outline-2 outline-offset-[-2px] outline-[var(--cds-focus)]' : goalStyle.panel
            }`}
          >
            <div
              className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-4 p-4 text-left text-[var(--cds-text-primary)] transition-colors hover:bg-white/55 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)]"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => toggleGoalExpanded(goal.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) {
                  return
                }
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  toggleGoalExpanded(goal.id)
                }
              }}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusIcon status={goal.status} />
                  <h3 className="min-w-0 truncate text-base font-semibold leading-6">{goal.title}</h3>
                </div>
                {goal.description && (
                  <p className="mt-1 overflow-hidden text-sm leading-5 text-[var(--cds-text-secondary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                    {goal.description}
                  </p>
                )}
                <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm leading-5 text-[var(--cds-text-secondary)]">
                  Goal{' '}
                  <button
                    className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      openGoalRoute(goal.id, null)
                    }}
                  >
                    {goal.id.slice(0, 8)}
                  </button>{' '}
                  organized by{' '}
                  {orchestrator ? (
                    <button
                      className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        openAgentConversation(orchestrator.agent.id)
                      }}
                    >
                      {orchestrator.agent.name}
                    </button>
                  ) : (
                    <span className="font-semibold text-[var(--cds-link-primary)]">
                      {goal.orchestratorAgentId}
                    </span>
                  )}
                  , with{' '}
                  <span className="rounded-md bg-[#d8e6ff] px-1.5 py-0.5 text-xs font-semibold text-[#0f3f9c]">
                    {goal.tasks.length}
                  </span>{' '}
                  {goal.tasks.length === 1 ? 'task' : 'tasks'}
                </p>
              </div>
              <span className="flex items-center gap-2 self-start">
                <span className="rounded-md bg-white/70 px-2.5 py-1 text-xs font-semibold text-[var(--cds-text-secondary)]">
                  {goal.tasks.length} {goal.tasks.length === 1 ? 'task' : 'tasks'}
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-lg border border-white/70 bg-white/80 text-[var(--cds-text-secondary)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                  {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                </span>
              </span>
            </div>
            {expanded && (
              <div className="grid gap-3 border-t border-white/70 bg-white/55 p-4">
                {goal.summary && (
                  <div className="rounded-xl border border-[#d8e6ff] bg-[#f3f7ff] p-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                    <h4 className="text-xs font-semibold uppercase text-[#0f3f9c]">Goal summary</h4>
                    <MessageContent className="mt-1 block text-sm leading-5" content={goal.summary} />
                  </div>
                )}
                {goal.tasks.length === 0 ? (
                  <p className="rounded-xl bg-white p-4 text-center text-sm text-[var(--cds-text-secondary)]">No tasks</p>
                ) : (
                  <div className="grid gap-2">
                    {goal.tasks.map((task) => renderGoalTaskCard(goal, task))}
                  </div>
                )}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )

  const renderStatusBoardView = () => (
    <div className="h-full min-h-0 min-w-0 overflow-x-scroll overflow-y-hidden pb-3">
      <div className="flex h-full min-h-0 w-max min-w-full gap-4 pr-2">
        {taskStatusOrder.map((status) => {
          const statusTasks = goalTasksByStatus.get(status) ?? []
          const style = taskStatusBoardStyle(status)

          return (
            <section
              key={status}
              className={`grid min-h-0 w-[15.3rem] shrink-0 grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-2xl border p-4 ${style.column}`}
            >
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[var(--cds-text-primary)]">
                  <span className={`h-3 w-3 shrink-0 rounded-full border-2 ${style.dot}`} aria-hidden="true" />
                  <span className="truncate capitalize">{status}</span>
                </h3>
                <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${style.count}`}>
                  {statusTasks.length}
                </span>
              </div>
              {statusTasks.length === 0 ? (
                <div className="grid min-h-0 place-items-center rounded-xl text-sm text-[var(--cds-text-placeholder)]">
                  No tasks
                </div>
              ) : (
                <div className="grid min-h-0 content-start gap-3 overflow-y-auto overscroll-contain pr-1">
                  {statusTasks.map(({ goal, task }) =>
                    renderGoalTaskCard(goal, task, { compact: true, showGoal: true }),
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )

  const renderDeploymentListView = () => (
    <div className="grid w-full content-start gap-3">
      {deployments.length === 0 ? (
        <div className="grid min-h-80 place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
          <Launch size={32} />
          <h2 className="cds--type-heading-compact-02">No deployments yet</h2>
        </div>
      ) : (
        deployments.map((deployment) => (
          <article
            key={deployment.id}
            className="grid gap-2 rounded-2xl border border-[#e1e5ea] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Tag size="sm" type={deployment.status === 'ready' ? 'green' : deployment.status === 'failed' ? 'red' : 'gray'}>
                    {deployment.status.toUpperCase()}
                  </Tag>
                  <Tag size="sm" type={deployment.publishedFrom === 'user' ? 'blue' : 'gray'}>
                    {deployment.publishedFrom.toUpperCase()}
                  </Tag>
                  <h3 className="truncate text-base font-semibold leading-5 text-[var(--cds-text-primary)]">
                    {deployment.title}
                  </h3>
                </div>
                <p className="mt-1 text-sm text-[var(--cds-text-secondary)]">
                  Entry `{deployment.entrypoint}` from run{' '}
                  <button className={inlineLink} type="button" onClick={() => openRun(deployment.runId)}>
                    {deployment.runId.slice(0, 8)}
                  </button>
                  {deployment.goalId ? (
                    <>
                      {' '}for goal{' '}
                      <button
                        className={inlineLink}
                        type="button"
                        onClick={() => openGoalRoute(deployment.goalId!, deployment.taskIndex ?? null)}
                      >
                        {deployment.goalId.slice(0, 8)}
                        {deployment.taskIndex === undefined ? '' : ` #${deployment.taskIndex}`}
                      </button>
                    </>
                  ) : null}
                  {' '}at {formatMessageTime(deployment.createdAt)}
                </p>
              </div>
              <a
                className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border border-[#dde1e6] bg-white px-3 text-sm font-semibold text-[#161616] no-underline shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:bg-[#eef0f4]"
                href={deployment.url}
                target="_blank"
                rel="noreferrer"
                aria-disabled={!deployment.url || deployment.status !== 'ready'}
              >
                Open
                <Launch size={14} />
              </a>
            </div>
          </article>
        ))
      )}
    </div>
  )

  return (
    <section
      id="main-content"
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[#fafafa]"
      aria-label={chatAriaLabel}
    >
      <header className="flex min-h-16 items-center justify-between gap-4 border-b border-[#eef0f3] bg-white px-6 max-[1055px]:px-4 max-[671px]:min-h-0 max-[671px]:flex-col max-[671px]:items-start max-[671px]:gap-3 max-[671px]:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-[#dde1e6] bg-[#f7f8fa] text-base font-semibold leading-none shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_0_1px_rgba(255,255,255,0.75)_inset]"
            style={projectIcon?.style}
            aria-hidden="true"
          >
            {!hasSelectedConversation ? (
              <ChatBot size={20} />
            ) : isAgentDirectMessage ? (
              selectedAgent?.agent.avatar ? (
                <img
                  src={selectedAgent.agent.avatar}
                  alt={selectedAgent.agent.name}
                  className="h-9 w-9 rounded-[2px] object-cover"
                />
              ) : (
                <ChatBot size={20} />
              )
            ) : (
              projectIcon?.initial ?? '#'
            )}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className={chatTitleClassName}>{chatTitle}</h1>
              {isAgentTyping && (
                <span className="inline-flex shrink-0 items-baseline gap-1.5 text-xs font-semibold leading-none text-[var(--cds-text-primary)]">
                  <span
                    className="relative top-[-0.0625rem] h-1.5 w-1.5 animate-[agenthub-breathe_1.4s_ease-in-out_infinite] rounded-full bg-[var(--cds-support-info)]"
                    aria-hidden="true"
                  />
                  输入中
                </span>
              )}
            </div>
            {chatDescription.length > 0 && (
              <p className="truncate text-sm leading-5 text-[var(--cds-text-secondary)] max-[671px]:whitespace-normal">
                {chatDescription}
              </p>
            )}
          </div>
        </div>
        {showConversationToolbar && (
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            kind={showTasks ? 'secondary' : 'ghost'}
            label="Tasks"
            size="md"
            align="bottom"
            type="button"
            disabled={!canOpenWorkspacePanel}
            onClick={() => {
              if (showTasks) {
                setWorkspacePanel(null)
                closeConversationRoute()
                return
              }

              closeArtifactEditor?.()
              setWorkspacePanel(activeConversation ? { conversationId: activeConversation.id, view: 'tasks' } : null)
              openTasksRoute()
            }}
          >
            <Task size={16} />
          </IconButton>
          {activeConversation?.type === 'project' && (
            <IconButton
              kind={showProjectWorkspace ? 'secondary' : 'ghost'}
              label="Project"
              size="md"
              align="bottom"
              type="button"
              disabled={!canOpenWorkspacePanel || activeConversation.project?.cloneStatus !== 'ready'}
              onClick={() => {
                if (showProjectWorkspace) {
                  setWorkspacePanel(null)
                  closeConversationRoute()
                  return
                }

                closeArtifactEditor?.()
                setWorkspacePanel({ conversationId: activeConversation.id, view: 'project' })
              }}
            >
              <Code size={16} />
            </IconButton>
          )}
          <IconButton
            kind={showFiles ? 'secondary' : 'ghost'}
            label="Files"
            size="md"
            align="bottom"
            type="button"
            disabled={!canOpenWorkspacePanel}
            onClick={() => {
              if (showFiles) {
                closeArtifactEditor?.()
                setWorkspacePanel(null)
                return
              }

              if (activeConversation !== null) {
                openConversationEditorPanel(activeConversation.id)
              }
            }}
          >
            <Folder size={16} />
          </IconButton>
          <IconButton
            kind={showDeployments ? 'secondary' : 'ghost'}
            label="Deployments"
            size="md"
            align="bottom"
            type="button"
            disabled={!canOpenWorkspacePanel}
            onClick={() => {
              if (showDeployments) {
                setWorkspacePanel(null)
                closeConversationRoute()
                return
              }

              closeArtifactEditor?.()
              if (activeConversation !== null) {
                setWorkspacePanel({ conversationId: activeConversation.id, view: 'deployments' })
                openDeploymentsRoute()
                refreshDeployments?.()
              }
            }}
          >
            <Launch size={16} />
          </IconButton>
          {hasSelectedConversation && (
            <IconButton
              kind="ghost"
              label="Settings"
              size="md"
              align="bottom-end"
              type="button"
              disabled={!canEditConversation}
              onClick={openEditConversation}
            >
              <Settings size={16} />
            </IconButton>
          )}
        </div>
        )}
      </header>

      <div className={runError ? 'grid gap-2 px-4 pt-3' : 'p-0'}>
        {runError && (
          <InlineNotification
            kind="error"
            title="Message was not sent"
            subtitle={runError}
            lowContrast
            aria-label="Close notification"
          />
        )}
      </div>

      <div
        ref={scrollContainerRef}
        className={`min-h-0 p-4 max-[671px]:p-2 ${showWorkspacePage ? '' : 'bg-white'} ${
              showFiles ||
              showProjectWorkspace ||
              (showWorkspacePage && showTasks && taskAggregationMode === 'status')
            ? 'overflow-hidden'
            : 'overflow-y-auto'
        }`}
        aria-live="polite"
      >
        {isConversationLoading && !showWorkspacePage ? (
          <div className="grid min-h-full place-items-center content-center gap-3 text-center text-[#69707d]">
            <Loading
              small
              withOverlay={false}
              description="Loading Conversation"
            />
            <p className="text-sm font-medium leading-5">Loading Conversation</p>
          </div>
        ) : showWorkspacePage && showTasks ? (
          <div
            className="grid h-full min-h-0 min-w-0 w-full grid-rows-[auto_minmax(0,1fr)] gap-4"
          >
            <div
              className="inline-flex h-8 w-fit items-center gap-1 rounded-full bg-[#eef0f4] p-0.5"
              role="group"
              aria-label="Task aggregation"
            >
              {(['goal', 'status'] as const).map((mode) => {
                const selected = taskAggregationMode === mode

                return (
                  <button
                    key={mode}
                    className={`flex h-7 min-w-16 cursor-pointer items-center justify-center rounded-full border-0 px-3 text-sm font-semibold capitalize leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                      selected
                        ? 'bg-white text-[#161616] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                        : 'bg-transparent text-[#69707d] hover:text-[#161616]'
                    }`}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setTaskAggregationMode(mode)}
                  >
                    {mode === 'goal' ? 'Goals' : 'Status'}
                  </button>
                )
              })}
            </div>
            <div className="h-full min-h-0 min-w-0 overflow-hidden">
              {goals.length === 0 ? (
                <div className="grid h-full min-h-[22rem] place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
                  <Task size={32} />
                  <h2 className="cds--type-heading-compact-02">No goals yet</h2>
                </div>
              ) : (
                taskAggregationMode === 'goal' ? renderGoalListView() : renderStatusBoardView()
              )}
            </div>
          </div>
        ) : showWorkspacePage && showFiles ? (
          <div className="grid h-full min-h-0 w-full">
            <ArtifactWorkspace
              artifacts={artifacts}
              activeArtifactId={activeEditorArtifactId}
              onActiveArtifactChange={onActiveEditorArtifactChange}
              onRefreshArtifacts={refreshArtifacts}
              onRefreshDeployments={refreshDeployments}
            />
          </div>
        ) : showWorkspacePage && showDeployments ? (
          <div className="grid w-full content-start gap-4">
            {renderDeploymentListView()}
          </div>
        ) : showWorkspacePage && showProjectWorkspace && activeConversation?.type === 'project' ? (
          <div className="grid h-full min-h-0 w-full">
            <ProjectWorkspace agents={agents} conversation={activeConversation} />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="grid min-h-full place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
            <ChatBot size={32} />
            <h2 className="cds--type-heading-compact-02">{emptyTitle}</h2>
            <p className="text-[var(--cds-text-secondary)]">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <div className="grid w-full">
            {visibleMessages.map((message, messageIndex) => {
              const senderAgent =
                message.senderAgentId === undefined
                  ? null
                  : agents.find((agent) => agent.agent.id === message.senderAgentId) ?? null
              const senderName =
                message.senderType === 'user'
                  ? userDisplayName
                  : message.senderType === 'agent'
                    ? senderAgent?.agent.name ?? 'Agent'
                    : 'System'
              const senderAvatar =
                message.senderType === 'user'
                  ? user?.avatar
                  : message.senderType === 'agent'
                    ? senderAgent?.agent.avatar
                    : null
              const avatarInitial = displayNameInitial(senderName)
              const senderIsOrchestrator =
                (activeConversation?.type === 'group' || activeConversation?.type === 'project') &&
                message.senderAgentId !== undefined &&
                activeConversation.orchestratorAgentId === message.senderAgentId
              const canMentionSender =
                (activeConversation?.type === 'group' || activeConversation?.type === 'project') &&
                message.senderType === 'agent' &&
                senderAgent !== null

              return (
                <article
                  id={`message-${message.id}`}
                  className={`grid min-w-0 scroll-mt-6 grid-cols-[2.5rem_minmax(0,1fr)] gap-3 px-3 py-4 text-left text-[var(--cds-text-primary)] transition-colors first:pt-2 last:pb-2 max-[671px]:grid-cols-[2.25rem_minmax(0,1fr)] max-[671px]:px-1 ${
                    messageIndex > 0 ? 'shadow-[inset_0_1px_0_rgba(15,23,42,0.045)]' : ''
                  } ${
                    focusedMessageId === message.id
                      ? 'bg-[var(--cds-layer-selected-01)] outline outline-2 outline-offset-[-2px] outline-[var(--cds-focus)]'
                      : ''
                  }`}
                  key={message.id}
                >
                  <span
                    className="group relative grid h-10 w-10 place-items-center rounded-md border border-[#d8dee6] bg-white text-sm font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.75)_inset] max-[671px]:h-9 max-[671px]:w-9"
                    aria-hidden="true"
                  >
                    <span className="grid h-full w-full place-items-center overflow-hidden rounded-md">
                      {senderAvatar ? (
                        <img
                          src={senderAvatar}
                          alt={senderName}
                          className="h-9 w-9 rounded-[3px] object-cover max-[671px]:h-8 max-[671px]:w-8"
                        />
                      ) : (
                        avatarInitial
                      )}
                    </span>
                    {senderIsOrchestrator && (
                      <>
                        <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full border-2 border-white bg-[var(--cds-support-success)] text-white shadow-[0_1px_2px_rgba(15,23,42,0.2)]">
                          <UserAdmin size={10} />
                        </span>
                        <span className="pointer-events-none absolute -right-2 -top-7 whitespace-nowrap rounded-full border border-[#bfe8c8] bg-[#defbe6] px-2 py-0.5 text-[0.65rem] font-semibold leading-4 text-[#0e6027] opacity-0 shadow-[0_4px_12px_rgba(15,23,42,0.12)] transition-opacity group-hover:opacity-100">
                          Orchestrator
                        </span>
                      </>
                    )}
                  </span>
                  <span className="grid min-w-0 gap-1">
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                      {canMentionSender ? (
                        <button
                          className="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-semibold leading-5 text-[var(--cds-text-primary)] hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                          type="button"
                          onClick={() => appendMention(senderAgent)}
                        >
                          {senderName}
                        </button>
                      ) : (
                        <strong
                          className={`leading-5 ${
                            message.senderType === 'user'
                              ? 'text-[#0f62fe]'
                              : message.senderType === 'system'
                                ? 'text-[#697386]'
                                : ''
                          }`}
                        >
                          {senderName}
                        </strong>
                      )}
                        {senderIsOrchestrator && <span className="sr-only">Orchestrator</span>}
                      </span>
                      <time className="text-xs leading-4 text-[var(--cds-text-secondary)]" dateTime={message.updatedAt}>
                        {formatMessageTime(message.updatedAt)}
                      </time>
                    </span>
                    {message.content && (
                      <MessageContent className={messageBodyClass} content={message.content} />
                    )}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.attachments.map((attachment) => {
                          if (attachment.type === 'image') {
                            return (
                              <button
                                key={attachment.id}
                                type="button"
                                className="max-w-72 cursor-pointer overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-0 text-left hover:border-[var(--cds-border-strong-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                                onClick={() => openArtifactEditorPanel(attachment.artifactId)}
                                title={attachment.artifact.title}
                              >
                                <img
                                  src={apiUrl(`/artifacts/${attachment.artifactId}/preview/`)}
                                  alt={attachment.artifact.title}
                                  className="block max-h-64 w-full object-contain"
                                />
                              </button>
                            )
                          }

                          return (
                            <button
                              key={attachment.id}
                              type="button"
                              className="flex max-w-80 cursor-pointer items-center gap-3 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-3 text-left hover:border-[var(--cds-border-strong-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                              onClick={() => openArtifactEditorPanel(attachment.artifactId)}
                              title={attachment.artifact.title}
                            >
                              <span className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)]">
                                <Document size={18} />
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold text-[var(--cds-text-primary)]">
                                  {attachment.artifact.filename}
                                </span>
                                <span className="block text-xs text-[var(--cds-text-secondary)]">
                                  {formatFileSize(attachment.artifact.sizeBytes)}
                                </span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {message.error && (
                      <span className="text-xs text-[var(--cds-text-error)]">
                        {message.error}
                      </span>
                    )}
                    {message.runId && (
                      <button
                        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-[var(--cds-text-secondary)] hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                        type="button"
                        onClick={() => openRun(message.runId as string)}
                      >
                        Run {message.runId.slice(0, 8)}
                      </button>
                    )}
                  </span>
                </article>
              )
            })}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>
        )}
      </div>

      {showComposer && (
      <Form
        className="grid gap-2 bg-[#fafafa] px-2 pb-2 pt-2 max-[671px]:px-1.5 max-[671px]:pb-2"
        aria-label="Create run"
        onSubmit={handleSubmit}
      >
        {hasSelectedConversation && !selectedAgentReady && (
          <InlineNotification
            kind="warning"
            title={warningTitle}
            subtitle={warningSubtitle}
            lowContrast
            hideCloseButton
          />
        )}
        <div className="grid w-full overflow-hidden rounded-2xl border border-[#d8dee6] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.05)] focus-within:border-[#b9c3cf] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--cds-focus)]">
          <label className="sr-only" htmlFor="run-prompt">
            {`Message ${chatDisplayName}`}
          </label>
          {mentionSuggestions.length > 0 && (
            <div className="mx-2 mt-2 grid max-h-48 overflow-y-auto rounded-xl border border-[#d8dee6] bg-white shadow-lg">
              {mentionSuggestions.map((suggestion) => {
                if (suggestion.type === 'all') {
                  return (
                    <button
                      key={suggestion.id}
                      type="button"
                      className={`flex min-h-10 cursor-pointer items-center gap-2 border-0 px-3 text-left text-sm text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] ${
                        activeMentionSuggestion?.id === suggestion.id
                          ? 'bg-[#eef0f4]'
                          : 'bg-transparent hover:bg-[#f3f4f6]'
                      }`}
                      onClick={() => selectMention(suggestion)}
                      onMouseEnter={() => {
                        const nextIndex = mentionSuggestions.findIndex((item) => item.id === suggestion.id)
                        if (nextIndex >= 0) {
                          setActiveMentionIndex(nextIndex)
                        }
                      }}
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#dde1e6] bg-[#f7f8fa] text-xs font-semibold">
                        @
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-semibold">@all</span>
                        <span className="truncate text-xs text-[var(--cds-text-secondary)]">All ready agents</span>
                      </span>
                    </button>
                  )
                }

                const agent = suggestion.agent
                const agentIsOrchestrator =
                  (activeConversation?.type === 'group' || activeConversation?.type === 'project') &&
                  activeConversation.orchestratorAgentId === agent.agent.id

                return (
                  <button
                    key={suggestion.id}
                    type="button"
                    className={`flex min-h-10 cursor-pointer items-center gap-2 border-0 px-3 text-left text-sm text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] ${
                      activeMentionSuggestion?.id === suggestion.id
                        ? 'bg-[#eef0f4]'
                        : 'bg-transparent hover:bg-[#f3f4f6]'
                    }`}
                    onClick={() => selectMention(suggestion)}
                    onMouseEnter={() => {
                      const nextIndex = mentionSuggestions.findIndex((item) => item.id === suggestion.id)
                      if (nextIndex >= 0) {
                        setActiveMentionIndex(nextIndex)
                      }
                    }}
                  >
                    <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-md border border-[#d8dee6] bg-[#f7f8fa] text-xs font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.75)_inset]">
                      <span className="grid h-full w-full place-items-center overflow-hidden rounded-md">
                        {agent.agent.avatar ? (
                          <img
                            src={agent.agent.avatar}
                            alt={agent.agent.name}
                            className="h-6 w-6 rounded-[3px] object-cover"
                          />
                        ) : (
                          displayNameInitial(agent.agent.name)
                        )}
                      </span>
                      {agentIsOrchestrator && (
                        <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-white bg-[var(--cds-support-success)] text-white shadow-[0_1px_2px_rgba(15,23,42,0.2)]" aria-hidden="true">
                          <UserAdmin size={8} />
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-semibold">@{agent.agent.name}</span>
                      {agentIsOrchestrator && <span className="sr-only">Orchestrator</span>}
                    </span>
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--cds-support-success)]" aria-hidden="true" />
                  </button>
                )
              })}
            </div>
          )}
          <textarea
            ref={promptInputRef}
            id="run-prompt"
            className="min-h-16 w-full resize-none border-0 bg-transparent px-3 pb-1 pt-3 text-base leading-5 text-[var(--cds-text-primary)] outline-none placeholder:text-[var(--cds-text-placeholder)] disabled:cursor-not-allowed disabled:text-[var(--cds-text-disabled)]"
            rows={2}
            value={prompt}
            placeholder={composerPlaceholder}
            disabled={isCreatingRun || !selectedAgentReady}
            onChange={(event) => handlePromptChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          {(visiblePendingAttachments.length > 0 || attachmentError !== null) && (
            <div className="grid gap-2 px-3 pb-2">
              {attachmentError !== null && (
                <p className="text-sm text-[var(--cds-support-error)]">{attachmentError}</p>
              )}
              {visiblePendingAttachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {visiblePendingAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="flex max-w-72 items-center gap-2 rounded-xl border border-[#d8dee6] bg-[#f7f8fa] p-2"
                    >
                      {attachment.kind === 'image' && attachment.previewUrl !== undefined ? (
                        <img
                          src={attachment.previewUrl}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[#dde1e6] bg-white">
                          <Document size={18} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--cds-text-primary)]">
                          {attachment.file.name}
                        </span>
                        <span className="block text-xs text-[var(--cds-text-secondary)]">
                          {formatFileSize(attachment.file.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[var(--cds-text-secondary)] hover:bg-[#eef0f4] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                        aria-label={`Remove ${attachment.file.name}`}
                        onClick={() => removePendingAttachment(attachment.id)}
                      >
                        <Close size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="flex min-h-10 items-center gap-2 px-2 pb-2 pt-1 max-[671px]:flex-wrap">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleAttachmentInputChange}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleAttachmentInputChange}
            />
            <div className="flex items-center gap-1.5" aria-label="Message tools">
              <button
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-[#dde1e6] bg-white text-[var(--cds-text-primary)] hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:text-[var(--cds-text-disabled)]"
                type="button"
                aria-label="Add image"
                disabled={isCreatingRun || !selectedAgentReady}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImageIcon size={16} />
              </button>
              <button
                className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-[#dde1e6] bg-white text-[var(--cds-text-primary)] hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:text-[var(--cds-text-disabled)]"
                type="button"
                aria-label="Attach file"
                disabled={isCreatingRun || !selectedAgentReady}
                onClick={() => fileInputRef.current?.click()}
              >
                <Attachment size={16} />
              </button>
            </div>
            {showComposerModeSwitch && (
              <div
                className="ml-1 inline-flex h-8 items-center gap-1 rounded-full bg-[#eef0f4] p-0.5"
                role="group"
                aria-label="Message mode"
              >
                {(['chat', 'task'] as const).map((mode) => {
                  const selected = composerMode === mode

                  return (
                    <button
                      className={`flex h-7 min-w-14 cursor-pointer items-center justify-center rounded-full border-0 px-3 text-sm font-semibold capitalize leading-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                        selected
                          ? 'bg-white text-[#161616] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                          : 'bg-transparent text-[#69707d] hover:text-[#161616]'
                      }`}
                      type="button"
                      key={mode}
                      aria-pressed={selected}
                      onClick={() => setComposerMode(mode)}
                    >
                      {mode}
                    </button>
                  )
                })}
              </div>
            )}
            <div className="ml-auto flex items-center">
          {isCreatingRun ? (
            <InlineLoading description="Queueing run..." status="active" />
          ) : (
            <button
              type="submit"
              aria-label="Send"
              className={`inline-flex h-8 items-center gap-2 rounded-lg border px-2.5 transition-[background-color,border-color,color,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                canSendMessage
                  ? 'cursor-pointer border-[#c7d0dc] bg-white text-[#161616] shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-[#b9c3cf] hover:bg-[#eef0f4]'
                  : 'cursor-not-allowed border-[#eef0f4] bg-[#f7f8fa] text-[#c1c7d0]'
              }`}
              disabled={!canSendMessage}
            >
              <span className="hidden text-xs font-semibold text-current sm:inline">
                Ctrl + Enter
              </span>
              <Return size={16} />
            </button>
          )}
            </div>
          </div>
        </div>
      </Form>
      )}
    </section>
  )
}
