import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OtwSession } from './sessionStore'

const mocks = vi.hoisted(() => ({
  getStravaConnection: vi.fn(),
  disconnectStrava: vi.fn(),
  getStravaUpload: vi.fn(),
  submitStravaUpload: vi.fn(),
  getCompletedOtwSessions: vi.fn(),
  saveOtwSession: vi.fn(),
  encodeFitSession: vi.fn(() => new Uint8Array([1, 2, 3])),
}))

vi.mock('../api', () => mocks)
vi.mock('./sessionStore', () => mocks)
vi.mock('./fitExport', () => mocks)

import { useStrava } from './useStrava'

const session: OtwSession = {
  id: 'session', mode: 'just-row', workoutId: null, workoutName: null,
  startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:01:00Z',
  elapsedSeconds: 60, records: [], laps: [], stravaAthleteId: '123', stravaStatus: 'pending',
}

describe('Strava queue', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    window.localStorage.clear()
    mocks.getStravaConnection.mockResolvedValue({ connected: true, athleteId: '123', athleteName: 'Rower' })
    mocks.getCompletedOtwSessions.mockResolvedValue([session])
    mocks.saveOtwSession.mockResolvedValue(undefined)
    mocks.encodeFitSession.mockReturnValue(new Uint8Array([1, 2, 3]))
    mocks.submitStravaUpload.mockResolvedValue({ status: 'processing', upload_id: '456' })
  })

  it('submits a queued session for the connected athlete', async () => {
    renderHook(() => useStrava())
    await waitFor(() => expect(mocks.submitStravaUpload).toHaveBeenCalledWith('session', '123', expect.any(Uint8Array)))
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ stravaStatus: 'processing' })))
  })

  it('does not send a queued session to a different athlete', async () => {
    mocks.getStravaConnection.mockResolvedValue({ connected: true, athleteId: 'other', athleteName: 'Other' })
    renderHook(() => useStrava())
    await waitFor(() => expect(mocks.getCompletedOtwSessions).toHaveBeenCalled())
    expect(mocks.submitStravaUpload).not.toHaveBeenCalled()
  })

  it('retains the connected athlete when the server is unreachable', async () => {
    window.localStorage.setItem('nbrctraining.otw.stravaAthleteId', '123')
    mocks.getStravaConnection.mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => useStrava())
    await waitFor(() => expect(result.current.message).toContain('Offline'))
    expect(result.current.athleteId).toBe('123')
    expect(mocks.submitStravaUpload).not.toHaveBeenCalled()
  })

  it('keeps a failed network attempt queued and resumes when online', async () => {
    mocks.submitStravaUpload.mockRejectedValueOnce(new Error('Network unavailable'))
    const { result } = renderHook(() => useStrava())
    await waitFor(() => expect(result.current.message).toContain('Network unavailable'))
    expect(mocks.saveOtwSession).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(mocks.submitStravaUpload).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ stravaStatus: 'processing' })))
  })

  it('checks processing uploads without resubmitting them', async () => {
    mocks.getCompletedOtwSessions.mockResolvedValue([{ ...session, stravaStatus: 'processing' }])
    mocks.getStravaUpload.mockResolvedValue({ status: 'uploaded', activity_id: '789' })
    renderHook(() => useStrava())
    await waitFor(() => expect(mocks.saveOtwSession).toHaveBeenCalledWith(expect.objectContaining({ stravaStatus: 'uploaded' })))
    expect(mocks.submitStravaUpload).not.toHaveBeenCalled()
  })

  it('does not automatically resubmit an unknown outcome', async () => {
    mocks.getCompletedOtwSessions.mockResolvedValue([{ ...session, stravaStatus: 'uncertain' }])
    renderHook(() => useStrava())
    await waitFor(() => expect(mocks.getCompletedOtwSessions).toHaveBeenCalled())
    expect(mocks.submitStravaUpload).not.toHaveBeenCalled()
  })
})