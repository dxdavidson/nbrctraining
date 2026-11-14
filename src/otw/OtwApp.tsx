import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchOtwWorkouts, type OtwWorkout } from '../api'
import { formatElapsed, formatPacePer500m, GpsAccumulator, type GpsMetrics } from './gps'
import { downloadFitSession } from './fitExport'
import {
  advanceInterval,
  buildOtwSegments,
  intervalRemaining,
  type IntervalProgress,
  type OtwSegment,
} from './intervalEngine'
import {
  createOtwSession,
  appendOtwRecord,
  deleteOtwSession,
  deleteCompletedOtwSessions,
  getCachedOtwWorkouts,
  getCompletedOtwSessions,
  saveOtwSession,
  saveOtwWorkouts,
  type CachedOtwWorkout,
  type OtwLap,
  type OtwRecord,
  type OtwSession,
} from './sessionStore'
import { StrokeRateTracker } from './strokeRate'
import { useScreenAwake } from './useScreenAwake'

type AppMode = 'just-row' | 'workout' | 'race'

const MODE_LABELS: Record<AppMode, string> = { 'just-row': 'Just Row', workout: 'Workout', race: 'Race' }
type SessionStatus = 'idle' | 'running' | 'paused' | 'completed'
type RemoteAction = 'toggle' | 'stop' | 'reset' | 'stroke'
type RemoteMap = Record<RemoteAction, string>
type OtwPanel = 'workout' | 'history' | 'settings' | 'remote' | null

const REMOTE_MAP_STORAGE_KEY = 'nbrctraining.otw.remoteMap'
const STROKE_SETTINGS_STORAGE_KEY = 'nbrctraining.otw.strokeSettings'
const DEFAULT_REMOTE_MAP: RemoteMap = {
  toggle: 'Space',
  stop: 'Escape',
  reset: 'KeyR',
  stroke: 'Enter',
}
const ACTION_LABELS: Record<RemoteAction, string> = {
  toggle: 'Start / Pause',
  stop: 'Stop',
  reset: 'Reset',
  stroke: 'Stroke',
}
const INITIAL_INTERVAL_PROGRESS: IntervalProgress = {
  index: 0,
  segmentStartedAt: 0,
  segmentStartDistance: 0,
  finished: false,
  changed: false,
}
const DEFAULT_STROKE_SETTINGS: StrokeSettings = {
  timeoutSeconds: 3,
  sampleSize: 5,
  slowestExpectedSpm: 18,
}

interface StrokeSettings {
  timeoutSeconds: number
  sampleSize: number
  slowestExpectedSpm: number
}

function loadRemoteMap(): RemoteMap {
  try {
    const saved = window.localStorage.getItem(REMOTE_MAP_STORAGE_KEY)
    if (!saved) return DEFAULT_REMOTE_MAP
    const parsed: unknown = JSON.parse(saved)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      ['toggle', 'stop', 'reset', 'stroke'].every((key) => typeof (parsed as Record<string, unknown>)[key] === 'string')
    ) {
      return parsed as RemoteMap
    }
  } catch (error) {
    console.error('Unable to read the saved OTW remote map.', error)
  }
  return DEFAULT_REMOTE_MAP
}

function loadStrokeSettings(): StrokeSettings {
  try {
    const saved = window.localStorage.getItem(STROKE_SETTINGS_STORAGE_KEY)
    if (!saved) return DEFAULT_STROKE_SETTINGS
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STROKE_SETTINGS
    const values = parsed as Record<string, unknown>
    const validTimeout = typeof values.timeoutSeconds === 'number' &&
      Number.isInteger(values.timeoutSeconds) &&
      values.timeoutSeconds >= 2 &&
      values.timeoutSeconds <= 10
    const validSampleSize = [4, 5, 6].includes(Number(values.sampleSize))
    const validSlowestRate = [16, 17, 18, 19, 20, 21, 22].includes(Number(values.slowestExpectedSpm))
    if (validTimeout && validSampleSize && validSlowestRate) {
      return {
        timeoutSeconds: Number(values.timeoutSeconds),
        sampleSize: Number(values.sampleSize),
        slowestExpectedSpm: Number(values.slowestExpectedSpm),
      }
    }
    console.error('Ignoring invalid saved OTW stroke settings.')
  } catch (error) {
    console.error('Unable to read saved OTW stroke settings.', error)
  }
  return DEFAULT_STROKE_SETTINGS
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatDistance(distanceMeters: number): string {
  return String(Math.round(distanceMeters))
}

function formatElapsedClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}

function formatIntervalRemaining(segment: OtwSegment, remaining: number): string {
  if (segment.measure === 'distance') return `${Math.ceil(remaining)} m`
  const total = Math.max(0, Math.ceil(remaining))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable ||
    target.matches('input, textarea, select, [role="textbox"]')
  )
}

