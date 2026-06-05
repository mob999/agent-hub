import { InlineNotification, Modal, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import { AgentMemberSelector } from './AgentMemberSelector'
import type { AgentDetails } from '../lib/api'

interface GroupCreateModalProps {
  agents: AgentDetails[]
  error: string | null
  isCreating: boolean
  open: boolean
  onClose: () => void
  onCreate: (input: { title: string; description?: string; agentIds: string[]; orchestratorAgentId?: string }) => void
}

export function GroupCreateModal({
  agents,
  error,
  isCreating,
  open,
  onClose,
  onCreate,
}: GroupCreateModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [orchestratorAgentId, setOrchestratorAgentId] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const canCreate =
    title.trim().length > 0 &&
    selectedAgentIds.length > 0 &&
    !isCreating

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

  const selectOrchestrator = (agentId: string | null) => {
    setOrchestratorAgentId(agentId ?? '')
    if (agentId) {
      setSelectedAgentIds((current) =>
        current.includes(agentId) ? current : [...current, agentId],
      )
    }
  }

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading="Create group"
      primaryButtonText={isCreating ? 'Creating...' : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canCreate}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!canCreate) {
          return
        }

        onCreate({
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
            title="Group was not created"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        {agents.length === 0 && (
          <InlineNotification
            kind="warning"
            title="No agents available"
            subtitle="Create an agent before creating a group."
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="group-name"
          labelText="Group name"
          value={title}
          disabled={isCreating}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea
          id="group-description"
          labelText="Description"
          rows={3}
          value={description}
          disabled={isCreating}
          onChange={(event) => setDescription(event.target.value)}
        />
        <AgentMemberSelector
          agents={agents}
          disabled={isCreating}
          idPrefix="group-agent"
          orchestratorAgentId={orchestratorAgentId}
          selectedAgentIds={selectedAgentIds}
          onSelectOrchestrator={selectOrchestrator}
          onToggleAgent={toggleAgent}
        />
      </div>
    </Modal>
  )
}
