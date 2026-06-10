import { InlineNotification, Modal, Select, SelectItem } from '@carbon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const [orchestratorAgentId, setOrchestratorAgentId] = useState(conversation.orchestratorAgentId ?? '')
  const readyAgents = agents.filter(isAgentReady)

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading={t('modals.groupSettings.heading')}
      primaryButtonText={isSaving ? t('common.saving') : t('common.save')}
      secondaryButtonText={t('common.cancel')}
      primaryButtonDisabled={isSaving}
      onRequestClose={onClose}
      onRequestSubmit={() => onSave({ orchestratorAgentId: orchestratorAgentId || undefined })}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title={t('modals.groupSettings.errorTitle')}
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <div className="rounded-xl border border-[#d8dee6] bg-[#f7f8fa] p-3">
          <Select
            id="all-group-orchestrator"
            labelText={t('modals.agentMembers.orchestrator')}
            value={orchestratorAgentId}
            disabled={isSaving}
            onChange={(event) => setOrchestratorAgentId(event.target.value)}
          >
            <SelectItem value="" text={t('modals.groupSettings.noOrchestrator')} />
            {readyAgents.map((agent) => (
              <SelectItem key={agent.agent.id} value={agent.agent.id} text={agent.agent.name} />
            ))}
          </Select>
        </div>
        {readyAgents.length === 0 && (
          <InlineNotification
            kind="warning"
            title={t('modals.groupSettings.noReadyAgentsTitle')}
            subtitle={t('modals.groupSettings.noReadyAgentsSubtitle')}
            lowContrast
            hideCloseButton
          />
        )}
      </div>
    </Modal>
  )
}
