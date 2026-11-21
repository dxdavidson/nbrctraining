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
    expect(result?.minimumRestSeconds).toBe(100)
  })

  it('includes the machine changeover time in the minimum rower rest', () => {
    const result = calculateRoundRobin({ rowerCount: 6, machineCount: 5, workSeconds: 60, restSeconds: 13 })

    expect(result?.feasible).toBe(false)
    expect(result?.minimumRestSeconds).toBe(40)
  })

  it('is feasible right at the 20-second changeover floor', () => {
    const result = calculateRoundRobin({ rowerCount: 6, machineCount: 5, workSeconds: 60, restSeconds: 36 })

    expect(result?.feasible).toBe(true)
    expect(result?.minimumRestSeconds).toBe(40)
    expect(result?.programmedRestSeconds).toBe(20)
    expect(result?.delaySeconds).toBeCloseTo(16)
  })

  it('reports the minimum rower rest needed for machine changeover', () => {
    const result = calculateRoundRobin({ rowerCount: 9, machineCount: 5, workSeconds: 240, restSeconds: 200 })

    expect(result?.feasible).toBe(false)
    expect(result?.minimumRestSeconds).toBe(230)
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

  it('shows a consistent minimum rest for the 9 rower / 5 machine example', async () => {
    const user = userEvent.setup()
    render(<RoundRobinErgos />)

    await user.clear(screen.getByLabelText(/Number of rowers/i))
    await user.type(screen.getByLabelText(/Number of rowers/i), '9')
    await user.clear(screen.getByLabelText(/Number of machines/i))
    await user.type(screen.getByLabelText(/Number of machines/i), '5')
    await user.clear(screen.getByLabelText(/Interval work time/i))
    await user.type(screen.getByLabelText(/Interval work time/i), '4:00')
    const restInput = screen.getByLabelText(/Interval rest time/i)
    await user.clear(restInput)
    await user.type(restInput, '3:20')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '3:20 rest is too short for 9 rowers on 5 machines. The shortest rest that keeps the machines constantly busy is 3:50.',
    )
  })

  it('requires valid rower and machine counts', async () => {
    const user = userEvent.setup()
    render(<RoundRobinErgos />)

    const rowerCount = screen.getByLabelText(/Number of rowers/i)
    await user.clear(rowerCount)

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enter whole numbers/i)
  })
})
