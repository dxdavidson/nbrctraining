import { useCallback, useSyncExternalStore } from 'react'

export interface Selection {
  planId: string | null
  blockId: string | null
  workoutId: string | null
}

const PARAM_NAMES = ['planId', 'blockId', 'workoutId'] as const

let cachedSearch: string | null = null
let cachedSelection: Selection = { planId: null, blockId: null, workoutId: null }

function readSelection(): Selection {
  const search = window.location.search
  if (search === cachedSearch) return cachedSelection

  const params = new URLSearchParams(search)
  cachedSearch = search
  cachedSelection = {
    planId: params.get('planId'),
    blockId: params.get('blockId'),
    workoutId: params.get('workoutId'),
  }
  return cachedSelection
}

function subscribe(callback: () => void) {
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

/**
 * Keeps the Plan/Block/Workout drill-down selection in the URL's query
 * string so refreshes and deep links restore the same view, without
 * pulling in a routing library.
 */
export function useUrlSelection() {
  const selection = useSyncExternalStore(subscribe, readSelection, readSelection)

  const setSelection = useCallback((next: Partial<Selection>) => {
    const params = new URLSearchParams(window.location.search)
    const merged = { ...readSelection(), ...next }

    for (const name of PARAM_NAMES) {
      const value = merged[name]
      if (value) {
        params.set(name, value)
      } else {
        params.delete(name)
      }
    }

    const query = params.toString()
    const url = `${window.location.pathname}${query ? `?${query}` : ''}`
    window.history.pushState(null, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  return [selection, setSelection] as const
}
