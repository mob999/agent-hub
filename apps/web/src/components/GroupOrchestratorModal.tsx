import { InlineNotification, Modal, Select, SelectItem } from '@carbon/react'
import { useState } from 'react'
import type { AgentDetails, Conversation } from '../lib/api'

interface GroupOrchestratorModalProps {
  agents: AgentDetails[]
  conversation: Conversation
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onSave: (input: { orchestratorAgentId?: string }) => void
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

export function GroupOrchestratorModal({
  agents,
  conversation,
  error,
  isSaving,
  open,
  onClose,
  onSave,
}: GroupOrchestratorModalProps) {
  const [orchestratorAgentId, setOrchestratorAgentId] = useState(conversation.orchestratorAgentId ?? '')
  const readyAgents = agents.filter(isAgentReady)

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading="Group settings"
      primaryButtonText={isSaving ? 'Saving...' : 'Save'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={isSaving}
      onRequestClose={onClose}
      onRequestSubmit={() => onSave({ orchestratorAgentId: orchestratorAgentId || undefined })}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title="Settings were not updated"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <Select
          id="all-group-orchestrator"
          labelText="Orchestrator"
          value={orchestratorAgentId}
          disabled={isSaving}
          onChange={(event) => setOrchestratorAgentId(event.target.value)}
        >
          <SelectItem value="" text="No orchestrator" />
          {readyAgents.map((agent) => (
            <SelectItem key={agent.agent.id} value={agent.agent.id} text={agent.agent.name} />
          ))}
        </Select>
        {readyAgents.length === 0 && (
          <InlineNotification
            kind="warning"
            title="No ready agents"
            subtitle="Create or finish provisioning an agent before enabling Task mode."
            lowContrast
            hideCloseButton
          />
        )}
      </div>
    </Modal>
  )
}
