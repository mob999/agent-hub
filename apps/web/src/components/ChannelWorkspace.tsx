import { Form, IconButton, InlineLoading, InlineNotification, Tag } from '@carbon/react'
import { Attachment, ChatBot, Code, Folder, Image as ImageIcon, SendAltFilled, Settings, Task } from '@carbon/react/icons'
import type { FormEvent, KeyboardEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentDetails, Conversation, ConversationArtifact, ConversationMessage, ConversationTask, User } from '../lib/api'
import { apiUrl } from '../lib/api'
import { formatMessageTime, formatTime } from '../lib/format'
import { ArtifactWorkspace } from './ArtifactWorkspace'
import { MessageContent } from './MessageContent'

const inlineLink =
  'cursor-pointer border-0 bg-transparent p-0 font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const messageBodyClass = 'block whitespace-pre-wrap break-words text-base leading-5'

interface ChannelWorkspaceProps {
  activeConversation: Conversation | null
  messages: ConversationMessage[]
  tasks: ConversationTask[]
  artifacts: ConversationArtifact[]
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
  ) => void
  openCreateAgent: () => void
  openEditConversation: () => void
  openArtifactEditor: (artifactId: string) => void
  openRun: (runId: string) => void
  openConversationEditor?: (conversationId: string) => void
  closeArtifactEditor?: () => void
  activeEditorArtifactId?: string | null
  editorConversationId?: string | null
  onActiveEditorArtifactChange?: (artifactId: string) => void
  refreshArtifacts?: () => void
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function displayNameInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}

function artifactLabel(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'html':
    case 'htm':
      return 'HTML'
    case 'md':
    case 'markdown':
    case 'mdx':
      return 'Markdown'
    case 'diff':
    case 'patch':
      return 'Diff'
    case 'avif':
    case 'gif':
    case 'jpeg':
    case 'jpg':
    case 'png':
    case 'svg':
    case 'webp':
      return 'Image'
    default:
      return 'File'
  }
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

