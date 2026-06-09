import { Theme } from '@carbon/react'
import { Chat, Devices, JobRun, Settings } from '@carbon/react/icons'
import { useTranslation } from 'react-i18next'
import type { WorkspaceView } from '../lib/api'
import { useIsMobile } from '../lib/useIsMobile'

interface AppRailProps {
  activeView: WorkspaceView
  openHome: () => void
  setActiveView: (view: WorkspaceView) => void
  openTutorial: () => void
  openSettings: () => void
}

const railButton =
  'grid h-10 w-10 cursor-pointer place-items-center border border-transparent bg-transparent text-[var(--cds-text-primary)] hover:bg-[var(--cds-layer-hover-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
const activeRailButton =
  'border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-01)] shadow-[inset_3px_0_0_var(--cds-text-primary)] hover:bg-[var(--cds-layer-01)]'

export function AppRail({
  activeView,
  openHome,
  setActiveView,
  openTutorial,
  openSettings,
}: AppRailProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()

  if (isMobile) {
    const mobileTab =
      'grid flex-1 cursor-pointer place-items-center gap-0.5 border-0 bg-transparent py-2 text-[var(--cds-text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]'
    const activeMobileTab = 'text-[var(--cds-text-on-color)]'

    return (
      <Theme
        theme="g100"
        as="nav"
        className="fixed bottom-0 left-0 right-0 z-30 grid grid-cols-5 items-center border-t border-[var(--cds-border-subtle-01)] bg-[var(--cds-background)]"
        aria-label={t('appRail.primaryTools')}
      >
        <button
          className={`${mobileTab} ${activeView === 'chat' ? activeMobileTab : ''}`}
          type="button"
          aria-label={t('appRail.chat')}
          aria-current={activeView === 'chat' ? 'page' : undefined}
          onClick={() => setActiveView('chat')}
        >
          <Chat size={20} />
          <span className="text-[0.625rem] leading-none">{t('appRail.chat')}</span>
        </button>
        <button
          className={`${mobileTab} ${activeView === 'runs' ? activeMobileTab : ''}`}
          type="button"
          aria-label={t('appRail.runs')}
          aria-current={activeView === 'runs' ? 'page' : undefined}
          onClick={() => setActiveView('runs')}
        >
          <JobRun size={20} />
          <span className="text-[0.625rem] leading-none">{t('appRail.runs')}</span>
        </button>
        <button
          className={`${mobileTab} ${activeView === 'daemon' ? activeMobileTab : ''}`}
          type="button"
          aria-label={t('appRail.daemon')}
          aria-current={activeView === 'daemon' ? 'page' : undefined}
          onClick={() => setActiveView('daemon')}
        >
          <Devices size={20} />
          <span className="text-[0.625rem] leading-none">{t('appRail.daemon')}</span>
        </button>
        <button
          className={mobileTab}
          type="button"
          aria-label={t('appRail.tutorial')}
          onClick={openTutorial}
        >
          <span className="text-lg font-semibold leading-none" aria-hidden="true">?</span>
        </button>
        <button
          className={mobileTab}
          type="button"
          aria-label={t('common.settings')}
          onClick={openSettings}
        >
          <Settings size={20} />
        </button>
      </Theme>
    )
  }

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
        className="mb-2 grid h-10 w-10 cursor-pointer place-items-center border border-[var(--cds-border-subtle-01)] bg-[var(--cds-layer-01)] hover:border-[var(--cds-border-strong-01)] hover:bg-[var(--cds-layer-selected-01)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
        type="button"
        aria-label={t('appRail.home')}
        onClick={openHome}
      >
        <img src="/favicon.svg" alt="" className="h-7 w-7" />
      </button>
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
