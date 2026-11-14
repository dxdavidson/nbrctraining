import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchOtwWorkouts: vi.fn(async () => []),
  appendOtwRecord: vi.fn(async () => {}),
  createOtwSession: vi.fn((mode: 'just-row' | 'workout' = 'just-row') => ({
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

describe('OtwApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
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

  it('shows the current mode in the header and lets the user switch to Race', async () => {
    const user = userEvent.setup()
    render(<OtwApp />)

    expect(screen.getByText('Just Row')).toBeInTheDocument()
    expect(screen.queryByText('On the Water')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(screen.getByRole('button', { name: 'Race' }))
    expect(screen.getByText('Race')).toBeInTheDocument()
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
