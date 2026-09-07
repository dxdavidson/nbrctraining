import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import RoundRobinErgos from './RoundRobinErgos'
import { calculateRoundRobin } from './roundRobinErgoMath'

describe('calculateRoundRobin', () => {
  it('calculates programmed rest and start delay for more rowers than machines, rounded to the nearest 5 seconds', () => {
    const result = calculateRoundRobin({ rowerCount: 7, machineCount: 5, workSeconds: 180, restSeconds: 150 })

    expect(result?.feasible).toBe(true)
    expect(result?.programmedRestSeconds).toBe(55)
    expect(result?.delaySeconds).toBeCloseTo((180 + 55) / 5)
  })

  it('needs no rotation when there are at least as many machines as rowers', () => {
    const result = calculateRoundRobin({ rowerCount: 5, machineCount: 5, workSeconds: 180, restSeconds: 150 })

    expect(result).toEqual({ programmedRestSeconds: 150, delaySeconds: 0, minimumRestSeconds: 0, feasible: true })
  })

  it('flags an infeasible rest that is shorter than the machines can sustain', () => {
    const result = calculateRoundRobin({ rowerCount: 7, machineCount: 5, workSeconds: 180, restSeconds: 10 })

    expect(result?.feasible).toBe(false)
    expect(result?.minimumRestSeconds).toBe(75)
  })

  it('enforces a 20-second minimum rest for machine changeover even when the ratio allows less', () => {
    const result = calculateRoundRobin({ rowerCount: 6, machineCount: 5, workSeconds: 60, restSeconds: 13 })

    expect(result?.feasible).toBe(false)
    expect(result?.minimumRestSeconds).toBe(20)
  })

  it('is feasible right at the 20-second changeover floor', () => {
    const result = calculateRoundRobin({ rowerCount: 6, machineCount: 5, workSeconds: 60, restSeconds: 36 })

    expect(result?.feasible).toBe(true)
    expect(result?.programmedRestSeconds).toBe(20)
    expect(result?.delaySeconds).toBeCloseTo(16)
  })

  it('returns null for invalid inputs', () => {
    expect(calculateRoundRobin({ rowerCount: 0, machineCount: 5, workSeconds: 180, restSeconds: 150 })).toBeNull()
    expect(calculateRoundRobin({ rowerCount: 7, machineCount: 5, workSeconds: 0, restSeconds: 150 })).toBeNull()
    expect(calculateRoundRobin({ rowerCount: 7, machineCount: 5, workSeconds: 180, restSeconds: -1 })).toBeNull()
  })
})

describe('Round Robin Ergos', () => {
  it('shows the programmed rest and delay for the default 7 rower / 5 machine example', () => {
    render(<RoundRobinErgos />)

    expect(screen.getByText('Rest time to program into PM5')).toBeInTheDocument()
    expect(screen.getByText('Delay between rowers starting')).toBeInTheDocument()
  })

  it('warns when the requested rest is infeasible for the given group size', async () => {
    const user = userEvent.setup()
    render(<RoundRobinErgos />)

    const restInput = screen.getByLabelText(/Interval rest time/i)
    await user.clear(restInput)
    await user.type(restInput, '0:10')

    expect(await screen.findByRole('alert')).toHaveTextContent(/too short/i)
  })

  it('requires valid rower and machine counts', async () => {
    const user = userEvent.setup()
    render(<RoundRobinErgos />)

    const rowerCount = screen.getByLabelText(/Number of rowers/i)
    await user.clear(rowerCount)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enter whole numbers/i)
  })
})
