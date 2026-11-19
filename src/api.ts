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
  ergdata_url: string | null
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

export interface OtwWorkout {
  id: string
  workout_code: string
  description: string | null
  plan_title: string
  block_title: string
  block_code: string
  intervals: Interval[]
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

export type StravaConnection = { connected: false } | { connected: true; athleteId: string; athleteName: string | null }
export interface StravaUpload {
  status: 'sending' | 'processing' | 'uploaded' | 'failed' | 'uncertain'
  upload_id?: string | null
  activity_id?: string | null
  error?: string | null
}

async function stravaRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { ...options, credentials: 'include' })
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `Strava request failed (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const stravaLoginUrl = `${API_BASE_URL}/auth/strava/login`
export function getStravaConnection(): Promise<StravaConnection> {
  return stravaRequest('/api/strava/status')
}
export function disconnectStrava(): Promise<void> {
  return stravaRequest('/api/strava/connection', { method: 'DELETE' })
}
export function submitStravaUpload(sessionId: string, athleteId: string, data: Uint8Array, retry = false): Promise<StravaUpload> {
  const buffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(buffer).set(data)
  return stravaRequest(`/api/strava/uploads/${encodeURIComponent(sessionId)}${retry ? '?retry=true' : ''}`, {
    method: 'POST', headers: { 'Content-Type': 'application/vnd.ant.fit', 'X-Strava-Athlete-Id': athleteId }, body: buffer,
  })
}
export function getStravaUpload(sessionId: string): Promise<StravaUpload> {
  return stravaRequest(`/api/strava/uploads/${encodeURIComponent(sessionId)}`)
}

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

export function fetchOtwWorkouts(): Promise<OtwWorkout[]> {
  return getJson('/api/otw/workouts')
}
