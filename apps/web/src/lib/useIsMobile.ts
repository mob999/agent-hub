import { useSyncExternalStore } from 'react'

const MOBILE_QUERY = '(max-width: 671px)'

function getSnapshot(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  return window.matchMedia(MOBILE_QUERY).matches
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  const mediaQuery = window.matchMedia(MOBILE_QUERY)
  mediaQuery.addEventListener('change', callback)
  return () => mediaQuery.removeEventListener('change', callback)
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot)
}
