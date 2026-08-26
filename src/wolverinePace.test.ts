import { describe, expect, it } from 'vitest'
import { calculateWolverinePace } from './wolverinePace'

describe('Wolverine pace calculation', () => {
  it('makes the L2 target faster as stroke rate increases', () => {
    const paceAt26 = calculateWolverinePace('L2', 26, 111)
    const paceAt28 = calculateWolverinePace('L2', 28, 111)

    expect(paceAt26.seconds).toBe(114)
    expect(paceAt28.seconds).toBe(113)
    expect(paceAt28.seconds).toBeLessThan(paceAt26.seconds)
  })
})