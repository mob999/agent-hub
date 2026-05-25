import { Tag } from '@carbon/react'
import type { LocalRun, RunEvent } from '../lib/api'
import { eventTitle, formatTime, runStatusLabel, runTagType } from '../lib/format'

interface RunThreadProps {
  localRun: LocalRun
  events: RunEvent[]
  selected: boolean
  selectRun: (runId: string) => void
}

export function RunThread({ localRun, events, selected, selectRun }: RunThreadProps) {
  const agentMessage = events
    .filter((event) => event.type === 'message.delta' && event.content)
    .map((event) => event.content)
    .join('')
  const latestEvent = events.at(-1)
  const eventPreview = events.slice(-4)

  return (
    <article className="grid gap-1" aria-label={`Run ${localRun.run.id}`}>
      <div className="grid w-full min-w-0 grid-cols-[2rem_minmax(0,1fr)] gap-3 p-3 text-left text-[var(--cds-text-primary)] max-[671px]:grid-cols-[1.75rem_minmax(0,1fr)] max-[671px]:px-1">
        <span
          className="grid h-8 w-8 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] text-sm font-semibold max-[671px]:h-7 max-[671px]:w-7"
          aria-hidden="true"
        >
          Y
        </span>
        <span className="grid min-w-0 gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <strong>You</strong>
            <time className="text-xs text-[var(--cds-text-secondary)]" dateTime={localRun.run.createdAt}>
              {formatTime(localRun.run.createdAt)}
            </time>
          </span>
          <span className="whitespace-pre-wrap break-words">{localRun.prompt}</span>
        </span>
      </div>
      <button
        type="button"
        className={`grid w-full min-w-0 cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-3 border-0 border-l-2 p-3 text-left text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] max-[671px]:grid-cols-[1.75rem_minmax(0,1fr)] max-[671px]:px-1 ${
          selected
            ? 'border-l-[var(--cds-border-interactive)] bg-[var(--cds-layer-selected-01)]'
            : 'border-l-transparent bg-transparent'
        }`}
        aria-pressed={selected}
        onClick={() => selectRun(localRun.run.id)}
      >
        <span
          className="grid h-8 w-8 place-items-center border border-[var(--cds-border-interactive)] bg-[var(--cds-layer-01)] text-sm font-semibold max-[671px]:h-7 max-[671px]:w-7"
          aria-hidden="true"
        >
          A
        </span>
        <span className="grid min-w-0 gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <strong>Agent</strong>
            <Tag type={runTagType(localRun.run.status)} size="sm">
              {runStatusLabel(localRun.run.status)}
            </Tag>
            <time className="text-xs text-[var(--cds-text-secondary)]" dateTime={localRun.run.updatedAt}>
              {formatTime(localRun.run.updatedAt)}
            </time>
          </span>
          <span className="whitespace-pre-wrap break-words">
            {agentMessage ||
              (latestEvent
                ? eventTitle(latestEvent)
                : `Run is ${runStatusLabel(localRun.run.status).toLowerCase()}.`)}
          </span>
          <span className="text-xs text-[var(--cds-text-secondary)]">
            Run {localRun.run.id.slice(0, 8)} · {localRun.run.daemonDeviceId}
          </span>
          {eventPreview.length > 0 && (
            <span className="mt-0.5 flex flex-wrap gap-1.5">
              {eventPreview.map((event, index) => (
                <span
                  className="max-w-56 truncate bg-[var(--cds-layer-01)] px-1.5 py-0.5 text-xs text-[var(--cds-text-secondary)]"
                  key={`${event.type}-${event.createdAt}-${index}`}
                >
                  {eventTitle(event)}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </article>
  )
}
