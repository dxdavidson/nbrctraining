import type { Interval } from './api'
import { secondsPer500mFromWatts } from './wolverinePace'

const STAGE_DURATION_SECONDS = 60

export interface RampSettings {
  startWatts: number
  incrementWatts: number
  stageCount: number
  conversionPercentage: number
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