export function ChannelWorkspace({
  activeConversation,
  messages,
  tasks,
  artifacts,
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
  openEditConversation,
  openArtifactEditor,
  openRun,
  openConversationEditor,
  closeArtifactEditor,
  activeEditorArtifactId = null,
  editorConversationId = null,
  onActiveEditorArtifactChange,
  refreshArtifacts,
}: ChannelWorkspaceProps) {
  const [composerMode, setComposerMode] = useState<'chat' | 'task'>('chat')
  const [workspacePanel, setWorkspacePanel] = useState<{ conversationId: string; view: 'tasks' | 'files' } | null>(null)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null)
  const hasSelectedConversation = activeConversation !== null
  const isAgentDirectMessage = activeConversation?.type === 'direct'
  const selectedAgent = isAgentDirectMessage
    ? agents.find((agent) => agent.agent.id === activeConversation.directAgentId) ?? null
    : null
  const groupAgentIds = activeConversation?.type === 'group'
    ? activeConversation.agentIds ?? []
    : []
  const readyGroupAgentCount =
    activeConversation?.type !== 'group'
      ? 0
      : activeConversation.key === 'all'
        ? readyAgentCount
        : agents.filter(
            (agent) =>
              groupAgentIds.includes(agent.agent.id) &&
              isAgentReady(agent),
          ).length
  const mentionableAgents = useMemo(() => {
    if (activeConversation?.type !== 'group') {
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
  const mentionTerm = hasSelectedConversation && !isAgentDirectMessage ? mentionSearchTerm(prompt) : null
  const mentionSuggestions =
    mentionTerm === null
      ? []
      : mentionableAgents
          .filter(
            (agent) =>
              agent.agent.name.toLowerCase().includes(mentionTerm) &&
              !promptMentionIds.includes(agent.agent.id),
          )
          .slice(0, 6)
  const normalizedMentionIndex = mentionSuggestions.length === 0
    ? 0
    : Math.min(activeMentionIndex, mentionSuggestions.length - 1)
  const activeMentionSuggestion = mentionSuggestions[normalizedMentionIndex] ?? null
  const selectedAgentReady = isAgentDirectMessage
    ? selectedAgent !== null && isAgentReady(selectedAgent)
    : hasSelectedConversation && readyGroupAgentCount > 0
  const createAgentLink = (
    <button className={inlineLink} type="button" onClick={openCreateAgent}>
      create an agent
    </button>
  )
  const chatTitle = !hasSelectedConversation
    ? 'Chat'
    : isAgentDirectMessage
      ? selectedAgent?.agent.name ?? activeConversation.title
      : activeConversation.title
  const chatDisplayName =
    hasSelectedConversation && !isAgentDirectMessage ? `#${activeConversation.title}` : chatTitle
  const chatDescription = !hasSelectedConversation
    ? 'No conversation selected'
    : isAgentDirectMessage
      ? selectedAgent?.agent.description?.trim() || 'Private conversation with this agent'
      : activeConversation.key === 'all'
        ? 'General channel for members and agent runs'
        : activeConversation.description?.trim() || 'Group channel for selected agents'
  const emptyTitle = !hasSelectedConversation
    ? 'No conversation selected'
    : isAgentDirectMessage
      ? 'No private messages yet'
      : 'No messages yet'
  const emptyMessage = !hasSelectedConversation
    ? readyAgentCount > 0
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
      : readyGroupAgentCount > 0
        ? `Message ${chatDisplayName} to start a group run.`
        : (
            <>
              First, {createAgentLink}; then message #all to start a run.
            </>
          )
  const warningTitle = isAgentDirectMessage ? 'Agent is not ready' : 'No ready agent available'
  const warningSubtitle = isAgentDirectMessage
    ? 'Wait for provisioning to finish, or choose another ready agent.'
    : 'Choose a group with a ready agent before sending a message.'
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
      : `Group ${chatDisplayName}`
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
  const canSendMessage = prompt.trim().length > 0 && selectedAgentReady && !isCreatingRun
  const showComposerModeSwitch = hasSelectedConversation && !isAgentDirectMessage
  const canOpenWorkspacePanel = hasSelectedConversation
  const chatTitleClassName =
    hasSelectedConversation && !isAgentDirectMessage
      ? 'min-w-0 truncate text-base font-semibold leading-5 text-[var(--cds-text-primary)]'
      : 'min-w-0 truncate text-xl font-semibold leading-tight'
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
  const selectMention = (agent: AgentDetails) => {
    setPrompt(replaceActiveMention(prompt, agent.agent.name))
  }
  const appendMention = (agent: AgentDetails) => {
    const separator = prompt.length === 0 || /\s$/.test(prompt) ? '' : ' '
    setPrompt(`${prompt}${separator}@${agent.agent.name} `)
    window.requestAnimationFrame(() => {
      promptInputRef.current?.focus()
    })
  }
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    submitRun(event, composerMode)
  }
  const handlePromptChange = (value: string) => {
    if (mentionSearchTerm(value) !== mentionTerm) {
      setActiveMentionIndex(0)
    }
    setPrompt(value)
  }

  const showTasks =
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'tasks'
  const showFiles =
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'files'
  const firstArtifactId = artifacts[0]?.id ?? null
  const showEditor =
    editorConversationId !== null &&
    editorConversationId === activeConversation?.id &&
    canOpenWorkspacePanel
  const showWorkspacePage = (showTasks || showFiles || showEditor) && canOpenWorkspacePanel
  const lastVisibleMessage = visibleMessages.at(-1)

  useEffect(() => {
    if (showWorkspacePage) {
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
    showWorkspacePage,
    visibleMessages.length,
  ])

  return (
    <section
      id="main-content"
      className="grid h-screen min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--cds-background)]"
      aria-label={chatAriaLabel}
    >
      <header className="flex min-h-18 items-center justify-between gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 max-[1055px]:px-4 max-[671px]:min-h-0 max-[671px]:flex-col max-[671px]:items-start max-[671px]:gap-3 max-[671px]:py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] text-base font-semibold leading-none"
            aria-hidden="true"
          >
            {!hasSelectedConversation ? (
              <ChatBot size={20} />
            ) : isAgentDirectMessage ? (
              selectedAgent?.agent.avatar ? (
                <img
                  src={selectedAgent.agent.avatar}
                  alt={selectedAgent.agent.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <ChatBot size={20} />
              )
            ) : (
              '#'
            )}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className={chatTitleClassName}>{chatTitle}</h1>
              {isAgentTyping && (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--cds-text-primary)]">
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-[var(--cds-support-info)]"
                    aria-hidden="true"
                  />
                  输入中
                </span>
              )}
            </div>
            {chatDescription.length > 0 && (
              <p className="truncate text-sm leading-snug text-[var(--cds-text-secondary)] max-[671px]:whitespace-normal">
                {chatDescription}
              </p>
            )}
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            kind={showTasks ? 'secondary' : 'ghost'}
            label="Tasks"
            size="md"
            align="bottom"
            type="button"
            disabled={!canOpenWorkspacePanel}
            onClick={() =>
              setWorkspacePanel((panel) =>
                panel?.conversationId === activeConversation?.id && panel?.view === 'tasks'
                  ? null
                  : activeConversation
                    ? { conversationId: activeConversation.id, view: 'tasks' }
                    : null,
              )
            }
          >
            <Task size={16} />
          </IconButton>
          <IconButton
            kind={showFiles ? 'secondary' : 'ghost'}
            label="Files"
            size="md"
            align="bottom"
            type="button"
            disabled={!canOpenWorkspacePanel}
            onClick={() =>
              setWorkspacePanel((panel) =>
                panel?.conversationId === activeConversation?.id && panel?.view === 'files'
                  ? null
                  : activeConversation
                    ? { conversationId: activeConversation.id, view: 'files' }
                    : null,
              )
            }
          >
            <Folder size={16} />
          </IconButton>
          <IconButton
            kind={showEditor ? 'secondary' : 'ghost'}
            label="Editor"
            size="md"
            align="bottom"
            type="button"
            disabled={!canOpenWorkspacePanel}
            onClick={() => {
              if (showEditor) {
                closeArtifactEditor?.()
                return
              }

              if (firstArtifactId !== null) {
                openArtifactEditor(firstArtifactId)
                return
              }

              if (activeConversation !== null) {
                openConversationEditor?.(activeConversation.id)
              }
            }}
          >
            <Code size={16} />
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
        className={`min-h-0 p-2 ${
          showEditor ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
        aria-live="polite"
      >
        {showWorkspacePage && showTasks ? (
          <div className="grid w-full content-start gap-4">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--cds-border-subtle-01)] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--cds-text-primary)]">Tasks</h2>
                <p className="text-sm text-[var(--cds-text-secondary)]">
                  {isAgentDirectMessage
                    ? `Work tracked in your private conversation with ${chatDisplayName}.`
                    : `Work created by the group orchestrator for ${chatDisplayName}.`}
                </p>
              </div>
              <span className="text-sm font-semibold text-[var(--cds-text-secondary)]">
                {tasks.length}
              </span>
            </div>
            {tasks.length === 0 ? (
              <div className="grid min-h-80 place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
                <Task size={32} />
                <h2 className="cds--type-heading-compact-02">No tasks yet</h2>
                <p className="max-w-[28rem] text-[var(--cds-text-secondary)]">
                  {isAgentDirectMessage
                    ? 'Private tasks from this conversation will appear here.'
                    : 'Send a group message in Task mode. The orchestrator can create tasks and assign them to agents.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {tasks.map((task) => {
                  const assignee = agents.find((agent) => agent.agent.id === task.assigneeAgentId)
                  const orchestrator = agents.find((agent) => agent.agent.id === task.orchestratorAgentId)

                  return (
                    <article
                      key={task.id}
                      className="grid gap-3 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-3 text-sm text-[var(--cds-text-primary)]"
                    >
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold">{task.title}</h3>
                          {task.description && (
                            <p className="mt-1 text-sm text-[var(--cds-text-secondary)]">
                              {task.description}
                            </p>
                          )}
                        </div>
                        <span className="border border-[var(--cds-border-subtle-01)] px-2 py-1 text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">
                          {task.status}
                        </span>
                      </div>
                      <dl className="grid gap-2 text-xs text-[var(--cds-text-secondary)] sm:grid-cols-3">
                        <div>
                          <dt className="font-semibold uppercase">Assignee</dt>
                          <dd className="truncate">{assignee?.agent.name ?? task.assigneeAgentId}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase">Orchestrator</dt>
                          <dd className="truncate">{orchestrator?.agent.name ?? task.orchestratorAgentId}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase">Run</dt>
                          <dd className="truncate">{task.assigneeRunId ?? 'Not dispatched'}</dd>
                        </div>
                      </dl>
                      {task.summary && (
                        <div className="border-t border-[var(--cds-border-subtle-01)] pt-3">
                          <h4 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">Summary</h4>
                          <MessageContent className="mt-1 block text-sm leading-5" content={task.summary} />
                        </div>
                      )}
                      {task.artifacts && task.artifacts.length > 0 && (
                        <div className="grid gap-1 border-t border-[var(--cds-border-subtle-01)] pt-3">
                          <h4 className="text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">Reports</h4>
                          {task.artifacts.map((artifact) => (
                            <button
                              key={artifact.id}
                              className="w-fit cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                              type="button"
                              onClick={() => openArtifactEditor(artifact.id)}
                            >
                              {artifact.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        ) : showWorkspacePage && showEditor ? (
          <div className="grid h-full min-h-0 w-full">
            <ArtifactWorkspace
              artifacts={artifacts}
              activeArtifactId={activeEditorArtifactId}
              onActiveArtifactChange={onActiveEditorArtifactChange}
              onRefreshArtifacts={refreshArtifacts}
            />
          </div>
        ) : showWorkspacePage && showFiles ? (
          <div className="grid w-full content-start gap-4">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--cds-border-subtle-01)] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--cds-text-primary)]">Files</h2>
                <p className="text-sm text-[var(--cds-text-secondary)]">
                  Files uploaded to the {chatDisplayName} workspace.
                </p>
              </div>
              <span className="text-sm font-semibold text-[var(--cds-text-secondary)]">
                {artifacts.length}
              </span>
            </div>
            {artifacts.length === 0 ? (
              <div className="grid min-h-80 place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
                <Folder size={32} />
                <h2 className="cds--type-heading-compact-02">No files yet</h2>
                <p className="max-w-[28rem] text-[var(--cds-text-secondary)]">
                  {isAgentDirectMessage
                    ? 'Files created by this private agent conversation will appear here.'
                    : 'Assigned agents can upload report files after completing tasks.'}
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                {artifacts.map((artifact) => {
                  const creator = agents.find((agent) => agent.agent.id === artifact.creatorAgentId)

                  return (
                    <article
                      key={artifact.id}
                      className="grid gap-2 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-3 text-sm text-[var(--cds-text-primary)]"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            className="block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-base font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                            type="button"
                            onClick={() => {
                              openArtifactEditor(artifact.id)
                            }}
                          >
                            {artifact.title}
                          </button>
                          <p className="truncate text-sm text-[var(--cds-text-secondary)]">
                            {artifact.filename}
                          </p>
                        </div>
                        <span className="shrink-0 border border-[var(--cds-border-subtle-01)] px-2 py-1 text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">
                          {artifactLabel(artifact.filename)}
                        </span>
                      </div>
                      <dl className="grid gap-2 text-xs text-[var(--cds-text-secondary)] sm:grid-cols-3">
                        <div>
                          <dt className="font-semibold uppercase">Creator</dt>
                          <dd className="truncate">{creator?.agent.name ?? artifact.creatorAgentId}</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase">Size</dt>
                          <dd>{Math.max(1, Math.ceil(artifact.sizeBytes / 1024))} KB</dd>
                        </div>
                        <div>
                          <dt className="font-semibold uppercase">Created</dt>
                          <dd>{formatTime(artifact.createdAt)}</dd>
                        </div>
                      </dl>
                    </article>
                  )
                })}
              </div>
            )}
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
          <div className="grid w-full gap-4">
            {visibleMessages.map((message) => {
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
                activeConversation?.type === 'group' &&
                message.senderAgentId !== undefined &&
                activeConversation.orchestratorAgentId === message.senderAgentId
              const canMentionSender =
                activeConversation?.type === 'group' &&
                message.senderType === 'agent' &&
                senderAgent !== null

              return (
                <article
                  className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] gap-3 p-3 text-left text-[var(--cds-text-primary)] max-[671px]:grid-cols-[2.25rem_minmax(0,1fr)] max-[671px]:px-1"
                  key={message.id}
                >
                  <span
                    className="grid h-10 w-10 place-items-center overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] text-sm font-semibold max-[671px]:h-9 max-[671px]:w-9"
                    aria-hidden="true"
                  >
                    {senderAvatar ? (
                      <img
                        src={senderAvatar}
                        alt={senderName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      avatarInitial
                    )}
                  </span>
                  <span className="grid min-w-0 gap-1.5">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                      {senderIsOrchestrator && (
                        <Tag className="self-center" type="green" size="sm">
                          Orch
                        </Tag>
                      )}
                      {canMentionSender ? (
                        <button
                          className="min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left font-semibold leading-5 text-[var(--cds-text-primary)] hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                          type="button"
                          onClick={() => appendMention(senderAgent)}
                        >
                          {senderName}
                        </button>
                      ) : (
                        <strong className="leading-5">{senderName}</strong>
                      )}
                      <time className="text-xs leading-5 text-[var(--cds-text-secondary)]" dateTime={message.updatedAt}>
                        {formatMessageTime(message.updatedAt)}
                      </time>
                    </span>
                    {message.content && (
                      <MessageContent className={messageBodyClass} content={message.content} />
                    )}
                    {message.attachments && message.attachments.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {message.attachments.map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            className="max-w-72 cursor-pointer overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-0 text-left hover:border-[var(--cds-border-strong-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                            onClick={() => openArtifactEditor(attachment.artifactId)}
                            title={attachment.artifact.title}
                          >
                            <img
                              src={apiUrl(`/artifacts/${attachment.artifactId}/preview/`)}
                              alt={attachment.artifact.title}
                              className="block max-h-64 w-full object-contain"
                            />
                          </button>
                        ))}
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

      {!showWorkspacePage && (
      <Form
        className="grid gap-2 bg-[var(--cds-layer-01)] px-2 pb-3 pt-2"
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
        <div className="grid w-full overflow-hidden border border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-01)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-[var(--cds-focus)]">
          <label className="sr-only" htmlFor="run-prompt">
            {`Message ${chatDisplayName}`}
          </label>
          {mentionSuggestions.length > 0 && (
            <div className="mx-2 mt-2 grid max-h-48 overflow-y-auto border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] shadow-lg">
              {mentionSuggestions.map((agent) => {
                const agentIsOrchestrator =
                  activeConversation?.type === 'group' &&
                  activeConversation.orchestratorAgentId === agent.agent.id

                return (
                  <button
                    key={agent.agent.id}
                    type="button"
                    className={`flex min-h-10 cursor-pointer items-center gap-2 border-0 px-3 text-left text-sm text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] ${
                      activeMentionSuggestion?.agent.id === agent.agent.id
                        ? 'bg-[var(--cds-layer-selected-02)]'
                        : 'bg-transparent hover:bg-[var(--cds-layer-hover-02)]'
                    }`}
                    onClick={() => selectMention(agent)}
                    onMouseEnter={() => {
                      const nextIndex = mentionSuggestions.findIndex((item) => item.agent.id === agent.agent.id)
                      if (nextIndex >= 0) {
                        setActiveMentionIndex(nextIndex)
                      }
                    }}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-xs font-semibold">
                      {agent.agent.avatar ? (
                        <img
                          src={agent.agent.avatar}
                          alt={agent.agent.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        displayNameInitial(agent.agent.name)
                      )}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate font-semibold">@{agent.agent.name}</span>
                      {agentIsOrchestrator && (
                        <Tag className="m-0" type="green" size="sm">
                          Orch
                        </Tag>
                      )}
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
          <div className="flex min-h-10 items-center gap-2 px-2 pb-2 pt-1 max-[671px]:flex-wrap">
            <div className="flex items-center gap-1.5" aria-label="Message tools">
              <button
                className="grid h-8 w-8 cursor-pointer place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:text-[var(--cds-text-disabled)]"
                type="button"
                aria-label="Add image"
                disabled={isCreatingRun || !selectedAgentReady}
              >
                <ImageIcon size={16} />
              </button>
              <button
                className="grid h-8 w-8 cursor-pointer place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:text-[var(--cds-text-disabled)]"
                type="button"
                aria-label="Attach file"
                disabled={isCreatingRun || !selectedAgentReady}
              >
                <Attachment size={16} />
              </button>
            </div>
            {showComposerModeSwitch && (
              <div
                className="ml-1 inline-flex h-8 overflow-hidden border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)]"
                role="group"
                aria-label="Message mode"
              >
                {(['chat', 'task'] as const).map((mode) => {
                  const selected = composerMode === mode

                  return (
                    <button
                      className={`min-w-14 cursor-pointer border-0 px-3 text-sm font-semibold capitalize focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)] ${
                        selected
                          ? 'bg-[var(--cds-text-primary)] text-[var(--cds-background)]'
                          : 'bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)]'
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
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-xs text-[var(--cds-text-secondary)] sm:inline">
                Ctrl+Enter
              </span>
          {isCreatingRun ? (
            <InlineLoading description="Queueing run..." status="active" />
          ) : (
            <IconButton
              type="submit"
              label="Send"
              kind="primary"
              size="md"
              align="top-end"
              disabled={!canSendMessage}
            >
              <SendAltFilled size={18} />
            </IconButton>
          )}
            </div>
          </div>
        </div>
      </Form>
      )}
    </section>
  )
}
