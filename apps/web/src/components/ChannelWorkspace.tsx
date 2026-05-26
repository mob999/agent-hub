import { Form, IconButton, InlineLoading, InlineNotification } from '@carbon/react'
import { Attachment, ChatBot, Code, Folder, Image as ImageIcon, SendAltFilled, Settings, Task } from '@carbon/react/icons'
import type { FormEvent, KeyboardEvent } from 'react'
import { useMemo, useState } from 'react'
import type { AgentDetails, Conversation, ConversationArtifact, ConversationMention, ConversationMessage, ConversationTask, User } from '../lib/api'
import { formatTime } from '../lib/format'
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
    mentions: ConversationMention[],
  ) => void
  openCreateAgent: () => void
  openEditConversation: () => void
  refreshArtifacts?: () => void
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function displayNameInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
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
  refreshArtifacts,
}: ChannelWorkspaceProps) {
  const [composerMode, setComposerMode] = useState<'chat' | 'task'>('chat')
  const [mentions, setMentions] = useState<ConversationMention[]>([])
  const [workspacePanel, setWorkspacePanel] = useState<{ conversationId: string; view: 'tasks' | 'files' | 'editor' } | null>(null)
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
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
  const mentionTerm = hasSelectedConversation && !isAgentDirectMessage ? mentionSearchTerm(prompt) : null
  const mentionSuggestions =
    mentionTerm === null
      ? []
      : mentionableAgents
          .filter(
            (agent) =>
              agent.agent.name.toLowerCase().includes(mentionTerm) &&
              !mentions.some((mention) => mention.agentId === agent.agent.id),
          )
          .slice(0, 6)
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
  const canOpenWorkspacePanel = hasSelectedConversation && !isAgentDirectMessage
  const chatTitleClassName =
    hasSelectedConversation && !isAgentDirectMessage
      ? 'min-w-0 truncate text-base font-semibold leading-5 text-[var(--cds-text-primary)]'
      : 'min-w-0 truncate text-xl font-semibold leading-tight'
  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && mentionSuggestions.length > 0) {
      event.preventDefault()
      return
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
    setMentions((current) =>
      current.some((mention) => mention.agentId === agent.agent.id)
        ? current
        : [
            ...current,
            {
              type: 'agent',
              agentId: agent.agent.id,
              label: agent.agent.name,
            },
          ],
    )
  }
  const removeMention = (agentId: string) => {
    setMentions((current) => current.filter((mention) => mention.agentId !== agentId))
  }
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    submitRun(event, composerMode, mentions)
  }
  const handlePromptChange = (value: string) => {
    setPrompt(value)
    if (value.trim().length === 0 && mentions.length > 0) {
      setMentions([])
    }
  }

  const showTasks =
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'tasks'
  const showFiles =
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'files'
  const showEditor =
    workspacePanel?.conversationId === activeConversation?.id &&
    workspacePanel?.view === 'editor'
  const showWorkspacePage = (showTasks || showFiles || showEditor) && canOpenWorkspacePanel

  return (
    <section
      id="main-content"
      className="grid h-screen min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--cds-background)]"
      aria-label={chatAriaLabel}
    >
      <header className="flex min-h-18 items-center justify-between gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 max-[1055px]:px-4 max-[671px]:min-h-0 max-[671px]:flex-col max-[671px]:items-start max-[671px]:gap-3 max-[671px]:py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] text-base font-semibold leading-none"
            aria-hidden="true"
          >
            {!hasSelectedConversation || isAgentDirectMessage ? <ChatBot size={20} /> : '#'}
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
            onClick={() =>
              setWorkspacePanel((panel) =>
                panel?.conversationId === activeConversation?.id && panel?.view === 'editor'
                  ? null
                  : activeConversation
                    ? { conversationId: activeConversation.id, view: 'editor' }
                    : null,
              )
            }
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
        className={`min-h-0 px-6 py-4 max-[1055px]:px-4 ${
          showEditor ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
        aria-live="polite"
      >
        {showWorkspacePage && showTasks ? (
          <div className="mx-auto grid w-full max-w-[68rem] content-start gap-4">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--cds-border-subtle-01)] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--cds-text-primary)]">Tasks</h2>
                <p className="text-sm text-[var(--cds-text-secondary)]">
                  Work created by the group orchestrator for {chatDisplayName}.
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
                  Send a group message in Task mode. The orchestrator can create tasks and assign them to agents.
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
                            <a
                              key={artifact.id}
                              className="w-fit text-sm font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:underline"
                              href={artifact.downloadUrl ?? '#'}
                            >
                              {artifact.title}
                            </a>
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
          <div className="mx-auto grid h-full min-h-0 w-full max-w-[86rem]">
            <ArtifactWorkspace
              artifacts={artifacts}
              activeArtifactId={activeArtifactId}
              onActiveArtifactChange={setActiveArtifactId}
              onRefreshArtifacts={refreshArtifacts}
            />
          </div>
        ) : showWorkspacePage && showFiles ? (
          <div className="mx-auto grid w-full max-w-[68rem] content-start gap-4">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--cds-border-subtle-01)] pb-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--cds-text-primary)]">Files</h2>
                <p className="text-sm text-[var(--cds-text-secondary)]">
                  Reports uploaded to the {chatDisplayName} workspace.
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
                  Assigned agents can upload report files after completing tasks.
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
                              setActiveArtifactId(artifact.id)
                              if (activeConversation) {
                                setWorkspacePanel({
                                  conversationId: activeConversation.id,
                                  view: 'editor',
                                })
                              }
                            }}
                          >
                            {artifact.title}
                          </button>
                          <p className="truncate text-sm text-[var(--cds-text-secondary)]">
                            {artifact.filename}
                          </p>
                        </div>
                        <span className="shrink-0 border border-[var(--cds-border-subtle-01)] px-2 py-1 text-xs font-semibold uppercase text-[var(--cds-text-secondary)]">
                          {artifact.kind}
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
          <div className="mx-auto grid w-full max-w-[68rem] gap-4">
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
              const avatarInitial = displayNameInitial(senderName)

              return (
                <article
                  className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 p-3 text-left text-[var(--cds-text-primary)] max-[671px]:grid-cols-[1.75rem_minmax(0,1fr)] max-[671px]:px-1"
                  key={message.id}
                >
                  <span
                    className="grid h-8 w-8 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] text-sm font-semibold max-[671px]:h-7 max-[671px]:w-7"
                    aria-hidden="true"
                  >
                    {avatarInitial}
                  </span>
                  <span className="grid min-w-0 gap-1.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <strong>{senderName}</strong>
                      <time className="text-xs text-[var(--cds-text-secondary)]" dateTime={message.updatedAt}>
                        {formatTime(message.updatedAt)}
                      </time>
                    </span>
                    {message.content && (
                      <MessageContent className={messageBodyClass} content={message.content} />
                    )}
                    {message.error && (
                      <span className="text-xs text-[var(--cds-text-error)]">
                        {message.error}
                      </span>
                    )}
                    {message.runId && (
                      <span className="text-xs text-[var(--cds-text-secondary)]">
                        Run {message.runId.slice(0, 8)}
                      </span>
                    )}
                  </span>
                </article>
              )
            })}
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
          {mentions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {mentions.map((mention) => (
                <button
                  key={mention.agentId}
                  type="button"
                  className="inline-flex h-6 items-center gap-1 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] px-2 text-xs font-semibold text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-02)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                  onClick={() => removeMention(mention.agentId)}
                  aria-label={`Remove ${mention.label ?? 'agent'} mention`}
                >
                  @{mention.label ?? 'agent'}
                  <span aria-hidden="true">x</span>
                </button>
              ))}
            </div>
          )}
          <label className="sr-only" htmlFor="run-prompt">
            {`Message ${chatDisplayName}`}
          </label>
          <textarea
            id="run-prompt"
            className="min-h-16 w-full resize-none border-0 bg-transparent px-3 pb-1 pt-3 text-base leading-5 text-[var(--cds-text-primary)] outline-none placeholder:text-[var(--cds-text-placeholder)] disabled:cursor-not-allowed disabled:text-[var(--cds-text-disabled)]"
            rows={2}
            value={prompt}
            placeholder={composerPlaceholder}
            disabled={isCreatingRun || !selectedAgentReady}
            onChange={(event) => handlePromptChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
          />
          {mentionSuggestions.length > 0 && (
            <div className="mx-2 mb-1 grid max-h-48 overflow-y-auto border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] shadow-lg">
              {mentionSuggestions.map((agent) => (
                <button
                  key={agent.agent.id}
                  type="button"
                  className="flex min-h-10 cursor-pointer items-center gap-2 border-0 bg-transparent px-3 text-left text-sm text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-02)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)]"
                  onClick={() => selectMention(agent)}
                >
                  <span className="grid h-6 w-6 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-xs font-semibold">
                    {displayNameInitial(agent.agent.name)}
                  </span>
                  <span className="min-w-0 truncate font-semibold">@{agent.agent.name}</span>
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--cds-support-success)]" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
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
