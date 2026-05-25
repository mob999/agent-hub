import {
  InlineNotification,
  Modal,
  Select,
  SelectItem,
  TextArea,
  TextInput,
} from '@carbon/react'
import { useMemo, useState } from 'react'
import type { DaemonDevice, RuntimeKind } from '../lib/api'

interface AgentCreateModalProps {
  open: boolean
  devices: DaemonDevice[]
  defaultDaemonDeviceId: string | null
  error: string | null
  isCreating: boolean
  onClose: () => void
  onCreate: (input: {
    name: string
    description?: string
    daemonDeviceId: string
    runtimeKind: RuntimeKind
  }) => void
}

function readyRuntimeDevices(devices: DaemonDevice[]): DaemonDevice[] {
  return devices
    .filter((device) => device.status === 'online')
    .map((device) => ({
      ...device,
      runtimes: device.runtimes.filter((runtime) => runtime.status === 'ready'),
    }))
    .filter((device) => device.runtimes.length > 0)
}

export function AgentCreateModal({
  open,
  devices,
  defaultDaemonDeviceId,
  error,
  isCreating,
  onClose,
  onCreate,
}: AgentCreateModalProps) {
  const availableDevices = useMemo(() => readyRuntimeDevices(devices), [devices])
  const initialDeviceId =
    availableDevices.find((device) => device.id === defaultDaemonDeviceId)?.id ??
    availableDevices[0]?.id ??
    ''
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [daemonDeviceId, setDaemonDeviceId] = useState(initialDeviceId)
  const selectedDaemonDeviceId =
    availableDevices.some((device) => device.id === daemonDeviceId)
      ? daemonDeviceId
      : initialDeviceId
  const selectedDevice = availableDevices.find((device) => device.id === selectedDaemonDeviceId) ?? null
  const [runtimeKind, setRuntimeKind] = useState<RuntimeKind | ''>('')
  const selectedRuntimeKind =
    selectedDevice?.runtimes.some((runtime) => runtime.runtimeKind === runtimeKind)
      ? runtimeKind
      : selectedDevice?.runtimes[0]?.runtimeKind ?? ''

  const canCreate =
    name.trim().length > 0 &&
    selectedDaemonDeviceId.length > 0 &&
    selectedRuntimeKind.length > 0 &&
    !isCreating

  return (
    <Modal
      open={open}
      modalHeading="Create agent"
      primaryButtonText={isCreating ? 'Creating...' : 'Create'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={!canCreate}
      onRequestClose={onClose}
      onRequestSubmit={() => {
        if (!canCreate || selectedRuntimeKind === '') {
          return
        }

        onCreate({
          name: name.trim(),
          description: description.trim() || undefined,
          daemonDeviceId: selectedDaemonDeviceId,
          runtimeKind: selectedRuntimeKind,
        })
      }}
    >
      <div className="grid gap-4">
        {error && (
          <InlineNotification
            kind="error"
            title="Agent was not created"
            subtitle={error}
            lowContrast
            hideCloseButton
          />
        )}
        {availableDevices.length === 0 && (
          <InlineNotification
            kind="warning"
            title="No runtime available"
            subtitle="Connect a daemon with a detected runtime before creating an agent."
            lowContrast
            hideCloseButton
          />
        )}
        <TextInput
          id="agent-name"
          labelText="Name"
          value={name}
          disabled={isCreating}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
        />
        <TextArea
          id="agent-description"
          labelText="Description"
          rows={3}
          value={description}
          disabled={isCreating}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select
          id="agent-daemon"
          labelText="Daemon"
          value={selectedDaemonDeviceId}
          disabled={isCreating || availableDevices.length === 0}
          onChange={(event) => {
            setDaemonDeviceId(event.target.value)
            setRuntimeKind('')
          }}
        >
          {availableDevices.map((device) => (
            <SelectItem key={device.id} value={device.id} text={device.id} />
          ))}
        </Select>
        <Select
          id="agent-runtime"
          labelText="Runtime"
          value={selectedRuntimeKind}
          disabled={isCreating || !selectedDevice}
          onChange={(event) => setRuntimeKind(event.target.value as RuntimeKind)}
        >
          {selectedDevice?.runtimes.map((runtime) => (
            <SelectItem
              key={`${runtime.daemonDeviceId}-${runtime.runtimeKind}`}
              value={runtime.runtimeKind}
              text={runtime.runtimeVersion ? `${runtime.runtimeKind} (${runtime.runtimeVersion})` : runtime.runtimeKind}
            />
          ))}
        </Select>
      </div>
    </Modal>
  )
}
