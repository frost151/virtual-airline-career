import type { Db } from '../db'
import { aircraftTypes, airlines } from '../world'
import { COST_PROFILE } from './demand'
import type { RouteState } from '@shared/airlines'
import { CREW_OVERHEAD, DAYS, pilotRate, projectAirline } from './sim'
import { loadStates, saveStates } from './state'

/**
 * Рейсы CEO своей компании: вместо почасовой ставки он получает долю прибыли рейса,
 * а компания экономит на одном пилоте. Без импорта карьеры — её вызывает career.ts.
 */

/** Доля прибыли рейса, которую получает CEO за то, что сам его выполнил. */
export const CEO_FLIGHT_SHARE = 0.1

/** Компания, которую основал игрок (если основал). */
export function foundedAirline(db: Db): string | null {
  const row = db.prepare('SELECT icao FROM stakes WHERE founded = 1').get() as { icao: string } | undefined
  return row?.icao ?? null
}

/** Прибыль одного рейса по маршруту — по итогам прошлого месяца, $. */
export function flightProfit(db: Db, icao: string, dep: string, arr: string): number {
  const find = (routes: RouteState[] | undefined) =>
    routes?.find((x) => (x.hub === dep && x.dest === arr) || (x.hub === arr && x.dest === dep))
  let r = find(loadStates(db).get(icao)?.routes)
  if (!r || r.freq <= 0) return 0
  // Рейс открыт в этом месяце и итогов ещё нет — берём прогноз.
  if (!r.fare && !r.profit) r = find(projectAirline(db, icao)?.routes) ?? r
  return r.profit / (r.freq * 2 * DAYS)
}

/** Доля CEO с рейса до налога, $ (убыточный рейс — ничего). */
export const ceoFlightCut = (db: Db, icao: string, dep: string, arr: string): number =>
  Math.max(0, flightProfit(db, icao, dep, arr)) * CEO_FLIGHT_SHARE

/** Сколько компания сэкономила на одном пилоте, $. */
export function crewSaving(icao: string, typeId: string, blockHours: number, level: number): number {
  const t = aircraftTypes.get(typeId)
  const al = airlines.get(icao)
  if (!t || !al) return 0
  return pilotRate(t) * CREW_OVERHEAD * blockHours * level * COST_PROFILE[al.archetype].ops
}

/** Расчёт с компанией после рейса CEO: платит ему долю и получает экономию на экипаже. */
export function settleCeoFlight(db: Db, icao: string, grossPay: number, saving: number): void {
  const states = loadStates(db)
  const s = states.get(icao)
  if (!s) return
  s.cash += saving - grossPay
  saveStates(db, states)
}
