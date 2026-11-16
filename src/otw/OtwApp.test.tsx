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
  getCompletedOtwSessions: vi.fn(async () => [{
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
  saveOtwSession: vi.fn(async () => {}),
  saveOtwWorkouts: vi.fn(async () => {}),
  downloadFitSession: vi.fn<(session: OtwSession) => void>(),
}))

vi.mock('../api', () => ({ fetchOtwWorkouts: mocks.fetchOtwWorkouts }))
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
  })

  afterEach(() => {
    if (originalGeolocation) Object.defineProperty(navigator, 'geolocation', originalGeolocation)
    else Reflect.deleteProperty(navigator, 'geolocation')
    vi.restoreAllMocks()
  })

  it('starts and stops a session, downloads FIT, and starts a new session without reset', async () => {
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
    expect(screen.getAllByRole('button', { name: /^(Start|Stop|Reset)$/ })).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^(Pause|Resume)$/ })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
    expect(mocks.downloadFitSession).toHaveBeenCalledTimes(1)
    expect(mocks.downloadFitSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) }))
    expect(mocks.appendOtwRecord).toHaveBeenCalledWith(
      'session-1',
      0,
      expect.objectContaining({ elapsedSeconds: 0, cadence: null }),
    )
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    expect(mocks.createOtwSession).toHaveBeenCalledTimes(2)
    expect(container.querySelector('.otw-metric-value')?.textContent).toBe('0')
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
    expect(within(menu).queryByRole('button', { name: /^(Just Row|Race|Workout)$/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.queryByText('Race', { selector: 'p' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race' })).toHaveAttribute('aria-pressed', 'true')

    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '100')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    expect(screen.getByText('Recording')).toBeInTheDocument()
    for (const name of ['Just Row', 'Race', 'Workout']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Workout' }))
    expect(screen.getByRole('dialog', { name: 'OTW Workouts' })).toBeInTheDocument()
  })

  it('counts down race distance past zero, saves the target on stop, and restores it after reset and reload', async () => {
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
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
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    const pace = screen.getByText('Pace (min / 500 m)').parentElement?.querySelector('strong')?.textContent

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(remaining).toHaveClass('otw-metric-race-complete')
    expect(screen.getByText('-2 m')).toBeInTheDocument()
    expect(screen.getByText('Pace (min / 500 m)').parentElement?.querySelector('strong')?.textContent).toBe(pace)
    const downloaded = mocks.downloadFitSession.mock.calls[0][0]
    expect(downloaded.records.at(-1)?.distanceMeters).toBeGreaterThan(6.9)
    expect(downloaded.records.at(-1)?.latitude).not.toBeNull()
    await waitFor(() => expect(mocks.appendOtwRecord).toHaveBeenCalledWith(
      'session-1',
      expect.any(Number),
      expect.objectContaining({ distanceMeters: downloaded.records.at(-1)?.distanceMeters }),
    ))
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('5')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    expect(screen.getByText('5 m')).toBeInTheDocument()
    expect(remaining).not.toHaveClass('otw-metric-race-complete')
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    await user.click(screen.getByRole('button', { name: 'Reset' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('12')
  })

  it('saves entered race distance immediately and restores it after reset, mode changes, and reload', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(500)

    await user.clear(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }))
    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '300')
    await user.click(screen.getByRole('button', { name: 'Workout' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Stop' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
  })

  it('retains the current workout interval values after stopping', async () => {
    const user = userEvent.setup()
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('workout-1', 'TIME', 'Long row', 'time', 600, 1)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Workout' }))
    await user.click(await screen.findByRole('button', { name: 'Long row' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('10:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    expect(screen.getByText('10:00')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByText('10:00')).toBeInTheDocument()
    expect(mocks.downloadFitSession).toHaveBeenCalledWith(expect.objectContaining({ mode: 'workout' }))
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

    await user.click(screen.getByRole('button', { name: 'Workout' }))
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
    expect(screen.getByRole('button', { name: 'Workout' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('500 m')).toBeInTheDocument()
    expect(screen.getByText('Interval 1 of 8')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Workout' }))
    await user.click(screen.getByRole('button', { name: '2x3 min (2 min rest)' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Workout' }))
    expect(screen.getByRole('button', { name: '8x500m (2 min rest)' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '2x3 min (2 min rest)' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('03:00')).toBeInTheDocument()
    expect(screen.getByText('Interval 1 of 2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Workout' }))
    await user.selectOptions(screen.getByLabelText('Filter by'), 'Mixed')
    await user.click(screen.getByRole('button', { name: 'Mixed workout' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('500 m')).toBeInTheDocument()
  })

  it('shows recovery countdown and the next work interval while recording', async () => {
    const user = userEvent.setup()
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    mocks.fetchOtwWorkouts.mockResolvedValueOnce([workout('time-1', 'TIME', 'Two short intervals', 'time', 3)])
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Workout' }))
    await user.click(await screen.findByRole('button', { name: 'Two short intervals' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('00:03')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())

    now += 3000
    expect(await screen.findByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText('00:02')).toBeInTheDocument()
    now += 1000
    expect(await screen.findByText('00:01')).toBeInTheDocument()
    now += 1000
    expect(await screen.findByText('Interval 2 of 2')).toBeInTheDocument()
    expect(screen.getByText('00:03')).toBeInTheDocument()
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

    await user.click(screen.getByRole('button', { name: 'Workout' }))
    await user.click(await screen.findByRole('button', { name: 'Two distances' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByText('5 m')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())

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
    expect(await screen.findByText('Recovery')).toBeInTheDocument()
    expect(screen.getByText('00:02')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
  })

  it('shows older cached workouts offline', async () => {
    const user = userEvent.setup()
    const oldCached: CachedOtwWorkout = workout('cached', 'DISTANCE', 'Cached distance', 'distance', 500)
    delete oldCached.block_code
    mocks.getCachedOtwWorkouts.mockResolvedValueOnce([oldCached])
    mocks.fetchOtwWorkouts.mockRejectedValueOnce(new Error('Offline'))
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Workout' }))
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
    await user.click(screen.getByRole('button', { name: 'Workout' }))
    await user.click(await screen.findByRole('button', { name: 'Missing intervals' }))
    await user.click(screen.getByRole('button', { name: 'Load Workout' }))
    expect(screen.getByRole('alert')).toHaveTextContent('This OTW workout has no usable intervals.')
    expect(screen.getByRole('button', { name: 'Just Row' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('discards an unfinished session on reset without confirmation or downloading it', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled())
    expect(confirm).not.toHaveBeenCalled()
    expect(mocks.deleteOtwSession).toHaveBeenCalledWith('session-1')
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
  })

  it('reports FIT download errors while still saving the session', async () => {
    const user = userEvent.setup()
    mocks.downloadFitSession.mockImplementationOnce(() => { throw new Error('Download unavailable') })
    render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('alert')).toHaveTextContent('FIT download failed: Download unavailable')
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
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
