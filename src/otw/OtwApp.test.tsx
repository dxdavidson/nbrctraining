import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchOtwWorkouts: vi.fn(async () => []),
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
  getCachedOtwWorkouts: vi.fn(async () => []),
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
  downloadFitSession: vi.fn(),
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

  it('starts, pauses, and finishes a Just Row session, saving it silently without a download', async () => {
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
    await user.click(await screen.findByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Stop' }))

    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ endedAt: expect.any(String) })))
    expect(mocks.downloadFitSession).not.toHaveBeenCalled()
    expect(mocks.appendOtwRecord).toHaveBeenCalledWith(
      'session-1',
      0,
      expect.objectContaining({ elapsedSeconds: 0, cadence: null }),
    )
  })

  it('shows mode buttons in the header, not the menu, and locks them during a session', async () => {
    const user = userEvent.setup()
    render(<OtwApp />)

    expect(screen.getByText('Just Row', { selector: 'p' })).toBeInTheDocument()
    expect(screen.queryByText('On the Water')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More options' }))
    const menu = document.getElementById('otw-menu')
    if (!menu) throw new Error('Options menu did not open.')
    expect(within(menu).queryByRole('button', { name: /^(Just Row|Race|Workout)$/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByText('Race', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race' })).toHaveAttribute('aria-pressed', 'true')

    await user.type(screen.getByRole('spinbutton', { name: 'Race distance (meters)' }), '100')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Pause' })
    for (const name of ['Just Row', 'Race', 'Workout']) {
      expect(screen.getByRole('button', { name })).toBeDisabled()
    }
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Race' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(screen.getByRole('button', { name: 'Race' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Workout' }))
    expect(screen.getByRole('dialog', { name: 'Workout' })).toBeInTheDocument()
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
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { unmount } = render(<OtwApp />)

    await user.click(screen.getByRole('button', { name: 'Race' }))
    const input = screen.getByRole('spinbutton', { name: 'Race distance (meters)' })
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    await user.type(input, '5')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await screen.findByRole('button', { name: 'Pause' })
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
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(remaining).toHaveClass('otw-metric-race-complete')

    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(remaining).not.toHaveClass('otw-metric-race-complete')
    expect(screen.queryByText('Target reached')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('5')
    expect(screen.getByRole('spinbutton', { name: 'Race distance (meters)' })).toHaveValue(5)
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
    await screen.findByRole('button', { name: 'Pause' })
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(window.localStorage.getItem('nbrctraining.otw.raceDistance')).toBe('12')
  })

  it('saves entered race distance immediately and restores it after reset, mode changes, and reload', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('nbrctraining.otw.raceDistance', '750')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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
    await screen.findByRole('button', { name: 'Pause' })
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
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeEnabled()
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
