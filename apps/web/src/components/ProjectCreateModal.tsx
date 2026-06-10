import { InlineNotification, Modal, Select, SelectItem, TextInput } from '@carbon/react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AgentMemberSelector } from './AgentMemberSelector'
import type { AgentDetails, DaemonDevice } from '../lib/api'

interface ProjectCreateModalProps {
  agents: AgentDetails[]
  devices: DaemonDevice[]
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
  devices,
  error,
  isCreating,
  open,
  onClose,
  onCreate,
}: ProjectCreateModalProps) {
  const { t } = useTranslation()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [orchestratorAgentId, setOrchestratorAgentId] = useState('')
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([])
  const availableDevices = useMemo(
    () => devices.filter((device) => device.status === 'online'),
    [devices],
  )
  const initialDaemonDeviceId = availableDevices[0]?.id ?? ''
  const [daemonDeviceId, setDaemonDeviceId] = useState(initialDaemonDeviceId)
  const selectedDaemonDeviceId =
    availableDevices.some((device) => device.id === daemonDeviceId)
      ? daemonDeviceId
      : initialDaemonDeviceId
  const selectedDaemonAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          agent.runtimeBinding.daemonDeviceId === selectedDaemonDeviceId &&
          agent.runtimeBinding.status === 'ready' &&
          agent.workspace.status === 'ready',
      ),
    [agents, selectedDaemonDeviceId],
  )
  const selectedDaemonAgentIds = useMemo(
    () => new Set(selectedDaemonAgents.map((agent) => agent.agent.id)),
    [selectedDaemonAgents],
  )
  const validSelectedAgentIds = selectedAgentIds.filter((agentId) => selectedDaemonAgentIds.has(agentId))
  const validOrchestratorAgentId = validSelectedAgentIds.includes(orchestratorAgentId) ? orchestratorAgentId : ''
  const canCreate =
    remoteUrl.trim().length > 0 &&
    selectedDaemonDeviceId.length > 0 &&
    validSelectedAgentIds.length > 0 &&
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
      modalHeading={t('modals.projectCreate.heading')}
      primaryButtonText={isCreating ? t('modals.agentCreate.creating') : t('common.create')}
      secondaryButtonText={t('common.cancel')}
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
          agentIds: validSelectedAgentIds,
          orchestratorAgentId: validOrchestratorAgentId || undefined,
        })
      }}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title={t('modals.projectCreate.errorTitle')}
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        {availableDevices.length === 0 && (
          <InlineNotification
            kind="warning"
            title={t('modals.projectCreate.daemonRequiredTitle')}
            subtitle={t('modals.projectCreate.daemonRequiredSubtitle')}
            lowContrast
            hideCloseButton
          />
        )}
        {availableDevices.length > 0 && selectedDaemonAgents.length === 0 && (
          <InlineNotification
            kind="warning"
            title={t('modals.projectCreate.noReadyAgentsTitle')}
            subtitle={t('modals.projectCreate.noReadyAgentsSubtitle')}
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="project-remote-url"
          labelText={t('modals.projectCreate.remoteUrl')}
          value={remoteUrl}
          disabled={isCreating}
          placeholder="https://github.com/acme/app.git"
          onChange={(event) => setRemoteUrl(event.target.value)}
        />
        <TextInput
          id="project-name"
          labelText={t('modals.projectCreate.name')}
          value={title}
          disabled={isCreating}
          maxLength={80}
          placeholder={t('modals.projectCreate.namePlaceholder')}
          onChange={(event) => setTitle(event.target.value)}
        />
        <TextInput
          id="project-description"
          labelText={t('modals.projectCreate.description')}
          value={description}
          disabled={isCreating}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select
          id="project-daemon"
          labelText={t('modals.projectCreate.daemon')}
          value={selectedDaemonDeviceId}
          disabled={isCreating || availableDevices.length === 0}
          onChange={(event) => {
            setDaemonDeviceId(event.target.value)
            setSelectedAgentIds([])
            setOrchestratorAgentId('')
          }}
        >
          {availableDevices.length === 0 ? (
            <SelectItem value="" text={t('modals.projectCreate.daemonRequiredTitle')} />
          ) : (
            availableDevices.map((device) => (
              <SelectItem key={device.id} value={device.id} text={device.name} />
            ))
          )}
        </Select>
        <AgentMemberSelector
          agents={selectedDaemonAgents}
          disabled={isCreating || selectedDaemonDeviceId.length === 0}
          helpText={t('modals.agentMembers.projectHelp')}
          idPrefix="project-agent"
          orchestratorAgentId={validOrchestratorAgentId}
          selectedAgentIds={validSelectedAgentIds}
          onSelectOrchestrator={selectOrchestrator}
          onToggleAgent={toggleAgent}
        />
      </div>
    </Modal>
  )
}
