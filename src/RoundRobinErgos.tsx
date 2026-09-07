import { useMemo, useState } from 'react'
import { calculateRoundRobin } from './roundRobinErgoMath'
import './RoundRobinErgos.css'

const DEFAULT_ROWER_COUNT = '7'
const DEFAULT_MACHINE_COUNT = '5'
const DEFAULT_WORK_TIME = '3:00'
const DEFAULT_REST_TIME = '2:30'

function parseTime(input: string): number | null {
  const match = input.trim().match(/^(\d+):([0-5]?\d)$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function formatTime(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds)
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`
}

export default function RoundRobinErgos() {
  const [rowerCountInput, setRowerCountInput] = useState(DEFAULT_ROWER_COUNT)
  const [machineCountInput, setMachineCountInput] = useState(DEFAULT_MACHINE_COUNT)
  const [workTimeInput, setWorkTimeInput] = useState(DEFAULT_WORK_TIME)
  const [restTimeInput, setRestTimeInput] = useState(DEFAULT_REST_TIME)

  const parsed = useMemo(() => {
    const rowerCount = Number(rowerCountInput)
    const machineCount = Number(machineCountInput)
    const workSeconds = parseTime(workTimeInput)
    const restSeconds = parseTime(restTimeInput)
    return { rowerCount, machineCount, workSeconds, restSeconds }
  }, [rowerCountInput, machineCountInput, workTimeInput, restTimeInput])

  const inputsAreValid =
    Number.isInteger(parsed.rowerCount) && parsed.rowerCount >= 1 &&
    Number.isInteger(parsed.machineCount) && parsed.machineCount >= 1 &&
    parsed.workSeconds != null &&
    parsed.restSeconds != null

  const result = useMemo(() => {
    if (!inputsAreValid) return null
    return calculateRoundRobin({
      rowerCount: parsed.rowerCount,
      machineCount: parsed.machineCount,
      workSeconds: parsed.workSeconds as number,
      restSeconds: parsed.restSeconds as number,
    })
  }, [inputsAreValid, parsed])

  return (
    <main className="round-robin-ergos">
      <p className="round-robin-ergos-kicker">NBRC Training</p>
      <h1>Round Robin Ergos</h1>
      <p className="round-robin-ergos-intro">
        When there are more rowers than ergs, rowers rotate through the machines in a fixed order. Enter the
        group size and the desired work/rest intervals to get the rest time to program into each PM5 and the
        delay to use between each rower starting their first interval.
      </p>

      <section className="round-robin-ergos-section" aria-labelledby="round-robin-ergos-settings-heading">
        <h2 id="round-robin-ergos-settings-heading">Session settings</h2>
        <div className="round-robin-ergos-settings">
          <label>
            Number of rowers
            <input
              type="number"
              min="1"
              step="1"
              value={rowerCountInput}
              onChange={(event) => setRowerCountInput(event.target.value)}
            />
          </label>
          <label>
            Number of machines
            <input
              type="number"
              min="1"
              step="1"
              value={machineCountInput}
              onChange={(event) => setMachineCountInput(event.target.value)}
            />
          </label>
          <label>
            Interval work time (m:ss)
            <input value={workTimeInput} onChange={(event) => setWorkTimeInput(event.target.value)} placeholder="3:00" />
          </label>
          <label>
            Interval rest time (m:ss)
            <input value={restTimeInput} onChange={(event) => setRestTimeInput(event.target.value)} placeholder="2:30" />
          </label>
        </div>
        {!inputsAreValid && (
          <p className="round-robin-ergos-error" role="alert">
            Enter whole numbers of rowers and machines (1 or more) and work/rest times as m:ss.
          </p>
        )}
        {inputsAreValid && result && !result.feasible && (
          <p className="round-robin-ergos-error" role="alert">
            {formatTime(parsed.restSeconds as number)} rest is too short for {parsed.rowerCount} rowers on{' '}
            {parsed.machineCount} machines. The shortest rest that keeps the machines constantly busy is{' '}
            {formatTime(result.minimumRestSeconds)}.
          </p>
        )}
      </section>

      {inputsAreValid && result && result.feasible && (
        <section className="round-robin-ergos-section" aria-labelledby="round-robin-ergos-result-heading">
          <h2 id="round-robin-ergos-result-heading">PM5 setup</h2>
          <dl className="round-robin-ergos-result" aria-live="polite">
            <div>
              <dt>Rest time to program into PM5</dt>
              <dd>{formatTime(result.programmedRestSeconds)}</dd>
            </div>
            <div>
              <dt>Delay between rowers starting</dt>
              <dd>{formatTime(result.delaySeconds)}</dd>
            </div>
          </dl>
        </section>
      )}
    </main>
  )
}
