import { Close } from '@carbon/react/icons'

export interface RealtimeToast {
  id: string
  conversationId: string
  title: string
  senderName: string
  preview: string
  expiresAt: number
}

interface RealtimeToastStackProps {
  toasts: RealtimeToast[]
  onDismiss: (toastId: string) => void
  onOpenConversation: (conversationId: string) => void
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
      className="pointer-events-none fixed bottom-4 right-4 z-[10000] grid w-[min(22rem,calc(100vw-2rem))] gap-2"
      aria-live="polite"
      aria-label="Realtime message notifications"
    >
      {toasts.map((toast) => (
        <article
          className="pointer-events-auto grid grid-cols-[minmax(0,1fr)_auto] gap-2 border border-[var(--cds-border-strong-01)] bg-[var(--cds-layer-02)] p-3 shadow-lg"
          key={toast.id}
        >
          <button
            className="grid min-w-0 gap-1 border-0 bg-transparent p-0 text-left text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            onClick={() => onOpenConversation(toast.conversationId)}
          >
            <span className="truncate text-sm font-semibold">{toast.title}</span>
            <span className="truncate text-xs font-semibold text-[var(--cds-text-secondary)]">
              {toast.senderName}
            </span>
            <span className="line-clamp-2 text-sm leading-5 text-[var(--cds-text-secondary)]">
              {toast.preview}
            </span>
          </button>
          <button
            className="flex h-6 w-6 items-center justify-center border-0 bg-transparent text-[var(--cds-text-secondary)] hover:bg-[var(--cds-layer-hover-01)] hover:text-[var(--cds-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cds-focus)]"
            type="button"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(toast.id)}
          >
            <Close size={16} />
          </button>
        </article>
      ))}
    </div>
  )
}
