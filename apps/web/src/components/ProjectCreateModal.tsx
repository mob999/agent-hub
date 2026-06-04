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
        <Select
          id="project-orchestrator"
          labelText="Orchestrator"
          value={orchestratorAgentId}
          disabled={isCreating || selectedAgentIds.length === 0}
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
                  id={`project-agent-${agent.agent.id}`}
                  labelText={agent.agent.name}
                  checked={selectedAgentIds.includes(agent.agent.id)}
                  disabled={isCreating}
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
