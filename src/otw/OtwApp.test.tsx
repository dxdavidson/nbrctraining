import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OtwWorkout } from '../api'
import type { CachedOtwWorkout, OtwSession } from './sessionStore'

const mocks = vi.hoisted(() => ({
  fetchOtwWorkouts: vi.fn(async (): Promise<OtwWorkout[]> => []),
  appendOtwRecord: vi.fn(async () => {}),
  createOtwSession: vi.fn((mode: 'just-row' | 'workout' | 'race' = 'just-row') => ({
    id: 'session-1',
    mode,
    workoutId: null,
    workoutName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    elapsedSeconds: 0,
    records: [],
    laps: [],
  })),
  deleteOtwSession: vi.fn(async () => {}),
  deleteCompletedOtwSessions: vi.fn(async () => {}),
  getCachedOtwWorkouts: vi.fn(async (): Promise<CachedOtwWorkout[]> => []),
  getCompletedOtwSessions: vi.fn(async (): Promise<OtwSession[]> => [{
    id: 'completed-session',
    mode: 'just-row' as const,
    workoutId: null,
    workoutName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:10:00.000Z',
    elapsedSeconds: 600,
    records: [],
    laps: [],
  }]),
  saveOtwSession: vi.fn<(session: OtwSession) => Promise<void>>(async () => {}),
  saveOtwWorkouts: vi.fn(async () => {}),
  downloadFitSession: vi.fn<(session: OtwSession) => void>(),
  strava: {
    connection: { connected: false } as { connected: boolean; athleteId?: string; athleteName?: string },
    athleteId: null as string | null,
    message: null as string | null,
    revision: 0,
    sync: vi.fn(async () => {}),
    upload: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
  },
}))

vi.mock('../api', () => ({ fetchOtwWorkouts: mocks.fetchOtwWorkouts, stravaLoginUrl: '/auth/strava/login' }))
vi.mock('./sessionStore', () => ({
  appendOtwRecord: mocks.appendOtwRecord,
  createOtwSession: mocks.createOtwSession,
  deleteOtwSession: mocks.deleteOtwSession,
  deleteCompletedOtwSessions: mocks.deleteCompletedOtwSessions,
  getCachedOtwWorkouts: mocks.getCachedOtwWorkouts,
  getCompletedOtwSessions: mocks.getCompletedOtwSessions,
  saveOtwSession: mocks.saveOtwSession,
  saveOtwWorkouts: mocks.saveOtwWorkouts,
}))
vi.mock('./fitExport', () => ({ downloadFitSession: mocks.downloadFitSession }))
vi.mock('./useScreenAwake', () => ({ useScreenAwake: () => 'disabled' }))
vi.mock('./useStrava', () => ({ useStrava: () => mocks.strava }))

import OtwApp from './OtwApp'

const originalGeolocation = Object.getOwnPropertyDescriptor(navigator, 'geolocation')

function workout(
  id: string,
  blockCode: string,
  description: string,
  kind: 'time' | 'distance',
  value: number,
  repeats = 2,
): OtwWorkout {
  return {
    id,
    workout_code: id,
    description,
    plan_title: 'On The Water Workouts',
    block_title: blockCode === 'DISTANCE' ? 'Distance Intervals' : 'Time Intervals',
    block_code: blockCode,
    intervals: [{
      id: `${id}-interval`,
      workout_id: id,
      interval_code: 'Work',
      interval_order: 1,
      repeat_count: repeats,
      work_kind: kind,
      work_value: value,
      recovery_kind: 'time',
      recovery_value: 2,
      spm: null,
      target_mode: null,
      target_value: null,
    }],
  }
}

