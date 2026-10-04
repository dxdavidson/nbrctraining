import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarkdownDescription from './MarkdownDescription'

describe('MarkdownDescription', () => {
  it('renders an em dash for empty values', () => {
    const { container } = render(<MarkdownDescription value={null} />)
    expect(container.textContent).toBe('—')
  })

  it('collapses blank lines between list items into a tight list', () => {
    const { container } = render(
      <MarkdownDescription value={'Intro:\n\n- one\n\n- two\n\n\n- three'} />
    )
    const list = container.querySelector('ul')
    expect(list).not.toBeNull()
    expect(list!.querySelectorAll('li')).toHaveLength(3)
    expect(list!.querySelectorAll('p')).toHaveLength(0)
  })

  it('converts literal backslash-n sequences to newlines', () => {
    const { container } = render(
      <MarkdownDescription value={'- one\\n- two'} />
    )
    expect(container.querySelectorAll('li')).toHaveLength(2)
  })

  it('keeps the blank line after a table so trailing text stays outside it', () => {
    const value = [
      'Header line:',
      '',
      '| Duration | SPM | Pace |',
      '| --- | --- | --- |',
      '| 2mins | **20** | 2K+20 |',
      '| 30s | 22 | **2K+15** |',
      '',
      'Trailing line after table.',
    ].join('\n')
    const { container } = render(<MarkdownDescription value={value} />)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(table!.textContent).not.toContain('Trailing line')
    expect(screen.getByText('Trailing line after table.')).toBeInTheDocument()
  })
})
