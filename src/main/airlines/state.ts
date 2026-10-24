import type { AirlineFinance, AirlineStatus, Autopilot, Delivery, RouteState, Staff } from '@shared/airlines'
import type { Airline } from '@shared/world'
import { transaction, type Db } from '../db'
import { aircraftTypes, airlines, airports, playerAirlineIds } from '../world'
import { distanceKm } from '../tracker/geo'
import { assignedType, blockMinutes, typeServes } from '../career/schedule'

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
  /** Ставка по долгу в месяц (по умолчанию 0,7%). У компании игрока зависит от поручительства. */
  debtRate?: number
  // ——— управление игрока (у компаний под его контролем) ———
  /** Какие решения принимает ИИ-заместитель; без поля — все. */
  autopilot?: Autopilot
  /** Множитель к рыночному тарифу, 0,7–1,3. */
  fareMult?: number
  /** Сколько самолётов из fleet в собственности (остальные — в лизинге). */
  owned?: Record<string, number>
  /** Самолёты в пути: после заказа их перегоняют и готовят около недели. */
  deliveries?: Delivery[]
  /** Своя компания игрока вышла на биржу (до этого её акции не торгуются). */
  listed?: boolean
  /** Штат экипажей, когда персоналом управляет игрок. */
  staff?: Staff
  /** Зарплата CEO в месяц, $ (до налога). */
  ceoSalary?: number
  /** Доля квартальной прибыли на дивиденды (по умолчанию 0,3). */
  payout?: number
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

/** Игрок потерял контроль: решения снова принимает ИИ, тарифы рыночные, зарплаты CEO нет. */
export function releaseControl(s: AirlineState): void {
  delete s.autopilot
  delete s.fareMult
  delete s.ceoSalary
  delete s.payout
}

/** Авиакомпания с живой сетью и флотом — для расписания и диспетчерской. */
export function effectiveAirline(db: Db | null, icao: string): Airline {
  const base = airlines.get(icao)
  if (!base) throw new Error(`Авиакомпания ${icao} не найдена`)
  const s = db && hasAirlineStates(db) ? loadStates(db).get(icao) : undefined
  if (!s) return base
  return withState(base, s)
}

/** Блок-часов в сутки на самолёт и дней в месяце — как в экономике авиакомпаний (sim.ts). */
const BLOCK_HOURS_PER_DAY = 13
const DAYS = 30

/**
 * «Авто» у компании игрока: маршрут без назначенного типа достаётся тому типу, у которого
 * больше всего свободных часов (после назначенных маршрутов). Длинные маршруты — первыми.
 * У компаний мира тип выбирается случайно по составу флота — на этом стоит их калибровка.
 */
function autoTypes(al: Airline, s: AirlineState): Map<RouteState, string> {
  const out = new Map<RouteState, string>()
  if (!playerAirlineIds.has(s.icao)) return out
  const free = new Map(al.fleet.map((f) => [f.type, f.count * BLOCK_HOURS_PER_DAY * DAYS]))
  const legs = s.routes
    .filter((r) => r.freq > 0)
    .map((r) => {
      const h = airports.get(r.hub)
      const d = airports.get(r.dest)
      return { r, km: h && d ? distanceKm(h.lat, h.lon, d.lat, d.lon) : 0 }
    })
  const hours = (typeId: string, km: number, freq: number) => (blockMinutes(aircraftTypes.get(typeId)!, km) / 60) * freq * 2 * DAYS
  for (const { r, km } of legs) {
    const t = assignedType(al, r.type, km, r.hub, r.dest)
    if (t) free.set(t.id, free.get(t.id)! - hours(t.id, km, r.freq))
  }
  for (const { r, km } of legs.filter((x) => !assignedType(al, x.r.type, x.km, x.r.hub, x.r.dest)).sort((a, b) => b.km * b.r.freq - a.km * a.r.freq)) {
    const best = al.fleet
      .map((f) => aircraftTypes.get(f.type)!)
      .filter((t) => t && typeServes(al, t, km, r.hub, r.dest))
      .sort((a, b) => free.get(b.id)! - free.get(a.id)!)[0]
    if (!best) continue
    out.set(r, best.id)
    free.set(best.id, free.get(best.id)! - hours(best.id, km, r.freq))
  }
  return out
}

export function withState(base: Airline, s: AirlineState): Airline {
  const fleet = Object.entries(s.fleet)
    .filter(([, c]) => c > 0)
    .map(([type, count]) => ({ type, count }))
  const auto = autoTypes({ ...base, fleet }, s)
  const byHub = new Map<string, Airline['network'][number]>()
  for (const r of s.routes) {
    if (r.freq <= 0) continue
    let n = byHub.get(r.hub)
    if (!n) {
      n = { hub: r.hub, destinations: [], freq: {}, lf: {}, fare: {}, type: {} }
      byHub.set(r.hub, n)
    }
    n.destinations.push(r.dest)
    n.freq![r.dest] = r.freq
    n.lf![r.dest] = r.lf
    n.fare![r.dest] = r.fare
    const type = r.type ?? auto.get(r)
    if (type) n.type![r.dest] = type
  }
  return {
    ...base,
    reputation: Math.round(s.reputation),
    fleet,
    network: [...byHub.values()],
    version: s.version
  }
}

export type { RouteState }
