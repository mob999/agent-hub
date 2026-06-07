import { Search } from '@carbon/react/icons'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
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

function conversationKindLabel(hit: ConversationSearchHit, t: (key: string) => string): string {
  if (hit.conversationType === 'group') {
    return t('search.groupType')
  }

  if (hit.conversationType === 'project') {
    return t('search.projectType')
  }

  return t('search.agentType')
}

const filterSelectClass =
  'h-9 rounded-full border border-[#dde1e6] bg-white py-0 pl-3 pr-9 text-xs font-semibold uppercase leading-9 tracking-normal text-[#3f4551] shadow-[0_1px_1px_rgba(0,0,0,0.03)] outline-none transition-colors hover:border-[#c7ced8] focus:border-[#0f62fe] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--cds-focus)]'

const resultSectionTitleClass =
  'text-xs font-semibold uppercase tracking-wide text-[#69707d]'

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
  const { t } = useTranslation()
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
      { value: '', label: t('search.anySender') },
      { value: 'user', label: t('search.userSender') },
      ...agents.map((agent) => ({
        value: agent.agent.id,
        label: agent.agent.name,
      })),
    ],
    [agents, t],
  )

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <section
      className="grid h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden bg-[#f7f8fa]"
      aria-label={t('search.aria')}
    >
      <header className="border-b border-[#eef0f3] bg-white px-6 py-5 max-[671px]:px-4">
        <div className="grid min-w-0 gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-[#d8dee6] bg-[#f7f8fa] text-[#3f4551] shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
              <Search size={18} />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold leading-7 text-[#161616]">{t('search.title')}</h1>
              <p className="truncate text-sm leading-5 text-[#69707d]">
                {t('search.findSubtitle')}
              </p>
            </div>
          </div>
          <label className="relative grid min-w-0" htmlFor="workspace-search-input">
            <span className="sr-only">{t('search.messagesLabel')}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-[#69707d]"
              size={18}
            />
            <input
              ref={inputRef}
              id="workspace-search-input"
              className="h-11 min-w-0 rounded-2xl border border-[#d8dee6] bg-white py-2 pl-10 pr-3 text-base leading-6 text-[#161616] shadow-[0_1px_3px_rgba(0,0,0,0.05)] outline-none placeholder:text-[#8d95a3] focus:border-[#b9c3cf] focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-[var(--cds-focus)]"
              placeholder={t('search.placeholder')}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-[#eef0f3] bg-white px-6 py-3 max-[671px]:px-4">
        <select
          className={filterSelectClass}
          value={selectedSender ?? ''}
          onChange={(event) => onSenderChange(event.target.value || undefined)}
          aria-label={t('search.filterSender')}
        >
          {senderOptions.map((option) => (
            <option key={option.value || 'any'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className={filterSelectClass}
          value={selectedChannelId ?? ''}
          onChange={(event) => onChannelChange(event.target.value || undefined)}
          aria-label={t('search.filterGroup')}
        >
          <option value="">{t('search.anyGroup')}</option>
          {channelOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          className={filterSelectClass}
          value={time}
          onChange={(event) => onTimeChange(event.target.value as SearchTimeFilter)}
          aria-label={t('search.filterTime')}
        >
          <option value="any">{t('search.anyTime')}</option>
          <option value="24h">{t('search.last24Hours')}</option>
          <option value="7d">{t('search.last7Days')}</option>
          <option value="30d">{t('search.last30Days')}</option>
        </select>
        <div className="ml-auto inline-flex h-9 overflow-hidden rounded-full bg-[#eef0f4] p-0.5" role="group" aria-label={t('search.sort')}>
          {(['relevant', 'recent'] as const).map((value) => {
            const selected = sort === value

            return (
              <button
                className={`min-w-20 cursor-pointer rounded-full border-0 px-3 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                  selected
                    ? 'bg-white text-[#161616] shadow-[0_1px_3px_rgba(0,0,0,0.08)]'
                    : 'bg-transparent text-[#69707d] hover:text-[#161616]'
                }`}
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => onSortChange(value)}
              >
                {value === 'relevant' ? t('search.relevant') : t('search.recent')}
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto px-6 py-5 max-[671px]:px-4">
        <div className="mb-4 flex min-h-6 items-center justify-between gap-3">
          <div className={resultSectionTitleClass}>
            {isLoading
              ? t('search.searching')
              : results === null
                ? t('search.ready')
                : query.trim()
                  ? t('search.resultCountFor', { count: results.totalCount, query: query.trim() })
                  : t('search.resultCount', { count: results.totalCount })}
          </div>
          {query.trim().length > 0 && (
            <div className="truncate text-xs text-[#69707d]">
              {t('search.pressEnterHint')}
            </div>
          )}
        </div>
        {error && (
          <div className="mb-4 rounded-xl border border-[#ffd7d9] bg-[#fff1f1] px-4 py-3 text-sm text-[var(--cds-text-error)]">
            {error}
          </div>
        )}
        {!isLoading && query.trim().length === 0 && (
          <div className="grid min-h-80 place-items-center text-center">
            <div className="grid max-w-md justify-items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-md border border-[#d8dee6] bg-white text-[#69707d] shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
                <Search size={22} />
              </span>
              <div className="grid gap-1">
                <h2 className="text-base font-semibold text-[#161616]">{t('search.welcomeTitle')}</h2>
                <p className="text-sm leading-5 text-[#69707d]">
                  {t('search.typeSubtitle')}
                </p>
              </div>
            </div>
          </div>
        )}
        {!isLoading && query.trim().length > 0 && results !== null && results.totalCount === 0 && (
          <div className="grid min-h-80 place-items-center text-center">
            <div className="grid max-w-md gap-1">
              <h2 className="text-base font-semibold text-[#161616]">{t('search.noMatches')}</h2>
              <p className="text-sm leading-5 text-[#69707d]">
                {t('search.noMatchesSubtitle')}
              </p>
            </div>
          </div>
        )}
        {results !== null && results.conversationHits.length > 0 && (
          <section className="mb-6">
            <div className={`mb-2 ${resultSectionTitleClass}`}>
              {t('search.conversations')}
            </div>
            <div className="grid gap-2">
              {results.conversationHits.map((hit) => (
                <button
                  className="grid cursor-pointer gap-1 rounded-xl border border-[#e1e5ea] bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-[#c7ced8] hover:bg-[#f9fafb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                  key={hit.conversationId}
                  type="button"
                  onClick={() => onOpenConversation(hit.conversationId)}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[#161616]">
                      {highlightText(hit.title, query)}
                    </span>
                    <span className="shrink-0 rounded-md border border-[#dde1e6] bg-[#f7f8fa] px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 text-[#69707d]">
                      {conversationKindLabel(hit, t)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
        {results !== null && results.messageHits.length > 0 && (
          <section>
            <div className={`mb-2 ${resultSectionTitleClass}`}>
              {t('search.messages')}
            </div>
            <div className="grid gap-2">
              {results.messageHits.map((hit) => (
                <button
                  className="grid cursor-pointer gap-2 rounded-xl border border-[#e1e5ea] bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:border-[#c7ced8] hover:bg-[#f9fafb] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                  key={hit.messageId}
                  type="button"
                  onClick={() => onOpenMessage(hit.conversationId, hit.messageId)}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-4 text-[#69707d]">
                    <span className="font-semibold text-[#161616]">{hit.senderLabel}</span>
                    <span>{t('search.inConversation', { conversation: hit.conversationLabel })}</span>
                    <span>{formatTime(hit.createdAt)}</span>
                  </div>
                  <div className="line-clamp-3 text-sm leading-5 text-[#161616]">
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
