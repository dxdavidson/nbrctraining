import { randomUUID } from 'node:crypto'
import express from 'express'
import { pool } from './db.js'

// Set CONCEPT2_BASE_URL=https://log-dev.concept2.com to use the Concept2 dev logbook.
// db.js is imported first, so the root .env is already loaded when this runs.
const CONCEPT2_BASE_URL = (process.env.CONCEPT2_BASE_URL || 'https://log.concept2.com').replace(/\/+$/, '')
const CONCEPT2_AUTHORIZE_URL = `${CONCEPT2_BASE_URL}/oauth/authorize`
const CONCEPT2_TOKEN_URL = `${CONCEPT2_BASE_URL}/oauth/access_token`
export const CONCEPT2_API_BASE = `${CONCEPT2_BASE_URL}/api`
const CONCEPT2_SCOPES = 'user:read,results:write'
const DEVICE_COOKIE_NAME = 'c2_device_id'
const DEVICE_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365

function getDeviceCookieOptions() {
  const usesHttpsCallback = process.env.CONCEPT2_REDIRECT_URI?.startsWith('https://') ?? false
  return {
    httpOnly: true,
    secure: usesHttpsCallback,
    sameSite: usesHttpsCallback ? 'none' : 'lax',
  }
}

function requireConcept2Config(res) {
  const { CONCEPT2_CLIENT_ID, CONCEPT2_CLIENT_SECRET, CONCEPT2_REDIRECT_URI, CONCEPT2_FRONTEND_URL } = process.env
  if (!CONCEPT2_CLIENT_ID || !CONCEPT2_CLIENT_SECRET || !CONCEPT2_REDIRECT_URI || !CONCEPT2_FRONTEND_URL) {
    res.status(503).json({ error: 'Concept2 integration is not configured on the server.' })
    return null
  }
  return { CONCEPT2_CLIENT_ID, CONCEPT2_CLIENT_SECRET, CONCEPT2_REDIRECT_URI, CONCEPT2_FRONTEND_URL }
}

function setDeviceCookie(res, deviceId) {
  res.cookie(DEVICE_COOKIE_NAME, deviceId, {
    ...getDeviceCookieOptions(),
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  })
}

function clearDeviceCookie(res) {
  res.clearCookie(DEVICE_COOKIE_NAME, getDeviceCookieOptions())
}

async function exchangeCodeForTokens(config, code) {
  const response = await fetch(CONCEPT2_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.CONCEPT2_CLIENT_ID,
      client_secret: config.CONCEPT2_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.CONCEPT2_REDIRECT_URI,
    }),
  })
  if (!response.ok) {
    throw new Error(`Concept2 token exchange failed with status ${response.status}`)
  }
  return response.json()
}

function getConcept2UserDisplayName(user) {
  const values = [
    user?.name,
    user?.username,
    user?.user_name,
    [user?.first_name, user?.last_name].filter(Boolean).join(' '),
    [user?.firstName, user?.lastName].filter(Boolean).join(' '),
  ]
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? null
}

// Maps the profile's weight class to Concept2's "H"/"L" result values; null when absent or unrecognised.
function getConcept2WeightClass(user) {
  const value = String(user?.weight_class ?? user?.weightClass ?? '').trim().toLowerCase()
  if (value === 'l' || value.startsWith('light')) return 'L'
  if (value === 'h' || value.startsWith('heavy')) return 'H'
  return null
}

async function fetchConcept2User(accessToken) {
  const response = await fetch(`${CONCEPT2_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Fetching Concept2 user failed with status ${response.status}`)
  }
  const body = await response.json()
  const user = body?.data ?? body
  return {
    userId: String(user?.id ?? ''),
    userName: getConcept2UserDisplayName(user),
    weightClass: getConcept2WeightClass(user),
  }
}

