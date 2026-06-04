import { InlineNotification, Modal, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import { AgentMemberSelector } from './AgentMemberSelector'
import type { AgentDetails } from '../lib/api'

interface ProjectCreateModalProps {
  agents: AgentDetails[]
  error: string | null
  isCreating: boolean
  open: boolean
  onClose: () => void
  onCreate: (input: {
    title?: string
    description?: string
    remoteUrl: string
    agentIds: string[]
    orchestratorAgentId?: string
  }) => void
}

export function ProjectCreateModal({
  agents,
  error,
  isCreating,
  open,
  onClose,
  onCreate,
}: ProjectCreateModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [orchestratorAgentId, setOrchestratorAgentId] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const canCreate =
    remoteUrl.trim().length > 0 &&
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
      modalHeading="Create project"
      primaryButtonText={isCreating ? 'Creating...' : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canCreate}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!canCreate) {
          return
        }

        onCreate({
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          remoteUrl: remoteUrl.trim(),
          agentIds: selectedAgentIds,
          orchestratorAgentId: orchestratorAgentId || undefined,
        })
      }}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title="Project was not created"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        {agents.length === 0 && (
          <InlineNotification
            kind="warning"
            title="No agents available"
            subtitle="Create ready agents before creating a project."
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="project-remote-url"
          labelText="Git remote URL"
          value={remoteUrl}
          disabled={isCreating}
          placeholder="https://github.com/acme/app.git"
          onChange={(event) => setRemoteUrl(event.target.value)}
        />
        <TextInput
          id="project-name"
          labelText="Project name"
          value={title}
          disabled={isCreating}
          maxLength={80}
          placeholder="Inferred from remote if empty"
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextArea
          id="project-description"
          labelText="Description"
          rows={3}
          value={description}
          disabled={isCreating}
          onChange={(event) => setDescription(event.target.value)}
        />
        <AgentMemberSelector
          agents={agents}
          disabled={isCreating}
          helpText="Project agents must be ready on the same daemon."
          idPrefix="project-agent"
          orchestratorAgentId={orchestratorAgentId}
          selectedAgentIds={selectedAgentIds}
          onSelectOrchestrator={selectOrchestrator}
          onToggleAgent={toggleAgent}
        />
      </div>
    </Modal>
  )
}
