import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, test } from 'node:test'
import express from 'express'
import cookieParser from 'cookie-parser'
import { registerStravaRoutes } from './strava.js'

const deviceId = 'c0d0e0f0-1234-4321-8123-123456789abc'
const sessionId = 'd0d0e0f0-1234-4321-8123-123456789abc'
const token = { athlete_id: '123', athlete_name: 'Rower', access_token: 'access', refresh_token: 'refresh', expires_at: new Date(Date.now() + 3600000) }
const uploads = new Map()
let uploadCalls = 0
let refreshCalls = 0
let uploadMode = 'success'
const pool = {
  async connect() {
    return {
      async query(sql, values) {
        if (sql.startsWith('SELECT * FROM strava_tokens')) return { rows: [token] }
        if (sql.startsWith('UPDATE strava_tokens')) {
          Object.assign(token, { access_token: values[1], refresh_token: values[2], expires_at: new Date(values[3] * 1000) })
        }
        return { rows: [] }
      },
      release() {},
    }
  },
  async query(sql, values) {
    if (sql.startsWith('SELECT athlete_id, athlete_name')) return { rows: [token] }
    if (sql.includes('INSERT INTO strava_uploads')) {
      if (uploads.has(values[1])) return { rowCount: 0, rows: [] }
      uploads.set(values[1], { status: 'sending', upload_id: null, activity_id: null, error: null })
      return { rowCount: 1, rows: [{ status: 'sending' }] }
    }
    if (sql.startsWith('SELECT status, upload_id')) return { rows: uploads.has(values[1]) ? [{ ...uploads.get(values[1]) }] : [] }
    if (sql.includes("SET status = 'sending'")) {
      const upload = uploads.get(values[1])
      if (upload?.status !== 'failed') return { rowCount: 0, rows: [] }
      Object.assign(upload, { status: 'sending', error: null })
      return { rowCount: 1, rows: [{ status: 'sending' }] }
    }
    if (sql.includes("SET status = 'processing'")) {
      Object.assign(uploads.get(values[1]), { status: 'processing', upload_id: values[2] })
      return { rowCount: 1 }
    }
    if (sql.includes("SET status = 'uncertain'")) {
      Object.assign(uploads.get(values[1]), { status: 'uncertain', error: values[2] })
      return { rowCount: 1 }
    }
    if (sql.includes('SET status = $3, activity_id')) {
      Object.assign(uploads.get(values[1]), { status: values[2], activity_id: values[3], error: values[4] })
      return { rowCount: 1 }
    }
    throw new Error(`Unexpected query: ${sql}`)
  },
}

let server
let baseUrl
let originalFetch

function call(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = request(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: { cookie: `strava_device_id=${deviceId}`, origin: 'https://frontend.example', ...options.headers },
    }, (res) => {
      let body = ''
      res.on('data', (chunk) => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: body && res.headers['content-type']?.includes('application/json') ? JSON.parse(body) : body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

before(async () => {
  Object.assign(process.env, {
    STRAVA_CLIENT_ID: 'client', STRAVA_CLIENT_SECRET: 'secret',
    STRAVA_REDIRECT_URI: 'https://api.example/auth/strava/callback', STRAVA_FRONTEND_URL: 'https://frontend.example/otw.html',
  })
  originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    if (url === 'https://www.strava.com/oauth/token') {
      refreshCalls += 1
      assert.equal(options.body.get('refresh_token'), 'refresh')
      return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 }), { status: 200 })
    }
    assert.match(url, /^https:\/\/www\.strava\.com\/api\/v3\/uploads/)
    if (options.method === 'POST') {
      uploadCalls += 1
      assert.equal(options.body.get('data_type'), 'fit')
      if (uploadMode === 'network-error') throw new Error('network error')
      return new Response(JSON.stringify({ id_str: '987654321' }), { status: 201 })
    }
    return new Response(JSON.stringify({ activity_id: 42, error: null }), { status: 200 })
  }
  const app = express()
  app.use(cookieParser())
  registerStravaRoutes(app, pool)
  server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  globalThis.fetch = originalFetch
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

test('requires a valid origin and matching athlete before sending data', async () => {
  const fit = Buffer.from([14, 0, 0, 0, 0, 0, 0, 0, 46, 70, 73, 84, 0, 0])
  const headers = { 'content-type': 'application/vnd.ant.fit', 'x-strava-athlete-id': 'wrong' }
  assert.equal((await call(`/api/strava/uploads/${sessionId}`, { method: 'POST', headers, body: fit })).status, 409)
  assert.equal((await call(`/api/strava/uploads/${sessionId}`, { method: 'POST', headers: { ...headers, origin: 'https://other.example' }, body: fit })).status, 403)
  assert.equal(uploadCalls, 0)
})

test('submits once and checks processing status without resending', async () => {
  const fit = Buffer.from([14, 0, 0, 0, 0, 0, 0, 0, 46, 70, 73, 84, 0, 0])
  const options = { method: 'POST', headers: { 'content-type': 'application/vnd.ant.fit', 'x-strava-athlete-id': '123' }, body: fit }
  const first = await call(`/api/strava/uploads/${sessionId}`, options)
  assert.equal(first.body.status, 'processing')
  const second = await call(`/api/strava/uploads/${sessionId}`, options)
  assert.equal(second.body.status, 'processing')
  assert.equal(uploadCalls, 1)
  const result = await call(`/api/strava/uploads/${sessionId}`)
  assert.equal(result.body.status, 'uploaded')
  assert.equal(result.body.activity_id, '42')
})

test('refreshes an expired token and saves the rotated refresh token', async () => {
  token.expires_at = new Date(0)
  const result = await call(`/api/strava/uploads/${sessionId}`)
  assert.equal(result.body.status, 'uploaded')
  assert.equal(refreshCalls, 1)
  assert.equal(token.access_token, 'new-access')
  assert.equal(token.refresh_token, 'new-refresh')
})

test('does not resubmit when the outcome of an upload is unknown', async () => {
  const otherSession = 'e0d0e0f0-1234-4321-8123-123456789abc'
  const fit = Buffer.from([14, 0, 0, 0, 0, 0, 0, 0, 46, 70, 73, 84, 0, 0])
  const options = { method: 'POST', headers: { 'content-type': 'application/vnd.ant.fit', 'x-strava-athlete-id': '123' }, body: fit }
  uploadMode = 'network-error'
  const result = await call(`/api/strava/uploads/${otherSession}`, options)
  assert.equal(result.body.status, 'uncertain')
  const calls = uploadCalls
  uploadMode = 'success'
  const retry = await call(`/api/strava/uploads/${otherSession}?retry=true`, options)
  assert.equal(retry.body.status, 'uncertain')
  assert.equal(uploadCalls, calls)
})

test('requires a matching OAuth state and activity write permission', async () => {
  const previousRefreshCalls = refreshCalls
  const login = await call('/auth/strava/login')
  assert.equal(login.status, 302)
  const state = new URL(login.headers.location).searchParams.get('state')
  assert.ok(state)
  const cookie = `strava_device_id=${deviceId}; strava_oauth_state=${state}`
  const missingScope = await call(`/auth/strava/callback?code=example&state=${state}&scope=read`, { headers: { cookie } })
  assert.match(missingScope.headers.location, /strava=error/)
  const invalidState = await call('/auth/strava/callback?code=example&state=wrong&scope=activity%3Awrite', { headers: { cookie } })
  assert.match(invalidState.headers.location, /strava=error/)
  assert.equal(refreshCalls, previousRefreshCalls)
})