describe('OtwApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mocks.strava.connection = { connected: false }
    mocks.strava.athleteId = null
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation)
    else Reflect.deleteProperty(navigator, 'geolocation')
    vi.restoreAllMocks()
  })

  it('finishes a paused session without downloading FIT and starts a new session', async () => {
    const user = userEvent.setup()
    const { container } = render(<OtwApp />)

    expect(container.querySelectorAll('.otw-metric')).toHaveLength(6)
    expect(screen.getByText('Distance (meters)')).toBeInTheDocument()
    expect(screen.getByText('Pace (min / 500 m)')).toBeInTheDocument()
    expect(screen.getByText('Avg Pace (min / 500 m)')).toBeInTheDocument()
    expect(screen.getByText('Stroke Rate (SPM)')).toBeInTheDocument()
    expect(container.querySelector('.otw-metric-value')?.textContent).toBe('0')
    expect(screen.getByText('Elapsed Time')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stroke rate unavailable. Tap to record a catch.' })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /^(Start|Pause|Resume|Finish)$/ })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('otw-button-primary')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('otw-button-pause')
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Resume' })).toHaveClass('otw-button-resume')
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
    expect(screen.getByRole('button', { name: 'Start' })).toHaveClass('otw-button-primary')
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
    expect(mocks.appendOtwRecord).toHaveBeenCalledWith(
      'session-1',
      0,
      expect.objectContaining({ elapsedSeconds: 0, cadence: null }),
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.otw-metric-value')?.textContent).toBe('0')
  })

  it('queues a completed session for the connected Strava athlete', async () => {
    mocks.strava.connection = { connected: true, athleteId: '123', athleteName: 'Rower' }
    mocks.strava.athleteId = '123'
    const user = userEvent.setup()
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({
      endedAt: expect.any(String), stravaAthleteId: '123', stravaStatus: 'pending',
    })))
    await waitFor(() => expect(mocks.strava.sync).toHaveBeenCalled())
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('does not automatically queue a session after a recording storage error', async () => {
    mocks.strava.connection = { connected: true, athleteId: '123' }
    mocks.strava.athleteId = '123'
    const user = userEvent.setup()
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Pause' })
    mocks.appendOtwRecord.mockRejectedValueOnce(new Error('Storage unavailable'))
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await screen.findByText(/Recording storage error: Storage unavailable/)
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
    expect(mocks.saveOtwSession).not.toHaveBeenCalledWith(expect.objectContaining({ stravaStatus: 'pending' }))
    expect(mocks.strava.sync).not.toHaveBeenCalled()
  })

  it('updates average pace every five seconds while current pace stays responsive', async () => {
    vi.useFakeTimers()
    try {
      let onPosition: PositionCallback | undefined
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
          clearWatch: vi.fn(),
        },
      })
      render(<OtwApp />)
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
      expect(onPosition).toBeDefined()
      const metricValue = (label: string) => screen.getByText(label).parentElement?.querySelector('strong')
      const sendPosition = (meters: number) => act(() => onPosition?.({
        coords: {
          latitude: 51 + meters / 111_195, longitude: 0, accuracy: 4, speed: null,
          heading: null, altitude: null, altitudeAccuracy: null, toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      }))
      sendPosition(0)
      act(() => { vi.advanceTimersByTime(1000) })
      sendPosition(6)
      expect(metricValue('Pace (min / 500 m)')).toHaveTextContent('01:23')
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('--:--')

      act(() => { vi.advanceTimersByTime(3000) })
      sendPosition(15)
      expect(metricValue('Pace (min / 500 m)')).toHaveTextContent('01:51')
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('--:--')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('02:47')

      act(() => { vi.advanceTimersByTime(1000) })
      sendPosition(27)
      expect(metricValue('Pace (min / 500 m)')).toHaveTextContent('01:40')
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('02:47')
      act(() => { vi.advanceTimersByTime(4000) })
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('03:05')
      act(() => { vi.advanceTimersByTime(1000) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause' })) })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish' })) })
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('03:24')
      fireEvent.click(screen.getByRole('button', { name: 'Race' }))
      expect(metricValue('Avg Pace (min / 500 m)')).toHaveTextContent('--:--')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the sampled average at work and recovery boundaries', async () => {
    vi.useFakeTimers()
    let unmount: (() => void) | undefined
    try {
      let onPosition: PositionCallback | undefined
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: {
          watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
          clearWatch: vi.fn(),
        },
      })
      mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Interval average', 'time', 6)])
      unmount = render(<OtwApp />).unmount
      await act(async () => {})
      fireEvent.click(screen.getByRole('button', { name: 'Intervals' }))
      fireEvent.click(screen.getByRole('button', { name: 'Interval average' }))
      fireEvent.click(screen.getByRole('button', { name: 'Load Workout' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
      expect(onPosition).toBeDefined()
      const sendPosition = (meters: number) => act(() => onPosition?.({
        coords: {
          latitude: 51 + meters / 111_195, longitude: 0, accuracy: 4, speed: null,
          heading: null, altitude: null, altitudeAccuracy: null, toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      }))
      const average = () => screen.getByText('Avg Pace (min / 500 m)').parentElement?.querySelector('strong')
      sendPosition(0)
      act(() => { vi.advanceTimersByTime(4000) })
      sendPosition(12)
      act(() => { vi.advanceTimersByTime(1000) })
      expect(average()).toHaveTextContent('03:28')
      act(() => { vi.advanceTimersByTime(1000) })
      expect(screen.getByText('Recovery, 1 of 2 intervals completed')).toBeInTheDocument()
      expect(average()).toHaveTextContent('--:--')
      act(() => { vi.advanceTimersByTime(2000) })
      expect(screen.getByText('Interval 2 of 2')).toBeInTheDocument()
      expect(average()).toHaveTextContent('--:--')
    } finally {
      unmount?.()
      vi.useRealTimers()
    }
  })

  it('shows mode buttons in the header, not the menu, and locks them during a session', async () => {
    const user = userEvent.setup()
    render(<OtwApp />)

    expect(screen.queryByText('Just Row', { selector: 'p' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Just Row' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('On the Water')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More options' }))
    const menu = document.getElementById('otw-menu')
    if (!menu) throw new Error('Options menu did not open.')
    expect(within(menu).getByRole('link', { name: 'Training Plan' })).toHaveAttribute('href', './index.html')
    expect(within(menu).queryByRole('button', { name: /^(Just Row|Race|Intervals)$/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.queryByText('Race', { selector: 'p' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race' })).toHaveAttribute('aria-pressed', 'true')

    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '100')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    expect(screen.getByText('Recording')).toBeInTheDocument()
    for (const name of ['Just Row', 'Race', 'Intervals']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    expect(screen.getByRole('dialog', { name: 'OTW Workouts' })).toBeInTheDocument()
  })

  it('clears session readings when switching modes without deleting saved sessions', async () => {
    const user = userEvent.setup()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    window.localStorage.setItem('nbrctraining.otw.raceDistance', '100')
    let onPosition: PositionCallback | undefined
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
        clearWatch: vi.fn(),
      },
    })
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Long workout', 'time', 600, 1)])
    render(<OtwApp />)

    const metric = (label: string) => screen.getByText(label).closest('.otw-metric')
    const expectClearedReadings = () => {
      expect(metric('Distance (meters)')).toHaveTextContent('0')
      expect(metric('Elapsed Time')).toHaveTextContent('00:00:00')
      expect(metric('Pace (min / 500 m)')).toHaveTextContent('--:--')
      expect(metric('Avg Pace (min / 500 m)')).toHaveTextContent('--:--')
      expect(screen.getByRole('button', { name: /^Stroke rate unavailable/ })).toHaveTextContent('--')
    }
    const recordAndStop = async () => {
      onPosition = undefined
      await user.click(screen.getByRole('button', { name: 'Start' }))
      await waitFor(() => expect(onPosition).toBeDefined())
      const sendPosition = (meters: number) => act(() => onPosition?.({
        coords: {
          latitude: 51 + meters / 111_195, longitude: 0, accuracy: 4, speed: null,
          heading: null, altitude: null, altitudeAccuracy: null, toJSON: () => ({}),
        },
        timestamp: now,
        toJSON: () => ({}),
      }))
      sendPosition(0)
      await user.click(screen.getByRole('button', { name: /^Stroke rate/ }))
      now += 2000
      sendPosition(6)
      await user.click(screen.getByRole('button', { name: /^Stroke rate/ }))
      await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
      expect(metric('Distance (meters)')).toHaveTextContent('6')
      expect(metric('Elapsed Time')).toHaveTextContent('00:00:02')
      expect(metric('Pace (min / 500 m)')).not.toHaveTextContent('--:--')
      expect(screen.getByRole('button', { name: /^Stroke rate 30/ })).toBeInTheDocument()
    }

    await recordAndStop()
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expectClearedReadings()
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(100)

    await recordAndStop()
    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(metric('Distance (meters)')).toHaveTextContent('6')
    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Long workout' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expectClearedReadings()
    expect(metric('Remaining')).toHaveTextContent('10:00')

    await recordAndStop()
    await user.click(within(screen.getByRole('dialog', { name: 'Workout summary' })).getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Just Row' }))
    expectClearedReadings()
    expect(metric('Remaining')).toHaveTextContent('0')
    expect(mocks.deleteOtwSession).not.toHaveBeenCalled()
    expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) }))
  })

  it('counts down race distance past zero and restores the target after finish and reload', async () => {
    const user = userEvent.setup()
    let onPosition: PositionCallback | undefined
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
        clearWatch: vi.fn(),
      },
    })
    const { unmount } = render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Race' }))
    const input = screen.getByRole('spinbutton', { name: 'Race distance (meters)' })
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    await user.type(input, '5')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    expect(onPosition).toBeDefined()

    const sendPosition = (meters: number, timestamp: number) => {
      onPosition?.({
        coords: {
          latitude: 51 + meters / 111_195,
          longitude: 0,
          accuracy: 4,
          speed: null,
          heading: null,
          altitude: null,
          altitudeAccuracy: null,
          toJSON: () => ({}),
        },
        timestamp,
        toJSON: () => ({}),
      })
    }
    const start = Date.now()
    act(() => {
      sendPosition(0, start)
      sendPosition(2.5, start + 1000)
    })
    expect(screen.getByText('3 m')).toBeInTheDocument()
    const remaining = screen.getByText('Remaining').closest('.otw-metric')
    expect(remaining).not.toHaveClass('otw-metric-race-complete')
    act(() => sendPosition(4.6, start + 2000))
    expect(screen.getByText('0 m')).toBeInTheDocument()
    expect(remaining).toHaveClass('otw-metric-race-complete')
    expect(screen.getByText('Target reached')).toBeInTheDocument()
    act(() => sendPosition(7, start + 3000))
    expect(screen.getByText('-2 m')).toBeInTheDocument()
    expect(remaining).toHaveClass('otw-metric-race-complete')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    const pace = screen.getByText('Pace (min / 500 m)').parentElement?.querySelector('strong')?.textContent

    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(remaining).toHaveClass('otw-metric-race-complete')
    expect(screen.getByText('-2 m')).toBeInTheDocument()
    expect(screen.getByText('Pace (min / 500 m)').parentElement?.querySelector('strong')?.textContent).toBe(pace)
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
    const saved = mocks.saveOtwSession.mock.calls.map(([session]) => session).find((session) => session.endedAt !== null)
    expect(saved?.records.at(-1)?.distanceMeters).toBeGreaterThan(6.9)
    expect(saved?.records.at(-1)?.latitude).not.toBeNull()
    await waitFor(() => expect(mocks.appendOtwRecord).toHaveBeenCalledWith(
      'session-1',
      expect.any(Number),
      expect.objectContaining({ distanceMeters: saved?.records.at(-1)?.distanceMeters }),
    ))
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('5')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    expect(screen.getByText('5 m')).toBeInTheDocument()
    expect(remaining).not.toHaveClass('otw-metric-race-complete')
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(5)
    await user.click(screen.getByRole('button', { name: 'Just Row' }))
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(5)

    unmount()
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(5)
    await user.clear(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '12')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('12')
  })

  it('saves entered race distance immediately and restores it after mode changes and reload', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('nbrctraining.otw.raceDistance', '750')
    const { unmount } = render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Race' }))
    const input = screen.getByRole('spinbutton', { name: 'Race distance (meters)' })
    await user.clear(input)
    await user.type(input, '0')
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('750')
    await user.clear(input)
    await user.type(input, '500')
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('500')

    await user.click(screen.getByRole('button', { name: 'Just Row' }))
    const remaining = screen.getByText('Remaining').closest('.otw-metric')
    if (!(remaining instanceof HTMLElement)) throw new Error('Remaining field was not found.')
    expect(within(remaining).getByText('0')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(500)

    await user.clear(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '300')
    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(300)

    unmount()
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(300)
  })

  it('shows an error when the race distance cannot be saved', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Race' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '100')
    expect(screen.getByRole('alert')).toHaveTextContent('Race distance could not be saved: Storage unavailable')
    await user.click(screen.getByRole('button', { name: 'Just Row' }))
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(100)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Race distance could not be saved: Storage unavailable')
  })

  it('locks mode selection while the session is starting', async () => {
    const user = userEvent.setup()
    let finishSave: () => void = () => {}
    mocks.saveOtwSession.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve }))
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(screen.getByRole('button', { name: 'Race' })).toBeDisabled()
    await act(async () => { finishSave() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
  })

  it('retains the current workout interval values after stopping', async () => {
    const user = userEvent.setup()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('workout-1', 'TIME', 'Long row', 'time', 600, 1)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Long row' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('10:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    expect(screen.getByText('10:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(screen.getByText('10:00')).toBeInTheDocument()
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ mode: 'workout', endedAt: expect.any(String) })))
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('classifies and filters workouts by work intervals rather than their blocks', async () => {
    const user = userEvent.setup()
    const mixed = workout('mixed-1', 'OTHER', 'Mixed workout', 'distance', 500)
    mixed.intervals.push({ ...mixed.intervals[0], id: 'mixed-time', interval_order: 2, work_kind: 'time', work_value: 180 })
    const noIntervals = { ...workout('none-1', 'OTHER', 'No intervals', 'time', 180), intervals: [] }
    const invalid = workout('invalid-1', 'OTHER', 'Invalid interval', 'time', 180)
    invalid.intervals[0].work_kind = null
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([
      workout('distance-1', 'OTHER', '8x500m (2 min rest)', 'distance', 500, 8),
      workout('time-1', 'DISTANCE', '2x3 min (2 min rest)', 'time', 180),
      mixed,
      noIntervals,
      invalid,
    ])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    expect(screen.getByRole('dialog', { name: 'OTW Workouts' })).toBeInTheDocument()
    const table = await screen.findByRole('table', { name: 'OTW workouts' })
    await within(table).findByRole('button', { name: '8x500m (2 min rest)' })
    expect(screen.queryByText('OTW workouts updated from the server and saved for offline use.')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load Workout' })).toBeDisabled()
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual(['Description', 'Intervals'])
    for (const [description, category] of [
      ['8x500m (2 min rest)', 'Distance'],
      ['2x3 min (2 min rest)', 'Time'],
      ['Mixed workout', 'Mixed'],
      ['No intervals', 'None'],
      ['Invalid interval', 'Invalid'],
    ]) {
      expect(within(table).getByRole('button', { name: description }).closest('tr')).toHaveTextContent(category)
    }
    expect(screen.getByRole('status')).toHaveTextContent('unrecognized work interval types')
    expect(screen.getByRole('button', { name: 'Just Row' })).toHaveAttribute('aria-pressed', 'true')

    const filter = screen.getByLabelText('Filter by')
    for (const [category, description] of [
      ['Distance', '8x500m (2 min rest)'],
      ['Time', '2x3 min (2 min rest)'],
      ['Mixed', 'Mixed workout'],
      ['None', 'No intervals'],
      ['Invalid', 'Invalid interval'],
    ]) {
      await user.selectOptions(filter, category)
      expect(within(table).getAllByRole('button')).toHaveLength(1)
      expect(within(table).getByRole('button', { name: description })).toBeInTheDocument()
    }
    await user.selectOptions(filter, 'All')
    await user.click(within(table).getByRole('button', { name: '8x500m (2 min rest)' }))
    expect(within(table).getByRole('button', { name: '8x500m (2 min rest)' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Just Row' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Intervals' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('500 m')).toBeInTheDocument()
    expect(screen.getByText('Interval 1 of 8')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(screen.getByRole('button', { name: '2x3 min (2 min rest)' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    expect(screen.getByRole('button', { name: '8x500m (2 min rest)' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '2x3 min (2 min rest)' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('03:00')).toBeInTheDocument()
    expect(screen.getByText('Interval 1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.selectOptions(screen.getByLabelText('Filter by'), 'Mixed')
    await user.click(screen.getByRole('button', { name: 'Mixed workout' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
  })

  it('shows recovery countdown and the next work interval while recording', async () => {
    const user = userEvent.setup()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Three short intervals', 'time', 3, 3)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Three short intervals' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('00:03')).toBeInTheDocument()
    expect(screen.getByText('Remaining').parentElement).not.toHaveClass('otw-metric-recovery')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())

    now += 3000
    expect(await screen.findByText('Recovery, 1 of 3 intervals completed')).toBeInTheDocument()
    expect(screen.getByText('Next interval starts in').parentElement).toHaveClass('otw-metric-recovery')
    expect(screen.getByText('00:02')).toBeInTheDocument()
    now += 1000
    expect(await screen.findByText('00:01')).toBeInTheDocument()
    now += 1000
    expect(await screen.findByText('Interval 2 of 3')).toBeInTheDocument()
    expect(screen.getByText('Remaining').parentElement).not.toHaveClass('otw-metric-recovery')
    expect(screen.getByText('00:03')).toBeInTheDocument()
    now += 3000
    expect(await screen.findByText('Recovery, 2 of 3 intervals completed')).toBeInTheDocument()
    now += 2000
    expect(await screen.findByText('Interval 3 of 3')).toBeInTheDocument()
    now += 3000
    expect(await screen.findByRole('dialog', { name: 'Workout summary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('summarizes completed work intervals without recovery when a workout finishes', async () => {
    const user = userEvent.setup()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let onPosition: PositionCallback | undefined
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
        clearWatch: vi.fn(),
      },
    })
    const sendPosition = (meters: number) => act(() => onPosition?.({
      coords: {
        latitude: 51 + meters / 111_195, longitude: 0, accuracy: 4, speed: null,
        heading: null, altitude: null, altitudeAccuracy: null, toJSON: () => ({}),
      },
      timestamp: now,
      toJSON: () => ({}),
    }))
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Summary workout', 'time', 3)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Summary workout' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(onPosition).toBeDefined())
    sendPosition(0)
    now += 3000
    sendPosition(6)
    await screen.findByText('Next interval starts in')
    now += 2000
    sendPosition(10)
    await screen.findByText('Interval 2 of 2')
    now += 3000
    sendPosition(19)

    const dialog = await screen.findByRole('dialog', { name: 'Workout summary' })
    const rows = within(dialog).getAllByRole('row')
    expect(rows).toHaveLength(4)
    expect(within(dialog).queryByText(/Completed work intervals only/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(Array.from(rows[1].children, (cell) => cell.textContent)).toEqual(['1/2', '00:00:03', '6', '04:10'])
    expect(Array.from(rows[2].children, (cell) => cell.textContent)).toEqual(['2/2', '00:00:03', '9', '02:47'])
    expect(Array.from(rows[3].children, (cell) => cell.textContent)).toEqual(['Total', '00:00:06', '15', '03:20'])
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({
      endedAt: expect.any(String),
      laps: [expect.objectContaining({ kind: 'work' }), expect.objectContaining({ kind: 'recovery' }), expect.objectContaining({ kind: 'work' })],
    })))
  })

  it('omits unfinished intervals on Stop and reports when none are completed', async () => {
    const user = userEvent.setup()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const partial = workout('time-1', 'TIME', 'Partial workout', 'time', 3)
    partial.intervals.push({ ...partial.intervals[0], id: 'other-interval', interval_code: 'Other', interval_order: 2, repeat_count: 1 })
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([partial])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Partial workout' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    now += 3000
    await screen.findByText('Next interval starts in')
    now += 2000
    await screen.findByText('Interval 2 of 3')
    now += 1000
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))

    let dialog = screen.getByRole('dialog', { name: 'Workout summary' })
    expect(within(dialog).getAllByRole('row')).toHaveLength(3)
    expect(Array.from(within(dialog).getByRole('row', { name: /^1\/3/ }).children, (cell) => cell.textContent)).toEqual(['1/3', '00:00:03', '0', '--:--'])
    expect(Array.from(within(dialog).getByRole('row', { name: /Total/ }).children, (cell) => cell.textContent)).toEqual(['Total', '00:00:03', '0', '--:--'])
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({
      endedAt: expect.any(String),
      laps: [expect.objectContaining({ kind: 'work' }), expect.objectContaining({ kind: 'recovery' }), expect.objectContaining({ kind: 'work' })],
    })))
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    dialog = screen.getByRole('dialog', { name: 'Workout summary' })
    expect(within(dialog).getByText('No intervals completed.')).toBeInTheDocument()
    expect(Array.from(within(dialog).getByRole('row', { name: /Total/ }).children, (cell) => cell.textContent)).toEqual(['Total', '00:00:00', '0', '--:--'])
  })

  it('includes an interval completed just before Stop, before the next timer tick', async () => {
    const user = userEvent.setup()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Boundary workout', 'time', 3)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Boundary workout' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    now += 3000
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish' }))
    const dialog = screen.getByRole('dialog', { name: 'Workout summary' })
    expect(Array.from(within(dialog).getByRole('row', { name: /^1\/2/ }).children, (cell) => cell.textContent)).toEqual(['1/2', '00:00:03', '0', '--:--'])
  })

  it('moves from a distance interval to its timed recovery', async () => {
    const user = userEvent.setup()
    let onPosition: PositionCallback | undefined
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
        clearWatch: vi.fn(),
      },
    })
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('distance-1', 'DISTANCE', 'Two distances', 'distance', 5)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Two distances' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('5 m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())

    const timestamp = Date.now()
    const sendPosition = (meters: number, time: number) => onPosition?.({
      coords: {
        latitude: 51 + meters / 111_195,
        longitude: 0,
        accuracy: 4,
        speed: null,
        heading: null,
        altitude: null,
        altitudeAccuracy: null,
        toJSON: () => ({}),
      },
      timestamp: time,
      toJSON: () => ({}),
    })
    act(() => {
      sendPosition(0, timestamp)
      sendPosition(6, timestamp + 1000)
    })
    expect(await screen.findByText('Recovery, 1 of 2 intervals completed')).toBeInTheDocument()
    expect(screen.getByText('00:02')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
  })

  it('finishes a distance workout as soon as its final interval ends', async () => {
    const user = userEvent.setup()
    let onPosition: PositionCallback | undefined
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (callback: PositionCallback) => { onPosition = callback; return 1 },
        clearWatch: vi.fn(),
      },
    })
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('distance-1', 'DISTANCE', 'Single distance', 'distance', 5, 1)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Single distance' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(onPosition).toBeDefined())
    const timestamp = Date.now()
    const sendPosition = (meters: number, time: number) => onPosition?.({
      coords: {
        latitude: 51 + meters / 111_195, longitude: 0, accuracy: 4, speed: null,
        heading: null, altitude: null, altitudeAccuracy: null, toJSON: () => ({}),
      },
      timestamp: time,
      toJSON: () => ({}),
    })
    act(() => {
      sendPosition(0, timestamp)
      sendPosition(6, timestamp + 1000)
    })

    const dialog = await screen.findByRole('dialog', { name: 'Workout summary' })
    expect(within(dialog).getByRole('row', { name: /^1\/1/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('shows older cached workouts offline', async () => {
    const user = userEvent.setup()
    const oldCached: CachedOtwWorkout = workout('cached', 'DISTANCE', 'Cached distance', 'distance', 500)
    delete oldCached.block_code
    mocks.getCachedOtwWorkouts.mockResolvedValueOnce([oldCached])
    mocks.fetchOtwWorkouts.mockRejectedValueOnce(new Error('Offline'))
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    const table = await screen.findByRole('table', { name: 'OTW workouts' })
    await within(table).findByRole('button', { name: 'Cached distance' })
    await user.selectOptions(screen.getByLabelText('Filter by'), 'Time')
    expect(screen.getByText('No workouts match this filter.')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Filter by'), 'All')
    await user.click(within(table).getByRole('button', { name: 'Cached distance' }))
    expect(screen.getByText('Offline copy is ready.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
  })

  it('reports an invalid workout without selecting it', async () => {
    const user = userEvent.setup()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([{ ...workout('invalid', 'TIME', 'Missing intervals', 'time', 3), intervals: [] }])
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'Intervals' }))
    await user.click(await screen.findByRole('button', { name: 'Missing intervals' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This OTW workout has no usable intervals.')
    expect(screen.getByRole('button', { name: 'Just Row' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('freezes race progress during pause and excludes movement until a new GPS baseline', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem('nbrctraining.otw.raceDistance', '100')
    const watchers: PositionCallback[] = []
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        watchPosition: (callback: PositionCallback) => { watchers.push(callback); return watchers.length },
        clearWatch: vi.fn(),
      },
    })
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Race' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    const position = (watcher: PositionCallback, meters: number) => act(() => watcher({
      coords: {
        latitude: 51 + meters / 111_195, longitude: 0, accuracy: 4, speed: null,
        heading: null, altitude: null, altitudeAccuracy: null, toJSON: () => ({}),
      },
      timestamp: Date.now(),
      toJSON: () => ({}),
    }))
    position(watchers[0], 0)
    await act(async () => { vi.advanceTimersByTime(1000) })
    position(watchers[0], 6)
    expect(screen.getByText('94 m')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause' })) })
    expect(screen.getByText('Paused')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Finish' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Race' })).toBeDisabled()
    const writesAtPause = mocks.appendOtwRecord.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(10000) })
    position(watchers[0], 100)
    expect(screen.getByText('94 m')).toBeInTheDocument()
    expect(screen.getByText('Elapsed Time').parentElement?.querySelector('strong')).toHaveTextContent('00:00:01')
    expect(mocks.appendOtwRecord).toHaveBeenCalledTimes(writesAtPause)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Resume' })) })
    expect(watchers).toHaveLength(2)
    position(watchers[0], 100)
    position(watchers[1], 100)
    expect(screen.getByText('94 m')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(1000) })
    position(watchers[1], 106)
    expect(screen.getByText('88 m')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish' })) })
    const saved = mocks.saveOtwSession.mock.calls.map(([item]) => item).find((item) => item.endedAt !== null)
    expect(saved?.elapsedSeconds).toBe(2)
    expect(saved?.records.filter((record) => record.timerEvent).map((record) => record.timerEvent)).toEqual(['pause', 'resume', 'pause'])
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(1)
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('freezes work and recovery intervals while paused and finishes automatically', async () => {
    vi.useFakeTimers()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Paused intervals', 'time', 3)])
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Intervals' }))
    fireEvent.click(screen.getByRole('button', { name: 'Paused intervals' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Workout' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    await act(async () => { vi.advanceTimersByTime(2000) })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByText('Paused - Interval 1 of 2')).toBeInTheDocument()
    expect(screen.getByText('00:01')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('00:01')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(screen.getByText('Recovery, 1 of 2 intervals completed')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await act(async () => { vi.advanceTimersByTime(10000) })
    expect(screen.getByText('Paused - Recovery, 1 of 2 intervals completed')).toBeInTheDocument()
    expect(screen.getByText('00:02')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('Interval 2 of 2')).toBeInTheDocument()
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(screen.getByRole('dialog', { name: 'Workout summary' })).toBeInTheDocument()
    expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String), elapsedSeconds: 8 }))
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('marks a recovery interrupted by Finish as recovery rather than work', async () => {
    vi.useFakeTimers()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Finish during recovery', 'time', 3)])
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Intervals' }))
    fireEvent.click(screen.getByRole('button', { name: 'Finish during recovery' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Workout' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    await act(async () => { vi.advanceTimersByTime(4000) })
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish' })) })
    expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({
      endedAt: expect.any(String),
      laps: [expect.objectContaining({ kind: 'work' }), expect.objectContaining({ kind: 'recovery' })],
    }))
  })

  it.each(['Space', 'Escape'])('uses %s to start, pause and resume without remote finish or reset', async (code) => {
    vi.useFakeTimers()
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.keyDown(window, { code })
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    await act(async () => { fireEvent.keyUp(window, { code }) })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    await act(async () => { vi.advanceTimersByTime(350) })
    fireEvent.keyDown(window, { code })
    await act(async () => { fireEvent.keyUp(window, { code }) })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    fireEvent.keyDown(window, { code })
    await act(async () => { vi.advanceTimersByTime(3000) })
    await act(async () => { fireEvent.keyUp(window, { code }) })
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled()
    expect(mocks.deleteOtwSession).not.toHaveBeenCalled()
    expect(mocks.saveOtwSession.mock.calls.some(([item]) => item.endedAt !== null)).toBe(false)
    fireEvent.keyDown(window, { code })
    await act(async () => { fireEvent.keyUp(window, { code }) })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated or simultaneous remote keys and cancels held keys on blur', async () => {
    vi.useFakeTimers()
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyDown(window, { code: 'Space', repeat: true })
    fireEvent.keyDown(window, { code: 'Escape' })
    await act(async () => { fireEvent.keyUp(window, { code: 'Escape' }) })
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    await act(async () => { fireEvent.keyUp(window, { code: 'Space' }) })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    fireEvent.keyDown(window, { code: 'Escape' })
    fireEvent.blur(window)
    await act(async () => { fireEvent.keyUp(window, { code: 'Escape' }) })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(1)
  })

  it('ignores a remote press begun during startup or released after finishing', async () => {
    vi.useFakeTimers()
    let finishStart: () => void = () => {}
    mocks.saveOtwSession.mockImplementationOnce(() => new Promise<void>((resolve) => { finishStart = resolve }))
    render(<OtwApp />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    expect(screen.getByRole('button', { name: 'Finish' })).toBeDisabled()
    fireEvent.keyDown(window, { code: 'Space' })
    await act(async () => { finishStart() })
    await act(async () => { fireEvent.keyUp(window, { code: 'Space' }) })
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }))
    fireEvent.keyDown(window, { code: 'Space' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Finish' })) })
    await act(async () => { fireEvent.keyUp(window, { code: 'Space' }) })
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(1)
  })

  it('cancels a remote press released in an editable field', async () => {
    vi.useFakeTimers()
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Race' }))
    fireEvent.keyDown(window, { code: 'Space' })
    fireEvent.keyUp(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), { code: 'Space' })
    await act(async () => { vi.advanceTimersByTime(3000) })
    expect(mocks.createOtwSession).not.toHaveBeenCalled()
  })

  it('does not restart an automatically completed workout when a held remote button is released', async () => {
    vi.useFakeTimers()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Short remote workout', 'time', 1, 1)])
    render(<OtwApp />)
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Intervals' }))
    fireEvent.click(screen.getByRole('button', { name: 'Short remote workout' }))
    fireEvent.click(screen.getByRole('button', { name: 'Load Workout' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    fireEvent.keyDown(window, { code: 'Space' })
    await act(async () => { vi.advanceTimersByTime(1250) })
    expect(screen.getByRole('dialog', { name: 'Workout summary' })).toBeInTheDocument()
    await act(async () => { fireEvent.keyUp(window, { code: 'Space' }) })
    expect(screen.getByRole('dialog', { name: 'Workout summary' })).toBeInTheDocument()
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(1)
  })

  it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])('records strokes with %s', async (code) => {
    vi.useFakeTimers()
    render(<OtwApp />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })) })
    fireEvent.keyDown(window, { code })
    fireEvent.keyDown(window, { code, repeat: true })
    fireEvent.keyUp(window, { code })
    act(() => { vi.advanceTimersByTime(1000) })
    fireEvent.keyDown(window, { code })
    fireEvent.keyUp(window, { code })
    expect(screen.getByRole('button', { name: /Stroke rate 60 strokes per minute/ })).toBeInTheDocument()
  })

  it('migrates saved remote keys and rejects conflicting learned assignments', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('nbrctraining.otw.remoteMap', JSON.stringify({
      toggle: 'KeyQ', stop: 'KeyW', reset: 'KeyR', stroke: 'ArrowDown',
    }))
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'Remote controls' }))
    expect(screen.getByRole('button', { name: 'Learn Button A · KeyQ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Learn Button B · KeyW' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Learn D-pad Up · ArrowDown' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Learn D-pad Down · Not assigned' }))
    fireEvent.keyDown(window, { code: 'ArrowLeft' })
    expect(screen.getByRole('alert')).toHaveTextContent('D-pad Left')
    await user.click(screen.getByRole('button', { name: 'Learn D-pad Down · Not assigned' }))
    fireEvent.keyDown(window, { code: 'ArrowUp' })
    expect(screen.getByRole('button', { name: 'Learn D-pad Down · ArrowUp' })).toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('nbrctraining.otw.remoteMap') ?? '{}')).toEqual({
      buttonA: 'KeyQ', buttonB: 'KeyW', up: 'ArrowDown', down: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight',
    })
  })

  it('waits for the stopped session to be saved before loading History', async () => {
    const user = userEvent.setup()
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: null, elapsedSeconds: expect.any(Number) })))
    let finishSave: () => void = () => {}
    mocks.saveOtwSession.mockImplementationOnce(() => new Promise<void>((resolve) => { finishSave = resolve }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.getByText('Loading saved sessions…')).toBeInTheDocument()
    expect(mocks.getCompletedOtwSessions).not.toHaveBeenCalled()
    await act(async () => { finishSave() })
    expect(await screen.findByText('Just Row', { selector: 'strong' })).toBeInTheDocument()
  })

  it('lists completed sessions and exports the selected FIT file from History', async () => {
    const user = userEvent.setup()
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))

    expect(await screen.findByText('Just Row', { selector: 'strong' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Export FIT' }))
    expect(mocks.downloadFitSession).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'completed-session' }),
    )
  })

  it('identifies laps in older workout sessions using the matching cached workout', async () => {
    const user = userEvent.setup()
    const oldWorkout = workout('legacy', 'TIME', 'Legacy workout', 'time', 3)
    mocks.getCachedOtwWorkouts.mockResolvedValueOnce([oldWorkout])
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([oldWorkout])
    mocks.getCompletedOtwSessions.mockResolvedValueOnce([{
      id: 'legacy-session', mode: 'workout', workoutId: 'legacy', workoutName: 'legacy',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:08.000Z', elapsedSeconds: 8,
      records: [],
      laps: [
        { label: 'Work (1/2)', startElapsedSeconds: 0, endElapsedSeconds: 3, startDistanceMeters: 0, endDistanceMeters: 3 },
        { label: 'Work recovery', startElapsedSeconds: 3, endElapsedSeconds: 5, startDistanceMeters: 3, endDistanceMeters: 5 },
        { label: 'Work (2/2)', startElapsedSeconds: 5, endElapsedSeconds: 8, startDistanceMeters: 5, endDistanceMeters: 8 },
      ],
    }])
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Export FIT' }))
    expect(mocks.downloadFitSession).toHaveBeenCalledWith(expect.objectContaining({
      laps: [expect.objectContaining({ kind: 'work' }), expect.objectContaining({ kind: 'recovery' }), expect.objectContaining({ kind: 'work' })],
    }))
  })

  it('reports an error instead of guessing when an older workout no longer matches', async () => {
    const user = userEvent.setup()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('legacy', 'TIME', 'Changed workout', 'time', 3)])
    mocks.getCompletedOtwSessions.mockResolvedValueOnce([{
      id: 'legacy-session', mode: 'workout', workoutId: 'legacy', workoutName: 'legacy',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:03.000Z', elapsedSeconds: 3,
      records: [], laps: [{ label: 'Different interval', startElapsedSeconds: 0, endElapsedSeconds: 3, startDistanceMeters: 0, endDistanceMeters: 3 }],
    }])
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Export FIT' }))
    expect(screen.getByRole('alert')).toHaveTextContent('recovery laps cannot be identified safely')
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('reports when the original workout for a legacy export is unavailable', async () => {
    const user = userEvent.setup()
    mocks.getCompletedOtwSessions.mockResolvedValueOnce([{
      id: 'legacy-session', mode: 'workout', workoutId: 'missing', workoutName: 'missing',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:03.000Z', elapsedSeconds: 3,
      records: [], laps: [{ label: 'Work', startElapsedSeconds: 0, endElapsedSeconds: 3, startDistanceMeters: 0, endDistanceMeters: 3 }],
    }])
    render(<OtwApp />)
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Export FIT' }))
    expect(screen.getByRole('alert')).toHaveTextContent('needs its original workout')
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('labels older workout sessions without a name as Intervals in History', async () => {
    const user = userEvent.setup()
    mocks.getCompletedOtwSessions.mockResolvedValueOnce([{
      id: 'legacy-session',
      mode: 'workout',
      workoutId: null,
      workoutName: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:10:00.000Z',
      elapsedSeconds: 600,
      records: [],
      laps: [],
    }])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByText('Intervals', { selector: 'strong' })).toBeInTheDocument()
  })

  it('reports FIT export errors in History', async () => {
    const user = userEvent.setup()
    mocks.downloadFitSession.mockImplementationOnce(() => { throw new Error('Download unavailable') })
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Export FIT' }))
    expect(screen.getByRole('alert')).toHaveTextContent('FIT download failed: Download unavailable')
  })

  it('deletes one saved session or all history from this phone', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: /^Delete session/ }))

    expect(mocks.deleteOtwSession).toHaveBeenCalledWith('completed-session')
    expect(await screen.findByText('No completed sessions yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'History' }))
    await user.click(await screen.findByRole('button', { name: 'Delete all history' }))

    expect(mocks.deleteCompletedOtwSessions).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('No completed sessions yet.')).toBeInTheDocument()
  })
})
