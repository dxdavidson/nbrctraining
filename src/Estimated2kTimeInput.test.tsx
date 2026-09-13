import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Estimated2kTimeInput from './Estimated2kTimeInput'
import { ESTIMATED_2K_STORAGE_KEY as STORAGE_KEY } from './hooks/useEstimated2kSeconds'

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.localStorage.clear()
})

describe('Estimated2kTimeInput', () => {
  it('starts empty when nothing is stored', () => {
    render(<Estimated2kTimeInput />)
    expect(screen.getByLabelText('Minutes')).toHaveValue(null)
    expect(screen.getByLabelText('Seconds')).toHaveValue(null)
  })

  it('persists minutes and seconds to localStorage as total seconds', async () => {
    const user = userEvent.setup()
    render(<Estimated2kTimeInput />)

    await user.type(screen.getByLabelText('Minutes'), '7')
    await user.type(screen.getByLabelText('Seconds'), '45')

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(7 * 60 + 45))
  })

  it('loads the previously stored value as the default on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, String(6 * 60 + 30))
    render(<Estimated2kTimeInput />)

    expect(screen.getByLabelText('Minutes')).toHaveValue(6)
    expect(screen.getByLabelText('Seconds')).toHaveValue(30)
  })

  it('shows the L3 and L2 target paces when a 2K time is entered', async () => {
    const user = userEvent.setup()
    render(<Estimated2kTimeInput />)

    await user.type(screen.getByLabelText('Minutes'), '8')
    await user.type(screen.getByLabelText('Seconds'), '0')

    expect(screen.getByText('L3 Target Pace: 2:09 /500m')).toBeVisible()
    expect(screen.getByText('L2 Target Pace: 2:02 /500m')).toBeVisible()
    expect(screen.getByText('L4 R18: 2:25 /500m')).toBeVisible()
    expect(screen.getByText('L4 R20: 2:20 /500m')).toBeVisible()
    expect(screen.getByText('L4 R22: 2:15 /500m')).toBeVisible()
    expect(screen.getByText('L4 R24: 2:10 /500m')).toBeVisible()
    expect(screen.getByText('L4 R26: 2:05 /500m')).toBeVisible()
  })
})
