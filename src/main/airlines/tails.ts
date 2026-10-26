import type { LiveFlight, NetworkMap, TailPosition } from '@shared/airlines'
import type { ScheduledFlight } from '@shared/types'
import type { Airline } from '@shared/world'
import type { Db } from '../db'
import { aircraftTypes, airlines, airports } from '../world'
import { airlineDaySchedule, utcDayStart } from '../career/schedule'
import { hasAirlineStates, loadStates, withState, type AirlineState } from './state'

/**
 * Борта в расписании: каждый оборот «туда-обратно» достаётся конкретному самолёту (по регистрации),
 * поэтому видно, где сейчас каждый борт. Всё считается от часов мира — перемотка двигает самолёты вместе с миром.
 */

const DAY_MS = 86_400_000
/** Самолёту нужно время на земле между рейсами. */
const TURN_MS = 45 * 60_000

interface Rotation {
  flights: ScheduledFlight[]
  start: number
  end: number
  base: string
}

interface DayPlan {
  /** Рейс → регистрация. */
  byFlight: Map<string, string>
  /** Регистрация → рейсы за сутки по времени. */
  byReg: Map<string, ScheduledFlight[]>
}

const planCache = new Map<string, DayPlan>()

/** Рейсы суток, разбитые на обороты: «туда» и «обратно» летит один самолёт; рейс в одну сторону — отдельно. */
function rotations(day: ScheduledFlight[]): Rotation[] {
  const out: Rotation[] = []
  for (let i = 0; i < day.length; i++) {
    const f = day[i]
    const back = !f.oneWay && day[i + 1] && day[i + 1].dep === f.arr && day[i + 1].arr === f.dep ? day[++i] : null
    const flights = back ? [f, back] : [f]
    out.push({ flights, start: f.depAt, end: flights[flights.length - 1].arrAt, base: f.dep })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** Распределить обороты суток по бортам: свободный самолёт в том же аэропорту, иначе любой освободившийся. */
function dayPlan(al: Airline, s: AirlineState, dayStart: number): DayPlan {
  const key = `${al.icao}|${dayStart}|${al.cacheKey ?? s.version}`
  const hit = planCache.get(key)
  if (hit) return hit
  const parked = new Set((s.legs ?? []).map((l) => l.reg))
  const byFlight = new Map<string, string>()
  const byReg = new Map<string, ScheduledFlight[]>()
  const tails = new Map<string, { reg: string; freeAt: number; at: string | null }[]>()
  for (const [type, regs] of Object.entries(s.regs ?? {}))
    tails.set(
      type,
      regs.filter((r) => !parked.has(r)).map((reg) => ({ reg, freeAt: -Infinity, at: null }))
    )
  const legReg = new Map((s.legs ?? []).map((l) => [`${l.hub}-${l.dest}-${l.depAt}`, l.reg]))

  for (const rot of rotations(airlineDaySchedule(al, dayStart))) {
    const first = rot.flights[0]
    let reg = first.oneWay ? legReg.get(`${first.dep}-${first.arr}-${first.depAt}`) : undefined
    if (!reg) {
      const pool = tails.get(first.typeId) ?? []
      if (!pool.length) continue
      const free = pool.filter((t) => t.freeAt + TURN_MS <= rot.start)
      const tail =
        free.find((t) => t.at === rot.base) ?? free.find((t) => t.at === null) ?? free[0] ?? pool.reduce((a, b) => (b.freeAt < a.freeAt ? b : a))
      tail.freeAt = rot.end
      tail.at = rot.flights[rot.flights.length - 1].arr
      reg = tail.reg
    }
    for (const f of rot.flights) {
      byFlight.set(f.id, reg)
      byReg.set(reg, [...(byReg.get(reg) ?? []), f])
    }
  }
  if (planCache.size > 400) planCache.clear()
  const plan = { byFlight, byReg }
  planCache.set(key, plan)
  return plan
}

function liveAirline(db: Db, icao: string): { al: Airline; s: AirlineState } | null {
  const s = hasAirlineStates(db) ? loadStates(db).get(icao) : undefined
  const base = airlines.get(icao)
  if (!s || !base) return null
  return { al: withState(base, s), s }
}

/** Регистрация борта, который выполняет рейс. */
export function tailOf(db: Db, flight: ScheduledFlight): string | null {
  const live = liveAirline(db, flight.airline)
  if (!live) return null
  return dayPlan(live.al, live.s, utcDayStart(flight.depAt)).byFlight.get(flight.id) ?? null
}

/** Где сейчас каждый борт компании: в воздухе (каким рейсом) или на земле (в каком аэропорту). */
export function fleetPositions(db: Db, icao: string, now: number): TailPosition[] {
  const live = liveAirline(db, icao)
  if (!live) return []
  const { al, s } = live
  const today = utcDayStart(now)
  const plans = [dayPlan(al, s, today - DAY_MS), dayPlan(al, s, today), dayPlan(al, s, today + DAY_MS)]
  const legs = new Map((s.legs ?? []).map((l) => [l.reg, l]))
  const out: TailPosition[] = []
  for (const [type, regs] of Object.entries(s.regs ?? {})) {
    for (const reg of regs) {
      const flights = plans.flatMap((p) => p.byReg.get(reg) ?? []).sort((a, b) => a.depAt - b.depAt)
      const airborne = flights.find((f) => f.depAt <= now && f.arrAt > now)
      const last = [...flights].reverse().find((f) => f.arrAt <= now)
      const next = flights.find((f) => f.depAt > now)
      const leg = legs.get(reg)
      const pos: TailPosition = {
        reg,
        typeId: type,
        typeName: aircraftTypes.get(type)?.name ?? type,
        status: airborne ? 'air' : 'ground',
        at: airborne ? null : (last?.arr ?? next?.dep ?? leg?.hub ?? null),
        flight: airborne ? toLive(al, airborne, reg) : null,
        next: next ? { flightNo: next.flightNo, dep: next.dep, arr: next.arr, depAt: next.depAt } : null,
        stranded: !!leg && now >= leg.depAt
      }
      if (pos.stranded && !airborne) pos.at = leg!.dest
      out.push(pos)
    }
  }
  return out
}

function toLive(al: Airline, f: ScheduledFlight, reg: string | null): LiveFlight {
  const d = airports.get(f.dep)!
  const a = airports.get(f.arr)!
  return {
    id: f.id,
    airline: al.icao,
    iata: al.iata,
    name: al.name,
    flightNo: f.flightNo,
    reg,
    typeId: f.typeId,
    typeName: aircraftTypes.get(f.typeId)?.name ?? f.typeId,
    category: aircraftTypes.get(f.typeId)?.category ?? 'narrowbody',
    dep: f.dep,
    arr: f.arr,
    depCity: d.city ?? d.name,
    arrCity: a.city ?? a.name,
    depAt: f.depAt,
    arrAt: f.arrAt,
    from: [d.lat, d.lon],
    to: [a.lat, a.lon]
  }
}

/** Все борта в воздухе в момент now (у выбранных компаний или у всех). */
export function liveFlights(db: Db, now: number, only?: string[]): LiveFlight[] {
  if (!hasAirlineStates(db)) return []
  const out: LiveFlight[] = []
  const today = utcDayStart(now)
  for (const s of loadStates(db).values()) {
    if (only && !only.includes(s.icao)) continue
    const base = airlines.get(s.icao)
    if (!base) continue
    const al = withState(base, s)
    for (const day of [today - DAY_MS, today]) {
      const plan = dayPlan(al, s, day)
      for (const f of airlineDaySchedule(al, day)) {
        if (f.depAt > now || f.arrAt <= now) continue
        if (!airports.get(f.dep) || !airports.get(f.arr)) continue
        out.push(toLive(al, f, plan.byFlight.get(f.id) ?? null))
      }
    }
  }
  return out
}

/** Маршрутная сеть компании для карты: пары аэропортов с частотами и координатами. */
export function networkMap(db: Db, icao: string): NetworkMap {
  const base = airlines.get(icao)
  if (!base) throw new Error('Авиакомпания не найдена')
  const s = hasAirlineStates(db) ? loadStates(db).get(icao) : undefined
  const al = s ? withState(base, s) : base
  const routes: NetworkMap['routes'] = []
  const codes = new Set<string>()
  for (const n of al.network) {
    for (const dest of n.destinations) {
      const h = airports.get(n.hub)
      const d = airports.get(dest)
      if (!h || !d) continue
      codes.add(n.hub)
      codes.add(dest)
      routes.push({ hub: n.hub, dest, freq: n.freq?.[dest] ?? 1 })
    }
  }
  for (const l of al.legs ?? []) {
    codes.add(l.hub)
    codes.add(l.dest)
    routes.push({ hub: l.hub, dest: l.dest, freq: 0, oneWay: true })
  }
  return {
    icao,
    iata: al.iata,
    name: al.name,
    hubs: [...new Set(al.network.map((n) => n.hub))],
    airports: Object.fromEntries(
      [...codes].map((c) => {
        const a = airports.get(c)!
        return [c, { lat: a.lat, lon: a.lon, name: a.city ?? a.name, iata: a.iata }]
      })
    ),
    routes
  }
}
