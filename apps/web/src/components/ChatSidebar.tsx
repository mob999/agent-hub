import {
  Activity,
  Add,
  Bookmark,
  ChatBot,
  Checkmark,
  ChevronDown,
  ChevronRight,
  Search,
  TrashCan,
  Undo,
} from '@carbon/react/icons'
import { Tag } from '@carbon/react'
import { useState } from 'react'
import { AgentStatusIndicator } from './AgentStatusIndicator'
import type { AgentDetails, Conversation } from '../lib/api'

interface ChatSidebarProps {
  conversations: Conversation[]
  archivedAgents: AgentDetails[]
  archivedConversations: Conversation[]
  activeRunCount: number
  agents: AgentDetails[]
  activeConversationId: string | null
  unreadCounts: Record<string, number>
  savedOpen: boolean
  onCreateAgent: () => void
  onCreateGroup: () => void
  onOpenSearch: () => void
  onOpenActivity: () => void
  onDeleteAgent: (agentId: string) => void
  onDeleteGroup: (conversationId: string) => void
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
const agentAvatarFrame =
  'grid h-8 w-8 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)]'
const unreadBadge =
  'inline-grid min-w-5 place-items-center rounded-full bg-[var(--cds-support-error)] px-1.5 text-xs font-semibold leading-5 text-[var(--cds-text-on-color)]'
const archivedActionButton =
  'grid h-7 w-7 place-items-center border-0 bg-transparent p-0 hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const archivedRestoreButton =
  `${archivedActionButton} text-[var(--cds-support-success)] hover:text-[var(--cds-support-success)]`
const archivedDeleteButton =
  `${archivedActionButton} text-[var(--cds-support-error)] hover:text-[var(--cds-support-error)]`
const archivedConfirmDeleteButton =
  'grid h-7 w-7 place-items-center border border-[var(--cds-support-error)] bg-[var(--cds-support-error)] p-0 text-[var(--cds-text-on-color)] hover:bg-[var(--cds-support-error)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const sidebarSectionToggle =
  'inline-grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-center gap-1 border-0 bg-transparent p-0 text-left text-[var(--cds-text-secondary)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null
  }

  return (
    <span className={unreadBadge} aria-label={`${count} unread messages`}>
      {count > 99 ? '99+' : count}
    </span>
  )
}

