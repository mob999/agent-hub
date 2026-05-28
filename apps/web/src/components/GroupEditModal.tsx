import {
  Button,
  Checkbox,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  TextArea,
  TextInput,
} from '@carbon/react'
import { useState } from 'react'
import { AgentStatusIndicator } from './AgentStatusIndicator'
import type { AgentDetails, Conversation } from '../lib/api'

interface GroupEditModalProps {
  agents: AgentDetails[]
  conversation: Conversation
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onArchive: () => void
  onSave: (input: { title: string; description?: string; agentIds: string[]; orchestratorAgentId?: string }) => void
}

export function GroupEditModal({
  agents,
  conversation,
  error,
  isSaving,
  open,
  onClose,
  onArchive,
  onSave,
}: GroupEditModalProps) {
  const [title, setTitle] = useState(conversation.title)
  const [description, setDescription] = useState(conversation.description ?? '')
  const [orchestratorAgentId, setOrchestratorAgentId] = useState(conversation.orchestratorAgentId ?? '')
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
    if (!checked && orchestratorAgentId === agentId) {
      setOrchestratorAgentId('')
    }
  }

  return (
    <Modal
      className="centered-modal-actions"
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
          orchestratorAgentId: orchestratorAgentId || undefined,
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
        <Select
          id="edit-group-orchestrator"
          labelText="Orchestrator"
          value={orchestratorAgentId}
          disabled={isSaving || selectedAgentIds.length === 0}
          onChange={(event) => setOrchestratorAgentId(event.target.value)}
        >
          <SelectItem value="" text="No orchestrator" />
          {agents
            .filter((agent) => selectedAgentIds.includes(agent.agent.id))
            .map((agent) => (
              <SelectItem key={agent.agent.id} value={agent.agent.id} text={agent.agent.name} />
            ))}
        </Select>
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
                <AgentStatusIndicator agent={agent} />
              </div>
            ))}
          </div>
        </div>
        <div className="grid gap-3 border-t border-[var(--cds-border-subtle-01)] pt-4">
          <Button
            kind="danger--tertiary"
            size="sm"
            type="button"
            disabled={isSaving}
            onClick={() => {
              if (isSaving) {
                return
              }

              onArchive()
            }}
          >
            Archive group
          </Button>
        </div>
      </div>
    </Modal>
  )
}
