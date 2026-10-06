// Turns a planned workout (intervals from the import CSV) into a simulated completed-workout
// summary. Real workouts should produce the same summary shape and skip this module.

const DEFAULT_PACE_SECONDS_PER_500M = 130
const DEFAULT_STROKE_RATE = 20

function jitter(value, fraction) {
  return value * (1 + (Math.random() * 2 - 1) * fraction)
}

export function simulateWorkout(intervals, { paceSecondsPer500m = DEFAULT_PACE_SECONDS_PER_500M, startedAt = new Date() } = {}) {
  const ordered = [...intervals].sort((a, b) => a.interval_order - b.interval_order)
  const results = []

  for (const interval of ordered) {
    for (let repeat = 0; repeat < interval.repeat_count; repeat += 1) {
      const pace = jitter(paceSecondsPer500m, 0.02)
      let distance
      let seconds
      if (interval.work_kind === 'time') {
        seconds = interval.work_value
        distance = (seconds / pace) * 500
      } else {
        distance = interval.work_value
        seconds = (distance / 500) * pace
      }

      results.push({
        type: interval.work_kind,
        distance: Math.round(distance),
        elapsedTime: Math.round(seconds * 1000),
        strokeRate: interval.spm ?? DEFAULT_STROKE_RATE,
        restTime: interval.recovery_kind === 'time' ? Math.round((interval.recovery_value ?? 0) * 1000) : 0,
      })
    }
  }

  const totalDistance = results.reduce((sum, r) => sum + r.distance, 0)
  const totalTime = results.reduce((sum, r) => sum + r.elapsedTime, 0)
  const weightedRate = results.reduce((sum, r) => sum + r.strokeRate * r.elapsedTime, 0) / totalTime

  return {
    startedAt: startedAt.toISOString(),
    distance: totalDistance,
    elapsedTime: totalTime,
    averageStrokeRate: weightedRate,
    // A single continuous piece is logged as a plain result rather than an interval workout.
    ...(results.length > 1 ? { intervals: results } : {}),
  }
}
