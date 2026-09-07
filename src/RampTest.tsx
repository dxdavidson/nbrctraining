import { useMemo, useState } from 'react'
import type { Workout } from './api'
import Pm5WorkoutSender from './Pm5WorkoutSender'
import { buildRampIntervals, calculateRampResult, type RampSettings } from './rampTestMath'
import { secondsPer500mFromWatts } from './wolverinePace'
import './RampTest.css'

const DEFAULT_START_WATTS = 100
const DEFAULT_INCREMENT_WATTS = 15
const DEFAULT_STAGE_COUNT = 10
const DEFAULT_2K_PERCENTAGE = 85

function isPositiveWholeNumber(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function formatTime(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds)
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

const rampWorkout: Workout = {
  id: 'ramp-test',
  block_id: 'ramp-test',
  wk_type: 'ERG',
  workout_code: 'Ramp Test',
  week_commencing: null,
  description: 'One-minute power ramp test',
  sort_order: 0,
  level: 'L1',
  has_intervals: true,
}

export default function RampTest() {
  const [settings, setSettings] = useState<RampSettings>({
    startWatts: DEFAULT_START_WATTS,
    incrementWatts: DEFAULT_INCREMENT_WATTS,
    stageCount: DEFAULT_STAGE_COUNT,
    conversionPercentage: DEFAULT_2K_PERCENTAGE,
  })
  const [targetOverrides, setTargetOverrides] = useState<Record<string, number>>({})
  const [lastCompletedWatts, setLastCompletedWatts] = useState('')
  const [nextStageSeconds, setNextStageSeconds] = useState('')

  const settingsAreValid =
    isPositiveWholeNumber(settings.startWatts) &&
    isPositiveWholeNumber(settings.incrementWatts) &&
    Number.isInteger(settings.stageCount) &&
    settings.stageCount >= 1 &&
    Number.isFinite(settings.conversionPercentage) &&
    settings.conversionPercentage > 0 &&
    settings.conversionPercentage <= 100
  const intervals = useMemo(() => {
    if (!settingsAreValid) return []
    return buildRampIntervals(settings).map((interval) => ({
      ...interval,
      target_value: targetOverrides[interval.id] ?? interval.target_value,
    }))
  }, [settings, settingsAreValid, targetOverrides])
  const result = useMemo(
    () => settingsAreValid
      ? calculateRampResult(settings, Number(lastCompletedWatts), Number(nextStageSeconds))
      : null,
    [lastCompletedWatts, nextStageSeconds, settings, settingsAreValid]
  )
  const canCalculate = result !== null

  const updateSetting = (key: keyof RampSettings, value: string) => {
    setTargetOverrides({})
    setSettings((current) => ({ ...current, [key]: Number(value) }))
  }

  const updateTarget = (intervalId: string, value: string) => {
    setTargetOverrides((current) => ({ ...current, [intervalId]: Number(value) }))
  }

  return (
    <main className="ramp-test">
      <p className="ramp-test-kicker">NBRC Training</p>
      <h1>Ramp Test</h1>
      <p className="ramp-test-intro">
        Row consecutive one-minute stages. Hold the target watts for as long as possible, then use the final completed
        target and partial next stage to estimate your 2K pace.
      </p>

      <section className="ramp-test-section" aria-labelledby="ramp-settings-heading">
        <h2 id="ramp-settings-heading">Coach settings</h2>
        <div className="ramp-test-settings">
          <label>
            Starting target (W)
            <input type="number" min="1" step="1" value={settings.startWatts} onChange={(event) => updateSetting('startWatts', event.target.value)} />
          </label>
          <label>
            Increase per stage (W)
            <input type="number" min="1" step="1" value={settings.incrementWatts} onChange={(event) => updateSetting('incrementWatts', event.target.value)} />
          </label>
          <label>
            Number of stages
            <input type="number" min="1" step="1" value={settings.stageCount} onChange={(event) => updateSetting('stageCount', event.target.value)} />
          </label>
          <label>
            2K conversion (%)
            <input type="number" min="1" max="100" step="1" value={settings.conversionPercentage} onChange={(event) => updateSetting('conversionPercentage', event.target.value)} />
          </label>
        </div>
        {!settingsAreValid && <p className="ramp-test-error" role="alert">Use positive whole-number targets, at least 1 stage, and a conversion from 1% to 100%.</p>}
      </section>

      <section className="ramp-test-section" aria-labelledby="ramp-protocol-heading">
        <h2 id="ramp-protocol-heading">Protocol</h2>
        <ol>
          <li>Warm up, then connect the PM5 and send the generated ramp workout.</li>
          <li>On the PM5, select Watts as the units and PaceBoat as the display before beginning.</li>
          <li>Row every stage at its target until you cannot continue; stop rather than compromising technique.</li>
        </ol>
        {settingsAreValid && (
          <table className="ramp-test-stage-table">
            <caption>PM5 stages</caption>
            <thead>
              <tr><th>Stage</th><th>Duration</th><th>Target</th><th>Pace /500m</th><th>Recovery</th></tr>
            </thead>
            <tbody>
              {intervals.map((interval) => (
                <tr key={interval.id}>
                  <td>{interval.interval_order}</td>
                  <td>1:00</td>
                  <td>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      aria-label={`Stage ${interval.interval_order} target (W)`}
                      value={interval.target_value ?? ''}
                      onChange={(event) => updateTarget(interval.id, event.target.value)}
                    />
                  </td>
                  <td>{interval.target_value != null && interval.target_value > 0 ? formatTime(secondsPer500mFromWatts(interval.target_value)) : '--'}</td>
                  <td>{interval.recovery_kind === 'time' && interval.recovery_value != null ? formatTime(interval.recovery_value) : '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pm5WorkoutSender
          workout={rampWorkout}
          intervals={intervals}
          requireEstimated2k={false}
          sendButtonLabel="Send ramp test to PM5"
          preferredUnits="watts"
        />
      </section>

      <section className="ramp-test-section" aria-labelledby="ramp-result-heading">
        <h2 id="ramp-result-heading">Calculate your estimate</h2>
        <div className="ramp-test-settings">
          <label>
            Last fully completed target (W)
            <input type="number" min="1" step="1" value={lastCompletedWatts} onChange={(event) => setLastCompletedWatts(event.target.value)} />
          </label>
          <label>
            Seconds completed at the next target
            <input type="number" min="0" max="59" step="1" value={nextStageSeconds} onChange={(event) => setNextStageSeconds(event.target.value)} />
          </label>
        </div>
        {lastCompletedWatts !== '' && nextStageSeconds !== '' && !canCalculate && (
          <p className="ramp-test-error" role="alert">Enter a listed completed target that has a next stage, and 0 to 59 seconds at that next target.</p>
        )}
        {result && (
          <dl className="ramp-test-result" aria-live="polite">
            <div><dt>Interpolated ramp power</dt><dd>{result.peakWatts.toFixed(1)} W</dd></div>
            <div><dt>Estimated 2K power</dt><dd>{Math.round(result.estimated2kWatts)} W</dd></div>
            <div><dt>Estimated 2K split</dt><dd>{formatTime(result.secondsPer500m)} /500 m</dd></div>
            <div><dt>Estimated 2K time</dt><dd>{formatTime(result.estimated2kSeconds)}</dd></div>
          </dl>
        )}
      </section>
    </main>
  )
}
