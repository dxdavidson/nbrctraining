import { describe, expect, it } from 'vitest'
import { formatPacePer500m, GpsAccumulator } from './gps'

function location(latitude: number, timestamp: number, accuracy = 4) {
  return { latitude, longitude: 0, accuracy, speed: null, timestamp }
}

describe('GpsAccumulator', () => {
  it('filters inaccurate positions and accumulates smoothed distance and speed', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 0))
    gps.add(location(51.00004, 1000, 40))
    expect(gps.metrics.distanceMeters).toBe(0)

    gps.add(location(51.00004, 1000))
    expect(gps.metrics.distanceMeters).toBeGreaterThan(4)
    expect(gps.metrics.speedMps).toBeGreaterThan(4)
  })

  it('ignores implausible GPS jumps', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 0))
    gps.add(location(51.01, 1000))
    expect(gps.metrics.distanceMeters).toBe(0)
    gps.add(location(51.00002, 2000))
    expect(gps.metrics.distanceMeters).toBeGreaterThan(2)
    expect(gps.metrics.distanceMeters).toBeLessThan(3)
  })

  it('accumulates small frequent movements instead of discarding each one', () => {
    const gps = new GpsAccumulator()
    const metersPerDegree = 111_195
    gps.add(location(51, 0))
    for (let step = 1; step <= 40; step += 1) {
      gps.add(location(51 + step * 0.5 / metersPerDegree, step * 500))
    }

    expect(gps.metrics.distanceMeters).toBeGreaterThan(18)
    expect(gps.metrics.distanceMeters).toBeLessThanOrEqual(20.1)
    expect(gps.metrics.speedMps).toBeCloseTo(1, 1)
  })

  it('does not count stationary jitter within the noise threshold', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 0))
    for (let step = 1; step <= 20; step += 1) {
      gps.add(location(51 + (step % 2) / 111_195, step * 1000))
    }
    expect(gps.metrics.distanceMeters).toBe(0)
  })

  it('rejects a sudden GPS jump after a long stationary period', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 0))
    for (let second = 1; second <= 60; second += 1) {
      gps.add(location(51, second * 1000))
    }
    gps.add(location(51 + 100 / 111_195, 61_000))
    expect(gps.metrics.distanceMeters).toBe(0)
    gps.add(location(51 + 2 / 111_195, 62_000))
    expect(gps.metrics.distanceMeters).toBeGreaterThan(1.9)
    expect(gps.metrics.distanceMeters).toBeLessThan(2.1)
  })

  it('does not move the distance anchor backwards on an old timestamp', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 2000))
    gps.add(location(51.00002, 1000))
    gps.add(location(51.00002, 3000))
    expect(gps.metrics.distanceMeters).toBeGreaterThan(2)
    expect(gps.metrics.distanceMeters).toBeLessThan(3)
  })

  it('ignores a timestamp older than the latest small movement', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 0))
    gps.add(location(51 + 1 / 111_195, 2000))
    gps.add(location(51 + 3 / 111_195, 1000))
    expect(gps.metrics.distanceMeters).toBe(0)
  })

  it('does not count the gap while paused and preserves accumulated distance', () => {
    const gps = new GpsAccumulator()
    gps.add(location(51, 0))
    const beforePause = gps.add(location(51.00004, 1000))
    gps.markGap()
    const afterResume = gps.add(location(51.001, 60_000))

    expect(afterResume.distanceMeters).toBe(beforePause.distanceMeters)
    expect(afterResume.speedMps).toBeNull()
  })

  it('formats pace per 500 meters', () => {
    expect(formatPacePer500m(5)).toBe('01:40')
    expect(formatPacePer500m(null)).toBe('--:--')
  })
})
