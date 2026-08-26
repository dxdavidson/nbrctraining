import { useState } from 'react'
import './AdminImport.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000'

interface ImportLogEntry {
  id: string
  imported_at: string
  plan_code: string
  block_code: string
  workout_code: string
  interval_count: number
  source_filename: string | null
}

interface ImportResponse {
  message?: string
  error?: string
  imported_workouts?: Array<{
    plan_code: string
    block_code: string
    workout_code: string
    interval_count: number
  }>
}

function formatImportedAt(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function AdminImport() {
  const [token, setToken] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileName, setFileName] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [deleteExistingBlocks, setDeleteExistingBlocks] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [importLog, setImportLog] = useState<ImportLogEntry[]>([])

  const selectFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFile(file)
    setFileName(file.name)
    setStatus(null)
    setError(null)
  }

  const submitImport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus(null)
    setError(null)
    setIsSubmitting(true)

    try {
      if (!selectedFile) {
        throw new Error('Choose a CSV file before submitting.')
      }
      const csvText = await selectedFile.text()
      const params = new URLSearchParams()
      if (dryRun) params.set('dry_run', 'true')
      if (deleteExistingBlocks) params.set('delete_existing_blocks', 'true')
      const query = params.toString()
      const response = await fetch(`${API_BASE_URL}/api/admin/import/workouts${query ? `?${query}` : ''}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/csv',
          'X-Import-Token': token,
        },
        body: csvText,
      })
      const result = await response.json() as ImportResponse
      if (!response.ok) {
        throw new Error(result.error ?? `Import failed with status ${response.status}.`)
      }
      setStatus(result.message ?? 'Import completed.')
      const importedWorkouts = result.imported_workouts ?? []
      if (!dryRun && importedWorkouts.length > 0) {
        const importedAt = new Date().toISOString()
        setImportLog((previous) => [
          ...importedWorkouts.map((workout, index) => ({
            ...workout,
            id: `${importedAt}-${index}`,
            imported_at: importedAt,
            source_filename: fileName || null,
          })),
          ...previous,
        ])
      }
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
            <input type="file" accept=".csv,text/csv" onChange={selectFile} required={!selectedFile} />
        </label>
        {fileName && <p className="admin-import-file">Selected: {fileName}</p>}

        <label className="admin-import-checkbox">
          <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
          Analyse only (dry run)
        </label>

        <label className="admin-import-checkbox">
          <input
            type="checkbox"
            checked={deleteExistingBlocks}
            onChange={(event) => setDeleteExistingBlocks(event.target.checked)}
          />
          Delete existing workouts for CSV blocks before import
        </label>

        <button type="submit" disabled={isSubmitting || !selectedFile}>
          {isSubmitting ? 'Processing...' : dryRun ? 'Analyse CSV' : 'Import CSV'}
        </button>
      </form>

      <section className="admin-import-history" aria-labelledby="admin-import-history-title">
        <div className="admin-import-history-header">
          <h2 id="admin-import-history-title">Imported workouts</h2>
        </div>
        {importLog.length === 0 ? (
          <p>No workouts imported during this session.</p>
        ) : (
          <div className="admin-import-history-table-wrapper">
            <table className="admin-import-history-table">
              <thead>
                <tr>
                  <th scope="col">Imported</th>
                  <th scope="col">Plan / block</th>
                  <th scope="col">Workout</th>
                  <th scope="col">Intervals</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {importLog.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatImportedAt(entry.imported_at)}</td>
                    <td>{entry.plan_code} / {entry.block_code}</td>
                    <td>{entry.workout_code}</td>
                    <td>{entry.interval_count}</td>
                    <td>{entry.source_filename ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {status && <p className="admin-import-status" role="status">{status}</p>}
      {error && <p className="admin-import-error" role="alert">{error}</p>}
    </main>
  )
}
