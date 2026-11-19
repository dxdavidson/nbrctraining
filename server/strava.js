import { randomUUID } from 'node:crypto'
import express from 'express'

const DEVICE_COOKIE = 'strava_device_id'
const STATE_COOKIE = 'strava_oauth_state'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function config() {
  const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI, STRAVA_FRONTEND_URL } = process.env
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REDIRECT_URI || !STRAVA_FRONTEND_URL) return null
  return { clientId: STRAVA_CLIENT_ID, clientSecret: STRAVA_CLIENT_SECRET, redirectUri: STRAVA_REDIRECT_URI, frontendUrl: STRAVA_FRONTEND_URL }
}

function cookieOptions(settings, sameSite = 'none') {
  const secure = new URL(settings.redirectUri).protocol === 'https:'
  return { httpOnly: true, secure, sameSite: secure ? sameSite : 'lax', path: '/' }
}

function validOrigin(req, settings) {
  return req.get('origin') === new URL(settings.frontendUrl).origin
}

async function exchangeToken(settings, params) {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, ...params }),
  })
  if (!response.ok) throw new Error(`Strava token request failed (${response.status})`)
  return response.json()
}

async function getAccessToken(deviceId, settings, pool) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query('SELECT * FROM strava_tokens WHERE device_id = $1 FOR UPDATE', [deviceId])
    const token = rows[0]
    if (!token) {
      await client.query('ROLLBACK')
      return null
    }
    if (new Date(token.expires_at).getTime() <= Date.now() + 60000) {
      const refreshed = await exchangeToken(settings, { grant_type: 'refresh_token', refresh_token: token.refresh_token })
      await client.query('UPDATE strava_tokens SET access_token = $2, refresh_token = $3, expires_at = to_timestamp($4), updated_at = now() WHERE device_id = $1',
        [deviceId, refreshed.access_token, refreshed.refresh_token, refreshed.expires_at])
      token.access_token = refreshed.access_token
    }
    await client.query('COMMIT')
    return token
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export function registerStravaRoutes(app, pool) {
  app.get('/auth/strava/login', (req, res) => {
    const settings = config()
    if (!settings) return res.status(503).json({ error: 'Strava is not configured.' })
    const device = UUID.test(req.cookies?.[DEVICE_COOKIE] ?? '') ? req.cookies[DEVICE_COOKIE] : randomUUID()
    const state = randomUUID()
    res.cookie(DEVICE_COOKIE, device, { ...cookieOptions(settings), maxAge: 365 * 24 * 60 * 60 * 1000 })
    res.cookie(STATE_COOKIE, state, { ...cookieOptions(settings, 'lax'), maxAge: 10 * 60 * 1000 })
    const url = new URL('https://www.strava.com/oauth/authorize')
    url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.redirectUri, response_type: 'code', scope: 'activity:write', state }).toString()
    return res.redirect(url.toString())
  })

  app.get('/auth/strava/callback', async (req, res) => {
    const settings = config()
    if (!settings) return res.status(503).json({ error: 'Strava is not configured.' })
    res.clearCookie(STATE_COOKIE, cookieOptions(settings, 'lax'))
    const device = req.cookies?.[DEVICE_COOKIE]
    const scope = typeof req.query.scope === 'string' ? req.query.scope.split(',') : []
    if (!UUID.test(device ?? '') || !req.query.state || req.query.state !== req.cookies?.[STATE_COOKIE] || typeof req.query.code !== 'string' || !scope.includes('activity:write')) {
      return res.redirect(`${settings.frontendUrl}?strava=error`)
    }
    try {
      const token = await exchangeToken(settings, { grant_type: 'authorization_code', code: req.query.code })
      if (!token.athlete?.id || !token.access_token || !token.refresh_token || !token.expires_at) throw new Error('Invalid Strava token response')
      const name = [token.athlete.firstname, token.athlete.lastname].filter(Boolean).join(' ')
      await pool.query(`INSERT INTO strava_tokens (device_id, athlete_id, athlete_name, access_token, refresh_token, expires_at)
        VALUES ($1, $2, $3, $4, $5, to_timestamp($6))
        ON CONFLICT (device_id) DO UPDATE SET athlete_id = EXCLUDED.athlete_id, athlete_name = EXCLUDED.athlete_name,
        access_token = EXCLUDED.access_token, refresh_token = EXCLUDED.refresh_token, expires_at = EXCLUDED.expires_at, updated_at = now()`,
      [device, String(token.athlete.id), name, token.access_token, token.refresh_token, token.expires_at])
      return res.redirect(`${settings.frontendUrl}?strava=connected`)
    } catch (error) {
      console.error('Strava connection failed:', error.message)
      return res.redirect(`${settings.frontendUrl}?strava=error`)
    }
  })

  app.get('/api/strava/status', async (req, res) => {
    const settings = config()
    if (!settings) return res.status(503).json({ error: 'Strava is not configured.' })
    const device = req.cookies?.[DEVICE_COOKIE]
    if (!UUID.test(device ?? '')) return res.json({ connected: false })
    try {
      const { rows } = await pool.query('SELECT athlete_id, athlete_name FROM strava_tokens WHERE device_id = $1', [device])
      return res.json(rows.length ? { connected: true, athleteId: rows[0].athlete_id, athleteName: rows[0].athlete_name } : { connected: false })
    } catch {
      return res.status(500).json({ error: 'Could not load Strava connection.' })
    }
  })

  app.delete('/api/strava/connection', async (req, res) => {
    const settings = config()
    if (!settings) return res.status(503).json({ error: 'Strava is not configured.' })
    if (!validOrigin(req, settings)) return res.status(403).json({ error: 'Invalid origin.' })
    try {
      const device = req.cookies?.[DEVICE_COOKIE]
      if (UUID.test(device ?? '')) await pool.query('DELETE FROM strava_tokens WHERE device_id = $1', [device])
      res.clearCookie(DEVICE_COOKIE, cookieOptions(settings))
      return res.status(204).end()
    } catch {
      return res.status(500).json({ error: 'Could not disconnect Strava.' })
    }
  })

  app.post('/api/strava/uploads/:sessionId', express.raw({ type: 'application/vnd.ant.fit', limit: '20mb' }), async (req, res) => {
    const settings = config()
    if (!settings) return res.status(503).json({ error: 'Strava is not configured.' })
    if (!validOrigin(req, settings)) return res.status(403).json({ error: 'Invalid origin.' })
    const device = req.cookies?.[DEVICE_COOKIE]
    if (!UUID.test(device ?? '') || !UUID.test(req.params.sessionId)) return res.status(400).json({ error: 'Invalid device or session.' })
    if (!Buffer.isBuffer(req.body) || req.body.length < 14 || req.body.subarray(8, 12).toString() !== '.FIT') return res.status(400).json({ error: 'Invalid FIT file.' })
    try {
      const token = await getAccessToken(device, settings, pool)
      if (!token) return res.status(401).json({ error: 'Connect Strava first.' })
      if (req.get('x-strava-athlete-id') !== token.athlete_id) return res.status(409).json({ error: 'This session belongs to a different Strava account.' })
      const sessionId = req.params.sessionId
      const claim = await pool.query(`INSERT INTO strava_uploads (athlete_id, session_id, status)
        VALUES ($1, $2, 'sending') ON CONFLICT (athlete_id, session_id) DO NOTHING RETURNING status`, [token.athlete_id, sessionId])
      if (!claim.rowCount) {
        if (req.query.retry === 'true') {
          const retry = await pool.query("UPDATE strava_uploads SET status = 'sending', error = NULL, updated_at = now() WHERE athlete_id = $1 AND session_id = $2 AND status = 'failed' RETURNING status", [token.athlete_id, sessionId])
          if (retry.rowCount) return submitUpload(req, res, token, sessionId)
        }
        const existing = await pool.query('SELECT status, upload_id, activity_id, error FROM strava_uploads WHERE athlete_id = $1 AND session_id = $2', [token.athlete_id, sessionId])
        return res.json(existing.rows[0])
      }
      return submitUpload(req, res, token, sessionId)
    } catch (error) {
      console.error('Strava upload failed:', error.message)
      return res.status(500).json({ error: 'Could not submit Strava upload.' })
    }
  })

  async function submitUpload(req, res, token, sessionId) {
    try {
      const form = new FormData()
      form.append('file', new Blob([req.body], { type: 'application/vnd.ant.fit' }), 'activity.fit')
      form.append('data_type', 'fit')
      form.append('external_id', `nbrc-${sessionId}`)
      let upload
      try {
        const response = await fetch('https://www.strava.com/api/v3/uploads', { method: 'POST', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token.access_token}` }, body: form })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          const status = response.status >= 500 ? 'uncertain' : 'failed'
          const message = `Strava rejected the upload (${response.status}).`
          await pool.query('UPDATE strava_uploads SET status = $3, error = $4, updated_at = now() WHERE athlete_id = $1 AND session_id = $2', [token.athlete_id, sessionId, status, message])
          return res.json({ status, error: message })
        }
        upload = body.id_str ?? (body.id != null ? String(body.id) : null)
        if (!upload) throw new Error('Strava did not return an upload ID')
      } catch {
        await pool.query("UPDATE strava_uploads SET status = 'uncertain', error = $3, updated_at = now() WHERE athlete_id = $1 AND session_id = $2", [token.athlete_id, sessionId, 'Upload outcome unknown. Check Strava before retrying.'])
        return res.json({ status: 'uncertain', error: 'Upload outcome unknown. Check Strava before retrying.' })
      }
      await pool.query("UPDATE strava_uploads SET status = 'processing', upload_id = $3, updated_at = now() WHERE athlete_id = $1 AND session_id = $2", [token.athlete_id, sessionId, upload])
      return res.json({ status: 'processing', upload_id: upload })
    } catch (error) {
      console.error('Strava upload failed:', error.message)
      return res.status(500).json({ error: 'Could not submit Strava upload.' })
    }
  }

  app.get('/api/strava/uploads/:sessionId', async (req, res) => {
    const settings = config()
    if (!settings) return res.status(503).json({ error: 'Strava is not configured.' })
    const device = req.cookies?.[DEVICE_COOKIE]
    if (!UUID.test(device ?? '') || !UUID.test(req.params.sessionId)) return res.status(400).json({ error: 'Invalid device or session.' })
    try {
      const token = await getAccessToken(device, settings, pool)
      if (!token) return res.status(401).json({ error: 'Connect Strava first.' })
      const { rows } = await pool.query('SELECT status, upload_id, activity_id, error, updated_at FROM strava_uploads WHERE athlete_id = $1 AND session_id = $2', [token.athlete_id, req.params.sessionId])
      const upload = rows[0]
      if (!upload) return res.status(404).json({ error: 'Upload not found.' })
      if (upload.status === 'sending' && Date.now() - new Date(upload.updated_at).getTime() > 120000) {
        const uncertain = await pool.query("UPDATE strava_uploads SET status = 'uncertain', error = $3, updated_at = now() WHERE athlete_id = $1 AND session_id = $2 AND status = 'sending' RETURNING status, upload_id, activity_id, error", [token.athlete_id, req.params.sessionId, 'Upload outcome unknown. Check Strava before retrying.'])
        if (uncertain.rowCount) return res.json(uncertain.rows[0])
      }
      if (upload.status === 'processing') {
        const response = await fetch(`https://www.strava.com/api/v3/uploads/${encodeURIComponent(upload.upload_id)}`, { signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token.access_token}` } })
        if (!response.ok) return res.status(502).json({ error: `Could not check Strava upload (${response.status}).` })
        const body = await response.json()
        if (body.activity_id || body.error) {
          upload.status = body.activity_id ? 'uploaded' : 'failed'
          upload.activity_id = body.activity_id ? String(body.activity_id) : null
          upload.error = body.error ?? null
          await pool.query('UPDATE strava_uploads SET status = $3, activity_id = $4, error = $5, updated_at = now() WHERE athlete_id = $1 AND session_id = $2', [token.athlete_id, req.params.sessionId, upload.status, upload.activity_id, upload.error])
        }
      }
      return res.json({ status: upload.status, upload_id: upload.upload_id, activity_id: upload.activity_id, error: upload.error })
    } catch (error) {
      console.error('Strava upload status failed:', error.message)
      return res.status(500).json({ error: 'Could not check Strava upload.' })
    }
  })
}