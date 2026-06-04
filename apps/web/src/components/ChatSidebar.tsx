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
  'grid w-full cursor-pointer items-center rounded-xl border-0 text-left text-[#596171] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const transparentListItem =
  'bg-transparent hover:bg-[#eef0f4] hover:text-[#161616]'
const selectedListItem =
  'bg-[#e9eaee] font-semibold text-[#161616] hover:bg-[#e9eaee]'
const sectionHeadingText = 'truncate text-[0.82rem] font-semibold uppercase tracking-[0.08em] text-[#344054]'
const agentAvatarFrame =
  'grid h-6 w-6 place-items-center overflow-hidden rounded-md border border-[#d8dee6] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12),0_0_0_1px_rgba(255,255,255,0.75)_inset]'
const unreadBadge =
  'inline-grid min-w-5 place-items-center rounded-full bg-[var(--cds-support-error)] px-1.5 text-xs font-semibold leading-5 text-[var(--cds-text-on-color)]'
const archivedActionButton =
  'grid h-7 w-7 place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const archivedRestoreButton =
  `${archivedActionButton} text-[var(--cds-support-success)] hover:text-[var(--cds-support-success)]`
const archivedDeleteButton =
  `${archivedActionButton} text-[var(--cds-support-error)] hover:text-[var(--cds-support-error)]`
const archivedConfirmDeleteButton =
  'grid h-7 w-7 place-items-center rounded-lg border border-[var(--cds-support-error)] bg-[var(--cds-support-error)] p-0 text-[var(--cds-text-on-color)] hover:bg-[var(--cds-support-error)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const sidebarSectionToggle =
  'group inline-grid min-w-0 grid-cols-[4.75rem_1rem] items-center gap-1 rounded-lg border-0 bg-transparent p-0 text-left text-[#8a94a6] hover:text-[#4b5565] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const sidebarSectionChevron =
  'grid h-4 w-4 place-items-center text-[#a4acba] transition-colors group-hover:text-[#4b5565]'
