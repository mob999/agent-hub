import {
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Modal,
  TextArea,
  TextInput,
} from '@carbon/react'
import { Document, Folder, Renew } from '@carbon/react/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ApiRequestError, apiRequest, type AgentDetails, type AgentMemoryFile, type AgentMemoryResponse } from '../lib/api'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import { AvatarPicker } from './AvatarPicker'

type AgentSettingsSection = 'profile' | 'memory' | 'danger'

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
  return (
    <AgentEditModalContent
      key={agent.agent.id}
      agent={agent}
      error={error}
      isSaving={isSaving}
      open={open}
      onClose={onClose}
      onArchive={onArchive}
      onSave={onSave}
    />
  )
}

function AgentEditModalContent({
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
  const [selectedMemoryFilePath, setSelectedMemoryFilePath] = useState('MEMORY.md')
  const [selectedSection, setSelectedSection] = useState<AgentSettingsSection>('profile')
  const canSave = name.trim().length > 0 && !isSaving
  const selectedMemoryFile = useMemo(
    () => memoryFiles.find((file) => file.file === selectedMemoryFilePath) ?? memoryFiles[0] ?? null,
    [memoryFiles, selectedMemoryFilePath],
  )
  const longTermMemory = memoryFiles.find((file) => file.scope === 'long_term') ?? null
  const dailyMemories = useMemo(
    () => memoryFiles.filter((file) => file.scope === 'daily').sort((first, second) => second.label.localeCompare(first.label)),
    [memoryFiles],
  )

  const loadMemoryFiles = useCallback(async () => {
    setMemoryLoading(true)
    setMemoryError(null)

    try {
      const response = await apiRequest<AgentMemoryResponse>(`/agents/${agent.agent.id}/memory`)
      setMemoryFiles(response.files)
      setMemoryWorkspaceReady(response.workspaceReady)
      setSelectedMemoryFilePath((current) =>
        response.files.some((file) => file.file === current)
          ? current
          : response.files.find((file) => file.scope === 'long_term')?.file ?? response.files[0]?.file ?? 'MEMORY.md',
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
  }, [agent.agent.id])

  useEffect(() => {
    if (!open) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void loadMemoryFiles()
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [loadMemoryFiles, open])

  const sectionButtonClass = (section: AgentSettingsSection) =>
    `w-full cursor-pointer border-0 px-3 py-2 text-left text-sm font-semibold ${
      selectedSection === section
        ? 'bg-[var(--cds-text-primary)] text-[var(--cds-background)]'
        : 'bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)]'
    }`

  const memoryTreeButtonClass = (filePath: string) =>
    `flex w-full cursor-pointer items-center gap-2 border-0 px-2 py-1.5 text-left text-sm ${
      selectedMemoryFilePath === filePath
        ? 'bg-[var(--cds-layer-selected-01)] font-semibold text-[var(--cds-text-primary)]'
        : 'bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)]'
    }`

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
      <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
        {error && (
          <InlineNotification
            className="md:col-span-2"
            kind="error"
            title="Agent was not updated"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <nav className="grid content-start gap-1 border-r border-[var(--cds-border-subtle-01)] pr-3" aria-label="Agent settings">
          <button className={sectionButtonClass('profile')} type="button" onClick={() => setSelectedSection('profile')}>
            Profile
          </button>
          <button className={sectionButtonClass('memory')} type="button" onClick={() => setSelectedSection('memory')}>
            Memory
          </button>
          <button className={sectionButtonClass('danger')} type="button" onClick={() => setSelectedSection('danger')}>
            Danger
          </button>
        </nav>
        <div className="min-h-[34rem] min-w-0">
          {selectedSection === 'profile' && (
            <div className="grid gap-4">
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
            </div>
          )}
          {selectedSection === 'memory' && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase text-[var(--cds-text-secondary)]">
                  Memory
                </h3>
                <IconButton
                  kind="ghost"
                  size="sm"
                  label="Refresh memory"
                  align="left"
                  type="button"
                  disabled={memoryLoading}
                  onClick={() => {
                    void loadMemoryFiles()
                  }}
                >
                  <Renew size={16} />
                </IconButton>
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
                <div className="grid min-h-80 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
                  <div className="grid content-start gap-1 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-2">
                    {longTermMemory && (
                      <button className={memoryTreeButtonClass(longTermMemory.file)} type="button" onClick={() => setSelectedMemoryFilePath(longTermMemory.file)}>
                        <Document size={16} />
                        MEMORY.md
                      </button>
                    )}
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-[var(--cds-text-primary)]">
                        <Folder size={16} />
                        memory/
                      </div>
                      <div className="grid gap-1 pl-5">
                        {dailyMemories.map((dailyMemory) => (
                          <button key={dailyMemory.file} className={memoryTreeButtonClass(dailyMemory.file)} type="button" onClick={() => setSelectedMemoryFilePath(dailyMemory.file)}>
                            <Document size={16} />
                            {dailyMemory.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {selectedMemoryFile && (
                    <div className="grid min-w-0 gap-2">
                      <pre className="h-[28rem] overflow-auto whitespace-pre-wrap border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-3 text-xs leading-5 text-[var(--cds-text-primary)]">
                        {selectedMemoryFile.exists
                          ? selectedMemoryFile.content
                          : 'This memory file has not been created yet.'}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {selectedSection === 'danger' && (
            <div className="grid gap-3">
              <InlineNotification
                kind="warning"
                title="Archive agent"
                subtitle="Archived agents are hidden from active lists and can be restored later."
                lowContrast
                hideCloseButton
              />
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
          )}
        </div>
      </div>
    </Modal>
  )
}
