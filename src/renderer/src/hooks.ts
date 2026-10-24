import { useEffect, useState } from 'react'
import type { SimConnectionStatus, TrackerState } from '@shared/sim'

export function useSimStatus(): SimConnectionStatus {
  const [status, setStatus] = useState<SimConnectionStatus>('disconnected')
  useEffect(() => {
    window.api.sim.status().then(setStatus)
    return window.api.sim.onStatus(setStatus)
  }, [])
  return status
}

/** Часы мира: реальное время плюс перемотка. Обновляются раз в секунду и после каждой перемотки. */
export function useWorldNow(): number {
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const load = () =>
      window.api.world
        .clock()
        .then(setOffset)
        .catch(() => setOffset(0))
    void load()
    const off = window.api.world.onChanged(load)
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])
  return now + offset
}

export function useTrackerState(): TrackerState | null {
  const [state, setState] = useState<TrackerState | null>(null)
  useEffect(() => {
    window.api.tracker.state().then(setState)
    return window.api.tracker.onUpdate(setState)
  }, [])
  return state
}
