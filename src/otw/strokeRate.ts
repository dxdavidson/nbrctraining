export interface StrokeRateOptions {
  sampleSize?: number
  timeoutSeconds?: number
  onChange?: (rate: number | null) => void
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

export class StrokeRateTracker {
  private readonly sampleSize: number
  private readonly timeoutSeconds: number
  private readonly onChange: (rate: number | null) => void
  private intervals: number[] = []
  private lastTap: number | null = null
  private currentRate: number | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null

  constructor({ sampleSize = 5, timeoutSeconds = 3, onChange = () => {} }: StrokeRateOptions = {}) {
    this.sampleSize = Math.max(1, Math.floor(sampleSize))
    this.timeoutSeconds = Math.min(10, Math.max(2, timeoutSeconds))
    this.onChange = onChange
  }

  get rate(): number | null {
    return this.currentRate
  }

  tap(timestamp = Date.now()): number | null {
    if (this.lastTap === null) {
      this.lastTap = timestamp
      this.armTimeout()
      return this.setRate(null)
    }

    const intervalSeconds = (timestamp - this.lastTap) / 1000
    if (intervalSeconds < 0.8) return this.currentRate

    if (intervalSeconds >= this.timeoutSeconds) {
      this.intervals = []
      this.lastTap = timestamp
      this.armTimeout()
      return this.setRate(null)
    }

    this.lastTap = timestamp
    this.intervals = [...this.intervals, intervalSeconds].slice(-this.sampleSize)
    this.armTimeout()

    const center = median(this.intervals)
    const accepted = this.intervals.filter((value) => value >= center * 0.6 && value <= center * 1.4)
    const meanInterval = accepted.reduce((sum, value) => sum + value, 0) / accepted.length
    return this.setRate(meanInterval > 0 ? 60 / meanInterval : null)
  }

  reset(): void {
    if (this.timeout !== null) clearTimeout(this.timeout)
    this.timeout = null
    this.lastTap = null
    this.intervals = []
    this.setRate(null)
  }

  dispose(): void {
    if (this.timeout !== null) clearTimeout(this.timeout)
    this.timeout = null
  }

  private armTimeout(): void {
    if (this.timeout !== null) clearTimeout(this.timeout)
    this.timeout = setTimeout(() => {
      this.timeout = null
      this.lastTap = null
      this.intervals = []
      this.setRate(null)
    }, this.timeoutSeconds * 1000)
  }

  private setRate(rate: number | null): number | null {
    this.currentRate = rate
    this.onChange(rate)
    return rate
  }
}
