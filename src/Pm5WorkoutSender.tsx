import { useEffect, useMemo, useState } from 'react'
import { useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'
import type { Interval, Workout } from './api'
import { calculatePaceGuidance, isPaceGuidanceMode, isWolverineLevel, requiresStrokeRate } from './paceGuidance'
import HeaderTooltip from './components/HeaderTooltip'
import './Pm5WorkoutSender.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

declare global {
  interface Window {
    ergometer?: {
      ble: { hasWebBlueTooth: () => boolean }
      PerformanceMonitorBle: new () => any
      LogLevel: { error: number; debug: number }
      MonitorConnectionState: { readyForCommunication: number }
    }
  }
}

const WORKOUT_TYPE_FIXED_TIME_INTERVAL = 6
const WORKOUT_TYPE_VARIABLE_INTERVAL = 8
const INTERVAL_TYPE_DISTANCE = 1
const INTERVAL_TYPE_TIME = 0
const DURATION_TYPE_DISTANCE = 0x80
const DURATION_TYPE_TIME = 0x00
const SCREEN_TYPE_WORKOUT = 1
const SCREEN_VALUE_PREPARE_TO_ROW = 1

const COMMAND_NAME_MAP: Record<number, string> = {
  26: 'SETUSERCFG1_CMD',
  118: 'SETPMCFG_CMD',
  119: 'SETPMDATA_CMD',
  126: 'GETPMCFG_CMD',
  127: 'GETPMDATA_CMD',
}

const DETAIL_COMMAND_NAME_MAP: Record<number, string> = {
  1: 'PM_SET_WORKOUTTYPE',
  3: 'PM_SET_WORKOUTDURATION',
  4: 'PM_SET_RESTDURATION',
  5: 'PM_SET_SPLITDURATION',
  6: 'PM_SET_TARGETPACETIME',
  19: 'PM_SET_SCREENSTATE',
  20: 'PM_CONFIGURE_WORKOUT',
  21: 'PM_SET_TARGETAVGWATTS',
  22: 'PM_SET_TARGETCALSPERHR',
  23: 'PM_SET_INTERVALTYPE',
  24: 'PM_SET_WORKOUTINTERVALCOUNT',
}

function formatHex(value: number | string | null | undefined): string {
  if (value === undefined || value === null) {
    return '--'
  }

  return `0x${Number(value).toString(16).toUpperCase().padStart(2, '0')}`
}

function getCommandName(command: number | string, detailCommand: number | string | null | undefined): string {
  const primaryName = COMMAND_NAME_MAP[Number(command)] ?? `CMD_${formatHex(command)}`

  if (detailCommand === undefined || detailCommand === null || detailCommand === '') {
    return primaryName
  }

  const detailName = DETAIL_COMMAND_NAME_MAP[Number(detailCommand)] ?? `DETAIL_${formatHex(detailCommand)}`
  return `${primaryName} -> ${detailName}`
}

function toByteArray(data: unknown): number[] {
  if (!data) {
    return []
  }

  if (Array.isArray(data)) {
    return data as number[]
  }

  if (data instanceof Uint8Array) {
    return Array.from(data)
  }

  if (data instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(data))
  }

  if (typeof data === 'object' && typeof (data as { length?: number }).length === 'number') {
    return Array.from(data as ArrayLike<number>)
  }

  return [Number(data)]
}

function formatPaceValue(valueHundredths: number): string {
  const totalHundredths = Number(valueHundredths)
  if (!Number.isFinite(totalHundredths) || totalHundredths <= 0) {
    return '0:00.00'
  }

  const totalSeconds = Math.round(totalHundredths / 100)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function decodeCommandValue(command: { data?: unknown; detailCommand?: number | string | null }): string {
  const bytes = toByteArray(command.data)

  if (bytes.length === 0) {
    return ''
  }

  const detail = Number(command.detailCommand)

  if (detail === 1) {
    return `value=${bytes[0]}`
  }

  if (detail === 3) {
    const durationType = bytes[0]
    const value = ((bytes[4] << 0) | (bytes[3] << 8) | (bytes[2] << 16) | (bytes[1] << 24)) >>> 0
    return `durationType=${durationType} value=${value}`
  }

  if (detail === 4) {
    const value = (bytes[0] << 8) | bytes[1]
    return `value=${value}s`
  }

  if (detail === 6) {
    const value = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]
    return `pace=${formatPaceValue(value)}`
  }

  if (detail === 19) {
    const screenType = bytes[0]
    const value = bytes[1]
    return `screenType=${screenType} value=${value}`
  }

  if (detail === 20) {
    return `programmingMode=${bytes[0] === 1 ? 'true' : 'false'}`
  }

  if (detail === 23) {
    return `intervalType=${bytes[0]}`
  }

  if (detail === 24) {
    return `intervalCount=${bytes[0]}`
  }

  return `data=${bytes.join(', ')}`
}

