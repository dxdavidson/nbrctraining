import { describe, expect, it } from 'vitest'
import { calculateWolverinePace } from './wolverinePace'

describe('Wolverine pace calculation', () => {
  it('L2 target is unaffected by stroke rate', () => {
    const paceAt26 = calculateWolverinePace('L2', 26, 111)
    const paceAt28 = calculateWolverinePace('L2', 28, 111)

    expect(paceAt26.seconds).toBe(paceAt28.seconds)
  })
})