import { Button, InlineNotification, Modal, TextInput } from '@carbon/react'
import { Add, Checkmark, Copy, Devices, Renew, TrashCan } from '@carbon/react/icons'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownCodeBlock } from '../components/MarkdownCodeBlock'
import { WorkspacePanel } from '../components/WorkspacePanel'
import { apiRequest, type DaemonDevice, type DaemonRegistrationCommandResponse, type DaemonRuntime, type DeviceStatus, type RuntimeKind } from '../lib/api'
import { formatTime } from '../lib/format'

interface DaemonPageProps {
  devices: DaemonDevice[]
  deviceError: string | null
  onDevicesChanged: () => void
}

function detectDaemonCommandPlatform(): 'windows' | 'posix' {
  if (typeof navigator === 'undefined') {
    return 'posix'
  }

  return /Win/i.test(navigator.platform) ? 'windows' : 'posix'
}

export function DaemonPage({ devices, deviceError, onDevicesChanged }: DaemonPageProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [registrationMode, setRegistrationMode] = useState<'create' | 'reconnect'>('create')
  const [registrationName, setRegistrationName] = useState('')
  const [registrationCommand, setRegistrationCommand] = useState<DaemonRegistrationCommandResponse | null>(null)
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  const [registrationLoading, setRegistrationLoading] = useState(false)
  const [commandCopied, setCommandCopied] = useState(false)
  const [deviceNameDraft, setDeviceNameDraft] = useState<{ deviceId: string | null; value: string }>({
    deviceId: null,
    value: '',
  })
  const [deviceSaveError, setDeviceSaveError] = useState<string | null>(null)
  const [deviceSaving, setDeviceSaving] = useState(false)
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? null
  const registeredDevice = registrationCommand
    ? devices.find((device) => device.id === registrationCommand.deviceId)
    : null
  const registrationConnected = registeredDevice?.status === 'online'
  const activeDeviceNameDraft =
    selectedDevice && deviceNameDraft.deviceId === selectedDevice.id
      ? deviceNameDraft.value
      : selectedDevice?.name ?? ''

  const loadRegistrationCommand = async (input: {
    deviceId?: string
    mode: 'create' | 'reconnect'
    name?: string
  }) => {
    setRegistrationLoading(true)
    setRegistrationError(null)
    setRegistrationCommand(null)
    setCommandCopied(false)

    try {
      const platform = detectDaemonCommandPlatform()
      const response =
        input.mode === 'reconnect' && input.deviceId
          ? await apiRequest<DaemonRegistrationCommandResponse>(
              `/daemon/devices/${encodeURIComponent(input.deviceId)}/reconnect-command`,
              {
                method: 'POST',
                body: JSON.stringify({ platform }),
              },
            )
          : await apiRequest<DaemonRegistrationCommandResponse>('/daemon/devices', {
              method: 'POST',
              body: JSON.stringify({ name: input.name, platform }),
            })
      setRegistrationCommand(response)
      if (response.device?.id) {
        setSelectedDeviceId(response.device.id)
      }
      onDevicesChanged()
    } catch (error) {
      setRegistrationError(error instanceof Error ? error.message : 'Unable to generate daemon command.')
    } finally {
      setRegistrationLoading(false)
    }
  }

  const openRegistrationModal = () => {
    setRegistrationMode('create')
    setRegistrationName('')
    setRegistrationOpen(true)
    setRegistrationCommand(null)
    setRegistrationError(null)
    setCommandCopied(false)
  }

  const openReconnectModal = () => {
    if (!selectedDevice) {
      return
    }

    setRegistrationMode('reconnect')
    setRegistrationName(selectedDevice.name)
    setRegistrationOpen(true)
    void loadRegistrationCommand({
      deviceId: selectedDevice.id,
      mode: 'reconnect',
    })
  }

  const closeRegistrationModal = () => {
    setRegistrationOpen(false)
  }

  const copyRegistrationCommand = async () => {
    if (!registrationCommand?.command) {
      return
    }

    try {
      await navigator.clipboard.writeText(registrationCommand.command)
      setCommandCopied(true)
    } catch {
      setRegistrationError('Copy failed. Select the command and copy it manually.')
    }
  }

  const createNamedDevice = () => {
    const name = registrationName.trim().replace(/\s+/g, ' ')

    if (name.length === 0 || name.length > 80) {
      setRegistrationError('Device name must be 1-80 characters.')
      return
    }

    void loadRegistrationCommand({ mode: 'create', name })
  }

  const saveDeviceName = async () => {
    if (!selectedDevice) {
      return
    }

    const name = activeDeviceNameDraft.trim().replace(/\s+/g, ' ')

    if (name.length === 0 || name.length > 80) {
      setDeviceSaveError('Device name must be 1-80 characters.')
      return
    }

    setDeviceSaving(true)
    setDeviceSaveError(null)
    try {
      await apiRequest(`/daemon/devices/${encodeURIComponent(selectedDevice.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      onDevicesChanged()
    } catch (error) {
      setDeviceSaveError(error instanceof Error ? error.message : 'Unable to update device.')
    } finally {
      setDeviceSaving(false)
    }
  }

  const deleteDevice = async () => {
    if (!selectedDevice) {
      return
    }

    if (!deleteConfirming) {
      setDeleteConfirming(true)
      return
    }

    setDeleteError(null)
    try {
      await apiRequest(`/daemon/devices/${encodeURIComponent(selectedDevice.id)}`, {
        method: 'DELETE',
      })
      setSelectedDeviceId(null)
      onDevicesChanged()
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Unable to delete device.')
    }
  }

  return (
    <section
      id="main-content"
      className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden bg-[#fafafa] max-[671px]:grid-cols-1"
      aria-label="Daemon management"
    >
      <aside
        className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto bg-[#fafafa] text-[#596171] max-[671px]:hidden"
        aria-label="Daemon list"
      >
        <header className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4">
          <h1 className="truncate text-lg font-semibold leading-7 text-[#161616]">Daemon</h1>
          <button
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add daemon"
            onClick={openRegistrationModal}
          >
            <Add size={16} />
          </button>
        </header>

        {devices.length === 0 ? (
          <p className="p-4 text-[#69707d]">No daemon connected.</p>
        ) : (
          <div className="grid gap-1 p-3">
            {devices.map((device) => (
              <button
                className={`grid min-h-14 w-full cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border-0 px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                  selectedDevice?.id === device.id
                    ? 'bg-[#e9eaee] font-semibold text-[#161616] hover:bg-[#e9eaee]'
                    : 'bg-transparent text-[#596171] hover:bg-[#eef0f4] hover:text-[#161616]'
                }`}
                key={device.id}
                type="button"
                onClick={() => {
                  setSelectedDeviceId(device.id)
                  setDeviceSaveError(null)
                  setDeleteError(null)
                  setDeleteConfirming(false)
                }}
              >
                <span
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#dde1e6] bg-white"
                  aria-hidden="true"
                >
                  <Devices size={18} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate">{device.name}</strong>
                  <small className="truncate font-normal text-[#69707d]">
                    daemon {device.status}
                  </small>
                </span>
                <StatusDot status={device.status} />
              </button>
            ))}
          </div>
        )}
      </aside>

      <WorkspacePanel>
        <section className="h-full min-h-0 min-w-0 overflow-y-auto bg-white" aria-label="Daemon detail">
          <header className="flex min-h-16 items-center gap-4 border-b border-[#eef0f3] bg-white px-6 max-[671px]:px-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-[#f7f8fa]"
                aria-hidden="true"
              >
                <Devices size={18} />
              </span>
              <strong className="truncate">{selectedDevice?.name ?? 'No daemon selected'}</strong>
            </div>
          </header>

          {deviceError && (
            <InlineNotification
              className="mx-6 mt-4 max-w-none max-[671px]:mx-4"
              kind="error"
              title="Daemon unavailable"
              subtitle={deviceError}
              lowContrast
              aria-label="Close notification"
            />
          )}

          {selectedDevice ? (
            <>
              <section
                className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-4 p-6 max-[671px]:p-4"
                aria-label="Selected daemon"
              >
                <span
                  className="grid h-16 w-16 place-items-center rounded-2xl border border-[#dde1e6] bg-[#f7f8fa]"
                  aria-hidden="true"
                >
                  <Devices size={28} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold leading-snug">{selectedDevice.name}</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-[var(--cds-text-secondary)]">
                    <StatusDot status={selectedDevice.status} />
                    <span>{selectedDevice.status}</span>
                  </p>
                  <small className="mt-1 block truncate text-[var(--cds-text-secondary)]">
                    Last seen {formatTime(selectedDevice.lastSeenAt)}
                  </small>
                </div>
              </section>

              <section className="border-t border-[#eef0f3] p-6 max-[671px]:p-4" aria-label="Runtimes">
                {selectedDevice.runtimes.length === 0 ? (
                  <p className="text-[var(--cds-text-secondary)]">No runtimes reported by this daemon yet.</p>
                ) : (
                  <div className="grid">
                    <div
                      className="grid grid-cols-[minmax(12rem,1fr)_minmax(9rem,0.85fr)_minmax(11rem,0.8fr)] gap-4 border-b border-[#eef0f3] pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cds-text-secondary)] max-[760px]:hidden"
                      aria-hidden="true"
                    >
                      <span>Runtimes</span>
                      <span>Version</span>
                      <span>Status</span>
                    </div>
                    {selectedDevice.runtimes.map((runtime) => (
                      <div
                        className="grid min-h-16 grid-cols-[minmax(12rem,1fr)_minmax(9rem,0.85fr)_minmax(11rem,0.8fr)] items-center gap-4 border-b border-[#eef0f3] py-3 last:border-b-0 max-[760px]:grid-cols-1"
                        key={`${runtime.daemonDeviceId}-${runtime.runtimeKind}`}
                      >
                        <RuntimeIdentity runtimeKind={runtime.runtimeKind} />
                        <RuntimeVersion runtime={runtime} />
                        <RuntimeStatus status={runtime.status} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="daemon-device-settings border-t border-[#eef0f3] p-6 max-[671px]:p-4" aria-label="Device settings">
                <div className="grid max-w-xl gap-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--cds-text-secondary)]">
                    Settings
                  </h3>
                  {deviceSaveError && (
                    <InlineNotification
                      kind="error"
                      title="Device was not updated"
                      subtitle={deviceSaveError}
                      lowContrast
                      hideCloseButton
                    />
                  )}
                  {deleteError && (
                    <InlineNotification
                      kind="error"
                      title="Device was not deleted"
                      subtitle={deleteError}
                      lowContrast
                      hideCloseButton
                    />
                  )}
                  <div className="grid border-t border-[#eef0f3]">
                    <div className="grid gap-2 border-b border-[#eef0f3] py-3">
                      <label
                        className="text-sm font-semibold text-[#161616]"
                        htmlFor="daemon-device-name"
                      >
                        Name
                      </label>
                      <div className="flex items-center gap-2">
                        <TextInput
                          className="w-56 max-w-[calc(100%-2.5rem)]"
                          id="daemon-device-name"
                          labelText=""
                          hideLabel
                          size="sm"
                          value={activeDeviceNameDraft}
                          maxLength={80}
                          onChange={(event) =>
                            setDeviceNameDraft({
                              deviceId: selectedDevice.id,
                              value: event.target.value,
                            })}
                        />
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#bfe8c8] bg-[#eefbf1] text-[#198038] transition hover:border-[#8ed99f] hover:bg-[#ddf7e4] disabled:cursor-not-allowed disabled:border-[#e1e5ea] disabled:bg-[#f4f4f4] disabled:text-[#a2a9b0]"
                          disabled={deviceSaving || activeDeviceNameDraft.trim().length === 0}
                          onClick={() => {
                            void saveDeviceName()
                          }}
                          title={deviceSaving ? 'Saving' : 'Save name'}
                          aria-label={deviceSaving ? 'Saving device name' : 'Save device name'}
                        >
                          <Checkmark size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-[#eef0f3] py-3">
                      <p className="text-sm font-semibold text-[#161616]">Reconnect</p>
                      <span aria-hidden="true" />
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#f1d27a] bg-[#fff8df] text-[#b28600] transition hover:border-[#d7af2f] hover:bg-[#fff1bf]"
                        onClick={openReconnectModal}
                        title="Reconnect"
                        aria-label="Reconnect daemon device"
                      >
                        <Renew size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-3">
                      <p className="text-sm font-semibold text-[#161616]">
                        {deleteConfirming ? 'Confirm delete' : 'Delete'}
                      </p>
                      <span aria-hidden="true" />
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#ffd7d9] bg-[#fff1f1] text-[#da1e28] transition hover:border-[#ffb3b8] hover:bg-[#ffe0e2]"
                        onClick={() => {
                          void deleteDevice()
                        }}
                        title={deleteConfirming ? 'Confirm delete' : 'Delete'}
                        aria-label={deleteConfirming ? 'Confirm delete daemon device' : 'Delete daemon device'}
                      >
                        <TrashCan size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <div className="grid min-h-[calc(100vh-4.5rem)] content-center justify-items-center gap-3 text-center">
              <Devices size={32} />
              <h2 className="cds--type-heading-compact-02">No daemon connected</h2>
              <p className="text-[var(--cds-text-secondary)]">
                Start a local daemon and it will appear in this page.
              </p>
            </div>
          )}
        </section>
      </WorkspacePanel>

      <Modal
        open={registrationOpen}
        modalHeading={registrationMode === 'create' ? 'Create daemon' : 'Reconnect daemon'}
        passiveModal
        onRequestClose={closeRegistrationModal}
      >
        <div className="grid gap-3">
          {registrationMode === 'create' && !registrationCommand && (
            <div className="grid gap-3">
              <TextInput
                id="daemon-registration-name"
                labelText="Device name"
                value={registrationName}
                maxLength={80}
                onChange={(event) => setRegistrationName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    createNamedDevice()
                  }
                }}
              />
              <Button
                size="sm"
                disabled={registrationLoading || registrationName.trim().length === 0}
                onClick={createNamedDevice}
              >
                Generate command
              </Button>
            </div>
          )}

          {registrationError && (
            <InlineNotification
              kind="error"
              title="Command was not generated"
              subtitle={registrationError}
              lowContrast
              hideCloseButton
            />
          )}

          {(registrationCommand || registrationMode === 'reconnect' || registrationLoading) && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
            <div className="min-w-0">
              <div className="agenthub-command-markdown">
                <ReactMarkdown
                  components={{
                    code: MarkdownCodeBlock,
                  }}
                  remarkPlugins={[remarkGfm]}
                >
                  {registrationCommand
                    ? `\`\`\`${registrationCommand.shell}\n${registrationCommand.command}\n\`\`\``
                    : registrationLoading
                      ? 'Generating command...'
                      : 'Command unavailable.'}
                </ReactMarkdown>
              </div>
            </div>

            <button
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-xl border border-[#d8dee6] bg-white text-[#596171] shadow-[0_1px_2px_rgba(15,23,42,0.08)] hover:border-[#c7d0dc] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              aria-label="Copy daemon command"
              title={commandCopied ? 'Copied' : 'Copy'}
              disabled={!registrationCommand?.command}
              onClick={() => {
                void copyRegistrationCommand()
              }}
            >
              {commandCopied ? <Checkmark size={16} /> : <Copy size={16} />}
            </button>
          </div>
          )}

          {registrationCommand && (
            <p className="text-sm leading-5 text-[#69707d]">Copy and run it in your terminal.</p>
          )}

          {registrationCommand && (
            <InlineNotification
              kind={registrationConnected ? 'success' : 'warning'}
              title={registrationConnected ? 'Daemon connected' : 'Waiting for daemon connection'}
              subtitle={
                registrationConnected
                  ? 'Device is online.'
                  : 'Run the command and wait for this device to connect.'
              }
              lowContrast
              hideCloseButton
            />
          )}
        </div>
      </Modal>
    </section>
  )
}

