import { useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'
import HeaderTooltip from './components/HeaderTooltip'
import { calculatePaceGuidance } from './paceGuidance'
import './Estimated2kTimeInput.css'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatPace(secondsPer500m: number): string {
  const rounded = Math.round(secondsPer500m)
  const minutes = Math.floor(rounded / 60)
  const seconds = rounded % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const L4_STROKE_RATES = [18, 20, 22, 24, 26] as const

export default function Estimated2kTimeInput() {
  const [totalSeconds, setTotalSeconds] = useEstimated2kSeconds()

  const minutes = totalSeconds != null ? Math.floor(totalSeconds / 60) : null
  const seconds = totalSeconds != null ? totalSeconds % 60 : null

  const handleMinutesChange = (raw: string) => {
    if (raw === '') {
      setTotalSeconds(seconds != null ? seconds : null)
      return
    }
    const nextMinutes = Math.max(0, Math.trunc(Number(raw)))
    setTotalSeconds(nextMinutes * 60 + (seconds ?? 0))
  }

  const handleSecondsChange = (raw: string) => {
    if (raw === '') {
      setTotalSeconds(minutes != null ? minutes * 60 : null)
      return
    }
    const nextSeconds = clamp(Math.trunc(Number(raw)), 0, 59)
    setTotalSeconds((minutes ?? 0) * 60 + nextSeconds)
  }

  return (
    <div className={`estimated-2k-time${!totalSeconds ? ' estimated-2k-time-missing' : ''}`}>
      <div className="estimated-2k-time-row">
        <span className="estimated-2k-time-label" id="estimated-2k-time-label">
          <HeaderTooltip label="Estimated 2K Time">
            Your estimated 2K time is the baseline used to calculate the target pace shown for each workout interval.
            <ul>
              <li>L4: target pace is looked up from a reference table based on your 2K pace and the workout&apos;s stroke rate.</li>
              <li>L3: target pace is 80% of the power equivalent to your 2K pace.</li>
              <li>L2: target pace is 95% of the power equivalent to your 2K pace.</li>
              <li>L1: There is no target pace, go full bore, this is just used for tests</li>
            </ul>
            Update this whenever your 2K estimate changes to keep target paces accurate.
          </HeaderTooltip>
        </span>
        <div className="estimated-2k-time-inputs" role="group" aria-labelledby="estimated-2k-time-label">
          <input
            type="number"
            inputMode="numeric"
            min={0}
            aria-label="Minutes"
            placeholder="mm"
            value={minutes ?? ''}
            onChange={(e) => handleMinutesChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
          <span aria-hidden="true">:</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            aria-label="Seconds"
            placeholder="ss"
            value={seconds ?? ''}
            onChange={(e) => handleSecondsChange(e.target.value)}
            onFocus={(e) => e.target.select()}
          />
        </div>
      </div>
      <div className="estimated-2k-target-paces" aria-label="Target paces">
        <div className="estimated-2k-target-paces-row">
          {totalSeconds != null && totalSeconds > 0 && L4_STROKE_RATES.map((spm) => {
            const { secondsPer500m } = calculatePaceGuidance('L4', {
              estimated2kSeconds: totalSeconds,
              spm,
              targetValue: null,
            })
            return (
              <span key={`L4-${spm}`} className="level-badge level-badge-l4">
                L4 R{spm}: {formatPace(secondsPer500m)} /500m
              </span>
            )
          })}
        </div>
        <div className="estimated-2k-target-paces-row">
          {totalSeconds != null && totalSeconds > 0 && (['L3', 'L2'] as const).map((level) => {
            const { secondsPer500m } = calculatePaceGuidance(level, {
              estimated2kSeconds: totalSeconds,
              spm: 0,
              targetValue: null,
            })
            return (
              <span key={level} className={`level-badge level-badge-${level.toLowerCase()}`}>
                {level} Target Pace: {formatPace(secondsPer500m)} /500m
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
