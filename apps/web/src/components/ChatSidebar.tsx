import { Activity, Add, Bookmark, Search } from '@carbon/react/icons'
import { Tag } from '@carbon/react'
import type { LocalRun } from '../lib/api'

interface ChatSidebarProps {
  runs: LocalRun[]
  activeRunCount: number
}

const sidebarButton =
  'grid w-full cursor-pointer items-center border text-left text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const transparentListItem =
  'border-transparent bg-transparent hover:bg-[var(--cds-layer-hover-01)]'
const selectedListItem =
  'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-selected-hover-01)] text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-selected-hover-01)]'
const inlineCount = 'font-semibold normal-case text-[var(--cds-text-primary)]'
const labelWithCount = 'inline-flex items-baseline gap-1'

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
        <button className={`${sidebarButton} ${transparentListItem} grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`} type="button">
          <Search size={16} />
          <span>Search</span>
          <kbd className="text-[var(--cds-text-secondary)]">Ctrl K</kbd>
        </button>
        <button className={`${sidebarButton} ${transparentListItem} grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`} type="button">
          <Activity size={16} />
          <span>Activity</span>
          <span className="font-semibold text-[var(--cds-text-primary)]">{activeRunCount}</span>
        </button>
        <button className={`${sidebarButton} ${transparentListItem} grid-cols-[1rem_minmax(0,1fr)] gap-3 px-3 py-2`} type="button">
          <Bookmark size={16} />
          <span>Saved</span>
        </button>
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="groups-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <h3 id="groups-heading" className={`${labelWithCount} truncate text-xs font-semibold uppercase`}>
            Groups<span className={inlineCount}>({runs.length})</span>
          </h3>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add group"
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        <button
          className={`${sidebarButton} ${selectedListItem} min-h-10 grid-cols-[1rem_minmax(0,1fr)_auto] gap-1 px-3 font-semibold`}
          type="button"
          aria-current="page"
        >
          <span className="text-base text-[var(--cds-text-primary)]">#</span>
          <span>all</span>
          {activeRunCount > 0 && (
            <Tag type="blue" size="sm">
              {activeRunCount}
            </Tag>
          )}
        </button>
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="agents-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <h3 id="agents-heading" className={`${labelWithCount} truncate text-xs font-semibold uppercase`}>
            Agents<span className={inlineCount}>(0)</span>
          </h3>
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
