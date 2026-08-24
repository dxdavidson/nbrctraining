import express from 'express'
import cors from 'cors'
import { pool } from './db.js'

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
  })
)

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
      'SELECT id, plan_code, title, start_date, published FROM plans ORDER BY title'
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
      'SELECT id, plan_id, block_code, title, description, start_date FROM blocks WHERE plan_id = $1 ORDER BY start_date NULLS LAST, title',
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

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`)
})
