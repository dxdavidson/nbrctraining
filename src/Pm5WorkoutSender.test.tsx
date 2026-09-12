import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Pm5WorkoutSender from './Pm5WorkoutSender'
import type { Workout, Interval } from './api'
import { secondsPer500mFromWatts } from './wolverinePace'

describe('Pm5WorkoutSender', () => {
  const workout: Workout = {
    id: 'w1',
    block_id: 'b1',
    wk_type: null,
    workout_code: 'WC1',
    week_commencing: null,
    description: 'Test workout',
    sort_order: 1,
    level: null,
    has_intervals: true,
  }

  const intervals: Interval[] = [
    {
      id: 'i1',
      workout_id: 'w1',
      interval_code: 'I1',
      interval_order: 1,
      repeat_count: 2,
      work_kind: 'distance',
      work_value: 500,
      spm: null,
      recovery_kind: 'time',
      recovery_value: 120,
      target_mode: 'two_k_pace_offset_seconds',
      target_value: 5,
    },
  ]

  beforeEach(() => {
    window.history.pushState({}, '', '?diagnostics=1')
    window.localStorage.setItem('nbrctraining.estimated2kTimeSeconds', JSON.stringify(447))

    const mockBufferFactory = () => {
      const rawCommands: Array<{ command: number; detailCommand?: number | string; data?: number[] }> = []
      const buffer = {
        setWorkoutIntervalCount: vi.fn().mockImplementation(({ value }) => {
          rawCommands.push({ command: 118, detailCommand: 24, data: [value] })
          return buffer
        }),
        setWorkoutType: vi.fn().mockImplementation(({ value }) => {
          rawCommands.push({ command: 118, detailCommand: 1, data: [value] })
          return buffer
        }),
        setIntervalType: vi.fn().mockImplementation(({ value }) => {
          rawCommands.push({ command: 118, detailCommand: 23, data: [value] })
          return buffer
        }),
        setWorkoutDuration: vi.fn().mockImplementation(({ value, durationType }) => {
          rawCommands.push({ command: 118, detailCommand: 3, data: [durationType, (value >> 0) & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff] })
          return buffer
        }),
        setRestDuration: vi.fn().mockImplementation(({ value }) => {
          rawCommands.push({ command: 118, detailCommand: 4, data: [value & 0xff, (value >> 8) & 0xff] })
          return buffer
        }),
        setTargetPaceTime: vi.fn().mockImplementation(({ value }) => {
          rawCommands.push({ command: 118, detailCommand: 6, data: [((value >> 24) & 0xff), ((value >> 16) & 0xff), ((value >> 8) & 0xff), (value & 0xff)] })
          return buffer
        }),
        setTargetAverageWatt: vi.fn().mockImplementation(({ value }) => {
          rawCommands.push({ command: 118, detailCommand: 21, data: [(value >> 8) & 0xff, value & 0xff] })
          return buffer
        }),
        setConfigureWorkout: vi.fn().mockImplementation(({ programmingMode }) => {
          rawCommands.push({ command: 118, detailCommand: 20, data: [programmingMode ? 1 : 0] })
          return buffer
        }),
        setScreenState: vi.fn().mockImplementation(({ screenType, value }) => {
          rawCommands.push({ command: 118, detailCommand: 19, data: [screenType, value] })
          return buffer
        }),
        send: vi.fn().mockResolvedValue(undefined),
        rawCommands,
      }

      return buffer
    }

    const sharedMonitor = {
      _commandTimeout: 0,
      logLevel: 0,
      deviceInfo: { manufacturer: 'Concept2', serial: 'PM5-TEST' },
      logEvent: { sub: vi.fn() },
      connectionStateChangedEvent: { sub: vi.fn() },
      rowingGeneralStatusEvent: { sub: vi.fn() },
      startScan: vi.fn(),
      disconnect: vi.fn(),
      newCsafeBuffer: vi.fn(() => mockBufferFactory()),
      _connectionStateCallback: null as ((prev: number, next: number) => void) | null,
    }

    sharedMonitor.connectionStateChangedEvent.sub = vi.fn((_source: unknown, callback: (prev: number, next: number) => void) => {
      sharedMonitor._connectionStateCallback = callback
    })
    sharedMonitor.startScan = vi.fn(() => {
      sharedMonitor._connectionStateCallback?.(0, 6)
    })

    ;(window as typeof window & { ergometer?: any }).ergometer = {
      ble: { hasWebBlueTooth: () => true },
      PerformanceMonitorBle: class {
        constructor() {
          return sharedMonitor
        }
      },
      LogLevel: { error: 0, debug: 2 },
      MonitorConnectionState: { readyForCommunication: 6 },
    }
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
    vi.clearAllMocks()
  })

  it('hides diagnostics unless diagnostics=1 is present in the URL', async () => {
    window.history.pushState({}, '', '/')
    render(<Pm5WorkoutSender workout={workout} intervals={intervals} />)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))

    expect(screen.queryByText(/No commands sent yet/i)).not.toBeInTheDocument()
  })

  it('disables sending until an estimated 2K time is entered', () => {
    window.localStorage.removeItem('nbrctraining.estimated2kTimeSeconds')
    render(<Pm5WorkoutSender workout={workout} intervals={intervals} />)

    expect(screen.getByRole('button', { name: /^Send workout to PM5$/i })).toBeDisabled()
  })

  it('sends the fixed-time interval protocol without pace', async () => {
    const timeIntervals: Interval[] = [
      {
        id: 'i2',
        workout_id: 'w1',
        interval_code: 'I2',
        interval_order: 1,
        repeat_count: 1,
        work_kind: 'time',
        work_value: 300,
        spm: null,
        recovery_kind: 'time',
        recovery_value: 120,
        target_mode: 'two_k_pace_offset_seconds',
        target_value: 5,
      },
    ]

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={timeIntervals} />)

    const connectButton = screen.getByRole('button', { name: /connect pm5/i })
    await user.click(connectButton)

    const sendButton = screen.getByRole('button', { name: /^Send workout to PM5$/i })
    expect(sendButton).toBeEnabled()
    await user.click(sendButton)

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    const createdBuffers = instance.newCsafeBuffer.mock.results.map((result: any) => result.value)
    expect(createdBuffers.some((buffer: any) => buffer.setConfigureWorkout.mock.calls.length > 0)).toBe(true)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetPaceTime.mock.calls.length > 0)).toBe(false)
    expect(screen.getByText(/Time-based interval/i)).toBeInTheDocument()
    expect(screen.getByText(/fixedTimeInterval.*duration=300s/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/workout sent/i)
    expect(instance.disconnect).toHaveBeenCalledTimes(1)
  })

  it('sends the correct command order for a 5-minute time-based interval', async () => {
    const timeIntervals: Interval[] = [
      {
        id: 'i3',
        workout_id: 'w1',
        interval_code: 'I3',
        interval_order: 1,
        repeat_count: 1,
        work_kind: 'time',
        work_value: 300,
        spm: null,
        recovery_kind: 'time',
        recovery_value: 120,
        target_mode: null,
        target_value: null,
      },
    ]

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={timeIntervals} />)

    const connectButton = screen.getByRole('button', { name: /connect pm5/i })
    await user.click(connectButton)

    const sendButton = screen.getByRole('button', { name: /^Send workout to PM5$/i })
    expect(sendButton).toBeEnabled()

    await user.click(sendButton)

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    expect(instance.newCsafeBuffer).toHaveBeenCalledTimes(2)
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutType).toHaveBeenCalledWith({ value: 6 })
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutDuration).toHaveBeenCalledWith({ value: 30000, durationType: 0 })
    expect(instance.newCsafeBuffer.mock.results[1].value.setRestDuration).toHaveBeenCalledWith({ value: 120 })
    expect(instance.newCsafeBuffer.mock.results[1].value.setConfigureWorkout).toHaveBeenCalledWith({ programmingMode: true })
    expect(instance.newCsafeBuffer.mock.results[1].value.setScreenState).toHaveBeenCalledWith({ screenType: 1, value: 1 })
    expect(screen.getByRole('status')).toHaveTextContent(/workout sent/i)

    expect(screen.getByText(/PM_CONFIGURE_WORKOUT/i)).toBeInTheDocument()
  })

  it('uses variable intervals for a mixed distance and time workout', async () => {
    const mixedIntervals: Interval[] = [
      {
        ...intervals[0],
        repeat_count: 1,
        work_value: 500,
        target_value: 5,
      },
      {
        ...intervals[0],
        id: 'i2',
        interval_code: 'I2',
        interval_order: 2,
        repeat_count: 1,
        work_kind: 'time',
        work_value: 180,
        target_value: 5,
      },
    ]

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={mixedIntervals} />)
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))
    await user.click(screen.getByRole('button', { name: /^Send workout to PM5$/i }))

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    expect(instance.newCsafeBuffer).toHaveBeenCalledTimes(6)
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutType).toHaveBeenCalledWith({ value: 8 })
    expect(instance.newCsafeBuffer.mock.results[0].value.rawCommands.map((command: any) => command.detailCommand)).toEqual([24, 1, 23])
    expect(instance.newCsafeBuffer.mock.results[3].value.setWorkoutIntervalCount).toHaveBeenCalledWith({ value: 1 })
    expect(instance.newCsafeBuffer.mock.results[3].value.setWorkoutType).not.toHaveBeenCalled()
    expect(instance.newCsafeBuffer.mock.results[4].value.setWorkoutDuration).toHaveBeenCalledWith({ value: 18000, durationType: 0 })
    expect(instance.newCsafeBuffer.mock.results[5].value.setTargetPaceTime).toHaveBeenCalled()
    expect(instance.newCsafeBuffer.mock.results[5].value.setScreenState).toHaveBeenCalledWith({ screenType: 1, value: 1 })
    expect(screen.getByRole('status')).toHaveTextContent(/workout sent/i)
  })

  it('requires a PM5 connection before sending the selected workout intervals', async () => {
    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={intervals} />)

    const connectButton = screen.getByRole('button', { name: /connect pm5/i })
    await user.click(connectButton)

    const sendButton = screen.getByRole('button', { name: /^Send workout to PM5$/i })
    expect(sendButton).toBeEnabled()

    await user.click(sendButton)

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    expect(instance.newCsafeBuffer).toHaveBeenCalledTimes(6)
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutIntervalCount).toHaveBeenCalledWith({ value: 0 })
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutType).toHaveBeenCalledWith({ value: 8 })
    expect(instance.newCsafeBuffer.mock.results[0].value.setIntervalType).toHaveBeenCalledWith({ value: 1 })
    expect(screen.getByRole('status')).toHaveTextContent(/workout sent/i)
    expect(screen.getByText(/PM_SET_TARGETPACETIME/i)).toBeInTheDocument()
    expect(screen.getByText(/programmingMode=true/i)).toBeInTheDocument()
    expect(screen.getByText(/programmingMode=true/i)).toBeInTheDocument()
  })

  it('converts multi-stage ramp targets to pace for the PM5', async () => {
    window.localStorage.removeItem('nbrctraining.estimated2kTimeSeconds')
    const rampIntervals: Interval[] = [{
      ...intervals[0],
      work_kind: 'time',
      work_value: 60,
      recovery_kind: null,
      recovery_value: null,
      target_mode: 'watts',
      target_value: 145,
    }, {
      ...intervals[0],
      id: 'i-ramp-2',
      interval_order: 2,
      work_kind: 'time',
      work_value: 60,
      recovery_kind: null,
      recovery_value: null,
      target_mode: 'watts',
      target_value: 160,
    }]

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={rampIntervals} requireEstimated2k={false} sendButtonLabel="Send ramp test to PM5" />)
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))
    await user.click(screen.getByRole('button', { name: /send ramp test to pm5/i }))

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    const createdBuffers = instance.newCsafeBuffer.mock.results.map((result: any) => result.value)
    const pace145 = Math.round(secondsPer500mFromWatts(145) * 100)
    const pace160 = Math.round(secondsPer500mFromWatts(160) * 100)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetPaceTime.mock.calls.some(([arg]: any[]) => arg.value === pace145))).toBe(true)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetPaceTime.mock.calls.some(([arg]: any[]) => arg.value === pace160))).toBe(true)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetAverageWatt.mock.calls.length > 0)).toBe(false)
    const paceTargetBuffers = createdBuffers.filter((buffer: any) => buffer.setTargetPaceTime.mock.calls.length > 0)
    expect(paceTargetBuffers.filter((buffer: any) => buffer.setScreenState.mock.calls.length === 1).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/targetEncoding: pace conversion from watts \(PM_SET_TARGETPACETIME\)/i)).toBeInTheDocument()
  })

  it('adds the screen command to the 10th interval and the final ramp interval', async () => {
    window.localStorage.removeItem('nbrctraining.estimated2kTimeSeconds')
    const rampIntervals: Interval[] = Array.from({ length: 12 }, (_, index) => ({
      ...intervals[0],
      id: `ramp-${index + 1}`,
      interval_order: index + 1,
      work_kind: 'time',
      work_value: 60,
      recovery_kind: null,
      recovery_value: null,
      target_mode: 'watts',
      target_value: 100 + index,
    }))

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={rampIntervals} requireEstimated2k={false} sendButtonLabel="Send ramp test to PM5" />)
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))
    await user.click(screen.getByRole('button', { name: /send ramp test to pm5/i }))

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    const targetBuffers = instance.newCsafeBuffer.mock.results
      .map((result: any) => result.value)
      .filter((buffer: any) => buffer.setTargetPaceTime.mock.calls.length > 0)
    const screenTargetBuffers = targetBuffers.filter((buffer: any) => buffer.setScreenState.mock.calls.length === 1)
    expect(screenTargetBuffers.length).toBe(1)
    const targetBufferMeta = targetBuffers.map((buffer: any) => ({
      target: buffer.setTargetPaceTime.mock.calls[0]?.[0]?.value,
      screenCalls: buffer.setScreenState.mock.calls.length,
    }))
    expect(targetBufferMeta.filter((entry) => entry.screenCalls === 1)).toHaveLength(1)
    expect(targetBufferMeta.at(-1)?.screenCalls).toBe(1)
  })

  it('caps variable-interval workouts at 10 intervals for the PM5', async () => {
    const longIntervals: Interval[] = Array.from({ length: 12 }, (_, index) => ({
      ...intervals[0],
      id: `long-${index + 1}`,
      interval_order: index + 1,
      work_kind: 'time',
      work_value: 120,
      recovery_kind: null,
      recovery_value: null,
      target_mode: 'two_k_pace_offset_seconds',
      target_value: 5,
    }))

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={longIntervals} />)
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))
    await user.click(screen.getByRole('button', { name: /^Send workout to PM5$/i }))

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    const setupCalls = instance.newCsafeBuffer.mock.results
      .map((result: any) => result.value)
      .filter((buffer: any) => buffer.setWorkoutIntervalCount.mock.calls.length > 0)
      .map((buffer: any) => buffer.setWorkoutIntervalCount.mock.calls[0][0].value)

    expect(setupCalls.some((value: number) => value >= 10)).toBe(false)
    expect(setupCalls.length).toBeLessThanOrEqual(10)
    expect(setupCalls).toHaveLength(10)
  })

  it('sends more than 10 variable intervals when none has a pace target', async () => {
    const targetlessIntervals: Interval[] = Array.from({ length: 12 }, (_, index) => ({
      ...intervals[0],
      id: `targetless-${index + 1}`,
      interval_order: index + 1,
      repeat_count: 1,
      work_kind: 'time',
      work_value: 120,
      recovery_kind: null,
      recovery_value: null,
      target_mode: null,
      target_value: null,
    }))

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={targetlessIntervals} />)
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))
    await user.click(screen.getByRole('button', { name: /^Send workout to PM5$/i }))

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    const createdBuffers = instance.newCsafeBuffer.mock.results.map((result: any) => result.value)
    const setupBuffers = createdBuffers.filter((buffer: any) => buffer.setWorkoutIntervalCount.mock.calls.length > 0)

    expect(setupBuffers).toHaveLength(12)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetPaceTime.mock.calls.length > 0)).toBe(false)
  })

  it('sends a single-stage ramp target as watts for the fixed-time protocol', async () => {
    window.localStorage.removeItem('nbrctraining.estimated2kTimeSeconds')
    const rampInterval: Interval[] = [{
      ...intervals[0],
      work_kind: 'time',
      work_value: 60,
      repeat_count: 1,
      recovery_kind: null,
      recovery_value: null,
      target_mode: 'watts',
      target_value: 250,
    }]

    const user = userEvent.setup()
    render(<Pm5WorkoutSender workout={workout} intervals={rampInterval} requireEstimated2k={false} sendButtonLabel="Send ramp test to PM5" />)
    await user.click(screen.getByRole('button', { name: /connect pm5/i }))
    await user.click(screen.getByRole('button', { name: /send ramp test to pm5/i }))

    const pm5Monitor = (window as typeof window & { ergometer?: any }).ergometer.PerformanceMonitorBle
    const instance = new pm5Monitor()
    const createdBuffers = instance.newCsafeBuffer.mock.results.map((result: any) => result.value)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetAverageWatt.mock.calls.some(([arg]: any[]) => arg.value === 250))).toBe(true)
    expect(createdBuffers.some((buffer: any) => buffer.setTargetPaceTime.mock.calls.length > 0)).toBe(false)
  })
})
