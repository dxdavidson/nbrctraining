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
