import { useEffect, useState } from 'react'
import { createToken, secondsLeft, windowAt } from '../../supabase/functions/_shared/qrToken.ts'

/**
 * How far the server's clock is ahead of this device's, in ms.
 *
 * The server stamped its time somewhere between sending the request and
 * receiving the answer; the midpoint is the best guess. A projector laptop
 * whose clock is minutes wrong then still signs tokens for the window the
 * server is in.
 */
export function clockOffset(serverTime: number, sentAt: number, receivedAt: number): number {
  return Math.round(serverTime - (sentAt + receivedAt) / 2)
}

/** How often the projector checks whether a new window has begun. */
const TICK_MS = 200

export interface RotatingToken {
  token: string | null
  /** Seconds left in the current window, for the countdown ring. */
  remaining: number
  window: number | null
}

/**
 * The current QR token, made on this device from the session's secret and
 * the server-corrected clock. Nothing here touches the network, so the code
 * keeps rotating when the classroom connection drops.
 */
export function useRotatingToken(
  secret: Uint8Array<ArrayBuffer> | null,
  sessionId: string | null,
  offset: number
): RotatingToken {
  const [state, setState] = useState<RotatingToken>({ token: null, remaining: 0, window: null })

  useEffect(() => {
    if (!secret || !sessionId) return

    let cancelled = false
    let shown: number | null = null

    const tick = () => {
      const now = Date.now() + offset
      const current = windowAt(now)
      const remaining = secondsLeft(now)

      if (current === shown) {
        setState((state) => (Math.abs(state.remaining - remaining) < 0.05 ? state : { ...state, remaining }))
        return
      }

      shown = current
      void createToken(secret, sessionId, current).then((token) => {
        if (!cancelled && shown === current) setState({ token, remaining, window: current })
      })
    }

    tick()
    const timer = window.setInterval(tick, TICK_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [offset, secret, sessionId])

  return state
}

/**
 * Keeps a projecting laptop's screen awake. Released when the projector
 * closes; browsers drop it themselves when the tab is hidden, so it is taken
 * again on return.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const lock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    if (!active || !lock) return

    let sentinel: { release: () => Promise<void> } | null = null
    const take = () => {
      if (document.visibilityState !== 'visible') return
      lock.request('screen').then(
        (held) => (sentinel = held),
        () => undefined
      )
    }

    take()
    document.addEventListener('visibilitychange', take)
    return () => {
      document.removeEventListener('visibilitychange', take)
      void sentinel?.release().catch(() => undefined)
    }
  }, [active])
}
