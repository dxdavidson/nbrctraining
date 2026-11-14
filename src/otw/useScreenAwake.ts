import { useEffect, useState } from 'react'

type WakeStatus = 'disabled' | 'screen-lock' | 'video-fallback' | 'unavailable'

interface WakeLockSentinelLike extends EventTarget {
  release(): Promise<void>
}

interface WakeLockApiLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

function startVideoFallback(): { stop: () => void; ready: Promise<void> } {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const context = canvas.getContext('2d')
  if (!context || typeof canvas.captureStream !== 'function') {
    throw new Error('Neither Screen Wake Lock nor the video wake fallback is supported.')
  }

  const stream = canvas.captureStream(1)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('aria-hidden', 'true')
  video.style.cssText = 'position:fixed;width:1px;height:1px;left:0;bottom:0;opacity:0.01;pointer-events:none'
  video.srcObject = stream
  document.body.append(video)

  let frame = 0
  let color = false
  const draw = () => {
    color = !color
    context.fillStyle = color ? '#000' : '#010101'
    context.fillRect(0, 0, canvas.width, canvas.height)
    frame = window.setTimeout(draw, 1000)
  }
  draw()

  const ready = video.play().then(() => {})
  return {
    ready,
    stop: () => {
      window.clearTimeout(frame)
      video.pause()
      video.srcObject = null
      stream.getTracks().forEach((track) => track.stop())
      video.remove()
    },
  }
}

export function useScreenAwake(enabled: boolean): WakeStatus {
  const [status, setStatus] = useState<WakeStatus>('disabled')

  useEffect(() => {
    if (!enabled) return

    let active = true
    let sentinel: WakeLockSentinelLike | null = null
    let fallback: ReturnType<typeof startVideoFallback> | null = null
    let requesting = false
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockApiLike }).wakeLock

    const stopFallback = () => {
      fallback?.stop()
      fallback = null
    }

    const request = async () => {
      if (!active || requesting || document.visibilityState !== 'visible') return
      requesting = true
      try {
        if (wakeLock) {
          const currentSentinel = await wakeLock.request('screen')
          sentinel = currentSentinel
          if (!active) {
            await currentSentinel.release()
            return
          }
          stopFallback()
          setStatus('screen-lock')
          currentSentinel.addEventListener('release', () => {
            if (active && sentinel === currentSentinel && document.visibilityState === 'visible') {
              setStatus('unavailable')
            }
          }, { once: true })
        } else {
          fallback ??= startVideoFallback()
          await fallback.ready
          if (active) setStatus('video-fallback')
        }
      } catch {
        try {
          fallback ??= startVideoFallback()
          await fallback.ready
          if (active) setStatus('video-fallback')
        } catch {
          if (active) setStatus('unavailable')
        }
      } finally {
        requesting = false
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void request()
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    void request()

    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopFallback()
      if (sentinel) void sentinel.release()
    }
  }, [enabled])

  return enabled ? status : 'disabled'
}
