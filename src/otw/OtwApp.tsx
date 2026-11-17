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

const MODE_LABELS: Record<AppMode, string> = { 'just-row': 'Just Row', workout: 'Intervals', race: 'Race' }
type SessionStatus = 'idle' | 'running' | 'paused' | 'completed'
type RemoteAction = 'buttonA' | 'buttonB' | 'up' | 'down' | 'left' | 'right'
type RemoteMap = Record<RemoteAction, string>
type OtwPanel = 'workout' | 'summary' | 'history' | 'settings' | 'remote' | null
type WorkoutCategory = 'Distance' | 'Time' | 'Mixed' | 'None' | 'Invalid'

const REMOTE_MAP_STORAGE_KEY = 'nbrctraining.otw.remoteMap'
const STROKE_SETTINGS_STORAGE_KEY = 'nbrctraining.otw.strokeSettings'
const RACE_DISTANCE_STORAGE_KEY = 'nbrctraining.otw.raceDistance'
const DEFAULT_REMOTE_MAP: RemoteMap = {
  buttonA: 'Space',
  buttonB: 'Escape',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
}
const ACTION_LABELS: Record<RemoteAction, string> = {
  buttonA: 'Button A',
  buttonB: 'Button B',
  up: 'D-pad Up',
  down: 'D-pad Down',
  left: 'D-pad Left',
  right: 'D-pad Right',
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

function validRaceDistance(value: string): boolean {
  const distance = Number(value)
  return value.trim() !== '' && Number.isFinite(distance) && distance > 0 && distance <= Number.MAX_SAFE_INTEGER
}

function loadRaceDistance(): { value: string; error: string | null } {
  try {
    const saved = window.localStorage.getItem(RACE_DISTANCE_STORAGE_KEY)
    if (saved === null) return { value: '', error: null }
    if (validRaceDistance(saved)) return { value: saved, error: null }
    return { value: '', error: 'The saved race distance is invalid. Enter a new distance.' }
  } catch (error) {
    return { value: '', error: `Race distance could not be loaded: ${errorMessage(error)}` }
  }
}

function loadRemoteMap(): RemoteMap {
  try {
    const saved = window.localStorage.getItem(REMOTE_MAP_STORAGE_KEY)
    if (!saved) return DEFAULT_REMOTE_MAP
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed === 'object' && parsed !== null) {
      const values = parsed as Record<string, unknown>
      if (
        typeof values.buttonA === 'string' && typeof values.buttonB === 'string' &&
        typeof values.up === 'string' && typeof values.down === 'string' &&
        typeof values.left === 'string' && typeof values.right === 'string'
      ) {
        const map = { buttonA: values.buttonA, buttonB: values.buttonB, up: values.up, down: values.down, left: values.left, right: values.right }
        const assigned = Object.values(map).filter(Boolean)
        if (new Set(assigned).size === assigned.length) return map
      }
      if (
        typeof values.toggle === 'string' && typeof values.stop === 'string' &&
        typeof values.reset === 'string' && typeof values.stroke === 'string'
      ) {
        const used = new Set<string>()
        const assign = (key: string) => {
          if (!key || used.has(key)) return ''
          used.add(key)
          return key
        }
        return {
          buttonA: assign(values.toggle),
          buttonB: assign(values.stop),
          up: assign(values.stroke),
          down: assign(DEFAULT_REMOTE_MAP.down),
          left: assign(DEFAULT_REMOTE_MAP.left),
          right: assign(DEFAULT_REMOTE_MAP.right),
        }
      }
    }
    console.error('Ignoring invalid saved OTW remote map.')
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
    block_code: workout.block_code,
    intervals: workout.intervals,
  }
}

function workoutCategory(workout: CachedOtwWorkout): WorkoutCategory {
  const kinds = new Set(workout.intervals.map((interval) => interval.work_kind))
  if (kinds.size === 0) return 'None'
  if ([...kinds].some((kind) => kind !== 'distance' && kind !== 'time')) return 'Invalid'
  if (kinds.size === 2) return 'Mixed'
  return kinds.has('distance') ? 'Distance' : 'Time'
}

