import { Form, IconButton, InlineLoading, InlineNotification, TextArea } from '@carbon/react'
import { Add, ChatBot, Folder, JobRun, Send, Task } from '@carbon/react/icons'
import type { FormEvent } from 'react'
import type { AgentDetails, LocalRun, RunEvent } from '../lib/api'
import type { ChatTarget } from '../lib/chat'
import { RunThread } from './RunThread'

const inlineLink =
  'cursor-pointer border-0 bg-transparent p-0 font-semibold text-[var(--cds-link-primary)] underline-offset-2 hover:text-[var(--cds-link-primary-hover)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'

interface ChannelWorkspaceProps {
  runs: LocalRun[]
  eventsByRun: Record<string, RunEvent[]>
  prompt: string
  isCreatingRun: boolean
  runError: string | null
  selectedRunId: string | null
  activeChatTarget: ChatTarget | null
  selectedAgent: AgentDetails | null
  runAgent: AgentDetails | null
  readyAgentCount: number
  setPrompt: (value: string) => void
  submitRun: (event: FormEvent<HTMLFormElement>) => void
  selectRun: (runId: string) => void
  openCreateAgent: () => void
}

export function ChannelWorkspace({
  runs,
  eventsByRun,
  prompt,
  isCreatingRun,
  runError,
  selectedRunId,
  activeChatTarget,
  selectedAgent,
  runAgent,
  readyAgentCount,
  setPrompt,
  submitRun,
  selectRun,
  openCreateAgent,
}: ChannelWorkspaceProps) {
  const hasSelectedConversation = activeChatTarget !== null
  const isAgentDirectMessage = activeChatTarget?.type === 'agent'
  const createAgentLink = (
    <button className={inlineLink} type="button" onClick={openCreateAgent}>
      create an agent
    </button>
  )
  const selectedAgentReady =
    hasSelectedConversation &&
    runAgent?.runtimeBinding.status === 'ready' &&
    runAgent.workspace.status === 'ready'
  const chatTitle = !hasSelectedConversation
    ? 'Chat'
    : isAgentDirectMessage
      ? selectedAgent?.agent.name ?? 'Agent'
      : 'all'
  const chatDescription = !hasSelectedConversation
    ? 'No conversation selected'
    : isAgentDirectMessage
      ? selectedAgent?.agent.description?.trim() || 'Private conversation with this agent'
      : 'General channel for members and agent runs'
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
      : readyAgentCount > 0
        ? 'Message #all to start a group run.'
        : (
            <>
              First, {createAgentLink}; then message #all to start a run.
            </>
          )
  const warningTitle = isAgentDirectMessage ? 'Agent is not ready' : 'No ready agent available'
  const warningSubtitle = isAgentDirectMessage
    ? 'Wait for provisioning to finish, or choose another ready agent.'
    : 'Create a ready agent before sending a group message.'
  const composerPlaceholder = !hasSelectedConversation
    ? 'Select a conversation first'
    : selectedAgentReady && runAgent
      ? isAgentDirectMessage
        ? `Message ${runAgent.agent.name}`
        : `Message #all via ${runAgent.agent.name}`
      : isAgentDirectMessage
        ? 'Agent is not ready yet'
        : 'Create a ready agent first'
  const chatAriaLabel = !hasSelectedConversation
    ? 'Chat'
    : isAgentDirectMessage
      ? `Private chat ${chatTitle}`
      : 'Channel all'

  return (
    <section
      id="main-content"
      className="grid h-screen min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--cds-background)]"
      aria-label={chatAriaLabel}
    >
      <header className="flex min-h-18 items-center justify-between gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 max-[1055px]:px-4 max-[671px]:min-h-0 max-[671px]:flex-col max-[671px]:items-start max-[671px]:gap-3 max-[671px]:py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] font-semibold"
            aria-hidden="true"
          >
            {!hasSelectedConversation || isAgentDirectMessage ? <ChatBot size={20} /> : '#'}
          </span>
          <div className="grid min-w-0 gap-0.5">
            <h1 className="truncate text-xl font-semibold leading-tight">{chatTitle}</h1>
            <p className="truncate text-sm leading-snug text-[var(--cds-text-secondary)] max-[671px]:whitespace-normal">
              {chatDescription}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <button
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 border border-transparent bg-transparent px-2.5 font-semibold text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
          >
            <Task size={16} />
            <span>Tasks</span>
          </button>
          <button
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 border border-transparent bg-transparent px-2.5 font-semibold text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
          >
            <Folder size={16} />
            <span>Files</span>
          </button>
        </div>
      </header>

      <div className={runError ? 'grid gap-2 px-4 pt-3' : 'p-0'}>
        {runError && (
          <InlineNotification
            kind="error"
            title="Run was not created"
            subtitle={runError}
            lowContrast
            aria-label="Close notification"
          />
        )}
      </div>

      <div className="min-h-0 overflow-y-auto px-6 py-4 max-[1055px]:px-4" aria-live="polite">
        {runs.length === 0 ? (
          <div className="grid min-h-full place-items-center content-center gap-2 text-center text-[var(--cds-text-primary)]">
            <ChatBot size={32} />
            <h2 className="cds--type-heading-compact-02">{emptyTitle}</h2>
            <p className="text-[var(--cds-text-secondary)]">
              {emptyMessage}
            </p>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[68rem] gap-5">
            {runs.map((localRun) => (
              <RunThread
                key={localRun.run.id}
                localRun={localRun}
                events={eventsByRun[localRun.run.id] ?? []}
                selected={selectedRunId === localRun.run.id}
                selectRun={selectRun}
              />
            ))}
          </div>
        )}
      </div>

      <Form
        className="grid gap-2 border-t border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] px-4 pb-4 pt-3"
        aria-label="Create run"
        onSubmit={submitRun}
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
        <TextArea
          id="run-prompt"
          labelText={isAgentDirectMessage ? `Message ${chatTitle}` : 'Message #all'}
          hideLabel
          rows={3}
          value={prompt}
          placeholder={composerPlaceholder}
          disabled={isCreatingRun || !selectedAgentReady}
          onChange={(event) => setPrompt(event.target.value)}
        />
        <div className="flex items-center justify-between gap-4 max-[671px]:flex-wrap max-[671px]:items-start">
          <div className="flex gap-1.5" aria-label="Message tools">
            <button
              className="grid h-8 w-8 cursor-pointer place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              aria-label="Add attachment"
            >
              <Add size={16} />
            </button>
            <button
              className="grid h-8 w-8 cursor-pointer place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              aria-label="Run task"
            >
              <JobRun size={16} />
            </button>
          </div>
          <label className="ml-auto inline-flex items-center gap-1.5 text-sm text-[var(--cds-text-secondary)] max-[671px]:ml-0">
            <input type="checkbox" checked readOnly />
            <span>As task</span>
          </label>
          {isCreatingRun ? (
            <InlineLoading description="Queueing run..." status="active" />
          ) : (
            <IconButton
              type="submit"
              label="Send"
              kind="primary"
              size="md"
              align="top-end"
              disabled={prompt.trim().length === 0 || !selectedAgentReady}
            >
              <Send size={20} />
            </IconButton>
          )}
        </div>
      </Form>
    </section>
  )
}
