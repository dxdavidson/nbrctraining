export interface OtwLocation {
  latitude: number
  longitude: number
  accuracy: number
  speed: number | null
  timestamp: number
}

export interface GpsMetrics {
  distanceMeters: number
  speedMps: number | null
}

const MAX_ACCURACY_METERS = 25
const MAX_SPEED_MPS = 12
const SPEED_WINDOW_SIZE = 5

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

export function distanceBetweenMeters(
  first: Pick<OtwLocation, 'latitude' | 'longitude'>,
  second: Pick<OtwLocation, 'latitude' | 'longitude'>,
): number {
  const earthRadiusMeters = 6_371_000
  const latitudeDelta = radians(second.latitude - first.latitude)
  const longitudeDelta = radians(second.longitude - first.longitude)
  const firstLatitude = radians(first.latitude)
  const secondLatitude = radians(second.latitude)
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

export class GpsAccumulator {
  private distanceAnchor: OtwLocation | null = null
  private previous: OtwLocation | null = null
  private distanceMeters = 0
  private speeds: number[] = []

  get metrics(): GpsMetrics {
    return {
      distanceMeters: this.distanceMeters,
      speedMps: this.speeds.length > 0
        ? this.speeds.reduce((sum, speed) => sum + speed, 0) / this.speeds.length
        : null,
    }
  }

  add(location: OtwLocation): GpsMetrics {
    if (
      !Number.isFinite(location.latitude) ||
      !Number.isFinite(location.longitude) ||
      !Number.isFinite(location.accuracy) ||
      !Number.isFinite(location.timestamp) ||
      location.accuracy > MAX_ACCURACY_METERS
    ) {
      return this.metrics
    }

    if (this.distanceAnchor && this.previous) {
      const previousElapsedSeconds = (location.timestamp - this.previous.timestamp) / 1000
      if (
        previousElapsedSeconds <= 0 ||
        distanceBetweenMeters(this.previous, location) / previousElapsedSeconds > MAX_SPEED_MPS
      ) {
        return this.metrics
      }

      const elapsedSeconds = (location.timestamp - this.distanceAnchor.timestamp) / 1000
      const deltaMeters = distanceBetweenMeters(this.distanceAnchor, location)
      const speedMps = elapsedSeconds > 0 ? deltaMeters / elapsedSeconds : Number.POSITIVE_INFINITY
      const noiseThreshold = Math.max(1.5, (this.distanceAnchor.accuracy + location.accuracy) * 0.1)

      if (elapsedSeconds > 0 && speedMps <= MAX_SPEED_MPS && deltaMeters > noiseThreshold) {
        this.distanceMeters += deltaMeters
        this.speeds = [...this.speeds, speedMps].slice(-SPEED_WINDOW_SIZE)
        this.distanceAnchor = location
      } else if (elapsedSeconds > 0 && location.speed !== null && location.speed >= 0 && location.speed <= MAX_SPEED_MPS) {
        this.speeds = [...this.speeds, location.speed].slice(-SPEED_WINDOW_SIZE)
      }
    } else {
      this.distanceAnchor = location
    }

    this.previous = location
    return this.metrics
  }

  reset(): void {
    this.distanceAnchor = null
    this.previous = null
    this.distanceMeters = 0
    this.speeds = []
  }

  markGap(): void {
    this.distanceAnchor = null
    this.previous = null
    this.speeds = []
  }
}

export function formatPacePer500m(speedMps: number | null): string {
  if (speedMps === null || speedMps <= 0) return '--:--'
  const totalSeconds = Math.round(500 / speedMps)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainingSeconds = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
}
