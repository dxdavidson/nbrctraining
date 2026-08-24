import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import { toIntervalRow } from './rowModels'
import { ESTIMATED_2K_STORAGE_KEY, useEstimated2kSeconds } from './hooks/useEstimated2kSeconds'

const interval = {
  id: 'i1',
  workout_id: 'w1',
  interval_code: 'IC1',
  interval_order: 1,
  repeat_count: 1,
  work_kind: 'time',
  work_value: 240,
  spm: null,
  recovery_kind: 'time',
  recovery_value: 60,
  target_mode: 'two_k_pace_offset_seconds',
  target_value: 5,
}

function TargetPaceReader() {
  const [estimated2kSeconds] = useEstimated2kSeconds()
  return <span data-testid="target-pace">{toIntervalRow(interval, estimated2kSeconds).targetDisplay}</span>
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('Target Pace recalculation', () => {
  it('recalculates in another component when the estimated 2K time changes', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Estimated2kTimeInput />
        <TargetPaceReader />
      </>
    )

    expect(screen.getByTestId('target-pace')).toHaveTextContent('—')

    await user.type(screen.getByLabelText('Minutes'), '8')
    await user.type(screen.getByLabelText('Seconds'), '0')

    // 2K estimate = 480s -> 500m pace = 120s, + 5s offset = 125s = 2:05
    expect(screen.getByTestId('target-pace')).toHaveTextContent('2:05')
    expect(window.localStorage.getItem(ESTIMATED_2K_STORAGE_KEY)).toBe('480')
  })
})
