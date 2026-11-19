import { useCallback, useEffect, useRef, useState } from 'react'
import { disconnectStrava, getStravaConnection, getStravaUpload, submitStravaUpload, type StravaConnection, type StravaUpload } from '../api'
import { encodeFitSession } from './fitExport'
import { getCompletedOtwSessions, saveOtwSession, type OtwSession } from './sessionStore'

const ATHLETE_KEY = 'nbrctraining.otw.stravaAthleteId'

function cachedAthlete(): string | null {
  try { return window.localStorage.getItem(ATHLETE_KEY) } catch { return null }
}

function cacheAthlete(id: string | null) {
  try {
    if (id) window.localStorage.setItem(ATHLETE_KEY, id)
    else window.localStorage.removeItem(ATHLETE_KEY)
  } catch { return }
}

export function useStrava() {
  const [connection, setConnection] = useState<StravaConnection | null>(null)
  const [athleteId, setAthleteId] = useState<string | null>(cachedAthlete)
  const [message, setMessage] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const busy = useRef(false)

  const updateSession = useCallback(async (session: OtwSession, result: StravaUpload) => {
    const status = result.status === 'sending' ? 'processing' : result.status
    await saveOtwSession({ ...session, stravaStatus: status, stravaError: result.error ?? undefined })
    setRevision((value) => value + 1)
  }, [])

  const sync = useCallback(async () => {
    if (busy.current || !navigator.onLine) return
    busy.current = true
    try {
      const current = await getStravaConnection()
      setConnection(current)
      const id = current.connected ? current.athleteId : null
      setAthleteId(id)
      cacheAthlete(id)
      setMessage(null)
      if (!id) return
      const sessions = await getCompletedOtwSessions()
      for (const session of sessions) {
        if (session.stravaAthleteId !== id || !session.stravaStatus || !['pending', 'processing'].includes(session.stravaStatus)) continue
        try {
          const result = session.stravaStatus === 'pending'
            ? await submitStravaUpload(session.id, id, encodeFitSession(session))
            : await getStravaUpload(session.id)
          await updateSession(session, result)
        } catch (error) {
          setMessage(`Strava sync: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    } catch (error) {
      setMessage(`Strava connection: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      busy.current = false
    }
  }, [updateSession])

  const upload = useCallback(async (session: OtwSession) => {
    if (busy.current || !athleteId) return
    if (session.stravaAthleteId && session.stravaAthleteId !== athleteId) {
      setMessage('This session is queued for a different Strava account.')
      return
    }
    busy.current = true
    try {
      const queued: OtwSession = { ...session, stravaAthleteId: athleteId, stravaStatus: 'pending', stravaError: undefined }
      const bytes = encodeFitSession(queued)
      await saveOtwSession(queued)
      setRevision((value) => value + 1)
      const result = await submitStravaUpload(session.id, athleteId, bytes, session.stravaStatus === 'failed')
      await updateSession(queued, result)
      setMessage(null)
    } catch (error) {
      setMessage(`Strava upload: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      busy.current = false
    }
  }, [athleteId, updateSession])

  const disconnect = useCallback(async () => {
    try {
      await disconnectStrava()
      cacheAthlete(null)
      setAthleteId(null)
      setConnection({ connected: false })
      setMessage(null)
    } catch (error) {
      setMessage(`Strava disconnect: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void sync() })
    const onOnline = () => { void sync() }
    window.addEventListener('online', onOnline)
    const timer = window.setInterval(() => { void sync() }, 30000)
    return () => {
      active = false
      window.removeEventListener('online', onOnline)
      window.clearInterval(timer)
    }
  }, [sync])

  return { connection, athleteId, message, revision, sync, upload, disconnect }
}