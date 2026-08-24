// Wolverine Plan target pace/power calculation, derived from Concept2's
// watts-from-pace formula: watts = 2.80 / (secondsPer500m / 500)^3

export type WolverineLevel = 'L1' | 'L2' | 'L3' | 'L4'

export interface WolverinePaceResult {
  seconds: number
  watts: number
}

const CONCEPT2_WATTS_CONSTANT = 2.8

function wattsFromSecondsPer500m(secondsPer500m: number): number {
  return CONCEPT2_WATTS_CONSTANT / Math.pow(secondsPer500m / 500, 3)
}

function secondsPer500mFromWatts(watts: number): number {
  return 500 * Math.cbrt(CONCEPT2_WATTS_CONSTANT / watts)
}

export function isWolverineLevel(mode: string | null): mode is WolverineLevel {
  return mode === 'L1' || mode === 'L2' || mode === 'L3' || mode === 'L4'
}

// spm maps to an offset (L1/L2/L4) or a scaling factor (L3) applied to 2K pace/watts.
export function calculateWolverinePace(level: WolverineLevel, spm: number, seconds2k: number): WolverinePaceResult {
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
      const offset = 2 + ((spm - 24) / (28 - 24)) * 2 // maps 24-28 spm to +2s to +4s
      seconds = seconds2k + Math.max(2, Math.min(4, offset))
      watts = wattsFromSecondsPer500m(seconds)
      break
    }
    case 'L3': {
      // Placeholder coefficients tuned to sit between L2 and L4; adjust once exact Wolverine values are known.
      watts = watts2k * (0.8 + 0.015 * (spm - 22))
      seconds = secondsPer500mFromWatts(watts)
      break
    }
    case 'L4': {
      let offset = 14 // default 20 spm
      if (spm <= 16) offset = 20
      else if (spm <= 18) offset = 17
      else if (spm <= 20) offset = 14
      else if (spm <= 22) offset = 11
      else offset = 14 - (spm - 20) * 1.5

      seconds = seconds2k + offset
      watts = wattsFromSecondsPer500m(seconds)
      break
    }
  }

  return {
    seconds: Math.round(seconds * 10) / 10,
    watts: Math.round(watts),
  }
}