async function upsertTokens(deviceId, concept2User, tokens) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await pool.query(
    `INSERT INTO concept2_tokens (device_id, concept2_user_id, concept2_user_name, weight_class, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (device_id) DO UPDATE
     SET concept2_user_id = EXCLUDED.concept2_user_id, concept2_user_name = EXCLUDED.concept2_user_name,
         weight_class = EXCLUDED.weight_class,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
    [deviceId, concept2User.userId, concept2User.userName, concept2User.weightClass, tokens.access_token, tokens.refresh_token, expiresAt]
  )
}

export function registerConcept2Routes(app) {
  app.get('/auth/concept2/login', (req, res) => {
    const config = requireConcept2Config(res)
    if (!config) return

    // Reuse the athlete's existing device id so re-linking doesn't create duplicate rows.
    const deviceId = req.cookies?.[DEVICE_COOKIE_NAME] ?? randomUUID()
    setDeviceCookie(res, deviceId)

    const authorizeUrl = new URL(CONCEPT2_AUTHORIZE_URL)
    authorizeUrl.searchParams.set('client_id', config.CONCEPT2_CLIENT_ID)
    authorizeUrl.searchParams.set('redirect_uri', config.CONCEPT2_REDIRECT_URI)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('scope', CONCEPT2_SCOPES)
    // Doubles as CSRF protection: the callback checks this matches the device cookie.
    authorizeUrl.searchParams.set('state', deviceId)

    res.redirect(authorizeUrl.toString())
  })

  app.get('/auth/concept2/callback', async (req, res) => {
    const config = requireConcept2Config(res)
    if (!config) return

    const { code, state, error: oauthError } = req.query
    const deviceId = req.cookies?.[DEVICE_COOKIE_NAME]

    if (oauthError) {
      return res.redirect(`${config.CONCEPT2_FRONTEND_URL}?concept2=error`)
    }
    if (!code || !state || !deviceId || state !== deviceId) {
      return res.status(400).json({ error: 'Invalid or missing OAuth state.' })
    }

    try {
      const tokens = await exchangeCodeForTokens(config, code)
      const concept2User = await fetchConcept2User(tokens.access_token)
      await upsertTokens(deviceId, concept2User, tokens)
      res.redirect(`${config.CONCEPT2_FRONTEND_URL}?concept2=connected`)
    } catch (err) {
      console.error('Concept2 OAuth callback failed:', err)
      res.redirect(`${config.CONCEPT2_FRONTEND_URL}?concept2=error`)
    }
  })

  app.get('/api/concept2/status', async (req, res) => {
    const deviceId = req.cookies?.[DEVICE_COOKIE_NAME]
    if (!deviceId) {
      return res.json({ connected: false })
    }

    try {
      const { rows } = await pool.query('SELECT concept2_user_id, concept2_user_name FROM concept2_tokens WHERE device_id = $1', [
        deviceId,
      ])
      if (rows.length === 0) {
        return res.json({ connected: false })
      }
      res.json({
        connected: true,
        concept2UserId: rows[0].concept2_user_id,
        concept2UserName: rows[0].concept2_user_name,
      })
    } catch (err) {
      console.error('Failed to load Concept2 connection status:', err)
      res.status(500).json({ error: 'Failed to load Concept2 connection status.' })
    }
  })

  app.delete('/api/concept2/connection', async (req, res) => {
    const deviceId = req.cookies?.[DEVICE_COOKIE_NAME]
    if (!deviceId) {
      return res.status(204).end()
    }

    try {
      await pool.query('DELETE FROM concept2_tokens WHERE device_id = $1', [deviceId])
      clearDeviceCookie(res)
      res.status(204).end()
    } catch (err) {
      console.error('Failed to disconnect Concept2 account:', err)
      res.status(500).json({ error: 'Failed to disconnect Concept2 account.' })
    }
  })

  app.post('/api/logbook/results', express.json({ limit: '64kb' }), async (req, res) => {
    const deviceId = req.cookies?.[DEVICE_COOKIE_NAME]
    if (!deviceId) {
      return res.status(401).json({ error: 'No Concept2 account is linked to this device.' })
    }

    try {
      const connection = await getConcept2Connection(deviceId)
      if (!connection) {
        return res.status(401).json({ error: 'No Concept2 account is linked to this device.' })
      }

      const payload = buildResultPayload({ ...req.body, weightClass: connection.weightClass })
      if (!payload) {
        return res.status(400).json({ error: 'distance and time are required and must be positive numbers.' })
      }

      const response = await fetch(`${CONCEPT2_API_BASE}/users/${connection.concept2UserId}/results`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const responseBody = await response.json().catch(() => null)
      if (!response.ok) {
        console.error('Concept2 result upload rejected:', response.status, responseBody)
        return res.status(502).json({ error: 'Concept2 rejected the result.', details: responseBody })
      }

      res.status(201).json({ result: responseBody })
    } catch (err) {
      console.error('Failed to upload result to Concept2:', err)
      res.status(500).json({ error: 'Failed to upload result to Concept2.' })
    }
  })
}

// Maps a PM5 workout-summary payload (see ergometer.js workoutSummaryDataEvent) to a Concept2
// result. Field names follow Concept2's published Result API shape; verify against the actual
// response the first time this runs, since it can only be confirmed against the live API.
// Optional summary.intervals: [{ distance (m), elapsedTime (ms), strokeRate?, restTime (ms)? }]
export function buildResultPayload(summary) {
  const distance = Number(summary?.distance)
  const timeSeconds = Number(summary?.elapsedTime) / 1000
  if (!Number.isFinite(distance) || distance <= 0 || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
    return null
  }

  const startedAt = new Date(summary?.startedAt ?? Date.now())
  const payload = {
    type: 'rower',
    // Required by Concept2: "H" (heavyweight) or "L" (lightweight).
    weight_class: summary?.weightClass === 'L' ? 'L' : 'H',
    // Concept2 expects "YYYY-MM-DD HH:MM:SS" and times in tenths of a second.
    date: startedAt.toISOString().slice(0, 19).replace('T', ' '),
    distance: Math.round(distance),
    time: Math.round(timeSeconds * 10),
  }

  if (Array.isArray(summary?.intervals) && summary.intervals.length > 0) {
    payload.workout_type = 'VariableInterval'
    payload.workout = {
      intervals: summary.intervals.map((interval) => ({
        type: interval.type ?? 'time',
        distance: Math.round(Number(interval.distance)),
        time: Math.round(Number(interval.elapsedTime) / 100),
        ...(Number(interval.strokeRate) > 0 ? { stroke_rate: Math.round(Number(interval.strokeRate)) } : {}),
        ...(Number(interval.restTime) > 0 ? { rest_time: Math.round(Number(interval.restTime) / 100) } : {}),
      })),
    }
  }

  if (Number.isFinite(Number(summary?.averageStrokeRate))) {
    payload.stroke_rate = Math.round(Number(summary.averageStrokeRate))
  }
  if (Number.isFinite(Number(summary?.averageHeartrate)) && Number(summary.averageHeartrate) > 0) {
    payload.heart_rate = {
      average: Math.round(Number(summary.averageHeartrate)),
      ...(Number(summary?.maxHeartrate) > 0 ? { max: Math.round(Number(summary.maxHeartrate)) } : {}),
      ...(Number(summary?.minHeartrate) > 0 ? { min: Math.round(Number(summary.minHeartrate)) } : {}),
    }
  }
  if (Number.isFinite(Number(summary?.dragFactorAverage))) {
    payload.drag_factor = Math.round(Number(summary.dragFactorAverage))
  }

  return payload
}

export async function getConcept2Connection(deviceId) {
  const { rows } = await pool.query('SELECT concept2_user_id, weight_class FROM concept2_tokens WHERE device_id = $1', [deviceId])
  if (rows.length === 0) return null

  const accessToken = await getValidConcept2AccessToken(deviceId)
  if (!accessToken) return null

  return { accessToken, concept2UserId: rows[0].concept2_user_id, weightClass: rows[0].weight_class }
}

// Returns a usable access token for the device, refreshing it first if it has expired.
export async function getValidConcept2AccessToken(deviceId) {
  const { rows } = await pool.query(
    'SELECT access_token, refresh_token, expires_at FROM concept2_tokens WHERE device_id = $1',
    [deviceId]
  )
  if (rows.length === 0) return null

  const row = rows[0]
  const stillValid = new Date(row.expires_at).getTime() > Date.now() + 60_000
  if (stillValid) {
    return row.access_token
  }

  const { CONCEPT2_CLIENT_ID, CONCEPT2_CLIENT_SECRET } = process.env
  const response = await fetch(CONCEPT2_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CONCEPT2_CLIENT_ID,
      client_secret: CONCEPT2_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    }),
  })
  if (!response.ok) {
    throw new Error(`Refreshing Concept2 token failed with status ${response.status}`)
  }

  const tokens = await response.json()
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await pool.query(
    `UPDATE concept2_tokens
     SET access_token = $2, refresh_token = $3, expires_at = $4, updated_at = now()
     WHERE device_id = $1`,
    [deviceId, tokens.access_token, tokens.refresh_token ?? row.refresh_token, expiresAt]
  )

  return tokens.access_token
}
