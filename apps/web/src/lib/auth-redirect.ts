const authRedirectStorageKey = 'agenthub.auth.redirect'
const authRedirectMaxAgeMs = 10 * 60 * 1000

interface StoredAuthRedirect {
  createdAt: number
  path: string
  version: 1
}

function isAllowedAuthRedirectPath(path: string): boolean {
  const segments = path.split('/').filter(Boolean)
  const isChatConversationRoute = path.startsWith('/chat/') &&
    (
      [2, 4, 6].includes(segments.length) ||
      (
        segments.length === 3 &&
        ['tasks', 'deployments'].includes(segments[2] ?? '')
      )
    )
  const isEditorRoute = path.startsWith('/editor/') &&
    [2, 3].includes(segments.length)

  return (
    path === '/welcome' ||
    path === '/chat' ||
    isChatConversationRoute ||
    path === '/runs' ||
    path === '/daemon' ||
    isEditorRoute
  )
}

export function readPendingAuthRedirect(): string | null {
  const value = window.sessionStorage.getItem(authRedirectStorageKey)
  window.sessionStorage.removeItem(authRedirectStorageKey)

  if (!value) {
    return null
  }

  try {
    const payload = JSON.parse(value) as Partial<StoredAuthRedirect>
    if (
      payload.version !== 1 ||
      typeof payload.path !== 'string' ||
      typeof payload.createdAt !== 'number' ||
      Date.now() - payload.createdAt > authRedirectMaxAgeMs ||
      !isAllowedAuthRedirectPath(payload.path)
    ) {
      return null
    }

    return payload.path
  } catch {
    return null
  }
}

export function writePendingAuthRedirect(path: string) {
  if (!isAllowedAuthRedirectPath(path)) {
    window.sessionStorage.removeItem(authRedirectStorageKey)
    return
  }

  const payload: StoredAuthRedirect = {
    createdAt: Date.now(),
    path,
    version: 1,
  }
  window.sessionStorage.setItem(authRedirectStorageKey, JSON.stringify(payload))
}
