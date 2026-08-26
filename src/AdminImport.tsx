import { useState } from 'react'
import './AdminImport.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

export default function AdminImport() {
  const [token, setToken] = useState('')
  const [csvText, setCsvText] = useState('')
  const [fileName, setFileName] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const selectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setCsvText(await file.text())
    setStatus(null)
    setError(null)
  }

  const submitImport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)
    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/import/workouts${dryRun ? '?dry_run=true' : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'X-Import-Token': token,
        },
        body: csvText,
      })
      const result = await response.json() as { message?: string; error?: string }
      if (!response.ok) {
        throw new Error(result.error ?? `Import failed with status ${response.status}.`)
      }
      setStatus(result.message ?? 'Import completed.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : String(caughtError))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="admin-import" aria-labelledby="admin-import-title">
      <p className="admin-import-kicker">NBRC Training administration</p>
      <h1 id="admin-import-title">Import workouts</h1>
      <p className="admin-import-intro">
        Upload the flat CSV exported from your spreadsheet. Plans and blocks must already exist.
      </p>

      <form onSubmit={submitImport}>
        <label>
          Import token
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            required
          />
        </label>

        <label>
          CSV file
          <input type="file" accept=".csv,text/csv" onChange={selectFile} required={!csvText} />
        </label>
        {fileName && <p className="admin-import-file">Selected: {fileName}</p>}

        <label className="admin-import-checkbox">
          <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          Validate only (dry run)
        </label>

        <button type="submit" disabled={isSubmitting || !csvText}>
          {isSubmitting ? 'Processing...' : dryRun ? 'Validate CSV' : 'Import CSV'}
        </button>
      </form>

      {status && <p className="admin-import-status" role="status">{status}</p>}
      {error && <p className="admin-import-error" role="alert">{error}</p>}
    </main>
  )
}
