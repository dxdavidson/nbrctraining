// Single entry point for all target-pace formulas; add/change a mode by editing its strategy only.
import { calculateWolverinePace, isWolverineLevel, wattsFromSecondsPer500m, type WolverineLevel } from './wolverinePace'
import { lookupWolverineL4Pace } from './wolverineL4Table'

export type TargetMode = WolverineLevel | 'two_k_pace_offset_seconds' | 'two_k_pace_multiplier'

export interface PaceGuidanceInput {
  estimated2kSeconds: number
  spm: number
  targetValue: number | null
}

export interface PaceGuidanceResult {
  secondsPer500m: number
  watts: number
}

type Strategy = (input: PaceGuidanceInput) => PaceGuidanceResult

const strategies: Record<TargetMode, Strategy> = {
  L1: wolverineStrategy('L1'),
  L2: wolverineStrategy('L2'),
  L3: wolverineStrategy('L3'),
  L4: wolverineL4Strategy,
  two_k_pace_offset_seconds: offsetStrategy,
  two_k_pace_multiplier: multiplierStrategy,
}

export function isPaceGuidanceMode(mode: string | null | undefined): mode is TargetMode {
  return mode != null && Object.prototype.hasOwnProperty.call(strategies, mode)
}

// L1 and L4 formulas depend on stroke rate; L2/L3 are fixed percentages of 2K watts and don't.
export function requiresStrokeRate(mode: TargetMode): boolean {
  return mode === 'L1' || mode === 'L4'
}

export function calculatePaceGuidance(mode: TargetMode, input: PaceGuidanceInput): PaceGuidanceResult {
  if (!Number.isFinite(input.estimated2kSeconds) || input.estimated2kSeconds <= 0) {
    throw new Error('Estimated 2K time must be a positive number of seconds.')
  }
  return strategies[mode](input)
}

function wolverineStrategy(level: Exclude<WolverineLevel, 'L4'>): Strategy {
  return ({ estimated2kSeconds, spm }) => {
    if (requiresStrokeRate(level) && (!Number.isFinite(spm) || spm <= 0)) {
      throw new Error('Stroke rate must be a positive number.')
    }
    const { seconds, watts } = calculateWolverinePace(level, spm, estimated2kSeconds / 4)
    return { secondsPer500m: seconds, watts }
  }
}

function wolverineL4Strategy({ estimated2kSeconds, spm }: PaceGuidanceInput): PaceGuidanceResult {
  if (!Number.isFinite(spm) || spm <= 0) {
    throw new Error('Stroke rate must be a positive number.')
  }
  const secondsPer500m = lookupWolverineL4Pace(estimated2kSeconds / 4, spm)
  return { secondsPer500m, watts: Math.round(wattsFromSecondsPer500m(secondsPer500m)) }
}

function offsetStrategy({ estimated2kSeconds, targetValue }: PaceGuidanceInput): PaceGuidanceResult {
  if (targetValue == null) {
    throw new Error('two_k_pace_offset_seconds requires a target value in seconds.')
  }
  const secondsPer500m = estimated2kSeconds / 4 + targetValue
  return { secondsPer500m, watts: Math.round(wattsFromSecondsPer500m(secondsPer500m)) }
}

function multiplierStrategy({ estimated2kSeconds, targetValue }: PaceGuidanceInput): PaceGuidanceResult {
  if (targetValue == null) {
    throw new Error('two_k_pace_multiplier requires a target value as a percentage.')
  }
  const secondsPer500m = (estimated2kSeconds / 4) * (1 + targetValue / 100)
  return { secondsPer500m, watts: Math.round(wattsFromSecondsPer500m(secondsPer500m)) }
}

export { isWolverineLevel }
