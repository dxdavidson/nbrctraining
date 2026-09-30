#!/usr/bin/env node
// Scrapes Concept2 log.concept2.com rankings pages across a range of years into one CSV file.
// Usage: node scripts/scrapeRankings.mjs --start 2002 --end 2027 [--out data/imports/rankings.csv] [--delay 400] [--gender both|M|F]

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const CSV_HEADER = 'year,gender,rank,name,age,location,country,affiliation,distance,time,verified,status\n'
const ROW_REGEX = /<tr[^>]*>(.*?)<\/tr>/gs
const CELL_REGEX = /<td[^>]*>(.*?)<\/td>/gs
const VALID_GENDERS = ['M', 'F']

function parseArgs(argv) {
  const args = { start: undefined, end: undefined, out: 'data/imports/rankings.csv', delay: 400, distance: 2000, gender: 'both' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--start') args.start = Number(argv[++i])
    else if (arg === '--end') args.end = Number(argv[++i])
    else if (arg === '--out') args.out = argv[++i]
    else if (arg === '--delay') args.delay = Number(argv[++i])
    else if (arg === '--distance') args.distance = Number(argv[++i])
    else if (arg === '--gender') args.gender = argv[++i]
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (!Number.isInteger(args.start) || !Number.isInteger(args.end)) {
    throw new Error('Usage: node scripts/scrapeRankings.mjs --start <year> --end <year> [--out <path>] [--delay <ms>] [--distance <meters>] [--gender both|M|F]')
  }
  if (args.start > args.end) {
    throw new Error(`--start (${args.start}) must be <= --end (${args.end})`)
  }
  if (args.gender !== 'both' && !VALID_GENDERS.includes(args.gender)) {
    throw new Error(`--gender must be one of: both, ${VALID_GENDERS.join(', ')}`)
  }
  return args
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPage(year, page, distance, gender) {
  const url = `https://log.concept2.com/rankings/${year}/rower/${distance}?rower=rower&gender=${gender}&status=race&page=${page}`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'nbrctraining-research-script (contact: nbrctraining project)' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.text()
}

async function fetchPageWithRetry(year, page, distance, gender, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetchPage(year, page, distance, gender)
    } catch (error) {
      lastError = error
      if (attempt < attempts) await sleep(1000 * attempt)
    }
  }
  throw lastError
}

function parseTotalPages(html) {
  const matches = [...html.matchAll(/[?&]page=(\d+)/g)].map((m) => Number(m[1]))
  return matches.length ? Math.max(...matches) : 1
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '').trim()
}

// The results table omits the "verified" column when a gender filter is applied, so cell count varies (8 or 9).
function parseRows(html, year, distance, gender) {
  const rows = []
  for (const rowMatch of html.matchAll(ROW_REGEX)) {
    const cells = [...rowMatch[1].matchAll(CELL_REGEX)].map((m) => stripTags(m[1]))
    if (cells.length !== 8 && cells.length !== 9) continue
    if (!/^\d+$/.test(cells[0])) continue

    const [rank, name, age, location, country, affiliation, time, verifiedOrStatus, status] = cells
    const hasVerifiedColumn = cells.length === 9
    rows.push({
      year,
      gender,
      rank,
      name,
      age,
      location,
      country,
      affiliation,
      distance,
      time,
      verified: hasVerifiedColumn ? verifiedOrStatus : '',
      status: hasVerifiedColumn ? status : verifiedOrStatus,
    })
  }
  return rows
}

function toCsvValue(value) {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}

function writeRows(stream, rows) {
  for (const row of rows) {
    stream.write(Object.values(row).map(toCsvValue).join(',') + '\n')
  }
}

async function scrapeYear(year, distance, gender, delayMs) {
  const firstPageHtml = await fetchPageWithRetry(year, 1, distance, gender)
  const totalPages = parseTotalPages(firstPageHtml)
  let rows = parseRows(firstPageHtml, year, distance, gender)

  for (let page = 2; page <= totalPages; page += 1) {
    await sleep(delayMs)
    const html = await fetchPageWithRetry(year, page, distance, gender)
    rows = rows.concat(parseRows(html, year, distance, gender))
  }

  return rows
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const genders = args.gender === 'both' ? VALID_GENDERS : [args.gender]

  await mkdir(dirname(args.out), { recursive: true })
  const out = createWriteStream(args.out)
  out.write(CSV_HEADER)

  for (let year = args.start; year <= args.end; year += 1) {
    for (const gender of genders) {
      const rows = await scrapeYear(year, args.distance, gender, args.delay)
      writeRows(out, rows)
      console.log(`Year ${year} (${gender}): ${rows.length} rows`)
      await sleep(args.delay)
    }
  }

  await new Promise((resolve, reject) => {
    out.end((error) => (error ? reject(error) : resolve()))
  })
  console.log(`Done. Wrote CSV to ${args.out}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
