import { randomUUID } from 'node:crypto'
import { pool } from './db.js'

const CONCEPT2_AUTHORIZE_URL = 'https://log.concept2.com/oauth/authorize'
const CONCEPT2_TOKEN_URL = 'https://log.concept2.com/oauth/access_token'
const CONCEPT2_API_BASE = 'https://log.concept2.com/api'
const CONCEPT2_SCOPES = 'user:read,results:write'
const DEVICE_COOKIE_NAME = 'c2_device_id'
const DEVICE_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365

function requireConcept2Config(res) {
  const { CONCEPT2_CLIENT_ID, CONCEPT2_CLIENT_SECRET, CONCEPT2_REDIRECT_URI, CONCEPT2_FRONTEND_URL } = process.env
  if (!CONCEPT2_CLIENT_ID || !CONCEPT2_CLIENT_SECRET || !CONCEPT2_REDIRECT_URI || !CONCEPT2_FRONTEND_URL) {
    res.status(503).json({ error: 'Concept2 integration is not configured on the server.' })
    return null
  }
  return { CONCEPT2_CLIENT_ID, CONCEPT2_CLIENT_SECRET, CONCEPT2_REDIRECT_URI, CONCEPT2_FRONTEND_URL }
}

function setDeviceCookie(res, deviceId) {
  // sameSite: 'none' + secure is required since the frontend and API are on different origins
  res.cookie(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  })
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

async function fetchConcept2UserId(accessToken) {
  const response = await fetch(`${CONCEPT2_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    throw new Error(`Fetching Concept2 user failed with status ${response.status}`)
  }
  const body = await response.json()
  return String(body?.data?.id ?? body?.id ?? '')
}

async function upsertTokens(deviceId, concept2UserId, tokens) {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)
  await pool.query(
    `INSERT INTO concept2_tokens (device_id, concept2_user_id, access_token, refresh_token, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (device_id) DO UPDATE
     SET concept2_user_id = EXCLUDED.concept2_user_id,
         access_token = EXCLUDED.access_token,
         refresh_token = EXCLUDED.refresh_token,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()`,
    [deviceId, concept2UserId, tokens.access_token, tokens.refresh_token, expiresAt]
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
      const concept2UserId = await fetchConcept2UserId(tokens.access_token)
      await upsertTokens(deviceId, concept2UserId, tokens)
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
      const { rows } = await pool.query('SELECT concept2_user_id FROM concept2_tokens WHERE device_id = $1', [
        deviceId,
      ])
      if (rows.length === 0) {
        return res.json({ connected: false })
      }
      res.json({ connected: true, concept2UserId: rows[0].concept2_user_id })
    } catch (err) {
      console.error('Failed to load Concept2 connection status:', err)
      res.status(500).json({ error: 'Failed to load Concept2 connection status.' })
    }
  })
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
