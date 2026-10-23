import type { AirlineFinance, AirlineStatus, RouteState } from '@shared/airlines'
import type { Airline } from '@shared/world'
import { transaction, type Db } from '../db'
import { airlines } from '../world'

/**
 * Живое состояние авиакомпаний в профиле: деньги, флот, сеть с частотами, акции.
 * Статичные данные (data/airlines) — только стартовая точка мира.
 */

export interface AirlineState {
  icao: string
  cash: number
  debt: number
  reputation: number
  /** Количество самолётов по типам. */
  fleet: Record<string, number>
  routes: RouteState[]
  /** Акций в обращении, млн. */
  shares: number
  sharePrice: number
  prevSharePrice: number
  status: AirlineStatus
  restarts: number
  last: AirlineFinance | null
  /** Прибыль за последние месяцы — для дивидендов. */
  recentProfit: number[]
  version: number
}

/** Национальные перевозчики: при банкротстве их спасает государство. */
export const FLAG_CARRIERS = new Set([
  'AFL', 'BRU', 'UZB', 'KZR', 'AHY', 'DLH', 'AFR', 'KLM', 'BAW', 'IBE', 'ITY', 'SWR', 'AUA', 'SAS', 'FIN', 'LOT', 'TAP', 'AEE',
  'THY', 'BEL', 'ASL', 'ICE', 'UAE', 'QTR', 'ETD', 'SVA', 'ELY', 'RJA', 'OMA', 'ETH', 'MSR', 'RAM', 'KQA', 'SAA', 'CCA', 'CSN',
  'CES', 'CPA', 'JAL', 'KAL', 'SIA', 'THA', 'HVN', 'MAS', 'GIA', 'PAL', 'AIC', 'QFA', 'ANZ', 'ACA', 'AMX', 'AVA', 'CMP', 'ARG', 'LAN'
])

const memo = new WeakMap<Db, Map<string, AirlineState>>()

export function hasAirlineStates(db: Db): boolean {
  return !!db.prepare('SELECT 1 FROM airline_state LIMIT 1').get()
}

export function loadStates(db: Db): Map<string, AirlineState> {
  const cached = memo.get(db)
  if (cached) return cached
  const rows = db.prepare('SELECT icao, data FROM airline_state').all() as { icao: string; data: string }[]
  const map = new Map(rows.map((r) => [r.icao, JSON.parse(r.data) as AirlineState]))
  memo.set(db, map)
  return map
}

export function saveStates(db: Db, states: Map<string, AirlineState>): void {
  const stmt = db.prepare('INSERT INTO airline_state (icao, data) VALUES (?, ?) ON CONFLICT(icao) DO UPDATE SET data = excluded.data')
  transaction(db, () => {
    for (const s of states.values()) stmt.run(s.icao, JSON.stringify(s))
  })
  memo.set(db, states)
}

/** Авиакомпания с живой сетью и флотом — для расписания и диспетчерской. */
export function effectiveAirline(db: Db | null, icao: string): Airline {
  const base = airlines.get(icao)
  if (!base) throw new Error(`Авиакомпания ${icao} не найдена`)
  const s = db && hasAirlineStates(db) ? loadStates(db).get(icao) : undefined
  if (!s) return base
  return withState(base, s)
}

export function withState(base: Airline, s: AirlineState): Airline {
  const byHub = new Map<string, Airline['network'][number]>()
  for (const r of s.routes) {
    if (r.freq <= 0) continue
    let n = byHub.get(r.hub)
    if (!n) {
      n = { hub: r.hub, destinations: [], freq: {}, lf: {}, fare: {} }
      byHub.set(r.hub, n)
    }
    n.destinations.push(r.dest)
    n.freq![r.dest] = r.freq
    n.lf![r.dest] = r.lf
    n.fare![r.dest] = r.fare
  }
  return {
    ...base,
    reputation: Math.round(s.reputation),
    fleet: Object.entries(s.fleet)
      .filter(([, c]) => c > 0)
      .map(([type, count]) => ({ type, count })),
    network: [...byHub.values()],
    version: s.version
  }
}

export type { RouteState }
