// Wolverine Plan target pace/power calculation, derived from Concept2's
// watts-from-pace formula: watts = 2.80 / (secondsPer500m / 500)^3

export type WolverineLevel = 'L1' | 'L2' | 'L3' | 'L4'

export interface WolverinePaceResult {
  seconds: number
  watts: number
}

const CONCEPT2_WATTS_CONSTANT = 2.8

export function wattsFromSecondsPer500m(secondsPer500m: number): number {
  return CONCEPT2_WATTS_CONSTANT / Math.pow(secondsPer500m / 500, 3)
}

function secondsPer500mFromWatts(watts: number): number {
  return 500 * Math.cbrt(CONCEPT2_WATTS_CONSTANT / watts)
}

export function isWolverineLevel(mode: string | null): mode is WolverineLevel {
  return mode === 'L1' || mode === 'L2' || mode === 'L3' || mode === 'L4'
}

// spm maps to an offset (L1) or a scaling factor (L3) applied to 2K pace/watts.
// L4 uses a measured reference table (see wolverineL4Table.ts) instead of a formula.
export function calculateWolverinePace(level: Exclude<WolverineLevel, 'L4'>, spm: number, seconds2k: number): WolverinePaceResult {
  if (!Number.isFinite(seconds2k) || seconds2k <= 0) {
    throw new Error('Invalid 2K pace provided.')
  }

  const watts2k = wattsFromSecondsPer500m(seconds2k)

  let seconds: number
  let watts: number

  switch (level) {
    case 'L1': {
      const offset = 1 + ((spm - 28) / (32 - 28)) * 2 // maps 28-32 spm to -1s to -3s
      seconds = seconds2k - Math.max(1, Math.min(3, offset))
      watts = wattsFromSecondsPer500m(seconds)
      break
    }
    case 'L2': {
      // Fixed at 95% of estimated 2K watts; stroke rate is not a factor for this level.
      watts = watts2k * 0.95
      seconds = secondsPer500mFromWatts(watts)
      break
    }
    case 'L3': {
      // Fixed at 80% of estimated 2K watts; stroke rate is not a factor for this level.
      watts = watts2k * 0.8
      seconds = secondsPer500mFromWatts(watts)
      break
    }
  }

  return {
    seconds: Math.round(seconds * 10) / 10,
    watts: Math.round(watts),
  }
}