export function ChatSidebar({
  conversations,
  archivedAgents,
  archivedConversations,
  activeRunCount,
  agents,
  activeConversationId,
  unreadCounts,
  savedOpen,
  onCreateAgent,
  onCreateGroup,
  onOpenSearch,
  onOpenActivity,
  onDeleteAgent,
  onDeleteGroup,
  onRestoreAgent,
  onRestoreGroup,
  onToggleSaved,
  selectGroup,
  selectAgent,
}: ChatSidebarProps) {
  const [confirmingDeleteKey, setConfirmingDeleteKey] = useState<string | null>(null)
  const [groupsCollapsed, setGroupsCollapsed] = useState(false)
  const [agentsCollapsed, setAgentsCollapsed] = useState(false)
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
  const archivedCount = archivedAgents.length + archivedGroupConversations.length
  const directConversationByAgentId = new Map(
    conversations
      .filter((conversation) => conversation.type === 'direct' && conversation.directAgentId !== undefined)
      .map((conversation) => [conversation.directAgentId, conversation]),
  )

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
        <button
          className={`${sidebarButton} ${transparentListItem} grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`}
          type="button"
          onClick={onOpenSearch}
        >
          <Search size={16} />
          <span>Search</span>
          <kbd className="text-[var(--cds-text-secondary)]">Ctrl K</kbd>
        </button>
        <button
          className={`${sidebarButton} ${transparentListItem} grid-cols-[1rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`}
          type="button"
          onClick={onOpenActivity}
        >
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
          <span>Archived</span>
          <span className="grid w-6 justify-items-center text-xs font-semibold text-[var(--cds-text-primary)]">
            {archivedCount}
          </span>
        </button>
        {savedOpen && (
          <div className="grid gap-2 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-02)] p-2">
            {archivedCount === 0 ? (
              <p className="px-1 py-2 text-sm text-[var(--cds-text-secondary)]">No archived items.</p>
            ) : (
              <>
                {archivedGroupConversations.map((conversation) => {
                  const deleteKey = `group:${conversation.id}`
                  const confirmingDelete = confirmingDeleteKey === deleteKey

                  return (
                    <div
                      className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-sm text-[var(--cds-text-primary)]"
                      key={conversation.id}
                    >
                      <span aria-hidden="true">#</span>
                      <span className="min-w-0 truncate">{conversation.title}</span>
                      <span className="inline-flex items-center gap-1">
                        <button
                          className={archivedRestoreButton}
                          type="button"
                          title={`Restore ${conversation.title}`}
                          aria-label={`Restore ${conversation.title}`}
                          onClick={() => {
                            setConfirmingDeleteKey(null)
                            onRestoreGroup(conversation.id)
                          }}
                        >
                          <Undo size={16} />
                        </button>
                        <button
                          className={confirmingDelete ? archivedConfirmDeleteButton : archivedDeleteButton}
                          type="button"
                          title={
                            confirmingDelete
                              ? `Confirm permanent delete ${conversation.title}`
                              : `Permanently delete ${conversation.title}`
                          }
                          aria-label={
                            confirmingDelete
                              ? `Confirm permanent delete ${conversation.title}`
                              : `Permanently delete ${conversation.title}`
                          }
                          onClick={() => {
                            if (!confirmingDelete) {
                              setConfirmingDeleteKey(deleteKey)
                              return
                            }

                            setConfirmingDeleteKey(null)
                            onDeleteGroup(conversation.id)
                          }}
                        >
                          {confirmingDelete ? <Checkmark size={16} /> : <TrashCan size={16} />}
                        </button>
                      </span>
                    </div>
                  )
                })}
                {archivedAgents.map((agent) => {
                  const deleteKey = `agent:${agent.agent.id}`
                  const confirmingDelete = confirmingDeleteKey === deleteKey

                  return (
                    <div
                      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1 text-sm text-[var(--cds-text-primary)]"
                      key={agent.agent.id}
                    >
                      <span className={agentAvatarFrame} aria-hidden="true">
                        {agent.agent.avatar ? (
                          <img
                            src={agent.agent.avatar}
                            alt=""
                            className="h-7 w-7 object-cover"
                          />
                        ) : (
                          <ChatBot size={16} />
                        )}
                      </span>
                      <span className="min-w-0 truncate">{agent.agent.name}</span>
                      <span className="inline-flex items-center gap-1">
                        <button
                          className={archivedRestoreButton}
                          type="button"
                          title={`Restore ${agent.agent.name}`}
                          aria-label={`Restore ${agent.agent.name}`}
                          onClick={() => {
                            setConfirmingDeleteKey(null)
                            onRestoreAgent(agent.agent.id)
                          }}
                        >
                          <Undo size={16} />
                        </button>
                        <button
                          className={confirmingDelete ? archivedConfirmDeleteButton : archivedDeleteButton}
                          type="button"
                          title={
                            confirmingDelete
                              ? `Confirm permanent delete ${agent.agent.name}`
                              : `Permanently delete ${agent.agent.name}`
                          }
                          aria-label={
                            confirmingDelete
                              ? `Confirm permanent delete ${agent.agent.name}`
                              : `Permanently delete ${agent.agent.name}`
                          }
                          onClick={() => {
                            if (!confirmingDelete) {
                              setConfirmingDeleteKey(deleteKey)
                              return
                            }

                            setConfirmingDeleteKey(null)
                            onDeleteAgent(agent.agent.id)
                          }}
                        >
                          {confirmingDelete ? <Checkmark size={16} /> : <TrashCan size={16} />}
                        </button>
                      </span>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="groups-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <button
            className={sidebarSectionToggle}
            type="button"
            aria-expanded={!groupsCollapsed}
            aria-controls="groups-list"
            onClick={() => setGroupsCollapsed((collapsed) => !collapsed)}
          >
            {groupsCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <span id="groups-heading" className={`${labelWithCount} truncate text-xs font-semibold uppercase`}>
              Groups<span className={inlineCount}>({groupConversations.length})</span>
            </span>
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add group"
            onClick={onCreateGroup}
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        {!groupsCollapsed && (
          <div id="groups-list" className="grid gap-1">
            {groupConversations.map((conversation) => {
              const groupChatSelected = activeConversationId === conversation.id

              return (
                <button
                  className={`${sidebarButton} ${
                    groupChatSelected ? selectedListItem : transparentListItem
                  } min-h-11 grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-2 px-3 py-2`}
                  type="button"
                  key={conversation.id}
                  aria-current={groupChatSelected ? 'page' : undefined}
                  onClick={() => selectGroup(conversation.id)}
                >
                  <span
                    className="grid h-6 w-5 place-items-center text-base leading-5 text-[var(--cds-text-primary)]"
                    aria-hidden="true"
                  >
                    #
                  </span>
                  <span className="min-w-0 truncate text-base leading-5 text-[var(--cds-text-primary)]">
                    {conversation.title}
                  </span>
                  <span className="flex min-w-6 justify-end">
                    <UnreadBadge count={unreadCounts[conversation.id] ?? 0} />
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="grid gap-1 p-3" aria-labelledby="agents-heading">
        <div className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[var(--cds-text-secondary)]">
          <button
            className={sidebarSectionToggle}
            type="button"
            aria-expanded={!agentsCollapsed}
            aria-controls="agents-list"
            onClick={() => setAgentsCollapsed((collapsed) => !collapsed)}
          >
            {agentsCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            <span id="agents-heading" className={`${labelWithCount} truncate text-xs font-semibold uppercase`}>
              Agents<span className={inlineCount}>({agents.length})</span>
            </span>
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent p-0 leading-none text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Create agent"
            onClick={onCreateAgent}
          >
            <Add className="block h-4 w-4" size={16} />
          </button>
        </div>
        {!agentsCollapsed && (agents.length === 0 ? (
          <p className="px-3 pb-3 pt-1 text-[var(--cds-text-secondary)]">
            No agents yet.
          </p>
        ) : (
          <div id="agents-list" className="grid gap-1">
            {agents.map((agent) => {
              const agentSelected =
                activeConversation?.type === 'direct' &&
                activeConversation.directAgentId === agent.agent.id
              const directConversation = directConversationByAgentId.get(agent.agent.id)
              const unreadCount =
                directConversation === undefined ? 0 : unreadCounts[directConversation.id] ?? 0

              return (
                <button
                  className={`${sidebarButton} ${
                    agentSelected ? selectedListItem : transparentListItem
                  } min-h-11 grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 px-3 py-2`}
                  type="button"
                  key={agent.agent.id}
                  aria-current={agentSelected ? 'page' : undefined}
                  onClick={() => selectAgent(agent.agent.id)}
                >
                  <span className={agentAvatarFrame} aria-hidden="true">
                    {agent.agent.avatar ? (
                      <img
                        src={agent.agent.avatar}
                        alt=""
                        className="h-7 w-7 object-cover"
                      />
                    ) : (
                      <ChatBot size={16} />
                    )}
                  </span>
                  <span className="min-w-0 truncate text-base leading-5">{agent.agent.name}</span>
                  <span className="flex min-w-6 items-center justify-end gap-2">
                    <UnreadBadge count={unreadCount} />
                    <AgentStatusIndicator agent={agent} />
                  </span>
                </button>
              )
            })}
          </div>
        ))}
      </section>
    </aside>
  )
}
