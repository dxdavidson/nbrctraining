import formatDate from './formatDate'
import type { Plan, Block, Workout, Interval } from './api'
import { calculatePaceGuidance, isPaceGuidanceMode, isWolverineLevel, requiresStrokeRate } from './paceGuidance'

// Centralizes display-only derivations so column defs stay pure "which field goes where".

export interface PlanRow extends Plan {
  startDateDisplay: string
  publishedDisplay: string
}

export interface BlockRow extends Block {
  startDateDisplay: string
}

export interface WorkoutRow extends Workout {
  weekCommencingDisplay: string
  sortOrderDisplay: string
  durationSummary: string
}

export interface IntervalRow extends Interval {
  workDisplay: string
  recoveryDisplay: string
  targetDisplay: string
}

function formatKindValue(kind: string | null, value: number | null): string {
  if (!kind) return '—'
  return value != null ? `${kind} (${value})` : kind
}

function formatMinutesSeconds(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds)
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatSummaryTime(totalSeconds: number | null): string {
  if (totalSeconds == null) return '—'
  const rounded = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatWorkoutDurationSummary(intervals: Interval[], estimated2kSeconds: number | null): string {
  let workSeconds = 0
  let restSeconds = 0
  let workIsKnown = true

  for (const interval of intervals) {
    const repeatCount = Math.max(1, interval.repeat_count)
    let intervalWorkSeconds: number | null = null

    if (interval.work_kind === 'time' && interval.work_value != null) {
      intervalWorkSeconds = interval.work_value
    } else if (interval.work_kind === 'distance' && interval.work_value != null) {
      let secondsPer500m: number | null = null
      if (interval.target_mode === 'pace' && interval.target_value != null) {
        secondsPer500m = interval.target_value
      } else if (isPaceGuidanceMode(interval.target_mode) && estimated2kSeconds != null) {
        if (!requiresStrokeRate(interval.target_mode) || interval.spm != null) {
          try {
            secondsPer500m = calculatePaceGuidance(interval.target_mode, {
              estimated2kSeconds,
              spm: interval.spm ?? 0,
              targetValue: interval.target_value,
            }).secondsPer500m
          } catch {
            secondsPer500m = null
          }
        }
      }
      if (secondsPer500m != null) intervalWorkSeconds = interval.work_value / 500 * secondsPer500m
    }

    if (intervalWorkSeconds == null) workIsKnown = false
    else workSeconds += intervalWorkSeconds * repeatCount

    if (interval.recovery_value != null) restSeconds += interval.recovery_value * repeatCount
  }

  const totalSeconds = workIsKnown ? workSeconds + restSeconds : null
  return `Work: ${formatSummaryTime(workIsKnown ? workSeconds : null)} Rest: ${formatSummaryTime(restSeconds)} Total: ${formatSummaryTime(totalSeconds)}`
}

function formatWork(kind: string | null, value: number | null): string {
  if (kind === 'time') return value != null ? `${formatMinutesSeconds(value)}min` : '—'
  if (kind === 'distance') return value != null ? `${value}m` : '—'
  return formatKindValue(kind, value)
}

function formatRecovery(kind: string | null, secondsValue: number | null): string {
  if (!kind) return '—'
  if (secondsValue == null) return kind
  const duration = formatMinutesSeconds(secondsValue)
  return kind === 'time' ? duration : `${kind} ${duration}`
}

// Target pace formulas live in paceGuidance.ts; this only formats the result for display.
function formatTarget(mode: string | null, value: number | null, estimated2kSeconds: number | null, spm: number | null): string {
  if (!isPaceGuidanceMode(mode)) {
    return formatKindValue(mode, value)
  }
  if (estimated2kSeconds == null) return '—'
  if (requiresStrokeRate(mode) && spm == null) return '—'
  if (!isWolverineLevel(mode) && value == null) return '—'

  try {
    const { secondsPer500m } = calculatePaceGuidance(mode, { estimated2kSeconds, spm: spm ?? 0, targetValue: value })
    return formatMinutesSeconds(secondsPer500m)
  } catch {
    return '—'
  }
}

export function toPlanRow(plan: Plan): PlanRow {
  return {
    ...plan,
    startDateDisplay: formatDate(plan.start_date),
    publishedDisplay: plan.published ? 'Yes' : 'No',
  }
}

export function toBlockRow(block: Block): BlockRow {
  return {
    ...block,
    startDateDisplay: formatDate(block.start_date),
  }
}

export function toWorkoutRow(workout: Workout, durationSummary = 'Work: — Rest: — Total: —'): WorkoutRow {
  return {
    ...workout,
    weekCommencingDisplay: formatDate(workout.week_commencing),
    sortOrderDisplay: workout.sort_order != null ? String(workout.sort_order) : '—',
    durationSummary,
  }
}

export function toIntervalRow(interval: Interval, estimated2kSeconds: number | null): IntervalRow {
  return {
    ...interval,
    workDisplay: formatWork(interval.work_kind, interval.work_value),
    recoveryDisplay: formatRecovery(interval.recovery_kind, interval.recovery_value),
    targetDisplay: formatTarget(interval.target_mode, interval.target_value, estimated2kSeconds, interval.spm),
  }
}
