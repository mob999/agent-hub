import { Button, Form, IconButton, InlineLoading, InlineNotification, TextArea } from '@carbon/react'
import { Add, ChatBot, Folder, JobRun, Send, Task } from '@carbon/react/icons'
import type { FormEvent } from 'react'
import type { AgentDetails, LocalRun, RunEvent } from '../lib/api'
import { RunThread } from './RunThread'

interface ChannelWorkspaceProps {
  runs: LocalRun[]
  eventsByRun: Record<string, RunEvent[]>
  prompt: string
  isCreatingRun: boolean
  runError: string | null
  selectedRunId: string | null
  selectedAgent: AgentDetails | null
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
  selectedAgent,
  readyAgentCount,
  setPrompt,
  submitRun,
  selectRun,
  openCreateAgent,
}: ChannelWorkspaceProps) {
  const selectedAgentReady =
    selectedAgent?.runtimeBinding.status === 'ready' &&
    selectedAgent.workspace.status === 'ready'

  return (
    <section
      id="main-content"
      className="grid h-screen min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden bg-[var(--cds-background)]"
      aria-label="Channel all"
    >
      <header className="flex min-h-18 items-center justify-between gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 max-[1055px]:px-4 max-[671px]:min-h-0 max-[671px]:flex-col max-[671px]:items-start max-[671px]:gap-3 max-[671px]:py-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] font-semibold"
            aria-hidden="true"
          >
            #
          </span>
          <div className="grid min-w-0 gap-0.5">
            <h1 className="truncate text-xl font-semibold leading-tight">all</h1>
            <p className="truncate text-sm leading-snug text-[var(--cds-text-secondary)] max-[671px]:whitespace-normal">
              General channel for members and agent runs
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
            <h2 className="cds--type-heading-compact-02">No messages yet</h2>
            <p className="text-[var(--cds-text-secondary)]">
              {readyAgentCount > 0
                ? 'Message the selected agent to start a run.'
                : 'Create an agent, then message #all to start a run.'}
            </p>
            {readyAgentCount === 0 && (
              <Button kind="secondary" size="sm" onClick={openCreateAgent}>
                Create agent
              </Button>
            )}
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
        {!selectedAgentReady && (
          <InlineNotification
            kind="warning"
            title="No ready agent selected"
            subtitle="Create or select a ready agent before sending a message."
            lowContrast
            hideCloseButton
          />
        )}
        <TextArea
          id="run-prompt"
          labelText="Message #all"
          hideLabel
          rows={3}
          value={prompt}
          placeholder={selectedAgentReady ? `Message ${selectedAgent.agent.name}` : 'Create an agent first'}
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
