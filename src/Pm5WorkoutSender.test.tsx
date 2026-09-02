import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Pm5WorkoutSender from './Pm5WorkoutSender'
import type { Workout, Interval } from './api'

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
    expect(instance.newCsafeBuffer).toHaveBeenCalledTimes(7)
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutType).toHaveBeenCalledWith({ value: 8 })
    expect(instance.newCsafeBuffer.mock.results[3].value.setWorkoutIntervalCount).toHaveBeenCalledWith({ value: 1 })
    expect(instance.newCsafeBuffer.mock.results[4].value.setWorkoutDuration).toHaveBeenCalledWith({ value: 18000, durationType: 0 })
    expect(instance.newCsafeBuffer.mock.results[5].value.setTargetPaceTime).toHaveBeenCalled()
    expect(instance.newCsafeBuffer.mock.results[6].value.setScreenState).toHaveBeenCalledWith({ screenType: 1, value: 1 })
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
    expect(instance.newCsafeBuffer).toHaveBeenCalledTimes(7)
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutIntervalCount).toHaveBeenCalledWith({ value: 0 })
    expect(instance.newCsafeBuffer.mock.results[0].value.setWorkoutType).toHaveBeenCalledWith({ value: 8 })
    expect(instance.newCsafeBuffer.mock.results[0].value.setIntervalType).toHaveBeenCalledWith({ value: 1 })
    expect(screen.getByRole('status')).toHaveTextContent(/workout sent/i)
    expect(screen.getByText(/PM_SET_TARGETPACETIME/i)).toBeInTheDocument()
    expect(screen.getByText(/programmingMode=true/i)).toBeInTheDocument()
    expect(screen.getByText(/programmingMode=true/i)).toBeInTheDocument()
  })
})