function summarizeCommandBuffer(label: string, buffer: { rawCommands?: Array<{ command?: number | string; detailCommand?: number | string | null; data?: unknown }> } | null | undefined): string {
  const rawCommands = Array.isArray(buffer?.rawCommands) ? buffer.rawCommands : []

  if (rawCommands.length === 0) {
    return `${label}\n  No command payload`
  }

  const summaryLines = rawCommands.map((command, index) => {
    const commandName = getCommandName(command.command ?? 0, command.detailCommand)
    const commandHex = formatHex(command.command)
    const detailHex = command.detailCommand !== undefined && command.detailCommand !== null ? formatHex(command.detailCommand) : '--'
    const valueSummary = decodeCommandValue(command)
    const valueText = valueSummary ? ` | ${valueSummary}` : ''
    return `  ${index + 1}. ${commandName} (${commandHex}${detailHex !== '--' ? ` / ${detailHex}` : ''})${valueText}`
  })

  return `${label}\n${summaryLines.join('\n')}`
}

function appendCommandHistory(previous: string, next: string): string {
  const entries = [next, previous].filter(Boolean)
  return entries.join('\n\n').trim()
}

function logIntervalDiagnostics(
  intervalIndex: number,
  interval: Interval,
  intervalType: number,
  durationType: number,
  workValue: number,
  recoverySeconds: number,
  isDistanceBased: boolean,
  targetPaceHundredths: number | null
): string {
  const lines = [
    `Interval ${intervalIndex + 1} computed values:`,
    `  workKind: ${interval.work_kind}`,
    `  intervalType: ${intervalType} (${isDistanceBased ? 'distance' : 'time'}-based)`,
    `  durationType: 0x${durationType.toString(16).toUpperCase().padStart(2, '0')} (${durationType === 0x80 ? 'distance' : 'time'})`,
    `  workValue: ${workValue}${isDistanceBased ? 'm' : 's'}`,
    `  recoverySeconds: ${recoverySeconds}s`,
    `  targetMode: ${interval.target_mode ?? 'null'}`,
    `  targetValue: ${interval.target_value ?? 'null'}`,
    `  targetPaceHundredths: ${targetPaceHundredths ?? 'null (skipped)'}`,
  ]
  return lines.join('\n')
}

interface Pm5WorkoutSenderProps {
  workout: Workout | null
  intervals: Interval[]
}

function getDurationType(workKind: string | null): number {
  return workKind === 'distance' ? DURATION_TYPE_DISTANCE : DURATION_TYPE_TIME
}

function getIntervalType(workKind: string | null): number {
  return workKind === 'distance' ? INTERVAL_TYPE_DISTANCE : INTERVAL_TYPE_TIME
}

function toTargetPaceHundredths(interval: Interval, estimated2kSeconds: number | null): number | null {
  if (!isPaceGuidanceMode(interval.target_mode) || estimated2kSeconds == null) {
    return null
  }
  if (requiresStrokeRate(interval.target_mode) && interval.spm == null) return null
  if (!isWolverineLevel(interval.target_mode) && interval.target_value == null) return null

  try {
    const { secondsPer500m } = calculatePaceGuidance(interval.target_mode, {
      estimated2kSeconds,
      spm: interval.spm ?? 0,
      targetValue: interval.target_value,
    })
    return Number.isFinite(secondsPer500m) ? Math.max(0, Math.round(secondsPer500m * 100)) : null
  } catch {
    return null
  }
}

