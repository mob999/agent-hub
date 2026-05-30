import { Search } from '@carbon/react/icons'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import type {
  AgentDetails,
  Conversation,
  ConversationSearchHit,
  SearchConversationsResponse,
  SearchSort,
  SearchTimeFilter,
} from '../lib/api'
import { formatTime } from '../lib/format'

interface SearchWorkspaceProps {
  agents: AgentDetails[]
  conversations: Conversation[]
  error: string | null
  isLoading: boolean
  onChannelChange: (value?: string) => void
  onOpenConversation: (conversationId: string) => void
  onOpenMessage: (conversationId: string, messageId: string) => void
  onQueryChange: (value: string) => void
  onSenderChange: (value?: string) => void
  onSortChange: (value: SearchSort) => void
  onTimeChange: (value: SearchTimeFilter) => void
  query: string
  results: SearchConversationsResponse | null
  selectedChannelId?: string
  selectedSender?: string
  sort: SearchSort
  time: SearchTimeFilter
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): ReactNode {
  const trimmedQuery = query.trim()

  if (trimmedQuery.length === 0) {
    return text
  }

  const pattern = new RegExp(`(${escapeRegExp(trimmedQuery)})`, 'ig')
  const parts = text.split(pattern)

  return parts.map((part, index) =>
    part.toLowerCase() === trimmedQuery.toLowerCase()
      ? (
          <mark className="bg-[var(--cds-highlight)] px-0.5 text-inherit" key={`${part}-${index}`}>
            {part}
          </mark>
        )
      : <span key={`${part}-${index}`}>{part}</span>,
  )
}

function resultCountLabel(results: SearchConversationsResponse | null): string {
  if (results === null) {
    return 'Search chats, channels, and DMs'
  }

  return `${results.totalCount} results`
}

function conversationKindLabel(hit: ConversationSearchHit): string {
  return hit.conversationType === 'group' ? 'Channel' : 'Direct message'
}

export function SearchWorkspace({
  agents,
  conversations,
  error,
  isLoading,
  onChannelChange,
  onOpenConversation,
  onOpenMessage,
  onQueryChange,
  onSenderChange,
  onSortChange,
  onTimeChange,
  query,
  results,
  selectedChannelId,
  selectedSender,
  sort,
  time,
}: SearchWorkspaceProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const channelOptions = useMemo(
    () => conversations.map((conversation) => ({
      id: conversation.id,
      label: conversation.type === 'group' ? `#${conversation.title}` : conversation.title,
    })),
    [conversations],
  )
  const senderOptions = useMemo(
    () => [
      { value: '', label: 'Any sender' },
      { value: 'user', label: 'User' },
      ...agents.map((agent) => ({
        value: agent.agent.id,
        label: agent.agent.name,
      })),
    ],
    [agents],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <section
      className="grid h-screen min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)]"
      aria-label="Search chats"
    >
      <header className="border-b border-[var(--cds-border-subtle-01)] px-6 py-4 max-[671px]:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-02)]">
            <Search size={18} />
          </span>
          <label className="grid min-w-0 flex-1 gap-1">
            <span className="text-sm font-semibold text-[var(--cds-text-secondary)]">Search</span>
            <input
              ref={inputRef}
              className="min-w-0 border border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-01)] px-3 py-2 text-base text-[var(--cds-text-primary)] outline-none focus:border-[var(--cds-focus)]"
              placeholder="Search channels, DMs, messages..."
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--cds-border-subtle-01)] px-6 py-3 max-[671px]:px-4">
        <select
          className="min-h-10 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] px-3 text-sm text-[var(--cds-text-primary)]"
          value={selectedSender ?? ''}
          onChange={(event) => onSenderChange(event.target.value || undefined)}
        >
          {senderOptions.map((option) => (
            <option key={option.value || 'any'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="min-h-10 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] px-3 text-sm text-[var(--cds-text-primary)]"
          value={selectedChannelId ?? ''}
          onChange={(event) => onChannelChange(event.target.value || undefined)}
        >
          <option value="">Any channel</option>
          {channelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className="min-h-10 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] px-3 text-sm text-[var(--cds-text-primary)]"
          value={time}
          onChange={(event) => onTimeChange(event.target.value as SearchTimeFilter)}
        >
          <option value="any">Any time</option>
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <div className="ml-auto inline-flex overflow-hidden border border-[var(--cds-border-strong-01)]">
          {(['relevant', 'recent'] as const).map((value) => {
            const selected = sort === value

            return (
              <button
                className={`min-h-10 min-w-22 px-3 text-sm font-semibold ${
                  selected
                    ? 'bg-[var(--cds-layer-selected-02)] text-[var(--cds-text-primary)]'
                    : 'bg-[var(--cds-layer-01)] text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)]'
                }`}
                key={value}
                type="button"
                onClick={() => onSortChange(value)}
              >
                {value === 'relevant' ? 'Relevant' : 'Recent'}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto px-6 py-4 max-[671px]:px-4">
        <div className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cds-text-secondary)]">
          {isLoading ? 'Searching...' : resultCountLabel(results)}
        </div>
        {error && (
          <div className="mb-4 border border-[var(--cds-support-error)] bg-[var(--cds-layer-01)] px-4 py-3 text-sm text-[var(--cds-text-error)]">
            {error}
          </div>
        )}
        {!isLoading && query.trim().length === 0 && (
          <div className="grid min-h-80 place-items-center text-center text-[var(--cds-text-secondary)]">
            Start typing to search active channels, DMs, and messages.
          </div>
        )}
        {!isLoading && query.trim().length > 0 && results !== null && results.totalCount === 0 && (
          <div className="grid min-h-80 place-items-center text-center text-[var(--cds-text-secondary)]">
            No matches found for this search.
          </div>
        )}
        {results !== null && results.conversationHits.length > 0 && (
          <section className="mb-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cds-text-secondary)]">
              Channels &amp; DMs
            </div>
            <div className="grid gap-2">
              {results.conversationHits.map((hit) => (
                <button
                  className="grid gap-1 border border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-01)] px-4 py-3 text-left hover:bg-[var(--cds-layer-hover-01)]"
                  key={hit.conversationId}
                  type="button"
                  onClick={() => onOpenConversation(hit.conversationId)}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--cds-text-primary)]">
                      {highlightText(hit.title, query)}
                    </span>
                    <span className="border border-[var(--cds-border-subtle-01)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--cds-text-secondary)]">
                      {conversationKindLabel(hit)}
                    </span>
                  </div>
                  <div className="truncate text-sm text-[var(--cds-text-secondary)]">
                    {highlightText(hit.subtitle, query)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
        {results !== null && results.messageHits.length > 0 && (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--cds-text-secondary)]">
              Messages
            </div>
            <div className="grid gap-2">
              {results.messageHits.map((hit) => (
                <button
                  className="grid gap-2 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] px-4 py-3 text-left hover:border-[var(--cds-border-strong-01)] hover:bg-[var(--cds-layer-hover-01)]"
                  key={hit.messageId}
                  type="button"
                  onClick={() => onOpenMessage(hit.conversationId, hit.messageId)}
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--cds-text-secondary)]">
                    <span className="font-semibold text-[var(--cds-text-primary)]">{hit.senderLabel}</span>
                    <span>in {hit.conversationLabel}</span>
                    <span>{formatTime(hit.createdAt)}</span>
                  </div>
                  <div className="text-sm leading-5 text-[var(--cds-text-primary)]">
                    {highlightText(hit.snippet, query)}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
