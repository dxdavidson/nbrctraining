import { useLocalStorageState } from './useLocalStorageState'

export const ESTIMATED_2K_STORAGE_KEY = 'nbrctraining.estimated2kTimeSeconds'

/** Shared estimated-2K-time (in seconds) used across the Estimated 2K input and target pace calculations. */
export function useEstimated2kSeconds() {
  return useLocalStorageState<number | null>(ESTIMATED_2K_STORAGE_KEY, null)
}
