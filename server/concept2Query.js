import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const CONCEPT2_API_BASE_URLS = {
  development: 'https://log-dev.concept2.com/api',
  production: 'https://log.concept2.com/api',
}

const USAGE = `Usage: node concept2Query.js --logids <id[,id...]> [--fromdate YYYY-MM-DD] [--todate YYYY-MM-DD]
                         [--out <file>] [--env development|production] [--type <result type>]
                         [--token <access token>]

Exports every Logbook result for the given Log IDs (Concept2 user IDs) to CSV.
Requests are authorised with a Concept2 OAuth access token (results:read scope),
supplied with --token or the CONCEPT2_ACCESS_TOKEN environment variable.

Options:
  --logids     Comma-delimited Concept2 user IDs (required).
  --token      Concept2 access token (default CONCEPT2_ACCESS_TOKEN).
  --fromdate   Earliest result date, inclusive (optional).
  --todate     Latest result date, inclusive (optional).
  --out        Output CSV path (default concept2-results.csv).
  --env        Concept2 environment (default CONCEPT2_LOGBOOK_ENVIRONMENT or development).
  --type       Restrict to one machine type, e.g. rower, skierg, bikerg (optional).
`

const PAGE_SIZE = 250

function fail(message) {
  console.error(message)
  process.exit(2)
}

function parseDate(value, name) {
  if (value === undefined) return undefined
  const parsed = new Date(`${value}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`--${name} must be a valid date in YYYY-MM-DD format.`)
  }
  return value
}

function flatten(value, prefix, out) {
  if (value === null || value === undefined) {
    out[prefix] = ''
  } else if (Array.isArray(value)) {
    out[prefix] = JSON.stringify(value)
  } else if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else {
    out[prefix] = value
  }
  return out
}

function csvCell(value) {
  const text = value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

async function fetchResults(apiBaseUrl, accessToken, logId, { fromdate, todate, type }) {
  const results = []
  for (let page = 1; ; page++) {
    const url = new URL(`${apiBaseUrl}/users/${encodeURIComponent(logId)}/results`)
    url.searchParams.set('number', String(PAGE_SIZE))
    url.searchParams.set('page', String(page))
    if (fromdate) url.searchParams.set('from', fromdate)
    if (todate) url.searchParams.set('to', todate)
    if (type) url.searchParams.set('type', type)

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Concept2 returned status ${response.status} for page ${page}`)
    }
    const body = await response.json()
    results.push(...(body.data ?? []))

    const totalPages = body.meta?.pagination?.total_pages ?? 1
    if (page >= totalPages || (body.data ?? []).length === 0) break
  }
  return results
}

async function main() {
  let values
  try {
    ;({ values } = parseArgs({
      options: {
        logids: { type: 'string' },
        fromdate: { type: 'string' },
        todate: { type: 'string' },
        out: { type: 'string', default: 'concept2-results.csv' },
        env: { type: 'string' },
        type: { type: 'string' },
        token: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    }))
  } catch (err) {
    fail(`${err.message}\n\n${USAGE}`)
  }
  if (values.help) {
    console.log(USAGE)
    return 0
  }

  const logIds = [...new Set((values.logids ?? '').split(',').map((id) => id.trim()).filter(Boolean))]
  if (logIds.length === 0) fail(`--logids is required.\n\n${USAGE}`)
  const badId = logIds.find((id) => !/^\d+$/.test(id))
  if (badId) fail(`Invalid Log ID "${badId}": IDs must be numeric.`)

  const fromdate = parseDate(values.fromdate, 'fromdate')
  const todate = parseDate(values.todate, 'todate')
  if (fromdate && todate && fromdate > todate) fail('--fromdate must not be after --todate.')

  const environment = values.env ?? process.env.CONCEPT2_LOGBOOK_ENVIRONMENT ?? 'development'
  const apiBaseUrl = CONCEPT2_API_BASE_URLS[environment]
  if (!apiBaseUrl) fail('--env must be development or production.')
  const accessToken = values.token ?? process.env.CONCEPT2_ACCESS_TOKEN
  if (!accessToken) fail('An access token is required: use --token or set CONCEPT2_ACCESS_TOKEN.')

  const rows = []
  let failures = 0
  for (const logId of logIds) {
    try {
      const results = await fetchResults(apiBaseUrl, accessToken, logId,  { fromdate, todate, type: values.type })
      for (const result of results) {
        rows.push({ log_id: logId, ...flatten(result, '', {}) })
      }
      console.error(`Log ID ${logId}: ${results.length} workout(s)`)
    } catch (err) {
      failures++
      console.error(`Log ID ${logId}: failed - ${err.message}`)
    }
  }

  const headers = []
  const seen = new Set()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        headers.push(key)
      }
    }
  }
  if (headers.length === 0) headers.push('log_id')

  const lines = [headers.map(csvCell).join(',')]
  for (const row of rows) lines.push(headers.map((header) => csvCell(row[header])).join(','))
  await writeFile(values.out, `${lines.join('\r\n')}\r\n`, 'utf8')
  console.error(`Wrote ${rows.length} workout(s) to ${values.out}`)

  return failures > 0 ? 1 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
