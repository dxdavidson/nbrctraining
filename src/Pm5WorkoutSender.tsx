import { useMemo, useState } from 'react'
import { useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'
import type { Interval, Workout } from './api'
import { calculateWolverinePace, isWolverineLevel } from './wolverinePace'

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
  if (isWolverineLevel(interval.target_mode)) {
    if (interval.spm == null || estimated2kSeconds == null) {
      return null
    }
    const { seconds } = calculateWolverinePace(interval.target_mode, interval.spm, estimated2kSeconds / 4)
    return Number.isFinite(seconds) ? Math.max(0, Math.round(seconds * 100)) : null
  }

  if (interval.target_mode !== 'two_k_pace_offset_seconds' || interval.target_value == null || estimated2kSeconds == null) {
    return null
  }

  const secondsPer500m = estimated2kSeconds / 4 + interval.target_value
  if (!Number.isFinite(secondsPer500m)) {
    return null
  }

  return Math.max(0, Math.round(secondsPer500m * 100))
}

export default function Pm5WorkoutSender({ workout, intervals }: Pm5WorkoutSenderProps) {
  const diagnosticsEnabled = new URLSearchParams(window.location.search).get('diagnostics') === '1'
  const [estimated2kSeconds] = useEstimated2kSeconds()
  const [pm5, setPm5] = useState<any>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState('Select a workout and connect to a PM5.')
  const [error, setError] = useState<string | null>(null)
  const [deviceInfo, setDeviceInfo] = useState<Record<string, unknown> | null>(null)
  const [commandLog, setCommandLog] = useState('No commands sent yet.')

  const orderedIntervals = useMemo(
    () => [...intervals].sort((a, b) => a.interval_order - b.interval_order),
    [intervals]
  )

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

      setStatus('Workout sent. Check the PM5 and press the PM5 button to begin.')
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
      try {
        pm5.disconnect()
      } catch (disconnectError) {
        setCommandLog((previous) => appendCommandHistory(previous, `[error] Error during disconnect: ${disconnectError instanceof Error ? disconnectError.message : String(disconnectError)}`))
      }
    } finally {
      setIsSending(false)
      setIsConnected(false)
    }
  }

  if (!workout) {
    return null
  }

  return (
    <section className="pm5-workout-sender" aria-label="PM5 workout sender">
      <h3>Send workout to PM5</h3>
      <p className="pm5-workout-sender-summary">
        {workout.workout_code} · {orderedIntervals.length} interval{orderedIntervals.length === 1 ? '' : 's'}
      </p>

      <div className="pm5-workout-sender-actions">
        <button
          type="button"
          onClick={connectPm5}
          disabled={isSending || !window.ergometer?.ble?.hasWebBlueTooth?.()}
        >
          Connect PM5
        </button>
        <button
          type="button"
          onClick={sendWorkoutToPm5}
          disabled={!pm5 || !isConnected || isSending || orderedIntervals.length === 0}
        >
          Send workout to PM5
        </button>
      </div>

      <p className="pm5-workout-sender-status" role="status">
        {status}
      </p>

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
