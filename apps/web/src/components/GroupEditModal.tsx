import {
  Checkbox,
  InlineNotification,
  Loading,
  Modal,
  TextArea,
  TextInput,
} from '@carbon/react'
import { useState } from 'react'
import type { AgentDetails, Conversation } from '../lib/api'

interface GroupEditModalProps {
  agents: AgentDetails[]
  conversation: Conversation
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onSave: (input: { title: string; description?: string; agentIds: string[] }) => void
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function isAgentPending(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'pending' || agent.workspace.status === 'pending'
}

export function GroupEditModal({
  agents,
  conversation,
  error,
  isSaving,
  open,
  onClose,
  onSave,
}: GroupEditModalProps) {
  const [title, setTitle] = useState(conversation.title)
  const [description, setDescription] = useState(conversation.description ?? '')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(conversation.agentIds ?? [])
  const canSave =
    title.trim().length > 0 &&
    selectedAgentIds.length > 0 &&
    !isSaving

  const toggleAgent = (agentId: string, checked: boolean) => {
    setSelectedAgentIds((current) =>
      checked
        ? [...current, agentId]
        : current.filter((selectedAgentId) => selectedAgentId !== agentId),
    )
  }

  return (
    <Modal
      open={open}
      modalHeading="Edit group"
      primaryButtonText={isSaving ? 'Saving...' : 'Save'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canSave}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!canSave) {
          return
        }

        onSave({
          title: title.trim(),
          description: description.trim() || undefined,
          agentIds: selectedAgentIds,
        })
      }}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title="Group was not updated"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="edit-group-name"
          labelText="Group name"
          value={title}
          disabled={isSaving}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea
          id="edit-group-description"
          labelText="Description"
          rows={3}
          value={description}
          disabled={isSaving}
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="grid gap-2" aria-label="Agents">
          <p className="text-sm font-semibold text-[var(--cds-text-primary)]">
            Agents
          </p>
          <div className="grid max-h-64 overflow-y-auto border border-[var(--cds-border-subtle-01)]">
            {agents.map((agent) => (
              <div
                className="grid min-h-12 grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-3 border-b border-[var(--cds-border-subtle-01)] px-3 py-2 last:border-b-0"
                key={agent.agent.id}
              >
                <Checkbox
                  id={`edit-group-agent-${agent.agent.id}`}
                  labelText={agent.agent.name}
                  checked={selectedAgentIds.includes(agent.agent.id)}
                  disabled={isSaving}
                  onChange={(_, data) => toggleAgent(agent.agent.id, data.checked)}
                />
                {isAgentPending(agent) ? (
                  <Loading
                    small
                    withOverlay={false}
                    description="Agent is being created"
                    className="justify-self-end"
                  />
                ) : isAgentReady(agent) ? (
                  <span className="grid h-6 w-6 place-items-center justify-self-end" title="Ready">
                    <span
                      className="h-2 w-2 rounded-full bg-[var(--cds-support-success)]"
                      aria-hidden="true"
                    />
                    <span className="sr-only">Ready</span>
                  </span>
                ) : (
                  <span aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  )
}
