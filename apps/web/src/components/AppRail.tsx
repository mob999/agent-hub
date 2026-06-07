import { Button, Theme } from '@carbon/react'
import { Chat, Devices, JobRun, Logout, Settings, UserAvatar } from '@carbon/react/icons'
import { useTranslation } from 'react-i18next'
import type { User, WorkspaceView } from '../lib/api'

interface AppRailProps {
  user: User | null
  activeView: WorkspaceView
  accountExpanded: boolean
  toggleAccount: () => void
  setActiveView: (view: WorkspaceView) => void
  openTutorial: () => void
  logout: () => void
  openSettings: () => void
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
  openTutorial,
  logout,
  openSettings,
}: AppRailProps) {
  const { t } = useTranslation()
  const displayName = user?.name?.trim() || user?.email || 'A'
  const avatar = user?.avatar ?? null

  return (
    <Theme
      theme="g100"
      as="aside"
      className="relative grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center border-r border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)] py-2"
      aria-label={t('appRail.primaryTools')}
    >
      <a
        className="sr-only z-20 whitespace-nowrap bg-[var(--cds-layer-01)] p-2 text-[var(--cds-text-primary)] focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:outline-2 focus:outline-offset-2 focus:outline-[var(--cds-focus)]"
        href="#main-content"
      >
        {t('appRail.skip')}
      </a>
      <button
        className={`mb-2 grid h-10 w-10 cursor-pointer place-items-center border bg-[var(--cds-layer-01)] text-sm font-semibold text-[var(--cds-text-primary)] hover:border-[var(--cds-border-strong-01)] hover:bg-[var(--cds-layer-selected-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)] ${
          accountExpanded
            ? 'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-selected-01)]'
            : 'border-[var(--cds-border-subtle-01)]'
        }`}
        type="button"
        aria-label={t('appRail.account')}
        aria-expanded={accountExpanded}
        onClick={toggleAccount}
      >
        <UserAvatar size={20} />
      </button>
      {accountExpanded && (
        <div
          className="absolute left-12 top-2 z-10 grid w-64 gap-2 border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] p-4 shadow-2xl"
          role="dialog"
          aria-label={t('appRail.account')}
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-md border border-[#d8dee6] bg-[var(--cds-layer-02)] shadow-[0_1px_3px_rgba(0,0,0,0.22),0_0_0_1px_rgba(255,255,255,0.12)_inset]">
              {avatar ? (
                <img src={avatar} alt="" className="h-9 w-9 rounded-[3px] object-cover" />
              ) : (
                <UserAvatar size={22} />
              )}
            </span>
            <div className="min-w-0">
              <p className="cds--type-label-01">{t('appRail.signedInAs')}</p>
              <strong className="block truncate">{displayName}</strong>
            </div>
          </div>
          <span className="truncate text-[var(--cds-text-secondary)]">{user?.email}</span>
          <Button
            className="justify-self-start !pl-0 text-left"
            kind="danger--ghost"
            size="sm"
            renderIcon={Logout}
            onClick={logout}
          >
            {t('appRail.logOut')}
          </Button>
        </div>
      )}
      <nav className="flex flex-col items-center gap-1.5" aria-label={t('appRail.sections')}>
        <button
          className={`${railButton} ${activeView === 'chat' ? activeRailButton : ''}`}
          type="button"
          aria-label={t('appRail.chat')}
          aria-current={activeView === 'chat' ? 'page' : undefined}
          onClick={() => setActiveView('chat')}
        >
          <Chat size={20} />
        </button>
        <button
          className={`${railButton} ${activeView === 'runs' ? activeRailButton : ''}`}
          type="button"
          aria-label={t('appRail.runs')}
          aria-current={activeView === 'runs' ? 'page' : undefined}
          onClick={() => setActiveView('runs')}
        >
          <JobRun size={20} />
        </button>
        <button
          className={`${railButton} ${activeView === 'daemon' ? activeRailButton : ''}`}
          type="button"
          aria-label={t('appRail.daemon')}
          aria-current={activeView === 'daemon' ? 'page' : undefined}
          onClick={() => setActiveView('daemon')}
        >
          <Devices size={20} />
        </button>
      </nav>
      <div className="flex flex-col items-center gap-1.5">
        <button className={railButton} type="button" aria-label={t('appRail.tutorial')} onClick={openTutorial}>
          <span className="text-lg font-semibold leading-none" aria-hidden="true">?</span>
        </button>
        <button className={railButton} type="button" aria-label={t('common.settings')} onClick={openSettings}>
          <Settings size={20} />
        </button>
      </div>
    </Theme>
  )
}
