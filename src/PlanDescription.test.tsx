import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PlanDescription from './PlanDescription'
import * as api from './api'

vi.mock('./api')

afterEach(() => {
  vi.clearAllMocks()
  window.history.replaceState(null, '', '/')
})

describe('PlanDescription', () => {
  it('renders Markdown and links back to the originating page', async () => {
    vi.mocked(api.fetchPlans).mockResolvedValue([
      {
        id: 'p1',
        plan_code: 'PC1',
        title: 'Plan One',
        description: '# Overview\n\nThis is **important**.',
        start_date: null,
        published: true,
      },
    ])
    window.history.replaceState(null, '', '/plans/p1?from=%2F%3FplanId%3Dp1')

    render(<PlanDescription planId="p1" />)

    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('important').tagName).toBe('STRONG')
    expect(screen.getByRole('link', { name: 'Back to plans' })).toHaveAttribute('href', '/?planId=p1')
  })

  it('does not render unsafe HTML from the plan description', async () => {
    vi.mocked(api.fetchPlans).mockResolvedValue([
      {
        id: 'p1',
        plan_code: 'PC1',
        title: 'Plan One',
        description: 'Safe text\n\n<script>alert("unsafe")</script>',
        start_date: null,
        published: true,
      },
    ])

    render(<PlanDescription planId="p1" />)

    expect(await screen.findByText('Safe text')).toBeInTheDocument()
    expect(document.querySelector('script')).not.toBeInTheDocument()
  })
})