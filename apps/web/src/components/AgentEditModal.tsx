import {
  Button,
  IconButton,
  InlineLoading,
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  TextInput,
} from '@carbon/react'
import { Document, Folder, Renew } from '@carbon/react/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiRequestError, apiRequest, type AgentDetails, type AgentMemoryFile, type AgentMemoryResponse, type DaemonDevice } from '../lib/api'
import { DEFAULT_AVATAR_PATHS } from '@agent-hub/core'
import { AgentTagEditor } from './AgentTagEditor'
import { AvatarPicker } from './AvatarPicker'

type AgentSettingsSection = 'profile' | 'memory' | 'danger'

interface AgentEditModalProps {
  agent: AgentDetails
  devices: DaemonDevice[]
  error: string | null
  isSaving: boolean
  open: boolean
  onClose: () => void
  onArchive: () => void
  onSave: (input: { name: string; description?: string; tags: string[]; avatar: string }) => void
}

export function AgentEditModal({
  agent,
  devices,
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
      devices={devices}
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
  devices,
  error,
  isSaving,
  open,
  onClose,
  onArchive,
  onSave,
}: AgentEditModalProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(agent.agent.name)
  const [description, setDescription] = useState(agent.agent.description ?? '')
  const [tags, setTags] = useState(agent.agent.tags)
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
  const boundDevice = useMemo(
    () => devices.find((device) => device.id === agent.runtimeBinding.daemonDeviceId) ?? null,
    [agent.runtimeBinding.daemonDeviceId, devices],
  )
  const runtimeLabel = agent.runtimeBinding.runtimeVersion
    ? `${agent.runtimeBinding.runtimeKind} (${agent.runtimeBinding.runtimeVersion})`
    : agent.runtimeBinding.runtimeKind

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
        setMemoryError(t('modals.agentEdit.memoryLoadFallbackError'))
      }
    } finally {
      setMemoryLoading(false)
    }
  }, [agent.agent.id, t])

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
    `w-full cursor-pointer rounded-xl border-0 px-3 py-2 text-left text-sm font-semibold transition-colors ${
      selectedSection === section
        ? 'bg-[#e9eaee] text-[#161616]'
        : 'bg-transparent text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616]'
    }`

  const memoryTreeButtonClass = (filePath: string) =>
    `flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-2 py-1.5 text-left text-sm transition-colors ${
      selectedMemoryFilePath === filePath
        ? 'bg-[#e9eaee] font-semibold text-[#161616]'
        : 'bg-transparent text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616]'
    }`

  return (
    <Modal
      className="centered-modal-actions"
      open={open}
      modalHeading={t('modals.agentEdit.heading')}
      primaryButtonText={isSaving ? t('common.saving') : t('common.save')}
      secondaryButtonText={t('common.cancel')}
      primaryButtonDisabled={!canSave}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!canSave) {
          return
        }

        onSave({
          name: name.trim(),
          description: description.trim() || undefined,
          tags,
          avatar,
        })
      }}
    >
      <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
        {error && (
          <InlineNotification
            className="md:col-span-2"
            kind="error"
            title={t('modals.agentEdit.errorTitle')}
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        <nav className="grid content-start gap-1 rounded-2xl bg-[#f7f8fa] p-2" aria-label={t('modals.agentEdit.settingsAria')}>
          <button className={sectionButtonClass('profile')} type="button" onClick={() => setSelectedSection('profile')}>
            {t('modals.agentEdit.profile')}
          </button>
          <button className={sectionButtonClass('memory')} type="button" onClick={() => setSelectedSection('memory')}>
            {t('modals.agentEdit.memory')}
          </button>
          <button className={sectionButtonClass('danger')} type="button" onClick={() => setSelectedSection('danger')}>
            {t('modals.agentEdit.danger')}
          </button>
        </nav>
        <div className="min-h-[34rem] min-w-0">
          {selectedSection === 'profile' && (
            <div className="grid gap-4">
              <TextInput
                id="edit-agent-name"
                labelText={t('modals.agentEdit.name')}
                value={name}
                disabled={isSaving}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
              <TextInput
                id="edit-agent-description"
                labelText={t('modals.agentEdit.description')}
                value={description}
                disabled={isSaving}
                onChange={(event) => setDescription(event.target.value)}
              />
              <AgentTagEditor
                disabled={isSaving}
                tags={tags}
                onChange={setTags}
              />
              <AvatarPicker
                label={t('modals.agentEdit.avatar')}
                value={avatar}
                disabled={isSaving}
                onChange={setAvatar}
              />
              <Select
                id="edit-agent-daemon"
                labelText={t('modals.agentEdit.daemon')}
                value={agent.runtimeBinding.daemonDeviceId}
                disabled
              >
                <SelectItem
                  value={agent.runtimeBinding.daemonDeviceId}
                  text={boundDevice?.name ?? agent.runtimeBinding.daemonDeviceId}
                />
              </Select>
              <Select
                id="edit-agent-runtime"
                labelText={t('modals.agentEdit.runtime')}
                value={agent.runtimeBinding.runtimeKind}
                disabled
              >
                <SelectItem value={agent.runtimeBinding.runtimeKind} text={runtimeLabel} />
              </Select>
            </div>
          )}
          {selectedSection === 'memory' && (
            <div className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase text-[var(--cds-text-secondary)]">
                  {t('modals.agentEdit.memory')}
                </h3>
                <IconButton
                  kind="ghost"
                  size="sm"
                  label={t('modals.agentEdit.refreshMemory')}
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
              {memoryLoading && <InlineLoading description={t('modals.agentEdit.memoryLoading')} />}
              {memoryError && (
                <InlineNotification
                  kind="error"
                  title={t('modals.agentEdit.memoryErrorTitle')}
                  subtitle={memoryError}
                  lowContrast
                  hideCloseButton
                />
              )}
              {!memoryWorkspaceReady && (
                <InlineNotification
                  kind="warning"
                  title={t('modals.agentEdit.workspaceNotReadyTitle')}
                  subtitle={t('modals.agentEdit.workspaceNotReadySubtitle')}
                  lowContrast
                  hideCloseButton
                />
              )}
              {memoryFiles.length > 0 && (
                <div className="grid min-h-80 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
                  <div className="grid content-start gap-1 rounded-xl border border-[#d8dee6] bg-white p-2">
                    {longTermMemory && (
                      <button className={memoryTreeButtonClass(longTermMemory.file)} type="button" onClick={() => setSelectedMemoryFilePath(longTermMemory.file)}>
                        <Document size={16} />
                        MEMORY.md
                      </button>
                    )}
                    <div className="grid gap-1">
                      <div className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-[#161616]">
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
                      <pre className="h-[28rem] overflow-auto whitespace-pre-wrap rounded-xl border border-[#d8dee6] bg-[#f7f8fa] p-3 text-xs leading-5 text-[var(--cds-text-primary)]">
                        {selectedMemoryFile.exists
                          ? selectedMemoryFile.content
                          : t('modals.agentEdit.memoryFileMissing')}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {selectedSection === 'danger' && (
            <div className="grid gap-3 rounded-xl border border-[#ffd7d9] bg-[#fff1f1] p-3">
              <InlineNotification
                kind="warning"
                title={t('modals.agentEdit.archiveTitle')}
                subtitle={t('modals.agentEdit.archiveSubtitle')}
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
                {t('modals.agentEdit.archiveAction')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
