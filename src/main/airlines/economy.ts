import type { AirlineDetailEconomy, AirlineMarketRow } from '@shared/airlines'
import type { CompanyMonth, MacroState } from '@shared/economy'
import { CONTROL_PCT } from '@shared/airlines'
import { transaction, type Db } from '../db'
import type { NewsDraft } from '../economy/macro'
import { airlines, airports } from '../world'
import { addTransaction, leaveEmployer, pilotRow } from '../career/career'
import { countryParams } from '../lifestyle/catalog'
import { FLAG_CARRIERS, hasAirlineStates, loadStates, type AirlineState } from './state'
import { initAirlineStates, simulateAirlinesMonth } from './sim'
import { burnStake, payStakeDividends } from './stakes'
import { offeringsMonthly } from './manage'

/** Связка экономики авиакомпаний с миром и карьерой пилота. */

const monthStartOf = (dayIndex: number): number => {
  const d = new Date(dayIndex * 86_400_000)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
}

/** При первом запуске мира — стартовое состояние всех авиакомпаний. */
export function ensureAirlines(db: Db, macro: MacroState, seed: string): void {
  if (!hasAirlineStates(db)) initAirlineStates(db, macro, monthStartOf(macro.day), seed)
}

/** Итоги только что посчитанного месяца по компаниям, где у игрока контроль. */
export function controlledMonth(db: Db, dayIndex: number): CompanyMonth[] {
  const states = loadStates(db)
  const rows = db.prepare('SELECT icao FROM stakes WHERE pct >= ?').all(CONTROL_PCT) as { icao: string }[]
  // Итоги считаются за прошлый месяц: 1-го числа подводятся итоги предыдущего.
  const d = new Date(monthStartOf(dayIndex))
  const month = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)
  return rows.flatMap(({ icao }) => {
    const s = states.get(icao)
    if (!s?.last) return []
    const { revenue, costs, profit, pax, lf } = s.last
    return [{ icao, name: airlines.get(icao)?.name ?? icao, month, revenue, costs, profit, pax, lf, cash: s.cash }]
  })
}

/** Месячный шаг: экономика, увольнение пилота при банкротстве работодателя, дивиденды. */
export function airlinesMonthly(db: Db, macro: MacroState, seed: string): NewsDraft[] {
  const monthStart = monthStartOf(macro.day)
  const res = simulateAirlinesMonth(db, macro, monthStart, seed)
  const t = monthStart + 13 * 3_600_000
  const news = [...res.news, ...offeringsMonthly(db, t)]
  const p = pilotRow(db)

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
  payStakeDividends(db, res.dividends, taxPct)
  // Зарплата CEO облагается как обычная зарплата в стране базы.
  for (const [icao, gross] of Object.entries(res.ceoPay)) {
    const net = Math.round(gross * (1 - countryParams(country).tax / 100))
    if (net > 0) addTransaction(db, net, `Зарплата CEO ${airlines.get(icao)?.name ?? icao}`)
  }

  // Банкротства: сначала сгорают доли (и CEO перестаёт им быть), потом пилот теряет работу.
  for (const icao of res.restarted) {
    const burned = burnStake(db, icao)
    if (!burned) continue
    const name = airlines.get(icao)?.name ?? icao
    news.push({
      t,
      category: 'career',
      title: burned.founded ? `Ваша компания ${name} обанкротилась` : 'Ваша доля сгорела',
      body: burned.founded
        ? 'Кредиторы забрали флот и компанию. Ваша доля больше ничего не стоит, вы больше не CEO — но налёт, допуски и деньги остаются при вас.'
        : `${name} обанкротилась: кредиторы забрали флот, доля ${burned.pct}% больше ничего не стоит.`
    })
    if (burned.guaranteed) news.push(collectGuarantee(db, name, res.bankruptDebt[icao] ?? 0, t))
  }
  if (p.employer_kind === 'airline' && p.employer_id && res.restarted.includes(p.employer_id)) {
    leaveEmployer(db)
    news.push({
      t,
      category: 'career',
      title: 'Вы потеряли работу',
      body: `${airlines.get(p.employer_id)?.name} обанкротилась и сократила почти весь персонал. Найдите новую работу на главной.`
    })
  }

  // Своя компания в долгах — предупреждаем каждый месяц, пока не поздно.
  const own = db.prepare('SELECT icao FROM stakes WHERE founded = 1').get() as { icao: string } | undefined
  const ownState = own && loadStates(db).get(own.icao)
  if (ownState?.status === 'distress') {
    news.push({
      t,
      category: 'career',
      title: `${airlines.get(own!.icao)?.name}: банк грозит банкротством`,
      body: 'Долги компании слишком велики. Сократите убыточные рейсы, верните лишние самолёты или вложите личные деньги в «Финансах».'
    })
  }
  return news
}

/** Доля долга, которую банк взыскивает с поручителя: остальное покрывают изъятые самолёты и имущество. */
const GUARANTEE_SHARE = 0.6
/** Остаток долга по поручительству банк растягивает на 10 лет под 12% годовых. */
const GUARANTEE_RATE = 12
const GUARANTEE_MONTHS = 120

/** Взыскание по личному поручительству: сколько есть — со счёта, остальное — личный кредит. */
function collectGuarantee(db: Db, name: string, debt: number, t: number): NewsDraft {
  const owed = Math.round(debt * GUARANTEE_SHARE)
  const cash = Math.max(0, Math.floor(pilotRow(db).cash))
  const paid = Math.min(cash, owed)
  const rest = owed - paid
  transaction(db, () => {
    if (paid > 0) addTransaction(db, -paid, `Взыскание по поручительству за ${name}`)
    if (rest > 0) {
      const r = GUARANTEE_RATE / 1200
      const payment = Math.round((rest * r) / (1 - Math.pow(1 + r, -GUARANTEE_MONTHS)))
      db.prepare(
        "INSERT INTO loans (kind, asset_id, principal, balance, rate, payment, months_left, opened_at) VALUES ('guarantee', NULL, ?, ?, ?, ?, ?, ?)"
      ).run(rest, rest, GUARANTEE_RATE, payment, GUARANTEE_MONTHS, t)
    }
  })
  return {
    t,
    category: 'career',
    title: 'Банк взыскивает долг по поручительству',
    body:
      `По личному поручительству за ${name} вы должны $${owed.toLocaleString('ru-RU')}.` +
      (paid ? ` Со счёта списано $${paid.toLocaleString('ru-RU')}.` : '') +
      (rest ? ` Остаток $${rest.toLocaleString('ru-RU')} оформлен как личный кредит на 10 лет.` : '')
  }
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
