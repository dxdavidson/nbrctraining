import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { timingSafeEqual } from 'node:crypto'
import { pool } from './db.js'
import { groupWorkouts, parseWorkoutCsv } from './csvImport.js'
import { registerConcept2Routes } from './concept2Auth.js'

const app = express()
const PORT = process.env.PORT || 4000

// Restrict cross-origin access to known client origins in production;
// falls back to allowing all origins only when none are configured (local dev).
const allowedOrigins = (process.env.CLIENT_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    // Required so the browser sends/receives the Concept2 device-id cookie cross-origin.
    credentials: true,
  })
)
app.use(cookieParser())
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }))

registerConcept2Routes(app)

function hasValidImportToken(request) {
  const configuredToken = process.env.IMPORT_TOKEN
  const suppliedToken = request.get('x-import-token')
  if (!configuredToken || !suppliedToken) return false

  const configuredBytes = Buffer.from(configuredToken)
  const suppliedBytes = Buffer.from(suppliedToken)
  return configuredBytes.length === suppliedBytes.length && timingSafeEqual(configuredBytes, suppliedBytes)
}

function requireImportToken(req, res) {
  if (!process.env.IMPORT_TOKEN) {
    res.status(503).json({ error: 'CSV import is not configured on the server.' })
    return false
  }
  if (!hasValidImportToken(req)) {
    res.status(401).json({ error: 'Invalid import token.' })
    return false
  }
  return true
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function parseUuidQueryParam(res, value, name) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    res.status(400).json({ error: `Invalid ${name}` })
    return undefined
  }
  return value
}

app.get('/api/plans', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, plan_code, title, description, start_date, published FROM plans WHERE published = TRUE ORDER BY title'
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch plans' })
  }
})

app.get('/api/blocks', async (req, res) => {
  const planId = parseUuidQueryParam(res, req.query.plan_id, 'plan_id')
  if (planId === undefined) return
  if (planId === null) return res.status(400).json({ error: 'plan_id is required' })

  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.plan_id, b.block_code, b.title, b.description, b.start_date
       FROM blocks b
       JOIN plans p ON p.id = b.plan_id
       WHERE b.plan_id = $1 AND b.published = TRUE AND p.published = TRUE
       ORDER BY b.start_date NULLS LAST, b.title`,
      [planId]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch blocks' })
  }
})

app.get('/api/workouts', async (req, res) => {
  const blockId = parseUuidQueryParam(res, req.query.block_id, 'block_id')
  if (blockId === undefined) return
  if (blockId === null) return res.status(400).json({ error: 'block_id is required' })

  try {
    const { rows } = await pool.query(
      'SELECT id, block_id, workout_code, week_commencing, description, sort_order, level FROM workouts WHERE block_id = $1 ORDER BY sort_order NULLS LAST, week_commencing',
      [blockId]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch workouts' })
  }
})

app.get('/api/intervals', async (req, res) => {
  const workoutId = parseUuidQueryParam(res, req.query.workout_id, 'workout_id')
  if (workoutId === undefined) return
  if (workoutId === null) return res.status(400).json({ error: 'workout_id is required' })

  try {
    const { rows } = await pool.query(
      `SELECT id, workout_id, interval_code, interval_order, repeat_count,
              work_kind, work_value, spm, recovery_kind, recovery_value,
              target_mode, target_value
       FROM intervals WHERE workout_id = $1 ORDER BY interval_order`,
      [workoutId]
    )
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch intervals' })
  }
})

app.post('/api/admin/import/workouts', async (req, res) => {
  if (!requireImportToken(req, res)) return
  if (typeof req.body !== 'string') {
    return res.status(400).json({ error: 'Send the CSV as a text request body.' })
  }

  let rows
  try {
    rows = parseWorkoutCsv(req.body)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const client = await pool.connect()
  const dryRun = req.query.dry_run === 'true'
  const deleteExistingBlocks = req.query.delete_existing_blocks === 'true'
  try {
    await client.query('BEGIN')
    const workoutGroups = groupWorkouts(rows)
    const blockIds = new Map()

    for (const group of workoutGroups) {
      const { rows: planRows } = await client.query('SELECT id FROM plans WHERE plan_code = $1', [group.workout.plan_code])
      if (planRows.length === 0) {
        throw new Error(`Plan ${group.workout.plan_code} was not found.`)
      }

      const { rows: blockRows } = await client.query(
        'SELECT id FROM blocks WHERE plan_id = $1 AND block_code = $2',
        [planRows[0].id, group.workout.block_code]
      )
      if (blockRows.length === 0) {
        throw new Error(`Block ${group.workout.block_code} was not found in plan ${group.workout.plan_code}.`)
      }
      blockIds.set(`${group.workout.plan_code}\u0000${group.workout.block_code}`, blockRows[0].id)
    }

    let deletedWorkouts = 0
    if (deleteExistingBlocks) {
      for (const blockId of blockIds.values()) {
        const { rows: deletedRows } = await client.query(
          'DELETE FROM workouts WHERE block_id = $1 RETURNING id',
          [blockId]
        )
        deletedWorkouts += deletedRows.length
      }
    }

    for (const group of workoutGroups) {
      const blockId = blockIds.get(`${group.workout.plan_code}\u0000${group.workout.block_code}`)

      const { rows: workoutRows } = await client.query(
        `INSERT INTO workouts (block_id, workout_code, week_commencing, description, sort_order, level)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          blockId,
          group.workout.workout_code,
          group.workout.week_commencing,
          group.workout.description,
          group.workout.sort_order,
          group.workout.level,
        ]
      )
      const workoutId = workoutRows[0].id

      for (const interval of group.intervals) {
        await client.query(
          `INSERT INTO intervals (
             workout_id, interval_code, interval_order, repeat_count, work_kind, work_value,
             spm, recovery_kind, recovery_value, target_mode, target_value
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            workoutId,
            interval.interval_code,
            interval.interval_order,
            interval.repeat_count,
            interval.work_kind,
            interval.work_value,
            interval.spm,
            interval.recovery_kind,
            interval.recovery_value,
            interval.target_mode,
            interval.target_value,
          ]
        )
      }

    }

    if (dryRun) {
      await client.query('ROLLBACK')
    } else {
      await client.query('COMMIT')
    }

    return res.json({
      dry_run: dryRun,
      delete_existing_blocks: deleteExistingBlocks,
      rows: rows.length,
      workouts: workoutGroups.length,
      intervals: rows.length,
      deleted_workouts: deletedWorkouts,
      imported_workouts: dryRun ? [] : workoutGroups.map((group) => ({
        plan_code: group.workout.plan_code,
        block_code: group.workout.block_code,
        workout_code: group.workout.workout_code,
        interval_count: group.intervals.length,
      })),
      message: dryRun
        ? deleteExistingBlocks
          ? `CSV is valid. ${deletedWorkouts} existing workout(s) in the referenced block(s) would be deleted. No changes were saved.`
          : 'CSV is valid. No changes were saved.'
        : deleteExistingBlocks
          ? `CSV imported successfully. Deleted ${deletedWorkouts} existing workout(s) in the referenced block(s).`
          : 'CSV imported successfully.',
    })
  } catch (err) {
    await client.query('ROLLBACK')
    const status = err.code === '23505' ? 409 : err.message.includes('was not found') ? 404 : 400
    return res.status(status).json({ error: status === 409 ? 'A workout or interval already exists.' : err.message })
  } finally {
    client.release()
  }
})

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
