import type { AirlineDetailEconomy, AirlineMarketRow } from '@shared/airlines'
import type { MacroState } from '@shared/economy'
import type { Db } from '../db'
import type { NewsDraft } from '../economy/macro'
import { airlines, airports } from '../world'
import { addTransaction, pilotRow, resign } from '../career/career'
import { countryParams } from '../lifestyle/catalog'
import { FLAG_CARRIERS, hasAirlineStates, loadStates, type AirlineState } from './state'
import { initAirlineStates, simulateAirlinesMonth } from './sim'

/** Связка экономики авиакомпаний с миром и карьерой пилота. */

const monthStartOf = (dayIndex: number): number => {
  const d = new Date(dayIndex * 86_400_000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** При первом запуске мира — стартовое состояние всех авиакомпаний. */
export function ensureAirlines(db: Db, macro: MacroState, seed: string): void {
  if (!hasAirlineStates(db)) initAirlineStates(db, macro, monthStartOf(macro.day), seed)
}

/** Месячный шаг: экономика, увольнение пилота при банкротстве работодателя, дивиденды. */
export function airlinesMonthly(db: Db, macro: MacroState, seed: string): NewsDraft[] {
  const monthStart = monthStartOf(macro.day)
  const res = simulateAirlinesMonth(db, macro, monthStart, seed)
  const news = [...res.news]
  const t = monthStart + 13 * 3_600_000
  const p = pilotRow(db)

  if (p.employer_kind === 'airline' && p.employer_id && res.restarted.includes(p.employer_id)) {
    resign(db)
    news.push({
      t,
      category: 'career',
      title: 'Вы потеряли работу',
      body: `${airlines.get(p.employer_id)?.name} обанкротилась и сократила почти весь персонал. Найдите новую работу на главной.`
    })
  }

  // Дивиденды по акциям пилота, налог — по ставке страны базы (×0,75: льготная ставка на дивиденды).
  const holdings = db.prepare("SELECT icao, SUM(quantity) AS q FROM investments WHERE kind = 'shares' GROUP BY icao").all() as {
    icao: string
    q: number
  }[]
  const country = p.base ? (airports.get(p.base)?.country ?? null) : null
  const taxPct = countryParams(country).tax * 0.75
  for (const h of holdings) {
    const dps = res.dividends[h.icao]
    if (!dps || !h.q) continue
    const gross = dps * h.q
    const net = Math.round(gross * (1 - taxPct / 100))
    if (net > 0) addTransaction(db, net, `Дивиденды ${airlines.get(h.icao)?.name ?? h.icao}`)
  }
  return news
}

function row(s: AirlineState): AirlineMarketRow {
  const al = airlines.get(s.icao)!
  return {
    icao: s.icao,
    iata: al.iata,
    name: al.name,
    country: al.country,
    national: FLAG_CARRIERS.has(s.icao),
    status: s.status,
    reputation: Math.round(s.reputation),
    fleetSize: Object.values(s.fleet).reduce((a, b) => a + b, 0),
    routes: s.routes.filter((r) => r.freq > 0).length,
    cash: Math.round(s.cash),
    debt: Math.round(s.debt),
    sharePrice: s.sharePrice,
    shareChange: s.prevSharePrice ? +((s.sharePrice / s.prevSharePrice - 1) * 100).toFixed(1) : 0,
    last: s.last
  }
}

export function marketRows(db: Db): AirlineMarketRow[] {
  return [...loadStates(db).values()].map(row)
}

export function airlineEconomy(db: Db, icao: string): AirlineDetailEconomy {
  const s = loadStates(db).get(icao)
  if (!s) throw new Error('Авиакомпания не найдена')
  const history = db
    .prepare('SELECT month, revenue, profit, lf, share_price AS sharePrice, cash FROM airline_monthly WHERE icao = ? ORDER BY month')
    .all(icao) as unknown as AirlineDetailEconomy['history']
  return { row: row(s), history, routes: s.routes.filter((r) => r.freq > 0).sort((a, b) => b.profit - a.profit) }
}

export const sharePrice = (db: Db, icao: string): number => loadStates(db).get(icao)?.sharePrice ?? 0
