import { describe, expect, it } from 'vitest'
import { advanceInterval, buildOtwSegments } from './intervalEngine'
import type { Interval } from '../api'

const interval: Interval = {
  id: 'i1',
  workout_id: 'w1',
  interval_code: '1',
  interval_order: 1,
  repeat_count: 2,
  work_kind: 'time',
  work_value: 60,
  spm: null,
  recovery_kind: 'distance',
  recovery_value: 100,
  target_mode: null,
  target_value: null,
}

describe('OTW interval engine', () => {
  it('expands repeated mixed work and recovery segments', () => {
    const segments = buildOtwSegments([
      { ...interval, interval_code: '2', interval_order: 2, repeat_count: 1, work_kind: 'distance', work_value: 500 },
      interval,
    ])

    expect(segments.map(({ kind, measure, value }) => [kind, measure, value])).toEqual([
      ['work', 'time', 60],
      ['recovery', 'distance', 100],
      ['work', 'time', 60],
      ['recovery', 'distance', 100],
      ['work', 'distance', 500],
    ])
  })

  it('omits recovery after a single final work interval', () => {
    const segments = buildOtwSegments([{ ...interval, repeat_count: 1 }])
    expect(segments.map(({ kind }) => kind)).toEqual(['work'])
  })

  it('advances time and distance segments and marks completion', () => {
    const segments = buildOtwSegments([interval])
    const initial = { index: 0, segmentStartedAt: 0, segmentStartDistance: 0, finished: false, changed: false }
    const recovery = advanceInterval(segments, initial, 60, 0)
    expect(recovery).toMatchObject({ index: 1, changed: true, finished: false })

    const secondWork = advanceInterval(segments, recovery, 61, 100)
    expect(secondWork).toMatchObject({ index: 2, changed: true, finished: false })

    expect(advanceInterval(segments, secondWork, 121, 100)).toMatchObject({
      index: 3,
      changed: true,
      finished: true,
    })
  })

  it('rejects malformed interval data rather than silently skipping it', () => {
    expect(() => buildOtwSegments([{ ...interval, work_kind: null }])).toThrow('invalid work duration')
  })
})