const shortcutBadge =
  'rounded-md border border-[#dde1e6] bg-white px-2 py-0.5 text-xs font-medium leading-5 text-[#69707d] shadow-[0_1px_1px_rgba(0,0,0,0.03)]'

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
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-[#eef0f3] bg-[#f7f8fa] text-[#596171]"
      aria-label="Chat navigation"
    >
      <header className="flex min-h-16 items-center border-b border-[#eef0f3] px-4">
        <h2 className="min-w-0 truncate text-base font-semibold text-[#161616]">Chat</h2>
      </header>

      <section className="grid shrink-0 gap-1 px-3 pb-3 pt-2" aria-label="Quick actions">
        <button
          className={`${sidebarButton} ${transparentListItem} min-h-10 grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`}
          type="button"
          onClick={onOpenSearch}
        >
          <Search size={20} />
          <span className="truncate text-base">Search</span>
          <kbd className={shortcutBadge}>Ctrl K</kbd>
        </button>
        <button
          className={`${sidebarButton} ${transparentListItem} min-h-10 grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`}
          type="button"
          onClick={onOpenActivity}
        >
          <Activity size={20} />
          <span className="truncate text-base">Activity</span>
          <span className="grid min-w-6 justify-items-center text-xs font-semibold text-[#69707d]">
            {activeRunCount}
          </span>
        </button>
        <button
          className={`${sidebarButton} ${
            savedOpen ? selectedListItem : transparentListItem
          } min-h-10 grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-3 px-3 py-2`}
          type="button"
          aria-expanded={savedOpen}
          onClick={onToggleSaved}
        >
          <Bookmark size={20} />
          <span className="truncate text-base">Archived</span>
          <span className="grid min-w-6 justify-items-center text-xs font-semibold text-[#69707d]">
            {archivedCount}
          </span>
        </button>
        {savedOpen && (
          <div className="mx-1 mt-1 grid gap-1 rounded-xl bg-[#f1f3f6] p-2">
            {archivedCount === 0 ? (
              <p className="px-2 py-2 text-sm text-[#69707d]">No archived items.</p>
            ) : (
              <>
                {archivedGroupConversations.map((conversation) => {
                  const deleteKey = `group:${conversation.id}`
                  const confirmingDelete = confirmingDeleteKey === deleteKey

                  return (
                    <div
                      className="grid min-h-9 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1 text-sm text-[#3f4551]"
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
                      className="grid min-h-9 grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1 text-sm text-[#3f4551]"
                      key={agent.agent.id}
                    >
                      <span className={agentAvatarFrame} aria-hidden="true">
                        {agent.agent.avatar ? (
                          <img
                            src={agent.agent.avatar}
                            alt=""
                            className="h-6 w-6 rounded-[3px] object-cover"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid gap-2">
        <section
          className="grid gap-1"
          aria-labelledby="groups-heading"
        >
          <div className="grid min-h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[#69707d]">
            <button
              className={sidebarSectionToggle}
              type="button"
              aria-expanded={!groupsCollapsed}
              aria-controls="groups-list"
              onClick={() => setGroupsCollapsed((collapsed) => !collapsed)}
            >
              <span id="groups-heading" className={sectionHeadingText}>
                Groups
              </span>
              <span className={sidebarSectionChevron} aria-hidden="true">
                {groupsCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </span>
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-transparent p-0 leading-none text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              aria-label="Add group"
              onClick={onCreateGroup}
            >
              <Add className="block h-4 w-4" size={16} />
            </button>
          </div>
          {!groupsCollapsed && (
            <div id="groups-list" className="pr-1">
              <div className="grid gap-1">
                {groupConversations.map((conversation) => {
                  const groupChatSelected = activeConversationId === conversation.id

                  return (
                    <button
                      className={`${sidebarButton} ${
                        groupChatSelected ? selectedListItem : transparentListItem
                      } min-h-[2.125rem] grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-2 px-3 py-1.5`}
                      type="button"
                      key={conversation.id}
                      aria-current={groupChatSelected ? 'page' : undefined}
                      onClick={() => selectGroup(conversation.id)}
                    >
                      <span
                        className="grid h-6 w-6 place-items-center text-sm leading-5 text-[#596171]"
                        aria-hidden="true"
                      >
                        #
                      </span>
                      <span className="min-w-0 truncate text-base leading-5">
                        {conversation.title}
                      </span>
                      <span className="flex min-w-6 justify-end">
                        <UnreadBadge count={unreadCounts[conversation.id] ?? 0} />
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section
          className="grid gap-1"
          aria-labelledby="agents-heading"
        >
          <div className="grid min-h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 text-[#69707d]">
            <button
              className={sidebarSectionToggle}
              type="button"
              aria-expanded={!agentsCollapsed}
              aria-controls="agents-list"
              onClick={() => setAgentsCollapsed((collapsed) => !collapsed)}
            >
              <span id="agents-heading" className={sectionHeadingText}>
                Agents
              </span>
              <span className={sidebarSectionChevron} aria-hidden="true">
                {agentsCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              </span>
            </button>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-lg border-0 bg-transparent p-0 leading-none text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              aria-label="Create agent"
              onClick={onCreateAgent}
            >
              <Add className="block h-4 w-4" size={16} />
            </button>
          </div>
          {!agentsCollapsed && (agents.length === 0 ? (
            <p className="px-3 pb-3 pt-1 text-sm text-[#69707d]">
              No agents yet.
            </p>
          ) : (
            <div id="agents-list" className="pr-1">
              <div className="grid gap-1">
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
                      } min-h-[2.125rem] grid-cols-[1.5rem_minmax(0,1fr)_auto] gap-2 px-3 py-1.5`}
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
                            className="h-5 w-5 rounded-[3px] object-cover"
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
            </div>
          ))}
        </section>
        </div>
      </div>
    </aside>
  )
}
