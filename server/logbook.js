import { pool } from './db.js'
import { CONCEPT2_API_BASE, buildResultPayload, getConcept2Connection } from './concept2Auth.js'

// Resolves which linked Concept2 device to use: an explicit id, or the only/most recent link.
export async function resolveDeviceId(requested) {
  if (requested) return requested
  const { rows } = await pool.query('SELECT device_id FROM concept2_tokens ORDER BY updated_at DESC LIMIT 1')
  return rows[0]?.device_id ?? null
}

// Submits a workout summary (same shape the PM5 flow produces) to the athlete's Concept2 logbook.
// Shared by the simulator CLI and real workout submission.
export async function submitWorkoutToLogbook(deviceId, summary) {
  const connection = await getConcept2Connection(deviceId)
  if (!connection) throw new Error('No Concept2 account is linked to this device.')

  const payload = buildResultPayload({ ...summary, weightClass: connection.weightClass })
  if (!payload) throw new Error('Summary needs a positive distance and elapsedTime.')

  const response = await fetch(`${CONCEPT2_API_BASE}/users/${connection.concept2UserId}/results`, {
    method: 'POST',
    headers: {
      Authorization: ['Bearer', connection.accessToken].join(' '),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Concept2 rejected the result (${response.status}): ${JSON.stringify(body)}`)
  }
  return { payload, result: body }
}
