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

export function toWorkoutRow(workout: Workout): WorkoutRow {
  return {
    ...workout,
    weekCommencingDisplay: formatDate(workout.week_commencing),
    sortOrderDisplay: workout.sort_order != null ? String(workout.sort_order) : '—',
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