const openAiIconPath =
  'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z'

const claudeIconPath =
  'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z'

function RuntimeIdentity({ runtimeKind }: { runtimeKind: RuntimeKind }) {
  const runtimeLabel = runtimeDisplayName(runtimeKind)

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${runtimeIconFrameClass(runtimeKind)}`}
        aria-hidden="true"
      >
        <RuntimeBrandIcon runtimeKind={runtimeKind} />
      </span>
      <span className="min-w-0 truncate font-semibold text-[#161616]">{runtimeLabel}</span>
    </div>
  )
}

function RuntimeBrandIcon({ runtimeKind }: { runtimeKind: RuntimeKind }) {
  if (runtimeKind === 'codex') {
    return (
      <svg className="h-5 w-5" role="img" viewBox="0 0 24 24" aria-label="OpenAI">
        <path d={openAiIconPath} fill="currentColor" />
      </svg>
    )
  }

  if (runtimeKind === 'claude-code') {
    return (
      <svg className="h-5 w-5" role="img" viewBox="0 0 24 24" aria-label="Claude">
        <path d={claudeIconPath} fill="currentColor" />
      </svg>
    )
  }

  if (runtimeKind === 'opencode') {
    return <span className="text-[0.65rem] font-bold tracking-tight">OC</span>
  }

  return <span className="text-[0.65rem] font-bold tracking-tight">AI</span>
}

function RuntimeVersion({ runtime }: { runtime: DaemonRuntime }) {
  return (
    <span className="min-w-0 truncate text-[#596171]" title={runtime.runtimeVersion ?? 'No version reported'}>
      {runtime.runtimeVersion ?? 'Not reported'}
    </span>
  )
}

function RuntimeStatus({ status }: { status: DaemonRuntime['status'] }) {
  const meta = runtimeStatusMeta(status)

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
      <strong className="truncate text-sm font-semibold text-[#161616]">{meta.label}</strong>
    </span>
  )
}

function runtimeIconFrameClass(runtimeKind: RuntimeKind): string {
  if (runtimeKind === 'claude-code') {
    return 'border-[#eadfd2] bg-[#f8f2ec] text-[#d97757]'
  }

  return 'border-[#dde1e6] bg-[#f7f8fa] text-[#161616]'
}

function runtimeDisplayName(runtimeKind: RuntimeKind): string {
  if (runtimeKind === 'claude-code') {
    return 'Claude Code'
  }

  if (runtimeKind === 'codex') {
    return 'Codex'
  }

  if (runtimeKind === 'opencode') {
    return 'OpenCode'
  }

  return 'Custom runtime'
}

function runtimeStatusMeta(status: DaemonRuntime['status']): {
  label: string
  dot: string
} {
  if (status === 'ready') {
    return {
      label: 'Ready',
      dot: 'bg-[var(--cds-support-success)]',
    }
  }

  if (status === 'disabled') {
    return {
      label: 'Disabled',
      dot: 'bg-[#8d8d8d]',
    }
  }

  return {
    label: 'Unavailable',
    dot: 'bg-[var(--cds-support-error)]',
  }
}

interface StatusDotProps {
  status: DeviceStatus
}

function StatusDot({ status }: StatusDotProps) {
  const isOnline = status === 'online'

  return (
    <span
      className={`h-2.5 w-2.5 rounded-full border ${
        isOnline
          ? 'border-[var(--cds-support-success)] bg-[var(--cds-support-success)]'
          : 'border-[var(--cds-border-strong-01)] bg-[var(--cds-text-placeholder)]'
      }`}
      aria-label={status}
      title={status}
    />
  )
}
