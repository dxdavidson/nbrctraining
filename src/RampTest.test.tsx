import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import RampTest from './RampTest'
import { buildRampIntervals, calculateRampResult } from './rampTestMath'

describe('Ramp Test', () => {
  it('generates consecutive one-minute watt targets', () => {
    expect(buildRampIntervals({ startWatts: 100, incrementWatts: 15, stageCount: 3 })).toMatchObject([
      { interval_order: 1, work_value: 60, target_mode: 'watts', target_value: 100 },
      { interval_order: 2, work_value: 60, target_mode: 'watts', target_value: 115 },
      { interval_order: 3, work_value: 60, target_mode: 'watts', target_value: 130 },
    ])
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
