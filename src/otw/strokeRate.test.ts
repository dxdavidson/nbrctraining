import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrokeRateTracker } from './strokeRate'

describe('StrokeRateTracker', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts without a rate and computes from the second valid catch', () => {
    const tracker = new StrokeRateTracker()

    expect(tracker.tap(0)).toBeNull()
    expect(tracker.tap(2000)).toBe(30)
  })

  it('ignores taps less than 0.8 seconds apart', () => {
    const tracker = new StrokeRateTracker()

    tracker.tap(0)
    expect(tracker.tap(700)).toBeNull()
    expect(tracker.tap(2000)).toBe(30)
  })

  it('treats a catch at the timeout boundary as a fresh first catch', () => {
    const tracker = new StrokeRateTracker({ timeoutSeconds: 3 })
    tracker.tap(0)
    tracker.tap(1000)

    expect(tracker.tap(4000)).toBeNull()
    expect(tracker.tap(5000)).toBe(60)
  })

  it('rejects intervals outside 40 percent of the median', () => {
    const tracker = new StrokeRateTracker({ timeoutSeconds: 10, sampleSize: 5 })
    tracker.tap(0)
    tracker.tap(1000)
    tracker.tap(2000)
    tracker.tap(3000)

    expect(tracker.tap(6000)).toBe(60)
  })

  it('clears its buffer on timeout and makes the next catch a new first catch', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const onChange = vi.fn()
    const tracker = new StrokeRateTracker({ onChange })

    tracker.tap()
    tracker.tap(1000)
    expect(tracker.rate).toBe(60)

    vi.advanceTimersByTime(3000)
    expect(tracker.rate).toBeNull()
    expect(onChange).toHaveBeenLastCalledWith(null)

    expect(tracker.tap(Date.now())).toBeNull()
    expect(tracker.tap(Date.now() + 1000)).toBe(60)
    tracker.dispose()
  })
})
