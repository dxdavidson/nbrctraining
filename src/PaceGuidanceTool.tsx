import { useMemo, useState } from 'react'
import { calculatePaceGuidance, isWolverineLevel, type TargetMode } from './paceGuidance'
import './PaceGuidanceTool.css'

const TARGET_MODES: TargetMode[] = ['L2', 'L3', 'L4', 'two_k_pace_offset_seconds', 'two_k_pace_multiplier']

function parseTime(input: string): number | null {
  const match = input.trim().match(/^(\d+):([0-5]?\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function formatPace(secondsPer500m: number): string {
  const rounded = Math.round(secondsPer500m * 10) / 10
  const minutes = Math.floor(rounded / 60)
  const seconds = (rounded % 60).toFixed(1).padStart(4, '0')
  return `${minutes}:${seconds}`
}

// Standalone page for validating pace-guidance formulas without needing the full plan/import UI.
export default function PaceGuidanceTool() {
  const [timeInput, setTimeInput] = useState('7:35')
  const [spmInput, setSpmInput] = useState('24')
  const [mode, setMode] = useState<TargetMode>('L2')
  const [targetValueInput, setTargetValueInput] = useState('')

  const result = useMemo(() => {
    const estimated2kSeconds = parseTime(timeInput)
    if (estimated2kSeconds == null) {
      return { error: 'Enter estimated 2K time as m:ss, e.g. 7:35' }
    }

    const spm = Number(spmInput)
    if (!Number.isFinite(spm) || spm <= 0) {
      return { error: 'Enter a positive stroke rate.' }
    }

    const requiresTargetValue = !isWolverineLevel(mode)
    const targetValue = targetValueInput.trim() === '' ? null : Number(targetValueInput)
    if (requiresTargetValue && (targetValue == null || !Number.isFinite(targetValue))) {
      return { error: 'Enter a target value.' }
    }

    try {
      const { secondsPer500m, watts } = calculatePaceGuidance(mode, { estimated2kSeconds, spm, targetValue })
      return { pace: formatPace(secondsPer500m), watts }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Unable to calculate pace guidance.' }
    }
  }, [timeInput, spmInput, mode, targetValueInput])

  return (
    <div className="pace-guidance-tool">
      <h1>Pace Guidance Tool</h1>
      <form className="pace-guidance-form" onSubmit={(e) => e.preventDefault()}>
        <label>
          Estimated 2K time (m:ss)
          <input value={timeInput} onChange={(e) => setTimeInput(e.target.value)} placeholder="7:35" />
        </label>
        <label>
          Stroke rate (spm)
          <input value={spmInput} onChange={(e) => setSpmInput(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          Target mode
          <select value={mode} onChange={(e) => setMode(e.target.value as TargetMode)}>
            {TARGET_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Target value {mode === 'two_k_pace_offset_seconds' && '(seconds, +/-)'}
          {mode === 'two_k_pace_multiplier' && '(%, +/-)'}
          {isWolverineLevel(mode) && '(not used for Wolverine levels)'}
          <input
            value={targetValueInput}
            onChange={(e) => setTargetValueInput(e.target.value)}
            inputMode="decimal"
            disabled={isWolverineLevel(mode)}
          />
        </label>
      </form>
      <div className="pace-guidance-result">
        {result.error ? (
          <p className="pace-guidance-error">{result.error}</p>
        ) : (
          <p>
            Target pace: <strong>{result.pace}</strong> /500m ({result.watts}W)
          </p>
        )}
      </div>
    </div>
  )
}
