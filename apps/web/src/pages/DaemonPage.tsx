import { Button, InlineNotification, Tag } from '@carbon/react'
import { Add, ChatBot, Devices, Renew } from '@carbon/react/icons'
import { useState, type ReactNode } from 'react'
import type { DaemonDevice, DeviceStatus } from '../lib/api'
import { formatTime } from '../lib/format'

interface DaemonPageProps {
  devices: DaemonDevice[]
  deviceError: string | null
  onlineCount: number
}

export function DaemonPage({ devices, deviceError, onlineCount }: DaemonPageProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null)
  const selectedDevice =
    devices.find((device) => device.id === selectedDeviceId) ?? devices[0] ?? null

  return (
    <section
      id="main-content"
      className="grid h-screen min-w-0 grid-cols-[18rem_minmax(0,1fr)] overflow-hidden bg-[var(--cds-background)] max-[671px]:grid-cols-1"
      aria-label="Daemon management"
    >
      <aside
        className="flex h-screen min-w-0 flex-col overflow-y-auto border-r border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] max-[671px]:hidden"
        aria-label="Daemon list"
      >
        <header className="grid min-h-18 grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-b border-[var(--cds-border-subtle-01)] px-4">
          <h1 className="truncate text-base font-semibold leading-snug">Daemon</h1>
          <span className="text-[var(--cds-text-secondary)]">{devices.length}</span>
          <Tag type={onlineCount > 0 ? 'green' : 'gray'} size="sm">
            {onlineCount} online
          </Tag>
          <button
            className="grid h-7 w-7 cursor-pointer place-items-center border-0 bg-transparent text-[var(--cds-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Add daemon"
          >
            <Add size={16} />
          </button>
        </header>

        {devices.length === 0 ? (
          <p className="p-4 text-[var(--cds-text-secondary)]">No daemon connected.</p>
        ) : (
          <div className="grid gap-2 p-3">
            {devices.map((device) => (
              <button
                className={`grid min-h-16 w-full cursor-pointer grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border p-2.5 text-left text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
                  selectedDevice?.id === device.id
                    ? 'border-[var(--cds-border-interactive)] bg-[var(--cds-layer-selected-01)]'
                    : 'border-transparent bg-transparent'
                }`}
                key={device.id}
                type="button"
                onClick={() => setSelectedDeviceId(device.id)}
              >
                <span
                  className="grid h-10 w-10 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)]"
                  aria-hidden="true"
                >
                  <Devices size={18} />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <strong className="truncate">{device.id}</strong>
                  <small className="truncate text-[var(--cds-text-secondary)]">
                    daemon {device.status}
                  </small>
                </span>
                <StatusDot status={device.status} />
              </button>
            ))}
          </div>
        )}
      </aside>

      <section className="h-screen min-w-0 overflow-y-auto bg-[var(--cds-background)]" aria-label="Daemon detail">
        <header className="flex min-h-18 items-center gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 max-[671px]:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="grid h-10 w-10 shrink-0 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)]"
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
              className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-4 border-b border-[var(--cds-border-subtle-01)] px-6 py-5 max-[671px]:px-4"
              aria-label="Selected daemon"
            >
              <span
                className="grid h-16 w-16 place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)]"
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
              <p className="text-[var(--cds-text-secondary)]">No runtimes reported by this daemon yet.</p>
            </DetailSection>

            <DetailSection title="Connection">
              <Button kind="secondary" size="sm" renderIcon={Renew}>
                Generate connect command
              </Button>
            </DetailSection>

            <DetailSection
              title="Agents on this daemon"
              aside={
                <div className="flex items-center gap-2">
                  <Button kind="ghost" size="sm">
                    Select
                  </Button>
                  <Button kind="secondary" size="sm" renderIcon={Add}>
                    Create
                  </Button>
                </div>
              }
            >
              <div className="grid min-h-12 grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 border border-[var(--cds-border-subtle-01)] p-3 text-[var(--cds-text-secondary)]">
                <ChatBot size={20} />
                <span>No agents created on this daemon yet.</span>
              </div>
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
    <section className="grid gap-3 border-b border-[var(--cds-border-subtle-01)] px-6 py-5 max-[671px]:px-4">
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
