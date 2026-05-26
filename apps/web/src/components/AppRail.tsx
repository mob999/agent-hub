import { Button, Theme } from '@carbon/react'
import { Chat, Devices, JobRun, Logout, Renew, Settings } from '@carbon/react/icons'
import type { User, WorkspaceView } from '../lib/api'

interface AppRailProps {
  user: User | null
  activeView: WorkspaceView
  accountExpanded: boolean
  toggleAccount: () => void
  setActiveView: (view: WorkspaceView) => void
  refreshWorkspace: () => void
  logout: () => void
}

const railButton =
  'grid h-10 w-10 cursor-pointer place-items-center border border-transparent bg-transparent text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const activeRailButton =
  'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-01)] shadow-[inset_3px_0_0_var(--cds-text-primary)] hover:bg-[var(--cds-layer-01)]'

export function AppRail({
  user,
  activeView,
  accountExpanded,
  toggleAccount,
  setActiveView,
  refreshWorkspace,
  logout,
}: AppRailProps) {
  const displayName = user?.name?.trim() || user?.email || 'A'
  const avatarInitial = displayName.slice(0, 1).toUpperCase()

  return (
    <Theme
      theme="g100"
      as="aside"
      className="relative grid h-screen grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center border-r border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] py-2"
      aria-label="Primary workspace tools"
    >
      <a
        className="absolute left-2 top-2 z-20 -translate-y-20 bg-[var(--cds-layer-01)] p-2 text-[var(--cds-text-primary)] focus:translate-y-0"
        href="#main-content"
      >
        Skip to workspace
      </a>
      <button
        className={`mb-2 grid h-10 w-10 cursor-pointer place-items-center border bg-[var(--cds-layer-01)] text-sm font-semibold text-[var(--cds-text-primary)] hover:border-[var(--cds-border-strong-01)] hover:bg-[var(--cds-layer-selected-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
          accountExpanded
            ? 'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-selected-01)]'
            : 'border-[var(--cds-border-subtle-01)]'
        }`}
        type="button"
        aria-label="Account"
        aria-expanded={accountExpanded}
        onClick={toggleAccount}
      >
        {avatarInitial}
      </button>
      {accountExpanded && (
        <div
          className="absolute left-12 top-2 z-10 grid w-64 gap-2 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-4 shadow-2xl"
          role="dialog"
          aria-label="Account"
        >
          <p className="cds--type-label-01">Signed in as</p>
          <strong className="truncate">{user?.name ?? user?.email}</strong>
          <span className="truncate text-[var(--cds-text-secondary)]">{user?.email}</span>
          <Button kind="ghost" size="sm" renderIcon={Logout} onClick={logout}>
            Log out
          </Button>
        </div>
      )}
      <nav className="flex flex-col items-center gap-1.5" aria-label="Workspace sections">
        <button
          className={`${railButton} ${activeView === 'chat' ? activeRailButton : ''}`}
          type="button"
          aria-label="Chat"
          aria-current={activeView === 'chat' ? 'page' : undefined}
          onClick={() => setActiveView('chat')}
        >
          <Chat size={20} />
        </button>
        <button
          className={`${railButton} ${activeView === 'runs' ? activeRailButton : ''}`}
          type="button"
          aria-label="Runs"
          aria-current={activeView === 'runs' ? 'page' : undefined}
          onClick={() => setActiveView('runs')}
        >
          <JobRun size={20} />
        </button>
        <button
          className={`${railButton} ${activeView === 'daemon' ? activeRailButton : ''}`}
          type="button"
          aria-label="Daemon"
          aria-current={activeView === 'daemon' ? 'page' : undefined}
          onClick={() => setActiveView('daemon')}
        >
          <Devices size={20} />
        </button>
      </nav>
      <div className="flex flex-col items-center gap-1.5">
        <button className={railButton} type="button" aria-label="Refresh" onClick={refreshWorkspace}>
          <Renew size={20} />
        </button>
        <button className={railButton} type="button" aria-label="Settings">
          <Settings size={20} />
        </button>
      </div>
    </Theme>
  )
}
