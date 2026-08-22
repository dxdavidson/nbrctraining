import pg from 'pg'
import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'

// In production (Railway), env vars are injected directly; the root .env is
// only present for local development, so a missing file here is expected.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Add it to the root .env file or your Railway service variables.')
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})
