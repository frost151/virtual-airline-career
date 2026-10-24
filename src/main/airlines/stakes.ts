import { CONTROL_PCT, FLAG_CARRIER_MAX_PCT, STAKE_LEVELS, type Stake, type StakeOffer, type StakeQuote } from '@shared/airlines'
import { transaction, type Db } from '../db'
import { airlines } from '../world'
import { addTransaction, pilotRow } from '../career/career'
import { FLAG_CARRIERS, loadStates, releaseControl, saveStates, type AirlineState } from './state'

/**
 * Доли игрока в авиакомпаниях. Это не портфель акций из «Личной жизни»: доля покупается пакетом
 * у крупных акционеров с надбавкой, даёт дивиденды по проценту и с 51% — контроль над компанией.
 */

/** Надбавка к цене акций за пакет: за контрольный платят заметно дороже. */
const BLOCK_PREMIUM = 1.1
const CONTROL_PREMIUM = 1.3
/** Покупатель контрольного пакета при продаже тоже доплачивает, но меньше. */
const CONTROL_SALE_PREMIUM = 1.15
/** Комиссия банка-консультанта при продаже пакета. */
const SALE_FEE = 0.02

interface StakeRow {
  icao: string
  pct: number
  cost: number
  dividends: number
  founded: number
  guaranteed: number
  acquired_at: number
}

const marketCap = (s: AirlineState): number => s.shares * 1e6 * s.sharePrice

function stakeRow(db: Db, icao: string): StakeRow | undefined {
  return db.prepare('SELECT * FROM stakes WHERE icao = ?').get(icao) as StakeRow | undefined
}

function toStake(r: StakeRow, s: AirlineState | undefined): Stake {
  return {
    icao: r.icao,
    name: airlines.get(r.icao)?.name ?? r.icao,
    pct: r.pct,
    cost: Math.round(r.cost),
    value: s ? Math.round((marketCap(s) * r.pct) / 100) : 0,
    dividends: Math.round(r.dividends),
    control: r.pct >= CONTROL_PCT,
    founded: !!r.founded,
    acquiredAt: r.acquired_at
  }
}

export function listStakes(db: Db): Stake[] {
  const states = loadStates(db)
  const rows = db.prepare('SELECT * FROM stakes ORDER BY pct DESC').all() as unknown as StakeRow[]
  return rows.map((r) => toStake(r, states.get(r.icao)))
}

function stateOf(db: Db, icao: string): AirlineState {
  const s = loadStates(db).get(icao)
  if (!s) throw new Error('Авиакомпания не найдена')
  return s
}

function quote(s: AirlineState, current: number, pct: number, cash: number): StakeQuote {
  const price = Math.round(((pct - current) / 100) * marketCap(s) * (pct >= CONTROL_PCT ? CONTROL_PREMIUM : BLOCK_PREMIUM))
  let blocked: string | null = null
  if (pct <= current) blocked = 'Доля уже не меньше'
  else if (FLAG_CARRIERS.has(s.icao) && pct > FLAG_CARRIER_MAX_PCT)
    blocked = `Национальный перевозчик: государство продаёт не больше ${FLAG_CARRIER_MAX_PCT}%`
  else if (s.status !== 'ok') blocked = 'Компания в кризисе: крупные акционеры пакет сейчас не продают'
  else if (cash < price) blocked = 'Не хватает денег'
  return { pct, price, blocked }
}

const saleValue = (s: AirlineState, pct: number): number =>
  Math.round((pct / 100) * marketCap(s) * (pct >= CONTROL_PCT ? CONTROL_SALE_PREMIUM : 1) * (1 - SALE_FEE))

/** Что можно купить или продать в компании: для карточки на «Рынке». */
export function stakeOffer(db: Db, icao: string): StakeOffer {
  const s = stateOf(db, icao)
  const row = stakeRow(db, icao)
  const current = row?.pct ?? 0
  const cash = pilotRow(db).cash
  if (row?.founded)
    return {
      stake: toStake(row, s),
      quotes: [],
      saleValue: 0,
      marketCap: Math.round(marketCap(s))
    }
  return {
    stake: row ? toStake(row, s) : null,
    quotes: STAKE_LEVELS.map((pct) => quote(s, current, pct, cash)),
    saleValue: row ? saleValue(s, row.pct) : 0,
    marketCap: Math.round(marketCap(s))
  }
}

/** Докупает долю до pct (10, 25 или 51%). Деньги — из кошелька игрока, компания их не получает. */
export function buyStake(db: Db, icao: string, pct: number): void {
  if (!(STAKE_LEVELS as readonly number[]).includes(pct)) throw new Error('Такого пакета нет')
  const s = stateOf(db, icao)
  const row = stakeRow(db, icao)
  if (row?.founded) throw new Error('Это ваша компания')
  const q = quote(s, row?.pct ?? 0, pct, pilotRow(db).cash)
  if (q.blocked) throw new Error(q.blocked)
  const name = airlines.get(icao)?.name ?? icao
  transaction(db, () => {
    addTransaction(db, -q.price, `Покупка доли ${pct}% в ${name}`)
    if (row) db.prepare('UPDATE stakes SET pct = ?, cost = cost + ? WHERE icao = ?').run(pct, q.price, icao)
    else db.prepare('INSERT INTO stakes (icao, pct, cost, acquired_at) VALUES (?, ?, ?, ?)').run(icao, pct, q.price, Date.now())
  })
}

/** Продаёт долю целиком. */
export function sellStake(db: Db, icao: string): number {
  const row = stakeRow(db, icao)
  if (!row) throw new Error('У вас нет доли в этой компании')
  if (row.founded) throw new Error('Свою компанию так не продать')
  const amount = saleValue(stateOf(db, icao), row.pct)
  transaction(db, () => {
    db.prepare('DELETE FROM stakes WHERE icao = ?').run(icao)
    addTransaction(db, amount, `Продажа доли ${row.pct}% в ${airlines.get(icao)?.name ?? icao}`)
    if (row.pct >= CONTROL_PCT) dropControl(db, icao)
  })
  return amount
}

/** Дивиденды по долям: dps — дивиденд на акцию из месячного шага, taxPct — налог страны базы. */
export function payStakeDividends(db: Db, dps: Record<string, number>, taxPct: number): void {
  const states = loadStates(db)
  for (const r of db.prepare('SELECT * FROM stakes').all() as unknown as StakeRow[]) {
    const s = states.get(r.icao)
    const perShare = dps[r.icao]
    if (!s || !perShare) continue
    const net = Math.round(perShare * s.shares * 1e6 * (r.pct / 100) * (1 - taxPct / 100))
    if (net <= 0) continue
    addTransaction(db, net, `Дивиденды по доле ${r.pct}% в ${airlines.get(r.icao)?.name ?? r.icao}`)
    db.prepare('UPDATE stakes SET dividends = dividends + ? WHERE icao = ?').run(net, r.icao)
  }
}

/** Компания обанкротилась и начала заново: кредиторы забрали всё, доли акционеров сгорают. */
export function burnStake(db: Db, icao: string): StakeRow | undefined {
  const row = stakeRow(db, icao)
  if (row) {
    db.prepare('DELETE FROM stakes WHERE icao = ?').run(icao)
    dropControl(db, icao)
  }
  return row
}

function dropControl(db: Db, icao: string): void {
  const states = loadStates(db)
  const s = states.get(icao)
  if (!s) return
  releaseControl(s)
  saveStates(db, states)
}
