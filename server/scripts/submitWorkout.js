import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { groupWorkouts, parseWorkoutCsv } from '../csvImport.js'
import { simulateWorkout } from '../workoutSimulator.js'
import { buildResultPayload } from '../concept2Auth.js'
import { resolveDeviceId, submitWorkoutToLogbook } from '../logbook.js'
import { pool } from '../db.js'

const USAGE = `Usage: node server/scripts/submitWorkout.js <csv-file> <workout_code> [options]

Simulates a completed workout from the plan CSV and submits it to the Concept2 logbook.

Options:
  --device <uuid>   Linked device id (default: most recently linked account)
  --pace <seconds>  Average pace per 500m used for the simulation (default 130)
  --dry-run         Print the simulated payload without submitting`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    device: { type: 'string' },
    pace: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
})

async function main() {
  const [csvPath, workoutCode] = positionals
  if (values.help || !csvPath || !workoutCode) {
    console.log(USAGE)
    process.exitCode = values.help ? 0 : 1
    return
  }

  const workouts = groupWorkouts(parseWorkoutCsv(await readFile(csvPath, 'utf8')))
  const matches = workouts.filter((w) => w.workout.workout_code === workoutCode)
  if (matches.length === 0) {
    const codes = [...new Set(workouts.map((w) => w.workout.workout_code))].join(', ')
    throw new Error(`Workout ${workoutCode} not found. Available: ${codes}`)
  }
  if (matches.length > 1) {
    throw new Error(`Workout ${workoutCode} appears in more than one plan/block in this CSV.`)
  }

  const pace = values.pace ? Number(values.pace) : undefined
  if (values.pace && !(pace > 0)) throw new Error('--pace must be a positive number of seconds.')

  const summary = simulateWorkout(matches[0].intervals, { paceSecondsPer500m: pace })
  console.log(`Simulated ${workoutCode}: ${summary.distance}m in ${(summary.elapsedTime / 1000).toFixed(1)}s`)

  if (values['dry-run']) {
    console.log(JSON.stringify(buildResultPayload(summary), null, 2))
    return
  }

  const deviceId = await resolveDeviceId(values.device)
  if (!deviceId) throw new Error('No linked Concept2 account found. Link one via /auth/concept2/login first.')

  const { result } = await submitWorkoutToLogbook(deviceId, summary)
  console.log('Submitted to Concept2 logbook:', JSON.stringify(result))
}

main()
  .catch((err) => {
    console.error(err.message)
    process.exitCode = 1
  })
  .finally(() => pool.end())
