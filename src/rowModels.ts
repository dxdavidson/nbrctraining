import formatDate from './formatDate'
import type { Plan, Block, Workout, Interval } from './api'

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
  if (kind === 'time') return `Time ${value != null ? formatMinutesSeconds(value) : '—'}`
  if (kind === 'distance') return `Distance ${value != null ? `${value}m` : '—'}`
  return formatKindValue(kind, value)
}

function formatRecovery(kind: string | null, secondsValue: number | null): string {
  if (!kind) return '—'
  if (secondsValue == null) return kind
  const duration = formatMinutesSeconds(secondsValue)
  return kind === 'time' ? duration : `${kind} ${duration}`
}

// two_k_pace_offset_seconds: target pace = (estimated 2K time / 4) + offset, shown per 500m.
function formatTarget(mode: string | null, value: number | null, estimated2kSeconds: number | null): string {
  if (mode === 'two_k_pace_offset_seconds') {
    if (value == null || estimated2kSeconds == null) return '—'
    const targetPaceSeconds = estimated2kSeconds / 4 + value
    return `${formatMinutesSeconds(targetPaceSeconds)}/500m`
  }
  return formatKindValue(mode, value)
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
    targetDisplay: formatTarget(interval.target_mode, interval.target_value, estimated2kSeconds),
  }
}
