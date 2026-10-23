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

export function useTrackerState(): TrackerState | null {
  const [state, setState] = useState<TrackerState | null>(null)
  useEffect(() => {
    window.api.tracker.state().then(setState)
    return window.api.tracker.onUpdate(setState)
  }, [])
  return state
}