export default function Pm5WorkoutSender({ workout, intervals }: Pm5WorkoutSenderProps) {
  const diagnosticsEnabled = new URLSearchParams(window.location.search).get('diagnostics') === '1'
  const [estimated2kSeconds] = useEstimated2kSeconds()
  const [pm5, setPm5] = useState<any>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [deviceInfo, setDeviceInfo] = useState<Record<string, unknown> | null>(null)
  const [commandLog, setCommandLog] = useState('No commands sent yet.')
  const [stayConnected, setStayConnected] = useState(false)
  const [isMonitoringWorkout, setIsMonitoringWorkout] = useState(false)
  const [concept2Connected, setConcept2Connected] = useState<boolean | null>(null)
  const [concept2UserId, setConcept2UserId] = useState<string | null>(null)
  const [concept2UserName, setConcept2UserName] = useState<string | null>(null)
  const [isDisconnectingConcept2, setIsDisconnectingConcept2] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)

  const orderedIntervals = useMemo(
    () => [...intervals].sort((a, b) => a.interval_order - b.interval_order),
    [intervals]
  )

  const loadConcept2Status = () => {
    let cancelled = false
    fetch(`${API_BASE_URL}/api/concept2/status`, { credentials: 'include' })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled) {
          setConcept2Connected(Boolean(data?.connected))
          setConcept2UserId(data?.connected && data?.concept2UserId ? String(data.concept2UserId) : null)
          setConcept2UserName(data?.connected && data?.concept2UserName ? String(data.concept2UserName) : null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConcept2Connected(false)
          setConcept2UserId(null)
          setConcept2UserName(null)
        }
      })
    return () => {
      cancelled = true
    }
  }

  useEffect(() => {
    return loadConcept2Status()
  }, [])

  const disconnectConcept2 = async () => {
    setIsDisconnectingConcept2(true)
    setUploadStatus(null)
    try {
      const response = await fetch(`${API_BASE_URL}/api/concept2/connection`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? `Disconnect failed with status ${response.status}`)
      }
      setConcept2Connected(false)
      setConcept2UserId(null)
      setConcept2UserName(null)
      setStayConnected(false)
    } catch (disconnectError) {
      const message = disconnectError instanceof Error ? disconnectError.message : String(disconnectError)
      setUploadStatus(`Could not disconnect from Concept2 Logbook: ${message}`)
    } finally {
      setIsDisconnectingConcept2(false)
    }
  }

  const uploadWorkoutSummary = async (summary: Record<string, unknown>, startedAt: string) => {
    setUploadStatus('Uploading result to your Concept2 Logbook...')
    try {
      const response = await fetch(`${API_BASE_URL}/api/logbook/results`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...summary, startedAt }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error ?? `Upload failed with status ${response.status}`)
      }
      setUploadStatus('Result uploaded to your Concept2 Logbook.')
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError)
      setUploadStatus(`Could not upload to Concept2 Logbook: ${message}`)
    }
  }

  const connectPm5 = () => {
    if (!workout) {
      setStatus('Choose a workout before connecting to a PM5.')
      return
    }

    const ergometer = window.ergometer
    if (!ergometer || !ergometer.ble?.hasWebBlueTooth || !ergometer.PerformanceMonitorBle) {
      setError('Web Bluetooth is unavailable. Use Chrome or Edge on Windows or Android.')
      return
    }

    setError(null)
    setCommandLog('No commands sent yet.')
    const monitor = new ergometer.PerformanceMonitorBle()
    monitor._commandTimeout = 5000
    monitor.logLevel = diagnosticsEnabled ? ergometer.LogLevel.debug : ergometer.LogLevel.error

    if (diagnosticsEnabled) {
      monitor.logEvent?.sub?.(window, (info: string, level: number) => {
        setCommandLog((previous) => appendCommandHistory(previous, `[${level}] ${info}`))
      })
    }

    monitor.connectionStateChangedEvent.sub(window, (_previousState: number, nextState: number) => {
      const readyState = ergometer.MonitorConnectionState.readyForCommunication
      const connected = nextState === readyState
      setIsConnected(connected)
      if (connected) {
        setStatus(`Connected to PM5: ${monitor.deviceInfo?.serial ?? monitor.deviceInfo?.name ?? 'PM5'}`)
        setDeviceInfo(monitor.deviceInfo ?? null)
      } else {
        setStatus(`PM5 connection state: ${nextState}`)
      }
    })

    if (diagnosticsEnabled) {
      monitor.rowingGeneralStatusEvent.sub(window, (data: Record<string, unknown>) => {
        setStatus(`PM5 live status: ${JSON.stringify(data)}`)
      })
    }

    setPm5(monitor)
    setStatus('Choose your PM5 in the Bluetooth picker...')
    monitor.startScan(() => true)
  }

  const sendWorkoutToPm5 = async () => {
    if (!estimated2kSeconds || estimated2kSeconds <= 0) {
      setStatus('Enter an estimated 2K time before sending a workout to the PM5.')
      return
    }

    if (!workout || !pm5 || orderedIntervals.length === 0) {
      setStatus('Select a connected PM5 and a workout before sending.')
      return
    }

    setIsSending(true)
    setError(null)
    setStatus(`Sending ${workout.workout_code} to the PM5...`)

    try {
      setCommandLog((previous) => appendCommandHistory(previous, `[diag] Device state: manufacturer=${deviceInfo?.manufacturer ?? 'unknown'}, serial=${deviceInfo?.serial ?? 'unknown'}, timeout=${pm5._commandTimeout}ms`))

      let intervalIndex = 0
      let screenSent = false
      const totalIntervalCount = orderedIntervals.reduce(
        (count, interval) => count + Math.max(1, interval.repeat_count ?? 1),
        0
      )
      const useVariableInterval = totalIntervalCount > 1
      for (const interval of orderedIntervals) {
        const repeatCount = Math.max(1, interval.repeat_count ?? 1)
        for (let repeat = 0; repeat < repeatCount; repeat += 1) {
          const intervalType = getIntervalType(interval.work_kind)
          const durationType = getDurationType(interval.work_kind)
          const workValue = interval.work_value ?? 0
          const recoverySeconds = interval.recovery_kind === 'time' ? Math.max(0, Math.round(interval.recovery_value ?? 0)) : 0
          const isDistanceBased = interval.work_kind === 'distance'
          const targetPaceHundredths = toTargetPaceHundredths(interval, estimated2kSeconds)

          setCommandLog((previous) => appendCommandHistory(previous, logIntervalDiagnostics(intervalIndex, interval, intervalType, durationType, workValue, recoverySeconds, isDistanceBased, targetPaceHundredths)))

          if (!isDistanceBased && !useVariableInterval) {
            const durationStartTime = performance.now()
            const durationCommand = pm5
              .newCsafeBuffer()
              .setWorkoutType({ value: WORKOUT_TYPE_FIXED_TIME_INTERVAL })
              .setWorkoutDuration({ value: Math.max(0, Math.round(workValue * 100)), durationType: DURATION_TYPE_TIME })
            setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: fixed time duration`, durationCommand)))
            setCommandLog((previous) => appendCommandHistory(previous, `[info] Time-based interval ${intervalIndex + 1}: fixedTimeInterval, duration=${workValue}s (${Math.round(workValue * 100)} hundredths)`))
            await durationCommand.send()
            const durationElapsed = performance.now() - durationStartTime
            setCommandLog((previous) => appendCommandHistory(previous, `[diag] Fixed time duration buffer sent in ${durationElapsed.toFixed(1)}ms`))

            const configureStartTime = performance.now()
            const configureCommand = pm5
              .newCsafeBuffer()
              .setRestDuration({ value: recoverySeconds })
              .setConfigureWorkout({ programmingMode: true })
              .setScreenState({
                screenType: SCREEN_TYPE_WORKOUT,
                value: SCREEN_VALUE_PREPARE_TO_ROW,
              })
            setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: rest + configure + screen`, configureCommand)))
            await configureCommand.send()
            const configureElapsed = performance.now() - configureStartTime
            setCommandLog((previous) => appendCommandHistory(previous, `[diag] Fixed time configure buffer sent in ${configureElapsed.toFixed(1)}ms`))
            screenSent = true
            intervalIndex += 1
            continue
          }

          const startTime = performance.now()
          const setupBuffer = pm5
            .newCsafeBuffer()
            .setWorkoutIntervalCount({ value: intervalIndex })
            .setWorkoutType({ value: WORKOUT_TYPE_VARIABLE_INTERVAL })
            .setIntervalType({ value: intervalType })
          setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: setup`, setupBuffer)))
          await setupBuffer.send()
          const setupDuration = performance.now() - startTime
          setCommandLog((previous) => appendCommandHistory(previous, `[diag] Setup buffer sent in ${setupDuration.toFixed(1)}ms`))

          if (targetPaceHundredths !== null) {
            const distStartTime = performance.now()
            const durationBuffer = pm5
              .newCsafeBuffer()
              .setWorkoutDuration({ value: isDistanceBased ? workValue : Math.max(0, Math.round(workValue * 100)), durationType })
              .setRestDuration({ value: recoverySeconds })
            setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: distance + rest`, durationBuffer)))
            await durationBuffer.send()
            const distDuration = performance.now() - distStartTime
            setCommandLog((previous) => appendCommandHistory(previous, `[diag] Distance/rest buffer sent in ${distDuration.toFixed(1)}ms`))

            const paceStartTime = performance.now()
            const paceCommand = pm5
              .newCsafeBuffer()
              .setTargetPaceTime({ value: targetPaceHundredths })
              .setConfigureWorkout({ programmingMode: true })
            setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: pace + configure`, paceCommand)))
            await paceCommand.send()
            const paceDuration = performance.now() - paceStartTime
            setCommandLog((previous) => appendCommandHistory(previous, `[diag] Pace/configure buffer sent in ${paceDuration.toFixed(1)}ms`))
          } else if (isDistanceBased || useVariableInterval) {
            const noPaceStartTime = performance.now()
            const durationBuffer = pm5
              .newCsafeBuffer()
              .setWorkoutDuration({ value: isDistanceBased ? workValue : Math.max(0, Math.round(workValue * 100)), durationType })
              .setRestDuration({ value: recoverySeconds })
            setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: distance + rest (no pace)`, durationBuffer)))
            await durationBuffer.send()
            const noPaceDuration = performance.now() - noPaceStartTime
            setCommandLog((previous) => appendCommandHistory(previous, `[diag] Distance/rest buffer sent in ${noPaceDuration.toFixed(1)}ms`))

            const configStartTime = performance.now()
            const configureCommand = pm5
              .newCsafeBuffer()
              .setConfigureWorkout({ programmingMode: true })
            setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer(`Interval ${intervalIndex + 1}: configure only`, configureCommand)))
            setCommandLog((previous) => appendCommandHistory(previous, `[info] Distance-based interval ${intervalIndex + 1}: no 2k pace estimate available.`))
            await configureCommand.send()
            const configDuration = performance.now() - configStartTime
            setCommandLog((previous) => appendCommandHistory(previous, `[diag] Configure buffer sent in ${configDuration.toFixed(1)}ms`))
          }

          intervalIndex += 1
        }
      }

      if (!screenSent) {
        const screenStartTime = performance.now()
        const screenCommand = pm5
          .newCsafeBuffer()
          .setScreenState({
            screenType: SCREEN_TYPE_WORKOUT,
            value: SCREEN_VALUE_PREPARE_TO_ROW,
          })
        setCommandLog((previous) => appendCommandHistory(previous, summarizeCommandBuffer('Final: workout screen', screenCommand)))
        await screenCommand.send()
        const screenDuration = performance.now() - screenStartTime
        setCommandLog((previous) => appendCommandHistory(previous, `[diag] Screen buffer sent in ${screenDuration.toFixed(1)}ms`))
      }

      if (stayConnected) {
        const startedAt = new Date().toISOString()
        setIsMonitoringWorkout(true)
        setStatus('Workout sent. Stay on this page — the result uploads to your Concept2 Logbook once you finish rowing.')

        const handleWorkoutSummary = async (summary: Record<string, unknown>) => {
          pm5.workoutSummaryDataEvent.unsub(handleWorkoutSummary)
          await uploadWorkoutSummary(summary, startedAt)
          setIsMonitoringWorkout(false)
          setIsConnected(false)
          try {
            pm5.disconnect()
          } catch (disconnectError) {
            setCommandLog((previous) => appendCommandHistory(previous, `[error] Error during disconnect: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`))
          }
        }
        pm5.workoutSummaryDataEvent.sub(window, handleWorkoutSummary)
      } else {
        setStatus('Workout sent. Check the PM5 and press the PM5 button to begin.')
        setIsConnected(false)
        try {
          pm5.disconnect()
        } catch (disconnectError) {
          setCommandLog((previous) => appendCommandHistory(previous, `[error] Error during disconnect: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`))
        }
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
      const stack = caughtError instanceof Error ? caughtError.stack : ''
      setCommandLog((previous) => appendCommandHistory(previous, `[error] Exception caught: ${message}`))
      if (stack) {
        setCommandLog((previous) => appendCommandHistory(previous, `[error] Stack: ${stack}`))
      }
      setCommandLog((previous) => appendCommandHistory(previous, `[diag] PM5 connection state before disconnect: ${pm5?.connectionState ?? 'unknown'}`))
      setError(`Could not send the workout: ${message}. Reconnect and try again.`)
      setStatus('Workout transmission failed.')
      setIsMonitoringWorkout(false)
      setIsConnected(false)
      try {
        pm5.disconnect()
      } catch (disconnectError) {
        setCommandLog((previous) => appendCommandHistory(previous, `[error] Error during disconnect: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`))
      }
    } finally {
      setIsSending(false)
    }
  }

  if (!workout) {
    return null
  }

  return (
    <section className="pm5-workout-sender" aria-label="PM5 workout sender">
      <div className="pm5-workout-sender-frames">
        <section className="pm5-workout-sender-frame" aria-label="PM5 connection">
          <h4>
            <HeaderTooltip label="Send workout to PM5 (Android only)">
              Sending workouts to a PM5 currently works on Android devices only. Apple devices are not supported.
            </HeaderTooltip>
          </h4>
          <p className="pm5-workout-sender-summary">
            {workout.workout_code} · {orderedIntervals.length} interval{orderedIntervals.length === 1 ? '' : 's'}
          </p>
          <div className="pm5-workout-sender-actions">
            <button
              type="button"
              onClick={connectPm5}
              disabled={isSending || isMonitoringWorkout || !window.ergometer?.ble?.hasWebBlueTooth?.()}
            >
              Connect PM5
            </button>
            <button
              type="button"
              onClick={sendWorkoutToPm5}
              disabled={!estimated2kSeconds || estimated2kSeconds <= 0 || !pm5 || !isConnected || isSending || isMonitoringWorkout || orderedIntervals.length === 0}
            >
              Send workout to PM5
            </button>
          </div>
          <label className="pm5-workout-sender-stay-connected">
            <input
              type="checkbox"
              checked={stayConnected}
              onChange={(event) => setStayConnected(event.target.checked)}
              disabled={isSending || isMonitoringWorkout || concept2Connected !== true}
            />
            Stay connected to PM5 and upload result to C2 Logbook
          </label>
          {status && <p className="pm5-workout-sender-status" role="status">{status}</p>}
        </section>

        <section className="pm5-workout-sender-frame" aria-label="Concept2 Logbook connection">
          <h4>Concept2 Logbook</h4>
          <dl className="pm5-workout-sender-connection-details">
            <div>
              <dt>Connection</dt>
              <dd>{concept2Connected === null ? 'Checking...' : concept2Connected ? 'Connected' : 'Not connected'}</dd>
            </div>
            {concept2Connected && concept2UserId && (
              <div>
                <dt>Connected user ID</dt>
                <dd>{concept2UserId}</dd>
              </div>
            )}
            {concept2Connected && concept2UserName && (
              <div>
                <dt>Connected as</dt>
                <dd>{concept2UserName}</dd>
              </div>
            )}
          </dl>
          <div className="pm5-workout-sender-actions">
            <a className="pm5-workout-sender-button" href={`${API_BASE_URL}/auth/concept2/login`}>
              {concept2Connected ? 'Replace connection' : 'Connect Logbook'}
            </a>
            {concept2Connected && (
              <button type="button" onClick={disconnectConcept2} disabled={isDisconnectingConcept2 || isMonitoringWorkout}>
                {isDisconnectingConcept2 ? 'Disconnecting...' : 'Disconnect'}
              </button>
            )}
          </div>
          {uploadStatus && <p className="pm5-workout-sender-status" role="status">{uploadStatus}</p>}
        </section>
      </div>

      {error && (
        <p className="pm5-workout-sender-error" role="alert">
          {error}
        </p>
      )}

      {diagnosticsEnabled && commandLog && (
        <pre className="pm5-workout-sender-log" aria-live="polite">
          {commandLog}
        </pre>
      )}

      {diagnosticsEnabled && deviceInfo && (
        <pre className="pm5-workout-sender-device">
          {JSON.stringify(deviceInfo, null, 2)}
        </pre>
      )}
    </section>
  )
}
