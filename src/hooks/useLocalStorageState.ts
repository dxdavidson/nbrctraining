import { useCallback, useSyncExternalStore } from 'react'

type Listener = () => void

const listenersByKey = new Map<string, Set<Listener>>()
// Caches the parsed value per key, keyed off the raw string, so getSnapshot
// returns a stable reference until the underlying localStorage value actually changes.
const parsedCache = new Map<string, { raw: string | null; value: unknown }>()

function notify(key: string) {
  listenersByKey.get(key)?.forEach((listener) => listener())
}

function readValue<T>(key: string, defaultValue: T): T {
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return defaultValue
  }

  const cached = parsedCache.get(key)
  if (cached && cached.raw === raw) return cached.value as T

  let value: T
  try {
    value = raw != null ? (JSON.parse(raw) as T) : defaultValue
  } catch {
    value = defaultValue
  }
  parsedCache.set(key, { raw, value })
  return value
}

/**
 * Persists a JSON-serializable value in localStorage, shared reactively across
 * every component using the same key (so a write in one place updates all others).
 */
export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const subscribe = useCallback(
    (callback: Listener) => {
      let set = listenersByKey.get(key)
      if (!set) {
        set = new Set()
        listenersByKey.set(key, set)
      }
      set.add(callback)

      const onStorage = (event: StorageEvent) => {
        if (event.key === key) callback()
      }
      window.addEventListener('storage', onStorage)

      return () => {
        set!.delete(callback)
        window.removeEventListener('storage', onStorage)
      }
    },
    [key]
  )

  const getSnapshot = useCallback(() => readValue(key, defaultValue), [key, defaultValue])
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const setValue = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // localStorage may be unavailable (e.g. private browsing quota) — fail silently
      }
      notify(key)
    },
    [key]
  )

  return [value, setValue] as const
}
