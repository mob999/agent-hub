import {
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

interface ProjectEditModalProps {
  agents: AgentDetails[]
  conversation: Conversation
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onSave: (input: { title: string; description?: string; agentIds: string[]; orchestratorAgentId?: string }) => void
}

export function ProjectEditModal({
  agents,
  conversation,
  error,
  isSaving,
  open,
  onClose,
  onSave,
}: ProjectEditModalProps) {
  const [title, setTitle] = useState(conversation.title)
  const [description, setDescription] = useState(conversation.description ?? '')
  const [orchestratorAgentId, setOrchestratorAgentId] = useState(conversation.orchestratorAgentId ?? '')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>(conversation.agentIds ?? [])
  const canSave = title.trim().length > 0 && selectedAgentIds.length > 0 && !isSaving

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
      modalHeading="Edit project"
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
            title="Project was not updated"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="edit-project-remote-url"
          labelText="Git remote URL"
          value={conversation.project?.remoteUrl ?? ''}
          disabled
        />
        <TextInput
          id="edit-project-name"
          labelText="Project name"
          value={title}
          disabled={isSaving}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea
          id="edit-project-description"
          labelText="Description"
          rows={3}
          value={description}
          disabled={isSaving}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select
          id="edit-project-orchestrator"
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
          <div className="grid max-h-64 overflow-y-auto rounded-xl border border-[#d8dee6] bg-white">
            {agents.map((agent) => (
              <div
                className="grid min-h-12 grid-cols-[minmax(0,1fr)_1.5rem] items-center gap-3 border-b border-[#eef0f3] px-3 py-2 last:border-b-0 hover:bg-[#f7f8fa]"
                key={agent.agent.id}
              >
                <Checkbox
                  id={`edit-project-agent-${agent.agent.id}`}
                  labelText={agent.agent.name}
                  checked={selectedAgentIds.includes(agent.agent.id)}
                  disabled={isSaving}
                  onChange={(_, data) => toggleAgent(agent.agent.id, data.checked)}
                />
                <AgentStatusIndicator agent={agent} />
              </div>
            ))}
          </div>
          <p className="text-xs text-[#69707d]">
            Project agents must be ready on the same daemon.
          </p>
        </div>
      </div>
    </Modal>
  )
}
