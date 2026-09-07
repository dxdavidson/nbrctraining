// Round Robin Ergos: schedule more rowers than ergs by rotating them through a fixed turn order.
//
// Turns are assigned to machines in a repeating sequence (1, 2, ..., M, 1, 2, ...), each offset from
// the previous by a fixed delay. Every rower gets 1 turn out of every R consecutive turns, so a
// rower's personal work+rest cycle spans R turns, while each machine repeats its own work+rest cycle
// every M turns. Equating "R turns" and "M turns" to the same span of wall-clock time yields the
// delay between rower starts and the rest that must be programmed into each machine's PM5.

export interface RoundRobinInputs {
  rowerCount: number
  machineCount: number
  workSeconds: number
  restSeconds: number
}

export interface RoundRobinResult {
  programmedRestSeconds: number
  delaySeconds: number
  minimumRestSeconds: number
  feasible: boolean
}

// The PM5 only accepts rest durations in 5-second increments.
const PM5_REST_INCREMENT_SECONDS = 5

// The outgoing and incoming rowers need at least this long to swap machines.
const MIN_CHANGEOVER_REST_SECONDS = 20

function roundToRestIncrement(seconds: number): number {
  return Math.round(seconds / PM5_REST_INCREMENT_SECONDS) * PM5_REST_INCREMENT_SECONDS
}

function ceilToRestIncrement(seconds: number): number {
  return Math.ceil(seconds / PM5_REST_INCREMENT_SECONDS) * PM5_REST_INCREMENT_SECONDS
}

export function calculateRoundRobin(inputs: RoundRobinInputs): RoundRobinResult | null {
  const { rowerCount, machineCount, workSeconds, restSeconds } = inputs
  if (
    !Number.isInteger(rowerCount) || rowerCount < 1 ||
    !Number.isInteger(machineCount) || machineCount < 1 ||
    !Number.isFinite(workSeconds) || workSeconds <= 0 ||
    !Number.isFinite(restSeconds) || restSeconds < 0
  ) {
    return null
  }

  if (machineCount >= rowerCount) {
    // Enough machines for everyone; no rotation, so no changeover, is needed.
    return { programmedRestSeconds: roundToRestIncrement(restSeconds), delaySeconds: 0, minimumRestSeconds: 0, feasible: true }
  }

  const rawRestSeconds = machineCount * ((workSeconds + restSeconds) / rowerCount) - workSeconds
  const theoreticalMinimumRestSeconds = (workSeconds * (rowerCount - machineCount)) / machineCount
  const minimumRestSeconds = ceilToRestIncrement(Math.max(theoreticalMinimumRestSeconds, MIN_CHANGEOVER_REST_SECONDS))
  const feasible = rawRestSeconds >= MIN_CHANGEOVER_REST_SECONDS

  // Recompute the delay from the rounded rest so the rotation stays in sync with what's programmed.
  const programmedRestSeconds = feasible ? roundToRestIncrement(rawRestSeconds) : rawRestSeconds
  const delaySeconds = feasible ? (workSeconds + programmedRestSeconds) / machineCount : (workSeconds + restSeconds) / rowerCount

  return {
    programmedRestSeconds,
    delaySeconds,
    minimumRestSeconds,
    feasible,
  }
}
