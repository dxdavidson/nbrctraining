export interface Plan {
  id: string
  plan_code: string
  title: string
  description: string | null
  start_date: string | null
  published: boolean
}

export interface Block {
  id: string
  plan_id: string
  block_code: string
  title: string
  description: string | null
  start_date: string | null
}

export interface Workout {
  id: string
  block_id: string
  wk_type: string | null
  workout_code: string
  week_commencing: string | null
  description: string | null
  sort_order: number | null
  level: string | null
  has_intervals?: boolean
}

export interface Interval {
  id: string
  workout_id: string
  interval_code: string
  interval_order: number
  repeat_count: number
  work_kind: string | null
  work_value: number | null
  spm: number | null
  recovery_kind: string | null
  recovery_value: number | null
  target_mode: string | null
  target_value: number | null
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`)
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function fetchPlans(): Promise<Plan[]> {
  return getJson('/api/plans')
}

export function fetchBlocks(planId: string): Promise<Block[]> {
  return getJson(`/api/blocks?plan_id=${encodeURIComponent(planId)}`)
}

export function fetchWorkouts(blockId: string): Promise<Workout[]> {
  return getJson(`/api/workouts?block_id=${encodeURIComponent(blockId)}`)
}

export function fetchIntervals(workoutId: string): Promise<Interval[]> {
  return getJson(`/api/intervals?workout_id=${encodeURIComponent(workoutId)}`)
}
