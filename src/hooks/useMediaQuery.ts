import { useSyncExternalStore } from 'react'

/**
 * Tracks a CSS media query, used to switch between the phone-style
 * drill-down layout and the wider master-detail layout.
 */
export function useMediaQuery(query: string): boolean {
  const getSnapshot = () => window.matchMedia(query).matches
  const subscribe = (callback: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener('change', callback)
    return () => mql.removeEventListener('change', callback)
  }

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