function AveragePace({ speedMps, distance, segmentStartedAt, elapsedNow, running }: {
  speedMps: number | null
  distance: number
  segmentStartedAt: number
  elapsedNow: () => number
  running: boolean
}) {
  const [displayedSpeed, setDisplayedSpeed] = useState(speedMps)
  const distanceRef = useRef(distance)

  useEffect(() => {
    distanceRef.current = distance
  }, [distance])

  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => {
      const elapsed = elapsedNow() - segmentStartedAt
      setDisplayedSpeed(elapsed > 0 ? distanceRef.current / elapsed : null)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [elapsedNow, running, segmentStartedAt])

  return <strong className="otw-metric-value">{formatPacePer500m(displayedSpeed)}</strong>
}

export default function OtwApp() {
  const [mode, setMode] = useState<AppMode>('just-row')
  const [status, setStatus] = useState<SessionStatus>('idle')
  const [starting, setStarting] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [gpsMetrics, setGpsMetrics] = useState<GpsMetrics>({ distanceMeters: 0, speedMps: null })
  const [cadence, setCadence] = useState<number | null>(null)
  const [session, setSession] = useState<OtwSession | null>(null)
  const [workouts, setWorkouts] = useState<CachedOtwWorkout[]>([])
  const [workoutFilter, setWorkoutFilter] = useState<'All' | WorkoutCategory>('All')
  const [history, setHistory] = useState<OtwSession[]>([])
  const [workoutSummary, setWorkoutSummary] = useState<OtwLap[]>([])
  const [summaryIntervalCount, setSummaryIntervalCount] = useState(0)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState('')
  const [pendingWorkoutId, setPendingWorkoutId] = useState('')
  const [catalogueMessage, setCatalogueMessage] = useState('Loading OTW workouts…')
  const [catalogueError, setCatalogueError] = useState<string | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [intervalError, setIntervalError] = useState<string | null>(null)
  const [learningAction, setLearningAction] = useState<RemoteAction | null>(null)
  const [remoteMap, setRemoteMap] = useState<RemoteMap>(loadRemoteMap)
  const [strokeSettings, setStrokeSettings] = useState<StrokeSettings>(loadStrokeSettings)
  const [savedRaceDistance, setSavedRaceDistance] = useState(loadRaceDistance)
  const [raceDistance, setRaceDistance] = useState(savedRaceDistance.value)
  const [raceStartDistance, setRaceStartDistance] = useState<number | null>(null)
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
  const remoteControlPressRef = useRef<{ action: RemoteAction; startedAt: number; startedRevision: number; startedWhileStarting: boolean } | null>(null)
  const statusRevisionRef = useRef(0)
  const blockedRemoteControlsRef = useRef(new Set<RemoteAction>())
  const pressedDirectionsRef = useRef(new Set<RemoteAction>())
  const lastStrokeAtRef = useRef(Number.NEGATIVE_INFINITY)
  const lastControlAtRef = useRef(Number.NEGATIVE_INFINITY)
  const audioContextRef = useRef<AudioContext | null>(null)
  const cachedWorkoutsRef = useRef(false)
  const startInProgressRef = useRef(false)
  const cadenceRef = useRef<number | null>(null)

  const selectedWorkout = workouts.find((workout) => workout.id === selectedWorkoutId) ?? null
  const pendingWorkout = workouts.find((workout) => workout.id === pendingWorkoutId) ?? null
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
    if (statusRef.current !== nextStatus) statusRevisionRef.current += 1
    statusRef.current = nextStatus
    setStatus(nextStatus)
  }, [])

  const saveRaceDistance = useCallback((value: string) => {
    try {
      window.localStorage.setItem(RACE_DISTANCE_STORAGE_KEY, value)
      setSavedRaceDistance({ value, error: null })
    } catch (error) {
      setSavedRaceDistance({ value, error: `Race distance could not be saved: ${errorMessage(error)}` })
    }
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
    let current = sessionRef.current
    const wasRunning = statusRef.current === 'running'
    if (!current || (finishedByEngine ? !wasRunning : statusRef.current !== 'paused')) return

    const elapsed = elapsedNow()
    const now = Date.now()
    const distance = gpsMetricsRef.current.distanceMeters
    if (current.mode === 'workout' && !finishedByEngine) {
      const previous = progressRef.current
      const next = advanceInterval(segmentsRef.current, previous, elapsed, distance)
      if (next.changed) {
        closeLap(segmentsRef.current[previous.index].label, elapsed, distance)
        progressRef.current = next
        setProgress(next)
        current = sessionRef.current
        if (!current) return
      }
    }
    if (current.mode === 'workout') {
      setWorkoutSummary(current.laps.filter((_, index) => segmentsRef.current[index]?.kind === 'work'))
      setSummaryIntervalCount(segmentsRef.current.filter((segment) => segment.kind === 'work').length)
      setMenuOpen(false)
      setActivePanel('summary')
    }
    let laps = current.laps
    if (current.mode !== 'workout' && laps.length === 0) {
      laps = [{
        label: MODE_LABELS[current.mode],
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

    const finalRecord: OtwRecord = {
      timestamp: now,
      elapsedSeconds: elapsed,
      latitude: positionRef.current?.latitude ?? null,
      longitude: positionRef.current?.longitude ?? null,
      speedMps: gpsMetricsRef.current.speedMps,
      distanceMeters: distance,
      cadence: cadenceRef.current === null ? null : Math.round(cadenceRef.current),
    }
    const records = [...recordsRef.current]
    const lastRecord = records.at(-1)
    const sequence = lastRecord && !lastRecord.timerEvent && Math.floor(lastRecord.timestamp / 1000) === Math.floor(now / 1000)
      ? records.length - 1
      : records.length
    if (wasRunning) records[sequence] = finalRecord
    recordsRef.current = records

    const completed: OtwSession = {
      ...current,
      endedAt: new Date(now).toISOString(),
      elapsedSeconds: elapsed,
      records,
      laps,
    }
    if (current.mode === 'race' && raceStartDistance !== null) {
      const value = String(raceStartDistance)
      saveRaceDistance(value)
      setRaceDistance(value)
    }
    elapsedBeforeRunRef.current = elapsed
    setElapsedSeconds(elapsed)
    lastGpsAtRef.current = null
    positionRef.current = null
    strokeTrackerRef.current?.dispose()
    setSessionStatus('completed')
    sessionRef.current = completed
    setSession(completed)
    if (wasRunning) queueStorageWrite(() => appendOtwRecord(current.id, sequence, finalRecord))
    queueStorageWrite(() => saveOtwSession(completed))
    await storageWriteQueueRef.current
  }, [closeLap, elapsedNow, queueStorageWrite, raceStartDistance, saveRaceDistance, setSessionStatus])

  const clearSessionDisplay = useCallback(() => {
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
    setRaceStartDistance(null)
  }, [setSessionStatus])

  const startSession = useCallback(async () => {
    if (statusRef.current !== 'idle' && statusRef.current !== 'completed') return

    if (mode === 'workout' && !selectedWorkout) {
      setIntervalError('Choose an OTW workout before starting Intervals mode.')
      return
    }
    if (mode === 'workout' && selectedSegments.error) {
      setIntervalError(selectedSegments.error)
      return
    }
    if (mode === 'race' && !validRaceDistance(raceDistance)) return
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
    setStarting(true)
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
      setStarting(false)
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
    setRaceStartDistance(mode === 'race' ? Number(raceDistance) : null)
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
  }, [mode, raceDistance, selectedSegments, selectedWorkout, setSessionStatus])

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

  const pauseSession = useCallback(() => {
    const current = sessionRef.current
    if (statusRef.current !== 'running' || !current) return
    const elapsed = elapsedNow()
    const distance = gpsMetricsRef.current.distanceMeters
    if (current.mode === 'workout') {
      const previous = progressRef.current
      const next = advanceInterval(segmentsRef.current, previous, elapsed, distance)
      if (next.changed) {
        closeLap(segmentsRef.current[previous.index].label, elapsed, distance)
        playIntervalSignal()
        progressRef.current = next
        setProgress(next)
        if (next.finished) {
          void finishSession(true)
          return
        }
      }
    }
    const record: OtwRecord = {
      timestamp: Date.now(),
      elapsedSeconds: elapsed,
      latitude: positionRef.current?.latitude ?? null,
      longitude: positionRef.current?.longitude ?? null,
      speedMps: gpsMetricsRef.current.speedMps,
      distanceMeters: distance,
      cadence: cadenceRef.current === null ? null : Math.round(cadenceRef.current),
      timerEvent: 'pause',
    }
    const sequence = recordsRef.current.length
    recordsRef.current.push(record)
    elapsedBeforeRunRef.current = elapsed
    setElapsedSeconds(elapsed)
    setSessionStatus('paused')
    gpsRef.current.markGap()
    lastGpsAtRef.current = null
    positionRef.current = null
    strokeTrackerRef.current?.dispose()
    persistSession({ ...sessionRef.current!, elapsedSeconds: elapsed })
    queueStorageWrite(() => appendOtwRecord(current.id, sequence, record))
  }, [closeLap, elapsedNow, finishSession, persistSession, playIntervalSignal, queueStorageWrite, setSessionStatus])

  const resumeSession = useCallback(() => {
    const current = sessionRef.current
    if (statusRef.current !== 'paused' || !current) return
    const now = Date.now()
    const record: OtwRecord = {
      timestamp: now,
      elapsedSeconds: elapsedBeforeRunRef.current,
      latitude: null,
      longitude: null,
      speedMps: null,
      distanceMeters: gpsMetricsRef.current.distanceMeters,
      cadence: null,
      timerEvent: 'resume',
    }
    const sequence = recordsRef.current.length
    recordsRef.current.push(record)
    queueStorageWrite(() => appendOtwRecord(current.id, sequence, record))
    gpsMetricsRef.current = { ...gpsMetricsRef.current, speedMps: null }
    setGpsMetrics(gpsMetricsRef.current)
    strokeTrackerRef.current?.reset()
    runStartedAtRef.current = now
    setSessionStatus('running')
  }, [queueStorageWrite, setSessionStatus])

  const toggleSession = useCallback(() => {
    if (statusRef.current === 'running') pauseSession()
    else if (statusRef.current === 'paused') resumeSession()
    else void startSession()
  }, [pauseSession, resumeSession, startSession])

  useEffect(() => {
    let active = true
    void getCachedOtwWorkouts()
      .then((cached) => {
        if (!active || cached.length === 0) return
        cachedWorkoutsRef.current = true
        setWorkouts(cached)
        setCatalogueMessage('Using OTW workouts cached on this device.')
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
        setCatalogueMessage('')
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

    let active = true
    const watchId = navigator.geolocation.watchPosition(
      (gpsPosition) => {
        if (!active || statusRef.current !== 'running' || gpsPosition.timestamp < runStartedAtRef.current) return
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
        if (!active || statusRef.current !== 'running') return
        lastGpsAtRef.current = null
        gpsRef.current.markGap()
        gpsMetricsRef.current = { ...gpsMetricsRef.current, speedMps: null }
        setGpsMetrics(gpsMetricsRef.current)
        positionRef.current = null
        setGpsError(`GPS error: ${error.message}`)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 },
    )
    return () => {
      active = false
      navigator.geolocation.clearWatch(watchId)
    }
  }, [status])

  useEffect(() => {
    const cancelRemotePresses = () => {
      remoteControlPressRef.current = null
      blockedRemoteControlsRef.current.clear()
      pressedDirectionsRef.current.clear()
    }

    const matchAction = (event: KeyboardEvent) => (Object.keys(remoteMap) as RemoteAction[]).find((action) =>
      remoteMap[action] !== '' && (event.code === remoteMap[action] || event.key === remoteMap[action]),
    )

    const onKeyDown = (event: KeyboardEvent) => {
      if (learningAction) {
        event.preventDefault()
        if (event.repeat) return
        const key = event.code && event.code !== 'Unidentified' ? event.code : event.key
        if (!key || key === 'Unidentified') {
          setSettingsError('The controller did not provide a usable key.')
          setLearningAction(null)
          return
        }
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
      if ((activePanel && activePanel !== 'summary') || isEditableTarget(event.target)) return
      const matched = matchAction(event)
      if (!matched) return
      event.preventDefault()
      if (event.repeat) return

      if (matched !== 'buttonA' && matched !== 'buttonB') {
        if (pressedDirectionsRef.current.has(matched)) return
        pressedDirectionsRef.current.add(matched)
        if (statusRef.current !== 'running') return
        const now = Date.now()
        if (now - lastStrokeAtRef.current < 350) return
        lastStrokeAtRef.current = now
        stroke()
        return
      }

      if (remoteControlPressRef.current || blockedRemoteControlsRef.current.size > 0) {
        if (remoteControlPressRef.current?.action === matched) {
          remoteControlPressRef.current = null
        }
        blockedRemoteControlsRef.current.add(matched)
        return
      }
      const press = {
        action: matched,
        startedAt: Date.now(),
        startedRevision: statusRevisionRef.current,
        startedWhileStarting: startInProgressRef.current,
      }
      remoteControlPressRef.current = press
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const matched = matchAction(event)
      if (!matched) return
      if (matched !== 'buttonA' && matched !== 'buttonB') {
        if (pressedDirectionsRef.current.delete(matched)) event.preventDefault()
        return
      }
      if (blockedRemoteControlsRef.current.delete(matched)) {
        event.preventDefault()
        return
      }
      const press = remoteControlPressRef.current
      if (!press || press.action !== matched) return
      event.preventDefault()
      remoteControlPressRef.current = null
      if (Date.now() - press.startedAt >= 3000 || press.startedWhileStarting || startInProgressRef.current ||
        statusRevisionRef.current !== press.startedRevision || isEditableTarget(event.target) ||
        (activePanel && activePanel !== 'summary')) return
      const now = Date.now()
      if (now - lastControlAtRef.current < 350) return
      lastControlAtRef.current = now
      if (activePanel === 'summary') setActivePanel(null)
      toggleSession()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', cancelRemotePresses)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', cancelRemotePresses)
      cancelRemotePresses()
    }
  }, [activePanel, learningAction, remoteMap, saveRemoteMap, stroke, toggleSession])

  useEffect(() => () => {
    audioContextRef.current?.close()
  }, [])

  const hasWorkoutSession = mode === 'workout' && session?.mode === 'workout' &&
    session.workoutId === selectedWorkoutId && activeSegments.length > 0 &&
    (status === 'running' || status === 'paused' || status === 'completed')
  const workoutSegments = hasWorkoutSession ? activeSegments : selectedSegments.segments
  const workoutIndex = hasWorkoutSession ? progress.index : 0
  const currentSegment = mode === 'workout' ? workoutSegments[workoutIndex] : undefined
  const isRecovery = currentSegment?.kind === 'recovery'
  const remaining = currentSegment
    ? hasWorkoutSession
      ? intervalRemaining(
          currentSegment,
          progress.segmentStartedAt,
          progress.segmentStartDistance,
          elapsedSeconds,
          gpsMetrics.distanceMeters,
        )
      : currentSegment.value
    : null
  const intervalMetricsActive = hasWorkoutSession && currentSegment !== undefined
  const workoutPreview = mode === 'workout' && !hasWorkoutSession && currentSegment !== undefined
  const displayedDistance = workoutPreview
    ? 0
    : intervalMetricsActive
      ? Math.max(0, gpsMetrics.distanceMeters - progress.segmentStartDistance)
      : gpsMetrics.distanceMeters
  const displayedElapsed = workoutPreview
    ? 0
    : intervalMetricsActive
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
  const raceRemaining = mode === 'race' && raceStartDistance !== null &&
    (status === 'running' || status === 'paused' || status === 'completed')
    ? raceStartDistance - gpsMetrics.distanceMeters
    : null
  const raceTargetReached = raceRemaining !== null && Math.round(raceRemaining) <= 0
  const canChangeMode = canStart && !starting
  const workIntervalNumber = workoutSegments.slice(0, workoutIndex + 1).filter((segment) => segment.kind === 'work').length
  const workIntervalCount = workoutSegments.filter((segment) => segment.kind === 'work').length
  const workoutStatus = currentSegment
    ? currentSegment.kind === 'recovery'
      ? `Recovery, ${workIntervalNumber} of ${workIntervalCount} intervals completed`
      : `Interval ${workIntervalNumber} of ${workIntervalCount}`
    : null
  const statusLabel = status === 'paused'
    ? workoutStatus ? `Paused - ${workoutStatus}` : 'Paused'
    : workoutStatus ?? (status === 'running' ? 'Recording' : status === 'completed' ? 'Complete' : '')
  const summaryTime = workoutSummary.reduce((total, lap) => total + lap.endElapsedSeconds - lap.startElapsedSeconds, 0)
  const summaryDistance = workoutSummary.reduce((total, lap) => total + lap.endDistanceMeters - lap.startDistanceMeters, 0)
  const openPanel = (panel: Exclude<OtwPanel, null>) => {
    setMenuOpen(false)
    setActivePanel(panel)
    if (panel === 'history') {
      setHistoryLoading(true)
      setHistoryError(null)
      void storageWriteQueueRef.current
        .then(() => getCompletedOtwSessions())
        .then(setHistory)
        .catch((error: unknown) => setHistoryError(errorMessage(error)))
        .finally(() => setHistoryLoading(false))
    }
  }

  const changeMode = (nextMode: AppMode) => {
    if (!canChangeMode || startInProgressRef.current) return
    setMenuOpen(false)
    if (nextMode === 'workout') {
      setIntervalError(null)
      setPendingWorkoutId(mode === 'workout' ? selectedWorkoutId : '')
      setActivePanel('workout')
      return
    }
    if (nextMode !== mode) clearSessionDisplay()
    if (nextMode !== mode || (nextMode === 'race' && status === 'completed')) {
      setRaceStartDistance(null)
      if (nextMode === 'race') setRaceDistance(savedRaceDistance.value)
    }
    setMode(nextMode)
    setIntervalError(null)
  }

  const loadWorkout = (workout: CachedOtwWorkout) => {
    try {
      buildOtwSegments(workout.intervals)
    } catch (error) {
      setIntervalError(errorMessage(error))
      return
    }
    if (mode !== 'workout') clearSessionDisplay()
    setSelectedWorkoutId(workout.id)
    setMode('workout')
    setRaceStartDistance(null)
    setActiveSegments([])
    setProgress(INITIAL_INTERVAL_PROGRESS)
    setIntervalError(null)
    setActivePanel(null)
  }

  const deleteHistorySession = (id: string) => {
    if (!window.confirm('Delete this session from this phone?')) return
    setHistoryError(null)
    void deleteOtwSession(id)
      .then(() => setHistory((items) => items.filter((item) => item.id !== id)))
      .catch((error: unknown) => setHistoryError(errorMessage(error)))
  }

  const exportHistorySession = (savedSession: OtwSession) => {
    try {
      downloadFitSession(savedSession)
      setHistoryError(null)
    } catch (error) {
      setHistoryError(`FIT download failed: ${errorMessage(error)}`)
    }
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
            <p aria-live="polite">{statusLabel}</p>
          </div>
          <div className="otw-mode-controls" role="group" aria-label="Mode">
            {(['just-row', 'race', 'workout'] as const).map((option) => (
              <button
                key={option}
                type="button"
                disabled={!canChangeMode}
                aria-pressed={mode === option}
                onClick={() => changeMode(option)}
              >
                {MODE_LABELS[option]}
              </button>
            ))}
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
            <AveragePace
              key={`${mode}:${status}:${selectedWorkoutId}:${workoutIndex}`}
              speedMps={averageSpeed}
              distance={displayedDistance}
              segmentStartedAt={intervalMetricsActive ? progress.segmentStartedAt : 0}
              elapsedNow={elapsedNow}
              running={status === 'running'}
            />
          </div>
          <div className={`otw-metric${raceTargetReached ? ' otw-metric-race-complete' : ''}${isRecovery ? ' otw-metric-recovery' : ''}`}>
            <span className="otw-metric-label">
              {isRecovery ? 'Next interval starts in' : 'Remaining'}
            </span>
            {mode === 'race' && raceRemaining === null ? (
              <>
                <input
                  className="otw-metric-value otw-race-distance"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  aria-label="Race distance (meters)"
                  placeholder="Meters"
                  value={raceDistance}
                  disabled={starting}
                  onChange={(event) => {
                    const value = event.target.value
                    setRaceDistance(value)
                    if (validRaceDistance(value)) saveRaceDistance(value)
                  }}
                />
                <span className="otw-metric-unit">Enter a distance in meters</span>
              </>
            ) : (
              <strong className="otw-metric-value">
                {raceRemaining !== null
                  ? `${formatDistance(raceRemaining)} m`
                  : currentSegment && remaining !== null
                    ? formatIntervalRemaining(currentSegment, remaining)
                    : mode === 'just-row' ? '0' : '--'}
              </strong>
            )}
            {raceTargetReached && <span className="otw-metric-unit">Target reached</span>}
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
          {savedRaceDistance.error && <p className="otw-notice-error" role="alert">{savedRaceDistance.error}</p>}
          {wakeMessage && <p>{wakeMessage}</p>}
          {audioWarning && <p>{audioWarning}</p>}
        </div>

        <section className="otw-controls" aria-label="Session controls">
          <button
            className={`otw-button ${status === 'running' ? 'otw-button-pause' : status === 'paused' ? 'otw-button-resume' : 'otw-button-primary'}`}
            type="button"
            onClick={toggleSession}
            disabled={starting || (canStart && (
              (mode === 'workout' && (!selectedWorkout || Boolean(selectedSegments.error))) ||
              (mode === 'race' && !validRaceDistance(raceDistance))
            ))}
          >
            {status === 'running' ? 'Pause' : status === 'paused' ? 'Resume' : 'Start'}
          </button>
          <button className="otw-button otw-button-danger" type="button" onClick={() => void finishSession()} disabled={starting || status !== 'paused'}>
            Finish
          </button>
        </section>

        {activePanel && (
          <div className="otw-dialog-backdrop">
            <section className="otw-dialog" role="dialog" aria-modal="true" aria-labelledby="otw-dialog-title">
              <header className="otw-dialog-header">
                <h2 id="otw-dialog-title">
                  {activePanel === 'workout' ? 'OTW Workouts' : activePanel === 'summary' ? 'Workout summary' : activePanel === 'history' ? 'History' : activePanel === 'settings' ? 'Settings' : 'Remote controls'}
                </h2>
                <button className="otw-dialog-close" type="button" aria-label="Close" onClick={() => setActivePanel(null)}>×</button>
              </header>

              {activePanel === 'workout' && (
                <div className="otw-panel-content">
                  <label className="otw-panel-label otw-workout-filter">
                    Filter by
                    <select value={workoutFilter} onChange={(event) => {
                      const value = event.target.value
                      if (value === 'All' || value === 'Distance' || value === 'Time' || value === 'Mixed' || value === 'None' || value === 'Invalid') {
                        setWorkoutFilter(value)
                      }
                    }}>
                      {(['All', 'Distance', 'Time', 'Mixed', 'None'] as const).map((category) => (
                        <option key={category} value={category}>{category}</option>
                      ))}
                      {(workoutFilter === 'Invalid' || workouts.some((workout) => workoutCategory(workout) === 'Invalid')) && <option value="Invalid">Invalid</option>}
                    </select>
                  </label>
                  <table className="otw-workout-table" aria-label="OTW workouts">
                    <thead><tr><th scope="col">Description</th><th scope="col">Intervals</th></tr></thead>
                    <tbody>
                      {workouts.filter((workout) => workoutFilter === 'All' || workoutCategory(workout) === workoutFilter).map((workout) => (
                        <tr key={workout.id}>
                          <td>
                            <button
                              type="button"
                              aria-pressed={pendingWorkoutId === workout.id}
                              onClick={() => {
                                setPendingWorkoutId(workout.id)
                                setIntervalError(null)
                              }}
                            >
                              {workout.description || 'No description'}
                            </button>
                          </td>
                          <td className="otw-workout-category">{workoutCategory(workout)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {pendingWorkout && <p className="otw-note">Selected: {pendingWorkout.description || 'No description'}</p>}
                  <button
                    className="otw-button otw-button-primary"
                    type="button"
                    disabled={!pendingWorkout}
                    onClick={() => { if (pendingWorkout) loadWorkout(pendingWorkout) }}
                  >
                    Load Workout
                  </button>
                  {catalogueMessage && <p className="otw-note">{catalogueMessage}</p>}
                  {workouts.length === 0 && !catalogueError && <p className="otw-note">No OTW workouts are available.</p>}
                  {workouts.length > 0 && !workouts.some((workout) => workoutFilter === 'All' || workoutCategory(workout) === workoutFilter) && (
                    <p className="otw-note">No workouts match this filter.</p>
                  )}
                  {workouts.some((workout) => workoutCategory(workout) === 'Invalid') && (
                    <p className="otw-message" role="status">Some workouts have unrecognized work interval types and cannot be started.</p>
                  )}
                  {catalogueError && <p className="otw-message otw-message-error" role="alert">{catalogueError}</p>}
                  {selectedSegments.error && <p className="otw-message otw-message-error" role="alert">{selectedSegments.error}</p>}
                  {intervalError && <p className="otw-message otw-message-error" role="alert">{intervalError}</p>}
                </div>
              )}

              {activePanel === 'summary' && (
                <div className="otw-panel-content">
                  {workoutSummary.length === 0 && <p className="otw-note">No intervals completed.</p>}
                  <div className="otw-summary-table-wrap">
                    <table className="otw-summary-table">
                      <thead>
                        <tr><th scope="col">Interval</th><th scope="col">Time</th><th scope="col">Distance (m)</th><th scope="col">Pace (/500 m)</th></tr>
                      </thead>
                      <tbody>
                        {workoutSummary.map((lap, index) => {
                          const time = lap.endElapsedSeconds - lap.startElapsedSeconds
                          const distance = lap.endDistanceMeters - lap.startDistanceMeters
                          return (
                            <tr key={index}>
                              <th scope="row">{index + 1}/{summaryIntervalCount}</th>
                              <td>{formatElapsedClock(time)}</td>
                              <td>{formatDistance(distance)}</td>
                              <td>{formatPacePer500m(time > 0 ? distance / time : null)}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <th scope="row">Total</th>
                          <td>{formatElapsedClock(summaryTime)}</td>
                          <td>{formatDistance(summaryDistance)}</td>
                          <td>{formatPacePer500m(summaryTime > 0 ? summaryDistance / summaryTime : null)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
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
                          <strong>{savedSession.workoutName ?? MODE_LABELS[savedSession.mode]}</strong>
                          <span>{new Date(savedSession.startedAt).toLocaleString()}</span>
                          <span>{formatElapsed(savedSession.elapsedSeconds)}</span>
                        </div>
                        <div className="otw-history-actions">
                          <button className="otw-panel-button" type="button" onClick={() => exportHistorySession(savedSession)}>
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
                  <p className="otw-note">Pair a Bluetooth keyboard or remote that sends keyboard events, then learn its buttons. Press A or B to start, pause or resume. Press any direction to record a stroke. Finish is available on screen only.</p>
                  <div className="otw-remote-actions">
                    {(Object.keys(ACTION_LABELS) as RemoteAction[]).map((action) => (
                      <button
                        key={action}
                        type="button"
                        aria-pressed={learningAction === action}
                        onClick={() => setLearningAction(action)}
                      >
                        {learningAction === action ? `Press ${ACTION_LABELS[action]} key…` : `Learn ${ACTION_LABELS[action]} · ${remoteMap[action] || 'Not assigned'}`}
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
