import { useCallback, useEffect, useState } from 'react'
import type { ComboboxParsedItem, OptionsFilter } from '@mantine/core'
import type { PilotState, PlaceRef } from '@shared/types'

/** Текст ошибки из main-процесса без технического префикса Electron. */
export function errMsg(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  return s.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Шина «данные карьеры изменились» — экраны перечитывают состояние. */
const bus = new EventTarget()
export const notifyCareerChanged = (): void => void bus.dispatchEvent(new Event('changed'))

export function useCareerVersion(): number {
  const [v, setV] = useState(0)
  useEffect(() => {
    const h = () => setV((x) => x + 1)
    bus.addEventListener('changed', h)
    // После завершения полёта карьера тоже меняется.
    const off = window.api.tracker.onFinished(h)
    return () => {
      bus.removeEventListener('changed', h)
      off()
    }
  }, [])
  return v
}

export function usePilot(): [PilotState | null, () => void] {
  const version = useCareerVersion()
  const [pilot, setPilot] = useState<PilotState | null>(null)
  const reload = useCallback(() => {
    window.api.career.state().then(setPilot)
  }, [])
  useEffect(reload, [reload, version])
  return [pilot, reload]
}

const placeCache = new Map<string, PlaceRef>()

/** Названия аэропортов по ICAO (с кэшем). */
export function usePlaces(codes: (string | null | undefined)[]): Record<string, PlaceRef> {
  const key = [...new Set(codes.filter(Boolean) as string[])].sort().join(',')
  const [map, setMap] = useState<Record<string, PlaceRef>>({})
  useEffect(() => {
    const list = key ? key.split(',') : []
    const missing = list.filter((c) => !placeCache.has(c))
    const done = () => setMap(Object.fromEntries(list.map((c) => [c, placeCache.get(c)!]).filter(([, p]) => p)))
    if (!missing.length) return done()
    window.api.world.places(missing).then((res) => {
      for (const [c, p] of Object.entries(res)) placeCache.set(c, p)
      done()
    })
  }, [key])
  return map
}

export const placeLabel = (p: PlaceRef | undefined, icao: string): string => (p?.city ? `${p.city} (${icao})` : icao)

/**
 * Поиск в списках аэропортов (подпись «Город — Название (ICAO / IATA)»): сначала точный код,
 * потом подписи, начинающиеся с запроса, потом остальные совпадения. Иначе на «ULLI» первым
 * находится Flagstaff Pulliam.
 */
export const airportFilter: OptionsFilter = ({ options, search, limit }) => {
  const q = search.trim().toLowerCase()
  if (!q) return options.slice(0, limit)
  const rank = (item: ComboboxParsedItem): number => {
    const label = 'label' in item ? item.label.toLowerCase() : ''
    const codes = label.match(/\(([^)]+)\)$/)?.[1].split(' / ') ?? []
    if (codes.includes(q)) return 0
    if (label.startsWith(q)) return 1
    return label.includes(q) ? 2 : 3
  }
  return options
    .map((item) => ({ item, r: rank(item) }))
    .filter((x) => x.r < 3)
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map((x) => x.item)
}
