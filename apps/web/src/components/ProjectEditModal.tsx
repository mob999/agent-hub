import { InlineNotification, Modal, TextInput } from '@carbon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentMemberSelector } from './AgentMemberSelector'
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
  const { t } = useTranslation()
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
      modalHeading={t('modals.projectEdit.heading')}
      primaryButtonText={isSaving ? t('common.saving') : t('common.save')}
      secondaryButtonText={t('common.cancel')}
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
            title={t('modals.projectEdit.errorTitle')}
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="edit-project-remote-url"
          labelText={t('modals.projectEdit.remoteUrl')}
          value={conversation.project?.remoteUrl ?? ''}
          disabled
        />
        <TextInput
          id="edit-project-name"
          labelText={t('modals.projectEdit.name')}
          value={title}
          disabled={isSaving}
          maxLength={160}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextInput
          id="edit-project-description"
          labelText={t('modals.projectEdit.description')}
          value={description}
          disabled={isSaving}
          onChange={(event) => setDescription(event.target.value)}
        />
        <AgentMemberSelector
          agents={agents}
          disabled={isSaving}
          helpText={t('modals.projectEdit.agentHelp')}
          idPrefix="edit-project-agent"
          orchestratorAgentId={orchestratorAgentId}
          selectedAgentIds={selectedAgentIds}
          onSelectOrchestrator={selectOrchestrator}
          onToggleAgent={toggleAgent}
        />
      </div>
    </Modal>
  )
}
