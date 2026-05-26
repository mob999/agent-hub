import {
  Checkbox,
  InlineNotification,
  Loading,
  Modal,
  TextInput,
} from '@carbon/react'
import { useState } from 'react'
import type { AgentDetails } from '../lib/api'

interface GroupCreateModalProps {
  agents: AgentDetails[]
  error: string | null
  isCreating: boolean
  open: boolean
  onClose: () => void
  onCreate: (input: { title: string; agentIds: string[] }) => void
}

function isAgentReady(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'ready' && agent.workspace.status === 'ready'
}

function isAgentPending(agent: AgentDetails): boolean {
  return agent.runtimeBinding.status === 'pending' || agent.workspace.status === 'pending'
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
  }

  return (
    <Modal
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
          agentIds: selectedAgentIds,
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
                  id={`group-agent-${agent.agent.id}`}
                  labelText={agent.agent.name}
                  checked={selectedAgentIds.includes(agent.agent.id)}
                  disabled={isCreating}
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