function toCachedWorkout(workout: OtwWorkout): CachedOtwWorkout {
  return {
    id: workout.id,
    workout_code: workout.workout_code,
    description: workout.description,
    plan_title: workout.plan_title,
    block_title: workout.block_title,
    intervals: workout.intervals,
  }
}

export default function OtwApp() {
  const [mode, setMode] = useState<AppMode>('just-row')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [gpsMetrics, setGpsMetrics] = useState<GpsMetrics>({ distanceMeters: 0, speedMps: null })
  const [cadence, setCadence] = useState<number | null>(null)
  const [session, setSession] = useState<OtwSession | null>(null)
  const [workouts, setWorkouts] = useState<CachedOtwWorkout[]>([])
  const [history, setHistory] = useState<OtwSession[]>([])
  const [selectedWorkoutId, setSelectedWorkoutId] = useState('')
  const [catalogueMessage, setCatalogueMessage] = useState('Loading OTW workouts…')
  const [catalogueError, setCatalogueError] = useState<string | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [intervalError, setIntervalError] = useState<string | null>(null)
  const [learningAction, setLearningAction] = useState<RemoteAction | null>(null)
  const [remoteMap, setRemoteMap] = useState<RemoteMap>(loadRemoteMap)
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>(loadStrokeSettings)
  const [progress, setProgress] = useState(INITIAL_INTERVAL_PROGRESS)
  const [activeSegments, setActiveSegments] = useState<OtwSegment[]>([])
  const [audioWarning, setAudioWarning] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [activePanel, setActivePanel] = useState<OtwPanel>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

  const statusRef = useRef<SessionStatus>('idle')
  const elapsedBeforeRunRef = useRef(0)
  const runStartedAtRef = useRef(0)
  const sessionRef = useRef<OtwSession | null>(null)
  const recordsRef = useRef<OtwRecord[]>([])
  const storageWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const gpsRef = useRef(new GpsAccumulator())
  const gpsMetricsRef = useRef<GpsMetrics>({ distanceMeters: 0, speedMps: null })
  const positionRef = useRef<{ latitude: number; longitude: number } | null>(null)
  const lastGpsAtRef = useRef<number | null>(null)
  const strokeTrackerRef = useRef<StrokeRateTracker | null>(null)
  const progressRef = useRef<IntervalProgress>(INITIAL_INTERVAL_PROGRESS)
  const segmentsRef = useRef<OtwSegment[]>([])
  const lapStartedAtRef = useRef(0)
  const lapStartDistanceRef = useRef(0)
  const resetHoldRef = useRef<number | null>(null)
  const resetTriggeredRef = useRef(false)
  const actionDebounceRef = useRef<Partial<Record<RemoteAction, number>>>({})
  const audioContextRef = useRef<AudioContext | null>(null)
  const cachedWorkoutsRef = useRef(false)
  const startInProgressRef = useRef(false)
  const cadenceRef = useRef<number | null>(null)

  const selectedWorkout = workouts.find((workout) => workout.id === selectedWorkoutId) ?? null
  const gpsUnsupported = !navigator.geolocation
  const selectedSegments = useMemo(() => {
    if (!selectedWorkout) return { segments: [] as OtwSegment[], error: null as string | null }
    try {
      return { segments: buildOtwSegments(selectedWorkout.intervals), error: null }
    } catch (error) {
      return { segments: [] as OtwSegment[], error: errorMessage(error) }
    }
  }, [selectedWorkout])
  const wakeStatus = useScreenAwake(true)

  const setSessionStatus = useCallback((nextStatus: SessionStatus) => {
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const saveRemoteMap = useCallback((nextMap: RemoteMap) => {
    setRemoteMap(nextMap)
    try {
      window.localStorage.setItem(REMOTE_MAP_STORAGE_KEY, JSON.stringify(nextMap))
      setSettingsError(null)
    } catch (error) {
      setSettingsError(`Remote settings could not be saved: ${errorMessage(error)}`)
    }
  }, [])

  const saveStrokeSettings = useCallback((nextSettings: StrokeSettings) => {
    strokeTrackerRef.current?.reset()
    setStrokeSettings(nextSettings)
    try {
      window.localStorage.setItem(STROKE_SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings))
      setSettingsError(null)
    } catch (error) {
      setSettingsError(`Stroke settings could not be saved: ${errorMessage(error)}`)
    }
  }, [])

  const elapsedNow = useCallback(() => {
    return statusRef.current === 'running'
      ? elapsedBeforeRunRef.current + (Date.now() - runStartedAtRef.current) / 1000
      : elapsedBeforeRunRef.current
  }, [])

  const queueStorageWrite = useCallback((write: () => Promise<void>) => {
    storageWriteQueueRef.current = storageWriteQueueRef.current
      .then(write)
      .catch((error: unknown) => setStorageError(errorMessage(error)))
  }, [])

  const persistSession = useCallback((updated: OtwSession) => {
    const metadata = { ...updated, records: [] }
    sessionRef.current = metadata
    setSession(metadata)
    queueStorageWrite(() => saveOtwSession(metadata))
  }, [queueStorageWrite])

  const closeLap = useCallback((label: string, endElapsed: number, endDistance: number) => {
    const current = sessionRef.current
    if (!current) return
    const lap: OtwLap = {
      label,
      startElapsedSeconds: lapStartedAtRef.current,
      endElapsedSeconds: endElapsed,
      startDistanceMeters: lapStartDistanceRef.current,
      endDistanceMeters: endDistance,
    }
    persistSession({
      ...current,
      elapsedSeconds: endElapsed,
      laps: [...current.laps, lap],
    })
    lapStartedAtRef.current = endElapsed
    lapStartDistanceRef.current = endDistance
  }, [persistSession])

  const finishSession = useCallback(async (finishedByEngine = false) => {
    const current = sessionRef.current
    if (!current || (statusRef.current !== 'running' && statusRef.current !== 'paused')) return

    const elapsed = elapsedNow()
    const distance = gpsMetricsRef.current.distanceMeters
    let laps = current.laps
    if (current.mode !== 'workout' && laps.length === 0) {
      laps = [{
        label: 'Just Row',
        startElapsedSeconds: 0,
        endElapsedSeconds: elapsed,
        startDistanceMeters: 0,
        endDistanceMeters: distance,
      }]
    } else if (current.mode === 'workout' && !finishedByEngine && progressRef.current.index < segmentsRef.current.length) {
      const segment = segmentsRef.current[progressRef.current.index]
      laps = [...laps, {
        label: segment.label,
        startElapsedSeconds: lapStartedAtRef.current,
        endElapsedSeconds: elapsed,
        startDistanceMeters: lapStartDistanceRef.current,
        endDistanceMeters: distance,
      }]
    }

    const completed: OtwSession = {
      ...current,
      endedAt: new Date().toISOString(),
      elapsedSeconds: elapsed,
      records: recordsRef.current,
      laps,
    }
    elapsedBeforeRunRef.current = elapsed
    setElapsedSeconds(elapsed)
    lastGpsAtRef.current = null
    gpsMetricsRef.current = { ...gpsMetricsRef.current, speedMps: null }
    setGpsMetrics(gpsMetricsRef.current)
    positionRef.current = null
    setSessionStatus('completed')
    sessionRef.current = completed
    setSession(completed)
    queueStorageWrite(() => saveOtwSession(completed))
    await storageWriteQueueRef.current
  }, [elapsedNow, queueStorageWrite, setSessionStatus])

  const resetSession = useCallback(async () => {
    const current = sessionRef.current
    if (current && !current.endedAt) {
      const previousStatus = statusRef.current
      if (previousStatus === 'running') {
        elapsedBeforeRunRef.current = elapsedNow()
        setSessionStatus('paused')
      }
      await storageWriteQueueRef.current
      try {
        await deleteOtwSession(current.id)
      } catch (error) {
        setStorageError(errorMessage(error))
        if (previousStatus === 'running') {
          runStartedAtRef.current = Date.now()
          setSessionStatus('running')
        }
        return
      }
    }

    sessionRef.current = null
    recordsRef.current = []
    setSession(null)
    setSessionStatus('idle')
    elapsedBeforeRunRef.current = 0
    setElapsedSeconds(0)
    gpsRef.current.reset()
    lastGpsAtRef.current = null
    gpsMetricsRef.current = { distanceMeters: 0, speedMps: null }
    setGpsMetrics(gpsMetricsRef.current)
    positionRef.current = null
    setGpsError(null)
    setCadence(null)
    strokeTrackerRef.current?.reset()
    progressRef.current = INITIAL_INTERVAL_PROGRESS
    setProgress(INITIAL_INTERVAL_PROGRESS)
    segmentsRef.current = []
    setActiveSegments([])
    lapStartedAtRef.current = 0
    lapStartDistanceRef.current = 0
    setStorageError(null)
  }, [elapsedNow, setSessionStatus])

  const askToReset = useCallback(() => {
    if (window.confirm('Reset this OTW session? An unfinished recording will be discarded.')) {
      void resetSession()
    }
  }, [resetSession])

  const startOrResume = useCallback(async () => {
    if (statusRef.current === 'running') return
    if (statusRef.current === 'paused') {
      runStartedAtRef.current = Date.now()
      setSessionStatus('running')
      return
    }

    if (mode === 'workout' && !selectedWorkout) {
      setIntervalError('Choose an OTW workout before starting workout mode.')
      return
    }
    if (mode === 'workout' && selectedSegments.error) {
      setIntervalError(selectedSegments.error)
      return
    }
    if (startInProgressRef.current) return

    const startedAt = Date.now()
    const newSession = createOtwSession(mode)
    if (selectedWorkout && mode === 'workout') {
      newSession.workoutId = selectedWorkout.id
      newSession.workoutName = selectedWorkout.workout_code
    }
    newSession.startedAt = new Date(startedAt).toISOString()
    const initialRecord: OtwRecord = {
      timestamp: startedAt,
      elapsedSeconds: 0,
      latitude: null,
      longitude: null,
      speedMps: null,
      distanceMeters: 0,
      cadence: null,
    }

    startInProgressRef.current = true
    try {
      await storageWriteQueueRef.current
      await Promise.all([
        saveOtwSession(newSession),
        appendOtwRecord(newSession.id, 0, initialRecord),
      ])
    } catch (error) {
      setStorageError(errorMessage(error))
      return
    } finally {
      startInProgressRef.current = false
    }

    setStorageError(null)
    setGpsError(null)
    setIntervalError(null)
    gpsRef.current.reset()
    lastGpsAtRef.current = null
    gpsMetricsRef.current = { distanceMeters: 0, speedMps: null }
    setGpsMetrics(gpsMetricsRef.current)
    positionRef.current = null
    strokeTrackerRef.current?.reset()
    elapsedBeforeRunRef.current = 0
    setElapsedSeconds(0)
    recordsRef.current = [initialRecord]
    sessionRef.current = newSession
    setSession(newSession)
    runStartedAtRef.current = startedAt
    segmentsRef.current = mode === 'workout' ? selectedSegments.segments : []
    setActiveSegments(segmentsRef.current)
    progressRef.current = { ...INITIAL_INTERVAL_PROGRESS }
    setProgress(progressRef.current)
    lapStartedAtRef.current = 0
    lapStartDistanceRef.current = 0
    const AudioContextConstructor = window.AudioContext
    if (!audioContextRef.current && AudioContextConstructor) {
      audioContextRef.current = new AudioContextConstructor()
    }
    setSessionStatus('running')
  }, [mode, selectedSegments, selectedWorkout, setSessionStatus])

  const toggleSession = useCallback(() => {
    if (statusRef.current === 'running') {
      elapsedBeforeRunRef.current = elapsedNow()
      setElapsedSeconds(elapsedBeforeRunRef.current)
      gpsRef.current.markGap()
      lastGpsAtRef.current = null
      gpsMetricsRef.current = { ...gpsMetricsRef.current, speedMps: null }
      setGpsMetrics(gpsMetricsRef.current)
      positionRef.current = null
      setSessionStatus('paused')
    } else {
      void startOrResume()
    }
  }, [elapsedNow, setSessionStatus, startOrResume])

  const stopSession = useCallback(() => {
    void finishSession()
  }, [finishSession])

  const stroke = useCallback(() => {
    if (statusRef.current !== 'running') return
    strokeTrackerRef.current?.tap()
  }, [])

  const playIntervalSignal = useCallback(() => {
    if (navigator.vibrate) navigator.vibrate([120, 70, 120])
    const context = audioContextRef.current
    if (!context) {
      setAudioWarning('Audio beeps are unavailable; vibration may still work.')
      return
    }
    if (context.state === 'suspended') void context.resume().catch(() => setAudioWarning('Audio could not be resumed.'))
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 880
    gain.gain.value = 0.12
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.16)
  }, [])

  useEffect(() => {
    let active = true
    void getCachedOtwWorkouts()
      .then((cached) => {
        if (!active || cached.length === 0) return
        cachedWorkoutsRef.current = true
        setWorkouts(cached)
        setCatalogueMessage('Using OTW workouts cached on this device.')
        setSelectedWorkoutId((current) => current || cached[0].id)
      })
      .catch((error: unknown) => {
        if (active) setCatalogueError(`Unable to read offline workouts: ${errorMessage(error)}`)
      })

    void fetchOtwWorkouts()
      .then(async (loaded) => {
        const cached = loaded.map(toCachedWorkout)
        await saveOtwWorkouts(cached)
        if (!active) return
        cachedWorkoutsRef.current = cached.length > 0
        setWorkouts(cached)
        setCatalogueError(null)
        setCatalogueMessage('OTW workouts updated from the server and saved for offline use.')
        setSelectedWorkoutId((current) => current || cached[0]?.id || '')
      })
      .catch((error: unknown) => {
        if (!active) return
        setCatalogueMessage(cachedWorkoutsRef.current ? 'Offline copy is ready.' : 'No offline OTW workouts are available.')
        if (!cachedWorkoutsRef.current) setCatalogueError(`OTW workouts could not be loaded: ${errorMessage(error)}`)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    cadenceRef.current = cadence
  }, [cadence])

  useEffect(() => {
    const tracker = new StrokeRateTracker({
      sampleSize: strokeSettings.sampleSize,
      timeoutSeconds: strokeSettings.timeoutSeconds,
      onChange: setCadence,
    })
    strokeTrackerRef.current = tracker
    return () => tracker.dispose()
  }, [strokeSettings])

  useEffect(() => {
    if (status !== 'running') return
    const timer = window.setInterval(() => {
      if (statusRef.current !== 'running') return
      const elapsed = elapsedNow()
      setElapsedSeconds(elapsed)
      if (lastGpsAtRef.current !== null && Date.now() - lastGpsAtRef.current > 5000) {
        lastGpsAtRef.current = null
        gpsRef.current.markGap()
        if (gpsMetricsRef.current.speedMps !== null) {
          gpsMetricsRef.current = { ...gpsMetricsRef.current, speedMps: null }
          setGpsMetrics(gpsMetricsRef.current)
        }
        positionRef.current = null
      }

      if (mode !== 'workout' || segmentsRef.current.length === 0) return
      const previous = progressRef.current
      const next = advanceInterval(
        segmentsRef.current,
        previous,
        elapsed,
        gpsMetricsRef.current.distanceMeters,
      )
      if (!next.changed) return

      const oldSegment = segmentsRef.current[previous.index]
      if (oldSegment) {
        closeLap(oldSegment.label, elapsed, gpsMetricsRef.current.distanceMeters)
        playIntervalSignal()
      }
      progressRef.current = next
      setProgress(next)
      if (next.finished) void finishSession(true)
    }, 250)
    return () => window.clearInterval(timer)
  }, [closeLap, elapsedNow, finishSession, mode, playIntervalSignal, status])

  useEffect(() => {
    if (status !== 'running') return
    const timer = window.setInterval(() => {
      if (statusRef.current !== 'running') return
      const current = sessionRef.current
      if (!current) return
      const now = Date.now()
      const elapsed = elapsedNow()
      const gps = gpsMetricsRef.current
      const latestPosition = positionRef.current
      const record: OtwRecord = {
        timestamp: now,
        elapsedSeconds: elapsed,
        latitude: latestPosition?.latitude ?? null,
        longitude: latestPosition?.longitude ?? null,
        speedMps: gps.speedMps,
        distanceMeters: gps.distanceMeters,
        cadence: cadenceRef.current === null ? null : Math.round(cadenceRef.current),
      }
      const sequence = recordsRef.current.length
      recordsRef.current.push(record)
      persistSession({
        ...current,
        elapsedSeconds: elapsed,
      })
      queueStorageWrite(() => appendOtwRecord(current.id, sequence, record))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [elapsedNow, persistSession, queueStorageWrite, status])

  useEffect(() => {
    if (status !== 'running') return
    if (!navigator.geolocation) return

    const watchId = navigator.geolocation.watchPosition(
      (gpsPosition) => {
        const coords = gpsPosition.coords
        const metrics = gpsRef.current.add({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: coords.accuracy,
          speed: coords.speed,
          timestamp: gpsPosition.timestamp,
        }) ?? gpsMetricsRef.current
        gpsMetricsRef.current = metrics
        setGpsMetrics(metrics)
        if (coords.accuracy <= 25) {
          const nextPosition = { latitude: coords.latitude, longitude: coords.longitude }
          lastGpsAtRef.current = Date.now()
          positionRef.current = nextPosition
        }
        setGpsError(null)
      },
      (error) => {
        lastGpsAtRef.current = null
        gpsRef.current.markGap()
        gpsMetricsRef.current = { ...gpsMetricsRef.current, speedMps: null }
        setGpsMetrics(gpsMetricsRef.current)
        positionRef.current = null
        setGpsError(`GPS error: ${error.message}`)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [status])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (learningAction) {
        event.preventDefault()
        const key = event.code || event.key
        const conflictingAction = (Object.keys(remoteMap) as RemoteAction[]).find(
          (action) => action !== learningAction && remoteMap[action] === key,
        )
        if (conflictingAction) {
          setSettingsError(`${key} is already assigned to ${ACTION_LABELS[conflictingAction]}.`)
          setLearningAction(null)
          return
        }
        saveRemoteMap({ ...remoteMap, [learningAction]: key })
        setLearningAction(null)
        return
      }
      if (event.repeat || isEditableTarget(event.target)) return

      const matched = (Object.keys(remoteMap) as RemoteAction[]).find((action) =>
        event.code === remoteMap[action] || event.key === remoteMap[action],
      )
      if (!matched) return
      event.preventDefault()

      if (matched === 'reset') {
        resetTriggeredRef.current = false
        resetHoldRef.current = window.setTimeout(() => {
          resetTriggeredRef.current = true
          void resetSession()
        }, 1200)
        return
      }

      const now = Date.now()
      if (now - (actionDebounceRef.current[matched] ?? 0) < 350) return
      actionDebounceRef.current[matched] = now

      if (matched === 'toggle') toggleSession()
      else if (matched === 'stop') stopSession()
      else stroke()
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== remoteMap.reset && event.key !== remoteMap.reset) return
      if (resetHoldRef.current === null) return
      if (resetHoldRef.current !== null) window.clearTimeout(resetHoldRef.current)
      resetHoldRef.current = null
      if (!resetTriggeredRef.current) askToReset()
      resetTriggeredRef.current = false
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      if (resetHoldRef.current !== null) window.clearTimeout(resetHoldRef.current)
    }
  }, [askToReset, learningAction, remoteMap, resetSession, saveRemoteMap, stopSession, stroke, toggleSession])

  useEffect(() => () => {
    audioContextRef.current?.close()
  }, [])

  const currentSegment = mode === 'workout' ? activeSegments[progress.index] : undefined
  const remaining = currentSegment
    ? intervalRemaining(
        currentSegment,
        progress.segmentStartedAt,
        progress.segmentStartDistance,
        elapsedSeconds,
        gpsMetrics.distanceMeters,
      )
    : null
  const intervalMetricsActive = session?.mode === 'workout' &&
    mode === 'workout' &&
    currentSegment !== undefined &&
    (status === 'running' || status === 'paused')
  const displayedDistance = intervalMetricsActive
    ? Math.max(0, gpsMetrics.distanceMeters - progress.segmentStartDistance)
    : gpsMetrics.distanceMeters
  const displayedElapsed = intervalMetricsActive
    ? Math.max(0, elapsedSeconds - progress.segmentStartedAt)
    : elapsedSeconds
  const averageSpeed = displayedElapsed > 0 ? displayedDistance / displayedElapsed : null
  const wakeMessage = wakeStatus === 'unavailable'
    ? 'Keep this screen visible; screen-on support is unavailable.'
    : wakeStatus === 'video-fallback'
      ? 'Screen-on video fallback active.'
      : null
  const timeoutWarningThreshold = (60 / strokeSettings.slowestExpectedSpm) * 1.5
  const timeoutWarning = strokeSettings.timeoutSeconds < timeoutWarningThreshold
  const canStart = status === 'idle' || status === 'completed'
  const primaryLabel = status === 'running'
    ? 'Pause'
    : status === 'paused'
      ? 'Resume'
      : 'Start'

  const openPanel = (panel: Exclude<OtwPanel, null>) => {
    setMenuOpen(false)
    setActivePanel(panel)
    if (panel === 'workout') setMode('workout')
    if (panel === 'history') {
      setHistoryLoading(true)
      setHistoryError(null)
      void getCompletedOtwSessions()
        .then(setHistory)
        .catch((error: unknown) => setHistoryError(errorMessage(error)))
        .finally(() => setHistoryLoading(false))
    }
  }

  const deleteHistorySession = (id: string) => {
    if (!window.confirm('Delete this session from this phone?')) return
    setHistoryError(null)
    void deleteOtwSession(id)
      .then(() => setHistory((items) => items.filter((item) => item.id !== id)))
      .catch((error: unknown) => setHistoryError(errorMessage(error)))
  }

  const deleteAllHistory = () => {
    if (!window.confirm('Delete all saved sessions from this phone? This cannot be undone.')) return
    setHistoryError(null)
    void deleteCompletedOtwSessions()
      .then(() => setHistory([]))
      .catch((error: unknown) => setHistoryError(errorMessage(error)))
  }

  return (
    <main className="otw-app">
      <div className="otw-shell">
        <header className="otw-topbar">
          <div className="otw-heading">
            <p>
              {MODE_LABELS[mode]}
              {status === 'running' ? ' · Recording' : status === 'paused' ? ' · Paused' : status === 'completed' ? ' · Complete' : ''}
            </p>
          </div>
          <div className="otw-menu-wrap">
            <button
              className="otw-menu-toggle"
              type="button"
              aria-label="More options"
              aria-expanded={menuOpen}
              aria-controls="otw-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ⋮
            </button>
            {menuOpen && (
              <div className="otw-menu" id="otw-menu">
                <button type="button" disabled={!canStart} aria-pressed={mode === 'just-row'} onClick={() => {
                  setMode('just-row')
                  setMenuOpen(false)
                }}>
                  Just Row
                </button>
                <button type="button" disabled={!canStart} aria-pressed={mode === 'workout'} onClick={() => openPanel('workout')}>
                  Workout
                </button>
                <button type="button" disabled={!canStart} aria-pressed={mode === 'race'} onClick={() => {
                  setMode('race')
                  setMenuOpen(false)
                }}>
                  Race
                </button>
                <button type="button" onClick={() => openPanel('history')}>History</button>
                <button type="button" onClick={() => openPanel('settings')}>Settings</button>
                <button type="button" onClick={() => openPanel('remote')}>Remote controls</button>
              </div>
            )}
          </div>
        </header>

        <section className="otw-metrics" aria-label="Workout metrics">
          <div className="otw-metric">
            <span className="otw-metric-label">Distance (meters)</span>
            <strong className="otw-metric-value">{formatDistance(displayedDistance)}</strong>
          </div>
          <div className="otw-metric">
            <span className="otw-metric-label">Elapsed Time</span>
            <strong className="otw-metric-value">{formatElapsedClock(displayedElapsed)}</strong>
          </div>
          <div className="otw-metric">
            <span className="otw-metric-label">Pace (min / 500 m)</span>
            <strong className="otw-metric-value">{formatPacePer500m(gpsMetrics.speedMps)}</strong>
          </div>
          <div className="otw-metric">
            <span className="otw-metric-label">Avg Pace (min / 500 m)</span>
            <strong className="otw-metric-value">{formatPacePer500m(averageSpeed)}</strong>
          </div>
          <div className="otw-metric">
            <span className="otw-metric-label">Remaining</span>
            <strong className="otw-metric-value">
              {intervalMetricsActive && currentSegment && remaining !== null
                ? formatIntervalRemaining(currentSegment, remaining)
                : '--'}
            </strong>
          </div>
          <button
            className="otw-metric otw-metric-tappable"
            type="button"
            onClick={stroke}
            disabled={status !== 'running'}
            aria-label={`Stroke rate ${cadence === null ? 'unavailable' : `${Math.round(cadence)} strokes per minute`}. Tap to record a catch.`}
          >
            <span className="otw-metric-label">Stroke Rate (SPM)</span>
            <strong className="otw-metric-value">
              {cadence === null ? '--' : Math.round(cadence)}
            </strong>
            <span className="otw-metric-unit">
              {status === 'running' ? 'Tap each catch' : ''}
            </span>
          </button>
        </section>

        <div className="otw-notices" aria-live="polite">
          {gpsUnsupported && status === 'running' && <p>GPS is not supported in this browser.</p>}
          {gpsError && <p>{gpsError}</p>}
          {storageError && <p className="otw-notice-error">Recording storage error: {storageError}</p>}
          {wakeMessage && <p>{wakeMessage}</p>}
          {audioWarning && <p>{audioWarning}</p>}
        </div>

        <section className="otw-controls" aria-label="Session controls">
          <button
            className="otw-button otw-button-primary"
            type="button"
            onClick={status === 'running' ? toggleSession : () => void startOrResume()}
            disabled={mode === 'workout' && canStart && (!selectedWorkout || Boolean(selectedSegments.error))}
          >
            {primaryLabel}
          </button>
          <button className="otw-button" type="button" onClick={stopSession} disabled={status !== 'running' && status !== 'paused'}>
            Stop
          </button>
          <button className="otw-button otw-button-danger" type="button" onClick={askToReset}>
            Reset
          </button>
        </section>

        {activePanel && (
          <div className="otw-dialog-backdrop">
            <section className="otw-dialog" role="dialog" aria-modal="true" aria-labelledby="otw-dialog-title">
              <header className="otw-dialog-header">
                <h2 id="otw-dialog-title">
                  {activePanel === 'workout' ? 'Workout' : activePanel === 'history' ? 'History' : activePanel === 'settings' ? 'Settings' : 'Remote controls'}
                </h2>
                <button className="otw-dialog-close" type="button" aria-label="Close" onClick={() => setActivePanel(null)}>×</button>
              </header>

              {activePanel === 'workout' && (
                <div className="otw-panel-content">
                  <label className="otw-panel-label" htmlFor="otw-workout">Choose an OTW workout</label>
                  <select
                    id="otw-workout"
                    value={selectedWorkoutId}
                    disabled={!canStart}
                    onChange={(event) => {
                      setSelectedWorkoutId(event.target.value)
                      setIntervalError(null)
                    }}
                  >
                    <option value="">Choose a workout…</option>
                    {workouts.map((workout) => (
                      <option key={workout.id} value={workout.id}>
                        {workout.plan_title} · {workout.block_title} · {workout.workout_code}
                      </option>
                    ))}
                  </select>
                  {selectedWorkout?.description && <p className="otw-note">{selectedWorkout.description}</p>}
                  <p className="otw-note">{catalogueMessage}</p>
                  {workouts.length === 0 && !catalogueError && <p className="otw-note">No published OTW workouts are available.</p>}
                  {catalogueError && <p className="otw-message otw-message-error" role="alert">{catalogueError}</p>}
                  {selectedSegments.error && <p className="otw-message otw-message-error" role="alert">{selectedSegments.error}</p>}
                  {intervalError && <p className="otw-message otw-message-error" role="alert">{intervalError}</p>}
                </div>
              )}

              {activePanel === 'history' && (
                <div className="otw-panel-content">
                  {historyLoading && <p className="otw-note">Loading saved sessions…</p>}
                  {historyError && <p className="otw-message otw-message-error" role="alert">{historyError}</p>}
                  {!historyLoading && !historyError && history.length === 0 && <p className="otw-note">No completed sessions yet.</p>}
                  <p className="otw-note">Sessions are saved on this phone only. Export a FIT file when you want to upload one.</p>
                  <ul className="otw-history-list">
                    {history.map((savedSession) => (
                      <li key={savedSession.id}>
                        <div>
                          <strong>{savedSession.workoutName ?? 'Just Row'}</strong>
                          <span>{new Date(savedSession.startedAt).toLocaleString()}</span>
                          <span>{formatElapsed(savedSession.elapsedSeconds)}</span>
                        </div>
                        <div className="otw-history-actions">
                          <button className="otw-panel-button" type="button" onClick={() => downloadFitSession(savedSession)}>
                            Export FIT
                          </button>
                          <button
                            className="otw-panel-button"
                            type="button"
                            aria-label={`Delete session ${new Date(savedSession.startedAt).toLocaleString()}`}
                            onClick={() => deleteHistorySession(savedSession.id)}
                          >
                            <span aria-hidden="true">🗑</span>
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {history.length > 0 && (
                    <button className="otw-panel-button" type="button" onClick={deleteAllHistory}>
                      Delete all history
                    </button>
                  )}
                </div>
              )}

              {activePanel === 'settings' && (
                <div className="otw-panel-content">
                  <label className="otw-panel-label">
                    No-catch timeout
                    <select
                      value={strokeSettings.timeoutSeconds}
                      onChange={(event) => saveStrokeSettings({ ...strokeSettings, timeoutSeconds: Number(event.target.value) })}
                    >
                      {Array.from({ length: 9 }, (_, index) => index + 2).map((seconds) => (
                        <option key={seconds} value={seconds}>{seconds} seconds</option>
                      ))}
                    </select>
                  </label>
                  <label className="otw-panel-label">
                    Average last intervals
                    <select
                      value={strokeSettings.sampleSize}
                      onChange={(event) => saveStrokeSettings({ ...strokeSettings, sampleSize: Number(event.target.value) })}
                    >
                      {[4, 5, 6].map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                  <label className="otw-panel-label">
                    Slowest expected rate
                    <select
                      value={strokeSettings.slowestExpectedSpm}
                      onChange={(event) => saveStrokeSettings({ ...strokeSettings, slowestExpectedSpm: Number(event.target.value) })}
                    >
                      {[16, 17, 18, 19, 20, 21, 22].map((rate) => <option key={rate} value={rate}>{rate} spm</option>)}
                    </select>
                  </label>
                  {timeoutWarning && (
                    <p className="otw-message" role="status">
                      Timeout is shorter than 1.5× the slowest expected catch interval ({timeoutWarningThreshold.toFixed(1)} s).
                    </p>
                  )}
                  {settingsError && <p className="otw-message otw-message-error" role="alert">{settingsError}</p>}
                  <p className="otw-note">Stroke rate averages recent catch intervals and rejects outliers.</p>
                </div>
              )}

              {activePanel === 'remote' && (
                <div className="otw-panel-content">
                  <p className="otw-note">Pair a Bluetooth keyboard or media remote, then learn its buttons.</p>
                  <div className="otw-remote-actions">
                    {(Object.keys(ACTION_LABELS) as RemoteAction[]).map((action) => (
                      <button
                        key={action}
                        type="button"
                        aria-pressed={learningAction === action}
                        onClick={() => setLearningAction(action)}
                      >
                        {learningAction === action ? `Press ${ACTION_LABELS[action]} key…` : `Learn ${ACTION_LABELS[action]} · ${remoteMap[action]}`}
                      </button>
                    ))}
                    <button type="button" onClick={() => saveRemoteMap(DEFAULT_REMOTE_MAP)}>Restore defaults</button>
                  </div>
                  {learningAction && <p className="otw-note">Press the remote key for {ACTION_LABELS[learningAction]}.</p>}
                  {settingsError && <p className="otw-message otw-message-error" role="alert">{settingsError}</p>}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  )
}
