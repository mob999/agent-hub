import {
  Button,
  InlineLoading,
  InlineNotification,
  Modal,
  TextArea,
  TextInput,
} from '@carbon/react'
import { useEffect, useMemo, useState } from 'react'
import { ApiRequestError, apiRequest, type AgentDetails, type AgentMemoryFile, type AgentMemoryResponse, type AgentMemoryScope } from '../lib/api'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import { AvatarPicker } from './AvatarPicker'

interface AgentEditModalProps {
  agent: AgentDetails
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onArchive: () => void
  onSave: (input: { name: string; description?: string; avatar: string }) => void
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
  const [avatar, setAvatar] = useState(agent.agent.avatar ?? DEFAULT_AVATAR_PATHS[0])
  const [memoryFiles, setMemoryFiles] = useState<AgentMemoryFile[]>([])
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryWorkspaceReady, setMemoryWorkspaceReady] = useState(true)
  const [selectedMemoryScope, setSelectedMemoryScope] = useState<AgentMemoryScope>('long_term')
  const canSave = name.trim().length > 0 && !isSaving
  const selectedMemoryFile = useMemo(
    () => memoryFiles.find((file) => file.scope === selectedMemoryScope) ?? memoryFiles[0] ?? null,
    [memoryFiles, selectedMemoryScope],
  )

  const loadMemoryFiles = async () => {
    setMemoryLoading(true)
    setMemoryError(null)

    try {
      const response = await apiRequest<AgentMemoryResponse>(`/agents/${agent.agent.id}/memory`)
      setMemoryFiles(response.files)
      setMemoryWorkspaceReady(response.workspaceReady)
      setSelectedMemoryScope((current) =>
        response.files.some((file) => file.scope === current)
          ? current
          : response.files[0]?.scope ?? 'long_term',
      )
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setMemoryError(error.message)
      } else {
        setMemoryError('Unable to load memory files.')
      }
    } finally {
      setMemoryLoading(false)
    }
  }

  useEffect(() => {
    if (!open) {
      return
    }

    setName(agent.agent.name)
    setDescription(agent.agent.description ?? '')
    setAvatar(agent.agent.avatar ?? DEFAULT_AVATAR_PATHS[0])
    void loadMemoryFiles()
  }, [agent.agent.avatar, agent.agent.description, agent.agent.id, agent.agent.name, open])

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
          avatar,
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
        <AvatarPicker
          label="Avatar"
          value={avatar}
          disabled={isSaving}
          onChange={setAvatar}
        />
        <div className="grid gap-3 border-t border-[var(--cds-border-subtle-01)] pt-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase text-[var(--cds-text-secondary)]">
              Memory files
            </h3>
            <Button
              kind="ghost"
              size="sm"
              type="button"
              disabled={memoryLoading}
              onClick={() => {
                void loadMemoryFiles()
              }}
            >
              Refresh
            </Button>
          </div>
          {memoryLoading && <InlineLoading description="Loading memory files..." />}
          {memoryError && (
            <InlineNotification
              kind="error"
              title="Memory was not loaded"
              subtitle={memoryError}
              lowContrast
              hideCloseButton
            />
          )}
          {!memoryWorkspaceReady && (
            <InlineNotification
              kind="warning"
              title="Workspace is not ready"
              subtitle="Memory files will appear after the agent workspace is provisioned."
              lowContrast
              hideCloseButton
            />
          )}
          {memoryFiles.length > 0 && (
            <div className="grid gap-2">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Agent memory files">
                {memoryFiles.map((file) => (
                  <button
                    key={file.scope}
                    className={`border px-3 py-1 text-sm font-semibold ${
                      selectedMemoryScope === file.scope
                        ? 'border-[var(--cds-border-strong-01)] bg-[var(--cds-text-primary)] text-[var(--cds-background)]'
                        : 'border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)]'
                    }`}
                    type="button"
                    role="tab"
                    aria-selected={selectedMemoryScope === file.scope}
                    onClick={() => setSelectedMemoryScope(file.scope)}
                  >
                    {file.label}
                  </button>
                ))}
              </div>
              {selectedMemoryFile && (
                <div className="grid gap-2">
                  <p className="text-xs text-[var(--cds-text-secondary)]">
                    {selectedMemoryFile.file}
                  </p>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-3 text-xs leading-5 text-[var(--cds-text-primary)]">
                    {selectedMemoryFile.exists
                      ? selectedMemoryFile.content
                      : 'This memory file has not been created yet.'}
                  </pre>
                </div>
              )}
            </div>
          )}
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
            Archive agent
          </Button>
        </div>
      </div>
    </Modal>
  )
}
