import { useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'
import HeaderTooltip from './components/HeaderTooltip'
import './Estimated2kTimeInput.css'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

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
    <div className="estimated-2k-time">
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
        />
      </div>
    </div>
  )
}
