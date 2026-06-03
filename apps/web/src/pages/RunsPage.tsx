import { InlineNotification, Tag } from '@carbon/react'
import { JobRun, ListBoxes, Terminal } from '@carbon/react/icons'
import { useState, type ReactNode } from 'react'
import type { LocalRun, RunEvent, RunStatus } from '../lib/api'
import {
  eventLogLine,
  eventMessageContent,
  eventTitle,
  formatTime,
  isDisplayRunEvent,
  runStatusLabel,
  runTagType,
} from '../lib/format'
import { parsePromptSections, type PromptSection } from '../lib/promptSections'

interface RunsPageProps {
  runs: LocalRun[]
  activeRunCount: number
  eventsByRun: Record<string, RunEvent[]>
  selectedRunId: string | null
  selectRun: (runId: string) => void
}

interface EventDetail {
  label: string
  value: unknown
}

function formatEventJson(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function promptLineTitle(line: string): string {
  return line
    .replace(/<\/?[\w:-]+[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function runDisplayTitle(localRun: LocalRun): string {
  const agentLabel = localRun.agentName ?? 'Agent'

  for (const line of localRun.prompt.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (
      trimmed.length === 0 ||
      /^<\/?[\w:-]+[^>]*>$/.test(trimmed) ||
      trimmed.startsWith('```')
    ) {
      continue
    }

    const title = promptLineTitle(trimmed)

    if (title.length > 0) {
      return truncateText(`${agentLabel} · ${title}`, 80)
    }
  }

  return localRun.agentName ?? `Run ${localRun.run.id.slice(0, 8)}`
}

function eventDetails(event: RunEvent): EventDetail[] {
  const details: EventDetail[] = []
  const logLine = eventLogLine(event)

  if (event.input !== undefined) {
    details.push({ label: 'Parameters', value: event.input })
  }

  if (event.output !== undefined) {
    details.push({ label: 'Result', value: event.output })
  }

  if (event.error) {
    details.push({ label: 'Error', value: event.error })
  }

  if (logLine) {
    details.push({
      label: event.stream === 'stderr' ? 'Error log' : 'Log line',
      value: logLine,
    })
  }

  if (event.raw !== undefined && event.type !== 'runtime.event') {
    details.push({ label: 'Raw runtime event', value: event.raw })
  }

  return details
}

export function RunsPage({
  runs,
  activeRunCount,
  eventsByRun,
  selectedRunId,
  selectRun,
}: RunsPageProps) {
  const selectedRun = runs.find((localRun) => localRun.run.id === selectedRunId) ?? runs[0] ?? null
  const [expandedPromptByRunId, setExpandedPromptByRunId] = useState<Record<string, boolean>>({})
  const [promptViewByRunId, setPromptViewByRunId] = useState<Record<string, 'structured' | 'raw'>>({})
  const selectedEvents = selectedRun ? eventsByRun[selectedRun.run.id] ?? [] : []
  const displayEvents = selectedEvents.filter(isDisplayRunEvent)
  const agentOutput = selectedEvents
    .map(eventMessageContent)
    .filter(Boolean)
    .join('')
  const selectedRunTitle = selectedRun ? runDisplayTitle(selectedRun) : 'No run selected'
  const promptLength = selectedRun?.prompt.length ?? 0
  const promptExpanded = selectedRun ? expandedPromptByRunId[selectedRun.run.id] === true : false
  const promptView = selectedRun ? promptViewByRunId[selectedRun.run.id] ?? 'structured' : 'structured'
  const promptSections = selectedRun ? parsePromptSections(selectedRun.prompt) : []

  return (
    <section
      id="main-content"
      className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)] max-[671px]:grid-cols-1"
      aria-label="Runs management"
    >
      <aside
        className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-r border-[#eef0f3] bg-[#f7f8fa] text-[#596171] max-[671px]:h-auto max-[671px]:max-h-72"
        aria-label="Run list"
      >
        <header className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[#eef0f3] px-4">
          <h1 className="truncate text-base font-semibold leading-snug text-[#161616]">Runs</h1>
          <span className="rounded-md border border-[#dde1e6] bg-white px-2 py-0.5 text-xs font-medium leading-5 text-[#69707d] shadow-[0_1px_1px_rgba(0,0,0,0.03)]">
            {activeRunCount} active
          </span>
        </header>

        {runs.length === 0 ? (
          <div className="grid gap-3 p-4 text-[#69707d]">
            <JobRun size={24} />
            <p>No runs yet. Send a message in Chat to create one.</p>
          </div>
        ) : (
          <div className="grid gap-1 p-3">
            {runs.map((localRun) => (
              <button
                className={`grid min-h-14 w-full cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border-0 px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                  selectedRun?.run.id === localRun.run.id
                    ? 'bg-[#e9eaee] font-semibold text-[#161616] hover:bg-[#e9eaee]'
                    : 'bg-transparent text-[#596171] hover:bg-[#eef0f4] hover:text-[#161616]'
                }`}
                key={localRun.run.id}
                type="button"
                onClick={() => selectRun(localRun.run.id)}
              >
                <span
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#dde1e6] bg-white"
                  aria-hidden="true"
                >
                  <JobRun size={18} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate">{runDisplayTitle(localRun)}</strong>
                  <small className="truncate font-normal text-[#69707d]">
                    Run {localRun.run.id.slice(0, 8)} · {formatTime(localRun.run.createdAt)}
                  </small>
                </span>
                <StatusDot status={localRun.run.status} />
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="h-full min-h-0 min-w-0 overflow-y-auto bg-[#f7f8fa]" aria-label="Run detail">
        <header className="flex min-h-16 items-center gap-4 border-b border-[#eef0f3] bg-white px-6 max-[671px]:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-[#f7f8fa]"
              aria-hidden="true"
            >
              <JobRun size={18} />
            </span>
            <strong className="truncate">
              {selectedRunTitle}
            </strong>
          </div>
        </header>

        {selectedRun ? (
          <>
            <section
              className="mx-6 mt-6 grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-4 rounded-2xl border border-[#e1e5ea] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] max-[671px]:mx-4 max-[671px]:grid-cols-[4rem_minmax(0,1fr)]"
              aria-label="Selected run"
            >
              <span
                className="grid h-16 w-16 place-items-center rounded-2xl border border-[#dde1e6] bg-[#f7f8fa]"
                aria-hidden="true"
              >
                <JobRun size={28} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold leading-snug">
                  {selectedRunTitle}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-[var(--cds-text-secondary)]">
                  <StatusDot status={selectedRun.run.status} />
                  <span>{runStatusLabel(selectedRun.run.status)}</span>
                </p>
                <small className="mt-1 block truncate text-[var(--cds-text-secondary)]">
                  Run {selectedRun.run.id}
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
              <details
                className="overflow-hidden rounded-xl border border-[#e1e5ea] bg-[#f7f8fa]"
                open={promptExpanded}
                onToggle={(event) => {
                  if (selectedRun === null) {
                    return
                  }

                  const open = event.currentTarget.open
                  setExpandedPromptByRunId((current) => ({
                    ...current,
                    [selectedRun.run.id]: open,
                  }))
                }}
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)]">
                  <span className="font-semibold text-[var(--cds-text-primary)]">
                    Prompt
                  </span>
                  <span className="shrink-0 text-xs text-[var(--cds-text-secondary)]">
                    {promptLength.toLocaleString()} chars · {promptExpanded ? 'Hide' : 'Show'}
                  </span>
                </summary>
                <div className="border-t border-[#e1e5ea] p-3">
                  <div className="mb-3 inline-flex h-8 items-center gap-1 rounded-full bg-[#eef0f4] p-0.5">
                    {(['structured', 'raw'] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        className={`flex h-7 min-w-24 cursor-pointer items-center justify-center rounded-full border-0 px-3 text-sm font-semibold ${
                          promptView === view
                            ? 'bg-white text-[#161616] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                            : 'bg-transparent text-[#69707d] hover:text-[#161616]'
                        }`}
                        onClick={() => {
                          setPromptViewByRunId((current) => ({
                            ...current,
                            [selectedRun.run.id]: view,
                          }))
                        }}
                      >
                        {view === 'structured' ? 'Structured' : 'Raw'}
                      </button>
                    ))}
                  </div>
                  {promptView === 'structured' ? (
                    <PromptSectionList key={selectedRun.run.id} sections={promptSections} />
                  ) : (
                    <pre className="min-w-0 whitespace-pre-wrap break-words rounded-xl border border-[#e1e5ea] bg-white p-3 text-sm leading-relaxed text-[var(--cds-text-primary)]">
                      {selectedRun.prompt}
                    </pre>
                  )}
                </div>
              </details>
            </DetailSection>

            <DetailSection title="Info">
              <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-3 max-[671px]:grid-cols-1">
                <span className="text-[var(--cds-text-secondary)]">Agent</span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate">{selectedRun.agentName ?? selectedRun.run.agentId}</strong>
                  {selectedRun.agentName && (
                    <small className="truncate text-[var(--cds-text-secondary)]">{selectedRun.run.agentId}</small>
                  )}
                </span>
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
              aside={<span className="text-sm text-[var(--cds-text-secondary)]">{displayEvents.length}</span>}
            >
              {displayEvents.length === 0 ? (
                <InlineNotification
                  kind="info"
                  title="No events loaded"
                  subtitle="Run lifecycle events will appear here when the worker reports progress."
                  lowContrast
                  hideCloseButton
                />
              ) : (
                <ol className="grid overflow-hidden rounded-xl border border-[#e1e5ea] bg-white">
                  {displayEvents.map((event, index) => (
                    <EventRow
                      event={event}
                      index={index}
                      key={`${event.runId}-${event.type}-${event.createdAt}-${index}`}
                    />
                  ))}
                </ol>
              )}
            </DetailSection>

            <DetailSection title="Output">
              <div className="grid min-h-20 grid-cols-[1.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-[#e1e5ea] bg-[#f7f8fa] p-3">
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

interface EventRowProps {
  event: RunEvent
  index: number
}

interface PromptSectionListProps {
  sections: PromptSection[]
}

function PromptSectionList({ sections }: PromptSectionListProps) {
  const [openBySectionId, setOpenBySectionId] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      sections.map((section, index) => [
        section.id,
        sections.length === 1 || (index === 0 && section.content.length <= 1200),
      ]),
    ),
  )

  return (
    <div className="grid gap-2">
      {sections.map((section) => (
          <details
            key={section.id}
            className="overflow-hidden rounded-xl border border-[#e1e5ea] bg-white"
            open={openBySectionId[section.id] === true}
            onToggle={(event) => {
              const open = event.currentTarget.open
              setOpenBySectionId((current) => ({
                ...current,
                [section.id]: open,
              }))
            }}
          >
            <summary className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--cds-focus)]">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-[var(--cds-text-primary)]">
                  {section.title}
                </span>
                {section.tagName && (
                  <span className="block truncate text-xs text-[var(--cds-text-secondary)]">
                    {section.tagName}
                  </span>
                )}
              </span>
              <span className="text-xs text-[var(--cds-text-secondary)]">
                {section.content.length.toLocaleString()} chars
              </span>
            </summary>
            <pre className="max-h-96 min-w-0 overflow-auto border-t border-[#e1e5ea] bg-[#f7f8fa] p-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--cds-text-primary)]">
              {section.content}
            </pre>
          </details>
      ))}
    </div>
  )
}

function EventRow({ event, index }: EventRowProps) {
  const details = eventDetails(event)
  const logLine = eventLogLine(event)
  const isErrorLog = event.type === 'log.line' && event.stream === 'stderr'
  const isToolEvent = event.type.startsWith('tool.call') || event.type.startsWith('agenthub.tool')
  const isFailedToolResult = event.type === 'agenthub.tool.result' && event.status === 'failed'

  return (
    <li className="grid min-w-0 gap-3 border-b border-[#e1e5ea] px-4 py-3 last:border-b-0 max-[671px]:px-3">
      <div className="grid min-w-0 grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)_4.5rem] items-start gap-4 max-[671px]:grid-cols-1 max-[671px]:gap-1.5">
        <Tag
          className="min-w-0 max-w-full justify-self-start"
          size="sm"
          type={isErrorLog || isFailedToolResult ? 'red' : isToolEvent ? 'blue' : 'gray'}
        >
          <span className="block max-w-[11rem] truncate">{event.type}</span>
        </Tag>
        <span className="grid min-w-0 gap-1">
          <span className="min-w-0 break-words font-medium leading-snug">
            {eventTitle(event)}
          </span>
          {event.toolCallId && (
            <span className="truncate text-xs text-[var(--cds-text-secondary)]">
              {event.toolCallId}
            </span>
          )}
          {logLine && (
            <pre
              className={`min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed ${
                isErrorLog ? 'text-[var(--cds-text-error)]' : 'text-[var(--cds-text-secondary)]'
              }`}
            >
              {logLine}
            </pre>
          )}
        </span>
        <time
          className="justify-self-end text-xs text-[var(--cds-text-secondary)] max-[671px]:justify-self-start"
          dateTime={event.createdAt}
        >
          {formatTime(event.createdAt)}
        </time>
      </div>
      {details.length > 0 && (
        <details className="ml-[calc(13rem+1rem)] min-w-0 max-[671px]:ml-0">
          <summary className="w-fit cursor-pointer text-sm text-[var(--cds-link-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]">
            Details
          </summary>
          <div className="mt-3 grid gap-3">
            {details.map((detail) => (
              <section className="grid gap-1.5" key={`${event.runId}-${index}-${detail.label}`}>
                <h4 className="text-xs font-semibold uppercase leading-snug text-[var(--cds-text-secondary)]">
                  {detail.label}
                </h4>
                <pre className="max-h-72 min-w-0 overflow-auto rounded-xl border border-[#e1e5ea] bg-[#f7f8fa] p-3 text-xs leading-relaxed text-[var(--cds-text-primary)]">
                  {formatEventJson(detail.value)}
                </pre>
              </section>
            ))}
          </div>
        </details>
      )}
    </li>
  )
}

interface DetailSectionProps {
  title: string
  children: ReactNode
  aside?: ReactNode
}

function DetailSection({ title, children, aside }: DetailSectionProps) {
  return (
    <section className="mx-6 mt-4 grid gap-3 rounded-2xl border border-[#e1e5ea] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] last:mb-6 max-[671px]:mx-4">
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
    interrupted: 'border-[var(--cds-text-placeholder)] bg-[var(--cds-text-placeholder)]',
  }[status]

  return (
    <span
      className={`h-2.5 w-2.5 rounded-full border ${colorClass}`}
      aria-label={runStatusLabel(status)}
      title={runStatusLabel(status)}
    />
  )
}
