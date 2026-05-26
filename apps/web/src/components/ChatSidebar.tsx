import { Activity, Add, Bookmark, ChatBot, Search } from '@carbon/react/icons'
import { Tag } from '@carbon/react'
import { AgentStatusIndicator } from './AgentStatusIndicator'
import type { AgentDetails, Conversation } from '../lib/api'

interface ChatSidebarProps {
  conversations: Conversation[]
  archivedAgents: AgentDetails[]
  archivedConversations: Conversation[]
  activeRunCount: number
  agents: AgentDetails[]
  activeConversationId: string | null
  savedOpen: boolean
  onCreateAgent: () => void
  onCreateGroup: () => void
  onRestoreAgent: (agentId: string) => void
  onRestoreGroup: (conversationId: string) => void
  onToggleSaved: () => void
  selectGroup: (conversationId: string) => void
  selectAgent: (agentId: string) => void
}

const sidebarButton =
  'grid w-full cursor-pointer items-center border text-left text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const transparentListItem =
  'border-transparent bg-transparent hover:bg-[var(--cds-layer-hover-01)]'
const selectedListItem =
  'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-selected-hover-01)] text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-selected-hover-01)]'
const inlineCount = 'font-semibold normal-case text-[var(--cds-text-primary)]'
const labelWithCount = 'inline-flex items-baseline gap-1'

export function ChatSidebar({
  conversations,
  archivedAgents,
  archivedConversations,
  activeRunCount,
  agents,
  activeConversationId,
  savedOpen,
  onCreateAgent,
  onCreateGroup,
  onRestoreAgent,
  onRestoreGroup,
  onToggleSaved,
  selectGroup,
  selectAgent,
}: ChatSidebarProps) {
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) ?? null
  const defaultGroupConversation = conversations.find(
    (conversation) => conversation.type === 'group' && conversation.key === 'all',
  )
  const customGroupConversations = conversations
    .filter((conversation) => conversation.type === 'group' && conversation.key !== 'all')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const groupConversations =
    defaultGroupConversation === undefined
      ? customGroupConversations
      : [defaultGroupConversation, ...customGroupConversations]
  const archivedGroupConversations = archivedConversations
    .filter((conversation) => conversation.type === 'group' && conversation.key !== 'all')
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  const savedCount = archivedAgents.length + archivedGroupConversations.length

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
          <span className="grid w-6 justify-items-center text-xs font-semibold text-[var(--cds-text-primary)]">
            {activeRunCount}
          </span>
        </button>
        <button
          className={`${sidebarButton} ${
            savedOpen ? selectedListItem : transparentListItem
          } grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`}
          type="button"
          aria-expanded={savedOpen}
          onClick={onToggleSaved}
        >
          <Bookmark size={16} />
          <span>Saved</span>
          <span className="grid w-6 justify-items-center text-xs font-semibold text-[var(--cds-text-primary)]">
            {savedCount}
          </span>
        </button>
        {savedOpen && (
          <div className="grid gap-2 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] p-2">
            {savedCount === 0 ? (
              <p className="px-1 py-2 text-sm text-[var(--cds-text-secondary)]">No archived items.</p>
            ) : (
              <>
                {archivedGroupConversations.map((conversation) => (
                  <div
                    className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-sm text-[var(--cds-text-primary)]"
                    key={conversation.id}
                  >
                    <span aria-hidden="true">#</span>
                    <span className="min-w-0 truncate">{conversation.title}</span>
                    <button
                      className="border-0 bg-transparent px-2 py-1 text-xs font-semibold text-[var(--cds-link-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      type="button"
                      onClick={() => onRestoreGroup(conversation.id)}
                    >
                      Restore
                    </button>
                  </div>
                ))}
                {archivedAgents.map((agent) => (
                  <div
                    className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-sm text-[var(--cds-text-primary)]"
                    key={agent.agent.id}
                  >
                    <ChatBot size={14} />
                    <span className="min-w-0 truncate">{agent.agent.name}</span>
                    <button
                      className="border-0 bg-transparent px-2 py-1 text-xs font-semibold text-[var(--cds-link-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                      type="button"
                      onClick={() => onRestoreAgent(agent.agent.id)}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="groups-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <h3 id="groups-heading" className={`${labelWithCount} truncate text-xs font-semibold uppercase`}>
            Groups<span className={inlineCount}>({groupConversations.length})</span>
          </h3>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add group"
            onClick={onCreateGroup}
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        {groupConversations.map((conversation) => {
          const groupChatSelected = activeConversationId === conversation.id

          return (
            <button
              className={`${sidebarButton} ${
                groupChatSelected ? selectedListItem : transparentListItem
              } min-h-11 grid-cols-[1.25rem_minmax(0,1fr)_1.5rem] gap-2 px-3 py-2`}
              type="button"
              key={conversation.id}
              aria-current={groupChatSelected ? 'page' : undefined}
              onClick={() => selectGroup(conversation.id)}
            >
              <span className="grid h-6 w-5 place-items-center text-base leading-5 text-[var(--cds-text-primary)]" aria-hidden="true">
                #
              </span>
              <span className="min-w-0 truncate text-base leading-5 text-[var(--cds-text-primary)]">{conversation.title}</span>
              <span aria-hidden="true" />
            </button>
          )
        })}
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="agents-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <h3 id="agents-heading" className={`${labelWithCount} truncate text-xs font-semibold uppercase`}>
            Agents<span className={inlineCount}>({agents.length})</span>
          </h3>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Create agent"
            onClick={onCreateAgent}
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        {agents.length === 0 ? (
          <p className="px-3 pb-3 pt-1 text-[var(--cds-text-secondary)]">
            No agents yet.
          </p>
        ) : (
          <div className="grid gap-1">
            {agents.map((agent) => {
              const agentSelected =
                activeConversation?.type === 'direct' &&
                activeConversation.directAgentId === agent.agent.id

              return (
                <button
                  className={`${sidebarButton} ${
                    agentSelected ? selectedListItem : transparentListItem
                  } min-h-11 grid-cols-[1.25rem_minmax(0,1fr)_1.5rem] gap-2 px-3 py-2`}
                  type="button"
                  key={agent.agent.id}
                  aria-current={agentSelected ? 'page' : undefined}
                  onClick={() => selectAgent(agent.agent.id)}
                >
                  <span className="grid h-6 w-5 place-items-center" aria-hidden="true">
                    <ChatBot size={16} />
                  </span>
                  <span className="min-w-0 truncate text-base leading-5">{agent.agent.name}</span>
                  <AgentStatusIndicator agent={agent} />
                </button>
              )
            })}
          </div>
        )}
      </section>
    </aside>
  )
}
