import { afterEach, describe, expect, it, vi } from 'vitest'
import { showEnvBanner } from './envBanner'

describe('environment banner', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.style.removeProperty('--env-banner-height')
    document.title = ''
    vi.restoreAllMocks()
  })

  it('shows the build time in non-production and updates its height when resized', () => {
    document.title = 'NBRC'
    let height = 20
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height)
    const addListener = vi.spyOn(window, 'addEventListener')

    showEnvBanner()

    if (!__ENV_LABEL__) {
      expect(document.body.children).toHaveLength(0)
      expect(document.title).toBe('NBRC')
      return
    }

    expect(document.body.firstElementChild).toHaveTextContent(
      `${__ENV_LABEL__} - not production | build ${__BUILD_TIME__.slice(0, 19).replace('T', ' ')} UTC`,
    )
    expect(document.title).toBe(`[${__ENV_LABEL__}] NBRC`)
    expect(document.documentElement.style.getPropertyValue('--env-banner-height')).toBe('20px')
    height = 35
    window.dispatchEvent(new Event('resize'))
    expect(document.documentElement.style.getPropertyValue('--env-banner-height')).toBe('35px')

    const resizeListener = addListener.mock.calls.find(([type]) => type === 'resize')?.[1]
    if (resizeListener) window.removeEventListener('resize', resizeListener)
  })
})
