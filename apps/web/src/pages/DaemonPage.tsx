import { Button, InlineNotification } from '@carbon/react'
import { Add, ChatBot, Devices, Renew } from '@carbon/react/icons'
import { useState, type ReactNode } from 'react'
import type { AgentDetails, DaemonDevice, DeviceStatus } from '../lib/api'
import { formatTime } from '../lib/format'

interface DaemonPageProps {
  devices: DaemonDevice[]
  agents: AgentDetails[]
  deviceError: string | null
  openCreateAgent: (daemonDeviceId?: string) => void
}

export function DaemonPage({ devices, agents, deviceError, openCreateAgent }: DaemonPageProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? null
  const selectedDeviceAgents = selectedDevice
    ? agents.filter((agent) => agent.runtimeBinding.daemonDeviceId === selectedDevice.id)
    : []

  return (
    <section
      id="main-content"
      className="grid h-full min-h-0 min-w-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)] max-[671px]:grid-cols-1"
      aria-label="Daemon management"
    >
      <aside
        className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto border-r border-[#eef0f3] bg-[#f7f8fa] text-[#596171] max-[671px]:hidden"
        aria-label="Daemon list"
      >
        <header className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-[#eef0f3] px-4">
          <h1 className="truncate text-base font-semibold leading-snug text-[#161616]">Daemon</h1>
          <button
            className="grid h-7 w-7 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-[#69707d] hover:bg-[#eef0f4] hover:text-[#161616] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add daemon"
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
                onClick={() => setSelectedDeviceId(device.id)}
              >
                <span
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#dde1e6] bg-white"
                  aria-hidden="true"
                >
                  <Devices size={18} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate">{device.id}</strong>
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

      <section className="h-full min-h-0 min-w-0 overflow-y-auto bg-[#f7f8fa]" aria-label="Daemon detail">
        <header className="flex min-h-16 items-center gap-4 border-b border-[#eef0f3] bg-white px-6 max-[671px]:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#dde1e6] bg-[#f7f8fa]"
              aria-hidden="true"
            >
              <Devices size={18} />
            </span>
            <strong className="truncate">{selectedDevice?.id ?? 'No daemon selected'}</strong>
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
              className="mx-6 mt-6 grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-4 rounded-2xl border border-[#e1e5ea] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] max-[671px]:mx-4"
              aria-label="Selected daemon"
            >
              <span
                className="grid h-16 w-16 place-items-center rounded-2xl border border-[#dde1e6] bg-[#f7f8fa]"
                aria-hidden="true"
              >
                <Devices size={28} />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-semibold leading-snug">{selectedDevice.id}</h2>
                <p className="mt-1 flex items-center gap-1.5 text-[var(--cds-text-secondary)]">
                  <StatusDot status={selectedDevice.status} />
                  <span>{selectedDevice.status}</span>
                </p>
                <small className="mt-1 block truncate text-[var(--cds-text-secondary)]">
                  {selectedDevice.id}
                </small>
              </div>
            </section>

            <DetailSection title="Name">
              <p className="break-words">{selectedDevice.id}</p>
            </DetailSection>

            <DetailSection title="Info">
              <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-4 gap-y-3 max-[671px]:grid-cols-1">
                <span className="text-[var(--cds-text-secondary)]">Status</span>
                <strong className="truncate">{selectedDevice.status}</strong>
                <span className="text-[var(--cds-text-secondary)]">Last seen</span>
                <strong className="truncate">{formatTime(selectedDevice.lastSeenAt)}</strong>
                <span className="text-[var(--cds-text-secondary)]">Running runs</span>
                <strong className="truncate">{selectedDevice.runningRunIds.length}</strong>
              </div>
            </DetailSection>

            <DetailSection title="Detected runtimes">
              {selectedDevice.runtimes.length === 0 ? (
                <p className="text-[var(--cds-text-secondary)]">No runtimes reported by this daemon yet.</p>
              ) : (
                <div className="grid overflow-hidden rounded-xl border border-[#e1e5ea] bg-white">
                  {selectedDevice.runtimes.map((runtime) => (
                    <div
                      className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e1e5ea] p-3 last:border-b-0"
                      key={`${runtime.daemonDeviceId}-${runtime.runtimeKind}`}
                    >
                      <span className="min-w-0 truncate">
                        {runtime.runtimeVersion
                          ? `${runtime.runtimeKind} (${runtime.runtimeVersion})`
                          : runtime.runtimeKind}
                      </span>
                      <span className="text-[var(--cds-text-secondary)]">
                        {runtime.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>

            <DetailSection title="Connection">
              <Button kind="secondary" size="sm" renderIcon={Renew}>
                Generate connect command
              </Button>
            </DetailSection>

            <DetailSection
              title="Agents on this daemon"
              aside={
                <button
                  className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-[#dde1e6] bg-white px-3 text-sm font-semibold text-[#161616] shadow-[0_1px_1px_rgba(0,0,0,0.03)] hover:bg-[#eef0f4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                  type="button"
                  onClick={() => openCreateAgent(selectedDevice.id)}
                >
                  <Add size={16} />
                  Create
                </button>
              }
            >
              {selectedDeviceAgents.length === 0 ? (
                <div className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-[#e1e5ea] bg-[#f7f8fa] p-3 text-[var(--cds-text-secondary)]">
                  <ChatBot size={20} />
                  <span>No agents created on this daemon yet.</span>
                </div>
              ) : (
                <div className="grid overflow-hidden rounded-xl border border-[#e1e5ea] bg-white">
                  {selectedDeviceAgents.map((agent) => (
                    <div
                      className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e1e5ea] p-3 last:border-b-0"
                      key={agent.agent.id}
                    >
                      <ChatBot size={20} />
                      <span className="min-w-0 truncate">{agent.agent.name}</span>
                      <span className="text-[var(--cds-text-secondary)]">
                        {agent.workspace.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </DetailSection>
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
    </section>
  )
}

interface DetailSectionProps {
  title: string
  children: ReactNode
  aside?: ReactNode
}

function DetailSection({ title, children, aside }: DetailSectionProps) {
  return (
    <section className="mx-6 mt-4 grid gap-3 rounded-2xl border border-[#e1e5ea] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] last:mb-6 max-[671px]:mx-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xs font-semibold uppercase leading-snug text-[var(--cds-text-secondary)]">
          {title}
        </h3>
        {aside}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
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
