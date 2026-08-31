import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlanBrowser from './PlanBrowser'
import * as api from './api'

vi.mock('./api')

const plan = { id: 'p1', plan_code: 'PC1', title: 'Plan One', description: null, start_date: null, published: true }
const block = { id: 'b1', plan_id: 'p1', block_code: 'BC1', title: 'Block One', description: null, start_date: null }
const workout = { id: 'w1', block_id: 'b1', workout_code: 'WC1', week_commencing: null, description: null, sort_order: 1, level: null }
const interval = {
  id: 'i1',
  workout_id: 'w1',
  interval_code: 'IC1',
  interval_order: 1,
  repeat_count: 1,
  work_kind: 'run',
  work_value: 400,
  spm: null,
  recovery_kind: 'walk',
  recovery_value: 60,
  target_mode: 'pace',
  target_value: 5,
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
}

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.mocked(api.fetchPlans).mockResolvedValue([plan])
  vi.mocked(api.fetchBlocks).mockResolvedValue([block])
  vi.mocked(api.fetchWorkouts).mockResolvedValue([workout])
  vi.mocked(api.fetchIntervals).mockResolvedValue([interval])
  mockMatchMedia(false)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('PlanBrowser drill-down (narrow layout)', () => {
  it('shows Plans first, then drills into Blocks, Workouts, Intervals on row selection', async () => {
    const user = userEvent.setup()
    render(<PlanBrowser />)

    const plansTable = await screen.findByRole('table', { name: 'Plans' })

    await user.click(within(plansTable).getByText('Plan One'))
    const blocksTable = await screen.findByRole('table', { name: 'Blocks' })
    expect(api.fetchBlocks).toHaveBeenCalledWith('p1')

    await user.click(within(blocksTable).getByText('Block One'))
    const workoutsTable = await screen.findByRole('table', { name: 'Workouts' })
    expect(api.fetchWorkouts).toHaveBeenCalledWith('b1')

    await user.click(within(workoutsTable).getByText('WC1'))
    expect(await screen.findByRole('table', { name: 'Intervals' })).toBeInTheDocument()
    expect(api.fetchIntervals).toHaveBeenCalledWith('w1')

    expect(new URLSearchParams(window.location.search).get('workoutId')).toBe('w1')
  })

  it('keeps parent tables visible while drilling down', async () => {
    const user = userEvent.setup()
    render(<PlanBrowser />)

    const plansTable = await screen.findByRole('table', { name: 'Plans' })
    await user.click(within(plansTable).getByText('Plan One'))
    const blocksTable = await screen.findByRole('table', { name: 'Blocks' })
    await user.click(within(blocksTable).getByText('Block One'))
    expect(await screen.findByRole('table', { name: 'Workouts' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Plans' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Blocks' })).toBeInTheDocument()
  })

  it('collapses an expanded plan, block, or workout with its disclosure button', async () => {
    const user = userEvent.setup()
    render(<PlanBrowser />)

    const plansTable = await screen.findByRole('table', { name: 'Plans' })
    await user.click(within(plansTable).getByRole('button', { name: 'Expand Plan One' }))
    const blocksTable = await screen.findByRole('table', { name: 'Blocks' })
    await user.click(within(blocksTable).getByRole('button', { name: 'Expand Block One' }))
    const workoutsTable = await screen.findByRole('table', { name: 'Workouts' })
    await user.click(within(workoutsTable).getByRole('button', { name: 'Expand WC1' }))
    expect(await screen.findByRole('table', { name: 'Intervals' })).toBeInTheDocument()

    await user.click(within(workoutsTable).getByRole('button', { name: 'Collapse WC1' }))
    expect(screen.queryByRole('table', { name: 'Intervals' })).not.toBeInTheDocument()

    await user.click(within(blocksTable).getByRole('button', { name: 'Collapse Block One' }))
    expect(screen.queryByRole('table', { name: 'Workouts' })).not.toBeInTheDocument()

    await user.click(within(plansTable).getByRole('button', { name: 'Collapse Plan One' }))
    expect(screen.queryByRole('table', { name: 'Blocks' })).not.toBeInTheDocument()
  })

  it('restores the drill-down state from URL query params on load (deep link)', async () => {
    window.history.replaceState(null, '', '/?planId=p1&blockId=b1')
    render(<PlanBrowser />)

    expect(await screen.findByRole('table', { name: 'Workouts' })).toBeInTheDocument()
    expect(api.fetchBlocks).toHaveBeenCalledWith('p1')
    expect(api.fetchWorkouts).toHaveBeenCalledWith('b1')
  })

  it('preserves diagnostics when selecting a workout', async () => {
    window.history.replaceState(null, '', '/?diagnostics=1')
    const user = userEvent.setup()
    render(<PlanBrowser />)

    const plansTable = await screen.findByRole('table', { name: 'Plans' })
    await user.click(within(plansTable).getByText('Plan One'))
    expect(new URLSearchParams(window.location.search).get('diagnostics')).toBe('1')
    const blocksTable = await screen.findByRole('table', { name: 'Blocks' })
    await user.click(within(blocksTable).getByText('Block One'))
    expect(new URLSearchParams(window.location.search).get('diagnostics')).toBe('1')
    const workoutsTable = await screen.findByRole('table', { name: 'Workouts' })
    await user.click(within(workoutsTable).getByText('WC1'))

    expect(new URLSearchParams(window.location.search).get('diagnostics')).toBe('1')
    expect(await screen.findByRole('table', { name: 'Intervals' })).toBeInTheDocument()
  })

  it('only enables the plan description link when the plan has content', async () => {
    const describedPlan = { ...plan, description: '# Plan details' }
    vi.mocked(api.fetchPlans).mockResolvedValueOnce([describedPlan])
    render(<PlanBrowser />)

    const plansTable = await screen.findByRole('table', { name: 'Plans' })
    expect(within(plansTable).getByRole('link', { name: 'Plan Description' })).toHaveAttribute(
      'href',
      '/plans/p1?from=%2F'
    )
  })
})

describe('PlanBrowser master-detail layout (wide screens)', () => {
  it('shows nested parent and child tables without a Back button', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    render(<PlanBrowser />)

    const initialPlansTable = await screen.findByRole('table', { name: 'Plans' })
    await user.click(within(initialPlansTable).getByText('Plan One'))

    expect(await screen.findByRole('table', { name: 'Plans' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Blocks' })).toBeInTheDocument()
    await user.click(within(screen.getByRole('table', { name: 'Blocks' })).getByText('Block One'))
    expect(screen.getByRole('table', { name: 'Blocks' })).toBeInTheDocument()
    expect(await screen.findByRole('table', { name: 'Workouts' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '← Back' })).not.toBeInTheDocument()
  })

  it('keeps the selected row highlighted in the master pane', async () => {
    mockMatchMedia(true)
    const user = userEvent.setup()
    render(<PlanBrowser />)

    const initialPlansTable = await screen.findByRole('table', { name: 'Plans' })
    await user.click(within(initialPlansTable).getByText('Plan One'))
    const plansTable = await screen.findByRole('table', { name: 'Plans' })
    const selectedRow = within(plansTable).getByText('Plan One').closest('tr')
    expect(selectedRow).toHaveAttribute('aria-selected', 'true')
  })
})
