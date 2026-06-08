import { Close } from '@carbon/react/icons'
import { useTranslation } from 'react-i18next'

interface DesktopUpdateToastProps {
  info: TavroDesktopUpdateInfo | null
  onDismiss: () => void
  onDownload: (releaseUrl: string) => void
}

export function DesktopUpdateToast({
  info,
  onDismiss,
  onDownload,
}: DesktopUpdateToastProps) {
  const { t } = useTranslation()

  if (info === null || !info.updateAvailable || !info.releaseUrl) {
    return null
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[10000] w-[min(23.5rem,calc(100vw-1.5rem))] sm:bottom-5 sm:right-5"
      aria-live="polite"
      aria-label={t('settings.updates.availableTitle')}
    >
      <article className="pointer-events-auto grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2.5 rounded-2xl border border-[#dde3ea] bg-white/[0.96] p-3 shadow-[0_18px_50px_rgba(15,23,42,0.13),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur transition duration-200 ease-out animate-[agenthub-toast-in_180ms_ease-out_both] hover:-translate-y-0.5 hover:border-[#cfd7e2] hover:shadow-[0_22px_56px_rgba(15,23,42,0.16),0_8px_22px_rgba(15,23,42,0.1)]">
        <span
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-[#d8dee6] bg-white p-0.5"
          aria-hidden="true"
        >
          <img
            src="/favicon.svg"
            alt=""
            className="h-full w-full rounded-[0.55rem] object-cover"
          />
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <button
              className="min-w-0 flex-1 truncate border-0 bg-transparent p-0 text-left text-sm font-semibold leading-5 text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              onClick={() => onDownload(info.releaseUrl!)}
            >
              {t('settings.updates.availableTitle')}
            </button>
            <button
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-[#7b8490] transition hover:bg-[#eef1f5] hover:text-[#1f2933] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              aria-label={t('common.closeNotification')}
              onClick={onDismiss}
            >
              <Close size={15} />
            </button>
          </span>
          <button
            className="grid min-w-0 gap-0.5 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            onClick={() => onDownload(info.releaseUrl!)}
          >
            <span className="truncate text-xs font-medium text-[#5f6875]">
              Tavro AI Desktop
            </span>
            <span className="line-clamp-2 text-sm leading-5 text-[#697380]">
              {t('settings.updates.availableSubtitle', {
                version: info.latestVersion ?? '',
              })}
            </span>
          </button>
        </span>
      </article>
    </div>
  )
}
