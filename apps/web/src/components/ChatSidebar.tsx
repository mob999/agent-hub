import { Add, Chat, ChatBot, JobRun } from '@carbon/react/icons'
import { Tag } from '@carbon/react'
import type { LocalRun } from '../lib/api'

interface ChatSidebarProps {
  runs: LocalRun[]
  activeRunCount: number
}

const sidebarButton =
  'grid w-full cursor-pointer items-center border border-transparent bg-transparent text-left text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'

export function ChatSidebar({ runs, activeRunCount }: ChatSidebarProps) {
  return (
    <aside
      className="flex h-screen min-w-0 flex-col overflow-y-auto border-r border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)]"
      aria-label="Chat navigation"
    >
      <header className="flex min-h-18 items-center justify-between border-b border-[var(--cds-border-subtle-01)] px-4">
        <h2 className="cds--type-heading-compact-02">Chat</h2>
        <Tag type="gray" size="sm">
          beta
        </Tag>
      </header>

      <section className="grid gap-0.5 p-3" aria-label="Quick actions">
        <button className={`${sidebarButton} grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`} type="button">
          <Chat size={16} />
          <span>Search</span>
          <kbd className="text-[var(--cds-text-secondary)]">Ctrl K</kbd>
        </button>
        <button className={`${sidebarButton} grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`} type="button">
          <JobRun size={16} />
          <span>Activity</span>
          <small className="text-[var(--cds-text-secondary)]">{activeRunCount}</small>
        </button>
        <button className={`${sidebarButton} grid-cols-[1rem_minmax(0,1fr)] gap-3 px-3 py-2`} type="button">
          <ChatBot size={16} />
          <span>Saved</span>
        </button>
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="groups-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <h3 id="groups-heading" className="truncate text-xs font-semibold uppercase">
            Groups
          </h3>
          <span>{runs.length}</span>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add group"
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        <button
          className={`${sidebarButton} min-h-10 grid-cols-[1rem_minmax(0,1fr)_auto] gap-1 border-[var(--cds-border-interactive)] bg-[var(--cds-layer-selected-01)] px-3 font-semibold`}
          type="button"
        >
          <span className="text-base text-[var(--cds-text-secondary)]">#</span>
          <span>all</span>
          {activeRunCount > 0 && (
            <Tag type="blue" size="sm">
              {activeRunCount}
            </Tag>
          )}
        </button>
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="agents-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <h3 id="agents-heading" className="truncate text-xs font-semibold uppercase">
            Agents
          </h3>
          <span>0</span>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Create agent"
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        <p className="px-3 pb-3 pt-1 text-[var(--cds-text-secondary)]">
          No agents yet. Create one from a runtime.
        </p>
      </section>
    </aside>
  )
}
