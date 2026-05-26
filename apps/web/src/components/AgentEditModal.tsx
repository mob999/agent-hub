import {
  Button,
  InlineNotification,
  Modal,
  TextArea,
  TextInput,
} from '@carbon/react'
import { useState } from 'react'
import type { AgentDetails } from '../lib/api'

interface AgentEditModalProps {
  agent: AgentDetails
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onArchive: () => void
  onSave: (input: { name: string; description?: string }) => void
}

export function AgentEditModal({
  agent,
  error,
  isSaving,
  open,
  onClose,
  onArchive,
  onSave,
}: AgentEditModalProps) {
  const [name, setName] = useState(agent.agent.name)
  const [description, setDescription] = useState(agent.agent.description ?? '')
  const canSave = name.trim().length > 0 && !isSaving

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading="Edit agent"
      primaryButtonText={isSaving ? 'Saving...' : 'Save'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canSave}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!canSave) {
          return
        }

        onSave({
          name: name.trim(),
          description: description.trim() || undefined,
        })
      }}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title="Agent was not updated"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="edit-agent-name"
          labelText="Name"
          value={name}
          disabled={isSaving}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
        <TextArea
          id="edit-agent-description"
          labelText="Description"
          rows={3}
          value={description}
          disabled={isSaving}
          onChange={(event) => setDescription(event.target.value)}
        />
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
            Archive agent
          </Button>
        </div>
      </div>
    </Modal>
  )
}
