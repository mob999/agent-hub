import { InlineNotification, Tag } from '@carbon/react'
import { JobRun, ListBoxes, Terminal } from '@carbon/react/icons'
import type { ReactNode } from 'react'
import type { LocalRun, RunEvent, RunStatus } from '../lib/api'
import { eventTitle, formatTime, runStatusLabel, runTagType } from '../lib/format'

interface RunsPageProps {
  runs: LocalRun[]
  activeRunCount: number
  eventsByRun: Record<string, RunEvent[]>
  selectedRunId: string | null
  selectRun: (runId: string) => void
}

export function RunsPage({
  runs,
  activeRunCount,
  eventsByRun,
  selectedRunId,
  selectRun,
}: RunsPageProps) {
  const selectedRun = runs.find((localRun) => localRun.run.id === selectedRunId) ?? runs[0] ?? null
  const selectedEvents = selectedRun ? eventsByRun[selectedRun.run.id] ?? [] : []
  const agentOutput = selectedEvents
    .filter((event) => event.type === 'message.delta' && event.content)
    .map((event) => event.content)
    .join('')

  return (
    <section
      id="main-content"
      className="grid h-screen min-w-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)] max-[671px]:grid-cols-1"
      aria-label="Runs management"
    >
      <aside
        className="flex h-screen min-w-0 flex-col overflow-y-auto border-r border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] max-[671px]:h-auto max-[671px]:max-h-72"
        aria-label="Run list"
      >
        <header className="grid min-h-18 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[var(--cds-border-subtle-01)] px-4">
          <h1 className="truncate text-base font-semibold leading-snug">Runs</h1>
          <Tag type={activeRunCount > 0 ? 'blue' : 'gray'} size="sm">
            {activeRunCount} active
          </Tag>
        </header>

        {runs.length === 0 ? (
          <div className="grid gap-3 p-4 text-[var(--cds-text-secondary)]">
            <JobRun size={24} />
            <p>No runs yet. Send a message in Chat to create one.</p>
          </div>
        ) : (
          <div className="grid gap-2 p-3">
            {runs.map((localRun) => (
              <button
                className={`grid min-h-16 w-full cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border p-2.5 text-left text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                  selectedRun?.run.id === localRun.run.id
                    ? 'border-[var(--cds-border-interactive)] bg-[var(--cds-layer-selected-01)]'
                    : 'border-transparent bg-transparent'
                }`}
                key={localRun.run.id}
                type="button"
                onClick={() => selectRun(localRun.run.id)}
              >
                <span
                  className="grid h-10 w-10 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)]"
                  aria-hidden="true"
                >
                  <JobRun size={18} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate">Run {localRun.run.id.slice(0, 8)}</strong>
                  <small className="truncate text-[var(--cds-text-secondary)]">
                    {localRun.prompt}
                  </small>
                </span>
                <StatusDot status={localRun.run.status} />
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="h-screen min-w-0 overflow-y-auto bg-[var(--cds-background)]" aria-label="Run detail">
        <header className="flex min-h-18 items-center gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 max-[671px]:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)]"
              aria-hidden="true"
            >
              <JobRun size={18} />
            </span>
            <strong className="truncate">
              {selectedRun ? `Run ${selectedRun.run.id.slice(0, 8)}` : 'No run selected'}
            </strong>
          </div>
        </header>

        {selectedRun ? (
          <>
            <section
              className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 py-5 max-[671px]:grid-cols-[4rem_minmax(0,1fr)] max-[671px]:px-4"
              aria-label="Selected run"
            >
              <span
                className="grid h-16 w-16 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)]"
                aria-hidden="true"
              >
                <JobRun size={28} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold leading-snug">
                  {selectedRun.prompt}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-[var(--cds-text-secondary)]">
                  <StatusDot status={selectedRun.run.status} />
                  <span>{runStatusLabel(selectedRun.run.status)}</span>
                </p>
                <small className="mt-1 block truncate text-[var(--cds-text-secondary)]">
                  {selectedRun.run.id}
                </small>
              </div>
              <Tag
                className="justify-self-end max-[671px]:col-start-2 max-[671px]:justify-self-start"
                type={runTagType(selectedRun.run.status)}
                size="sm"
              >
                {runStatusLabel(selectedRun.run.status)}
              </Tag>
            </section>

            <DetailSection title="Prompt">
              <p className="whitespace-pre-wrap break-words">{selectedRun.prompt}</p>
            </DetailSection>

            <DetailSection title="Info">
              <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-3 max-[671px]:grid-cols-1">
                <span className="text-[var(--cds-text-secondary)]">Agent</span>
                <strong className="truncate">{selectedRun.run.agentId}</strong>
                <span className="text-[var(--cds-text-secondary)]">Daemon</span>
                <strong className="truncate">{selectedRun.run.daemonDeviceId}</strong>
                <span className="text-[var(--cds-text-secondary)]">Created</span>
                <strong className="truncate">{formatTime(selectedRun.run.createdAt)}</strong>
                <span className="text-[var(--cds-text-secondary)]">Updated</span>
                <strong className="truncate">{formatTime(selectedRun.run.updatedAt)}</strong>
              </div>
            </DetailSection>

            <DetailSection
              title="Events"
              aside={<span className="text-sm text-[var(--cds-text-secondary)]">{selectedEvents.length}</span>}
            >
              {selectedEvents.length === 0 ? (
                <InlineNotification
                  kind="info"
                  title="No events loaded"
                  subtitle="Run lifecycle events will appear here when the worker reports progress."
                  lowContrast
                  hideCloseButton
                />
              ) : (
                <ol className="grid border border-[var(--cds-border-subtle-01)]">
                  {selectedEvents.map((event, index) => (
                    <li
                      className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)_5rem] gap-3 border-b border-[var(--cds-border-subtle-01)] p-3 last:border-b-0 max-[671px]:grid-cols-1"
                      key={`${event.runId}-${event.type}-${event.createdAt}-${index}`}
                    >
                      <span className="text-[var(--cds-text-secondary)]">{event.type}</span>
                      <span className="min-w-0 truncate">{eventTitle(event)}</span>
                      <time
                        className="justify-self-end text-[var(--cds-text-secondary)] max-[671px]:justify-self-start"
                        dateTime={event.createdAt}
                      >
                        {formatTime(event.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </DetailSection>

            <DetailSection title="Output">
              <div className="grid min-h-20 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 border border-[var(--cds-border-subtle-01)] p-3">
                <Terminal size={20} />
                {agentOutput ? (
                  <pre className="min-w-0 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                    {agentOutput}
                  </pre>
                ) : (
                  <p className="text-[var(--cds-text-secondary)]">No agent output yet.</p>
                )}
              </div>
            </DetailSection>
          </>
        ) : (
          <div className="grid min-h-[calc(100vh-4.5rem)] content-center justify-items-center gap-3 px-6 text-center max-[671px]:px-4">
            <ListBoxes size={32} />
            <h2 className="cds--type-heading-compact-02">No runs yet</h2>
            <p className="max-w-md text-[var(--cds-text-secondary)]">
              Send a message in Chat. Runs created from that conversation will appear here.
            </p>
          </div>
        )}
      </section>
    </section>
  )
}

interface DetailSectionProps {
  title: string
  children: ReactNode
  aside?: ReactNode
}

function DetailSection({ title, children, aside }: DetailSectionProps) {
  return (
    <section className="grid gap-3 border-b border-[var(--cds-border-subtle-01)] px-6 py-5 max-[671px]:px-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xs font-semibold uppercase leading-snug text-[var(--cds-text-secondary)]">
          {title}
        </h3>
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

interface StatusDotProps {
  status: RunStatus
}

function StatusDot({ status }: StatusDotProps) {
  const colorClass = {
    queued: 'border-[var(--cds-icon-secondary)] bg-[var(--cds-layer-01)]',
    running: 'border-[var(--cds-interactive)] bg-[var(--cds-interactive)]',
    succeeded: 'border-[var(--cds-support-success)] bg-[var(--cds-support-success)]',
    failed: 'border-[var(--cds-support-error)] bg-[var(--cds-support-error)]',
    cancelled: 'border-[var(--cds-text-placeholder)] bg-[var(--cds-text-placeholder)]',
  }[status]

  return (
    <span
      className={`h-2.5 w-2.5 rounded-full border ${colorClass}`}
      aria-label={runStatusLabel(status)}
      title={runStatusLabel(status)}
    />
  )
}
