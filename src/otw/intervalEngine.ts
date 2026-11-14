import type { Interval } from '../api'

export interface OtwSegment {
  key: string
  label: string
  kind: 'work' | 'recovery'
  measure: 'time' | 'distance'
  value: number
}

export interface IntervalProgress {
  index: number
  segmentStartedAt: number
  segmentStartDistance: number
  finished: boolean
  changed: boolean
}

export function buildOtwSegments(intervals: Interval[]): OtwSegment[] {
  const segments: OtwSegment[] = []
  const orderedIntervals = [...intervals].sort((first, second) => first.interval_order - second.interval_order)

  for (const interval of orderedIntervals) {
    if (
      (interval.work_kind !== 'time' && interval.work_kind !== 'distance') ||
      interval.work_value === null ||
      interval.work_value <= 0 ||
      !Number.isInteger(interval.repeat_count) ||
      interval.repeat_count < 1
    ) {
      throw new Error(`Interval ${interval.interval_code} has an invalid work duration or repeat count.`)
    }

    for (let repeat = 1; repeat <= interval.repeat_count; repeat += 1) {
      const suffix = interval.repeat_count > 1 ? ` (${repeat}/${interval.repeat_count})` : ''
      segments.push({
        key: `${interval.id}-work-${repeat}`,
        label: `${interval.interval_code}${suffix}`,
        kind: 'work',
        measure: interval.work_kind,
        value: interval.work_value,
      })

      if (interval.recovery_kind && interval.recovery_value !== null && interval.recovery_value > 0) {
        if (interval.recovery_kind !== 'time' && interval.recovery_kind !== 'distance') {
          throw new Error(`Interval ${interval.interval_code} has an unsupported recovery type.`)
        }
        segments.push({
          key: `${interval.id}-recovery-${repeat}`,
          label: `${interval.interval_code} recovery`,
          kind: 'recovery',
          measure: interval.recovery_kind,
          value: interval.recovery_value,
        })
      }
    }
  }

  if (segments.length === 0) throw new Error('This OTW workout has no usable intervals.')
  return segments
}

export function advanceInterval(
  segments: OtwSegment[],
  progress: IntervalProgress,
  elapsedSeconds: number,
  distanceMeters: number,
): IntervalProgress {
  if (progress.finished || segments.length === 0) return progress

  let index = progress.index
  let segmentStartedAt = progress.segmentStartedAt
  let segmentStartDistance = progress.segmentStartDistance
  let changed = false

  while (index < segments.length) {
    const segment = segments[index]
    const completed = segment.measure === 'time'
      ? elapsedSeconds - segmentStartedAt >= segment.value
      : distanceMeters - segmentStartDistance >= segment.value
    if (!completed) break

    index += 1
    changed = true
    segmentStartedAt = elapsedSeconds
    segmentStartDistance = distanceMeters
  }

  return {
    index,
    segmentStartedAt,
    segmentStartDistance,
    finished: index >= segments.length,
    changed,
  }
}

export function intervalRemaining(
  segment: OtwSegment,
  segmentStartedAt: number,
  segmentStartDistance: number,
  elapsedSeconds: number,
  distanceMeters: number,
): number {
  const completed = segment.measure === 'time'
    ? elapsedSeconds - segmentStartedAt
    : distanceMeters - segmentStartDistance
  return Math.max(0, segment.value - completed)
}
