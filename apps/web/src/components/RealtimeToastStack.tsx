import { Close } from '@carbon/react/icons'

export interface RealtimeToast {
  id: string
  conversationId: string
  title: string
  senderName: string
  senderAvatar?: string | null
  senderInitials: string
  senderKind: 'agent' | 'system' | 'user'
  preview: string
  expiresAt: number
}

interface RealtimeToastStackProps {
  toasts: RealtimeToast[]
  onDismiss: (toastId: string) => void
  onOpenConversation: (conversationId: string) => void
}

const senderMarkClassByKind: Record<RealtimeToast['senderKind'], string> = {
  agent: 'border-[#c5d3ff] bg-[#eef3ff] text-[#3152a3]',
  system: 'border-[#d6ccd7] bg-[#f5f0f6] text-[#6f5573]',
  user: 'border-[#cfe6d8] bg-[#eff8f2] text-[#2e6f45]',
}

export function RealtimeToastStack({
  toasts,
  onDismiss,
  onOpenConversation,
}: RealtimeToastStackProps) {
  if (toasts.length === 0) {
    return null
  }

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[10000] grid w-[min(23.5rem,calc(100vw-1.5rem))] gap-2 sm:bottom-5 sm:right-5"
      aria-live="polite"
      aria-label="Realtime message notifications"
    >
      {toasts.map((toast) => (
        <article
          className="pointer-events-auto grid grid-cols-[2.25rem_minmax(0,1fr)] gap-2.5 rounded-2xl border border-[#dde3ea] bg-white/[0.96] p-3 shadow-[0_18px_50px_rgba(15,23,42,0.13),0_6px_18px_rgba(15,23,42,0.08)] backdrop-blur transition duration-200 ease-out animate-[agenthub-toast-in_180ms_ease-out_both] hover:-translate-y-0.5 hover:border-[#cfd7e2] hover:shadow-[0_22px_56px_rgba(15,23,42,0.16),0_8px_22px_rgba(15,23,42,0.1)]"
          key={toast.id}
        >
          <span
            className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border text-[0.6875rem] font-semibold uppercase tracking-[0.02em] ${
              toast.senderAvatar
                ? 'border-[#d8dee6] bg-white p-0.5'
                : senderMarkClassByKind[toast.senderKind]
            }`}
            aria-hidden="true"
          >
            {toast.senderAvatar ? (
              <img
                src={toast.senderAvatar}
                alt=""
                className="h-full w-full rounded-[0.55rem] object-cover"
              />
            ) : (
              toast.senderInitials
            )}
          </span>
          <span className="grid min-w-0 gap-0.5">
            <span className="flex min-w-0 items-center gap-2">
              <button
                className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                type="button"
                onClick={() => onOpenConversation(toast.conversationId)}
              >
                <span className="truncate text-sm font-semibold leading-5">
                  {toast.title}
                </span>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7f8ea3]"
                  aria-hidden="true"
                />
              </button>
              <button
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-[#7b8490] transition hover:bg-[#eef1f5] hover:text-[#1f2933] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(toast.id)}
              >
                <Close size={15} />
              </button>
            </span>
            <button
              className="grid min-w-0 gap-0.5 border-0 bg-transparent p-0 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
              type="button"
              onClick={() => onOpenConversation(toast.conversationId)}
            >
              <span className="truncate text-xs font-medium text-[#5f6875]">
                {toast.senderName}
              </span>
              <span className="line-clamp-2 text-sm leading-5 text-[#697380]">
                {toast.preview}
              </span>
            </button>
          </span>
        </article>
      ))}
    </div>
  )
}
