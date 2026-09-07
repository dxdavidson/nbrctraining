import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import RampTest from './RampTest'
import { buildRampIntervals, calculateRampResult } from './rampTestMath'

describe('Ramp Test', () => {
  it('generates consecutive one-minute watt targets without recovery', () => {
    const intervals = buildRampIntervals({ startWatts: 100, incrementWatts: 15, stageCount: 12 })

    expect(intervals).toHaveLength(12)
    expect(intervals[0]).toMatchObject({ interval_order: 1, work_value: 60, recovery_kind: null, recovery_value: null, target_mode: 'watts', target_value: 100 })
    expect(intervals[4]).toMatchObject({ interval_order: 5, work_value: 60, recovery_kind: null, recovery_value: null, target_mode: 'watts', target_value: 160 })
    expect(intervals[9]).toMatchObject({ interval_order: 10, work_value: 60, recovery_kind: null, recovery_value: null, target_mode: 'watts', target_value: 235 })
    expect(intervals[11]).toMatchObject({ interval_order: 12, work_value: 60, recovery_kind: null, recovery_value: null, target_mode: 'watts', target_value: 265 })
  })

  it('shows no recovery for ramp stages in the protocol table', () => {
    render(<RampTest />)

    expect(screen.getByRole('columnheader', { name: 'Recovery' })).toBeInTheDocument()
    const rows = screen.getAllByRole('row')
    expect(within(rows[5]).getByRole('cell', { name: '--' })).toBeInTheDocument()
    expect(within(rows[6]).getByRole('cell', { name: '--' })).toBeInTheDocument()
    expect(within(rows[10]).getByRole('cell', { name: '--' })).toBeInTheDocument()
  })

  it('allows individual protocol targets to be edited', async () => {
    const user = userEvent.setup()
    render(<RampTest />)

    const stageTwoTarget = screen.getByLabelText('Stage 2 target (W)')
    await user.clear(stageTwoTarget)
    await user.type(stageTwoTarget, '115')

    expect(stageTwoTarget).toHaveValue(115)
  })

  it('allows a single-stage ramp test', async () => {
    const user = userEvent.setup()
    render(<RampTest />)

    const stageCount = screen.getByLabelText(/Number of stages/i)
    await user.clear(stageCount)
    await user.type(stageCount, '1')

    expect(stageCount).toHaveAttribute('min', '1')
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('interpolates the partial next stage before estimating 2K power', () => {
    const result = calculateRampResult(
      { startWatts: 100, incrementWatts: 15, stageCount: 20, conversionPercentage: 85 },
      160,
      30
    )

    expect(result?.peakWatts).toBe(167.5)
    expect(result?.estimated2kWatts).toBeCloseTo(142.375)
    expect(result?.estimated2kSeconds).toBeGreaterThan(0)
  })

  it('extrapolates past the final listed stage and rejects an invalid partial-stage duration', () => {
    const settings = { startWatts: 100, incrementWatts: 15, stageCount: 3, conversionPercentage: 85 }

    // Completing the last programmed stage is valid: the athlete continues past the protocol at an extrapolated target.
    expect(calculateRampResult(settings, 130, 10)?.peakWatts).toBeCloseTo(132.5)
    expect(calculateRampResult(settings, 115, 60)).toBeNull()
  })

  it('shows a calculated result without changing the stored 2K estimate', async () => {
    window.localStorage.setItem('nbrctraining.estimated2kTimeSeconds', JSON.stringify(450))
    const user = userEvent.setup()
    render(<RampTest />)

    await user.type(screen.getByLabelText(/Last fully completed target/i), '160')
    await user.type(screen.getByLabelText(/Seconds completed at the next target/i), '30')

    expect(screen.getByText('Interpolated ramp power')).toBeInTheDocument()
    expect(screen.getByText('167.5 W')).toBeInTheDocument()
    expect(window.localStorage.getItem('nbrctraining.estimated2kTimeSeconds')).toBe(JSON.stringify(450))
  })
})
