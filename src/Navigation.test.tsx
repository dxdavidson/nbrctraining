import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Navigation from './Navigation'

describe('Navigation', () => {
  it('links to each top-level feature and the nested workout importer', () => {
    render(<Navigation routePath="/" />)

    expect(screen.getByRole('link', { name: 'Rowing Plans' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Ramp Test' })).toHaveAttribute('href', '/ramp-test')
    expect(screen.getByRole('link', { name: 'Round Robin Ergos' })).toHaveAttribute('href', '/round-robin-ergos')
    expect(screen.getByRole('link', { name: 'Rowing Machine' })).toHaveAttribute('href', '/technique/rowing-machine')
    expect(screen.getByRole('link', { name: 'On The Water' })).toHaveAttribute('href', '/technique/on-the-water')
    expect(screen.getByRole('link', { name: 'Import Workouts' })).toHaveAttribute('href', '/admin/import')
  })

  it('marks the active route and expands the admin menu for admin pages', () => {
    const { container } = render(<Navigation routePath="/admin/import" />)

    expect(screen.getByRole('link', { name: 'Import Workouts' })).toHaveClass('is-active')
    expect(container.querySelector('.admin-navigation')).toHaveAttribute('open')
  })

  it('marks the active route and expands the technique menu for technique pages', () => {
    const { container } = render(<Navigation routePath="/technique/rowing-machine" />)

    expect(screen.getByRole('link', { name: 'Rowing Machine' })).toHaveClass('is-active')
    expect(container.querySelector('.technique-navigation')).toHaveAttribute('open')
  })
})
