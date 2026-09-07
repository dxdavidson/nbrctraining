import type { Interval } from './api'
import { secondsPer500mFromWatts, wattsFromSecondsPer500m } from './wolverinePace'

const STAGE_DURATION_SECONDS = 60

// Starting watts is chosen so the midpoint of a selected 2K range fails around this stage.
const TARGET_COMPLETED_STAGES = 7

export interface RampSettings {
  startWatts: number
  incrementWatts: number
  stageCount: number
  conversionPercentage: number
}

export interface Estimated2kRangeOption {
  value: string
  label: string
  midpointSeconds: number
}

function parseMinutesSeconds(value: string): number {
  const [minutes, seconds] = value.split(':').map(Number)
  return minutes * 60 + seconds
}

const ESTIMATED_2K_RANGE_LABELS = [
  '9:30-10:00',
  '9:00-9:30',
  '8:30-9:00',
  '8:00-8:30',
  '7:30-8:00',
  '7:00-7:30',
  '6:30-7:00',
  '6:00-6:30',
]

export const ESTIMATED_2K_RANGES: Estimated2kRangeOption[] = ESTIMATED_2K_RANGE_LABELS.map((label) => {
  const [low, high] = label.split('-')
  return {
    value: label,
    label,
    midpointSeconds: (parseMinutesSeconds(low) + parseMinutesSeconds(high)) / 2,
  }
})

export function startWattsForEstimated2kRange(
  midpointSeconds: number,
  incrementWatts: number,
  conversionPercentage: number
): number {
  const secondsPer500m = midpointSeconds / 4
  const estimated2kWatts = wattsFromSecondsPer500m(secondsPer500m)
  const peakWatts = estimated2kWatts / (conversionPercentage / 100)
  const startWatts = peakWatts - incrementWatts * (TARGET_COMPLETED_STAGES - 1)
  return Math.max(1, Math.round(startWatts / 5) * 5)
}

export interface RampResult {
  peakWatts: number
  estimated2kWatts: number
  secondsPer500m: number
  estimated2kSeconds: number
}

export function buildRampIntervals(settings: Pick<RampSettings, 'startWatts' | 'incrementWatts' | 'stageCount'>): Interval[] {
  return Array.from({ length: settings.stageCount }, (_, index) => ({
    id: `ramp-stage-${index + 1}`,
    workout_id: 'ramp-test',
    interval_code: `Stage ${index + 1}`,
    interval_order: index + 1,
    repeat_count: 1,
    work_kind: 'time',
    work_value: STAGE_DURATION_SECONDS,
    spm: null,
    recovery_kind: null,
    recovery_value: null,
    target_mode: 'watts',
    target_value: settings.startWatts + index * settings.incrementWatts,
  }))
}

export function calculateRampResult(settings: RampSettings, lastCompletedWatts: number, nextStageSeconds: number): RampResult | null {
  const intervals = buildRampIntervals(settings)
  const completedIndex = intervals.findIndex((interval) => interval.target_value === lastCompletedWatts)
  if (
    completedIndex < 0 ||
    !Number.isInteger(nextStageSeconds) ||
    nextStageSeconds < 0 ||
    nextStageSeconds >= STAGE_DURATION_SECONDS
  ) {
    return null
  }

  const peakWatts = lastCompletedWatts + settings.incrementWatts * (nextStageSeconds / STAGE_DURATION_SECONDS)
  const estimated2kWatts = peakWatts * (settings.conversionPercentage / 100)
  const secondsPer500m = secondsPer500mFromWatts(estimated2kWatts)
  return {
    peakWatts,
    estimated2kWatts,
    secondsPer500m,
    estimated2kSeconds: secondsPer500m * 4,
  }
}
