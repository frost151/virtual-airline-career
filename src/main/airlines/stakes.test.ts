import { describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db'
import { setWorld, macroState } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import { pilotRow } from '../career/career'
import { FLAG_CARRIERS, loadStates } from './state'
import { airlinesMonthly } from './economy'
import { buyStake, listStakes, payStakeDividends, sellStake, stakeOffer } from './stakes'

const START = Date.UTC(2026, 9, 23, 12)

function newDb(): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'stakes-test')
  advanceWorld(db, START)
  pilotRow(db)
  db.prepare('UPDATE pilot SET cash = 1e13 WHERE id = 1').run()
  return db
}

/** Частная компания в нормальном состоянии — в ней можно купить контроль. */
function privateAirline(db: Db): string {
  return [...loadStates(db).values()].find((s) => !FLAG_CARRIERS.has(s.icao) && s.status === 'ok')!.icao
}

describe('доли в авиакомпаниях', () => {
  it('пакет докупается до 51% с надбавкой, даёт контроль', () => {
    const db = newDb()
    const icao = privateAirline(db)
    const cash0 = pilotRow(db).cash
    const offer = stakeOffer(db, icao)
    const q10 = offer.quotes.find((q) => q.pct === 10)!
    expect(q10.blocked).toBeNull()
    // 10% капитализации плюс 10% надбавки за пакет.
    expect(q10.price).toBeCloseTo(offer.marketCap * 0.1 * 1.1, -2)

    buyStake(db, icao, 10)
    expect(pilotRow(db).cash).toBeCloseTo(cash0 - q10.price, 0)
    expect(listStakes(db)[0]).toMatchObject({ icao, pct: 10, control: false })

    const q51 = stakeOffer(db, icao).quotes.find((q) => q.pct === 51)!
    // Докупаем 41% по цене контрольного пакета.
    expect(q51.price).toBeCloseTo(offer.marketCap * 0.41 * 1.3, -2)
    buyStake(db, icao, 51)
    const s = listStakes(db)[0]
    expect(s).toMatchObject({ pct: 51, control: true })
    expect(s.cost).toBe(q10.price + q51.price)
    expect(stakeOffer(db, icao).quotes.find((q) => q.pct === 25)!.blocked).not.toBeNull()
  })

  it('в национальном перевозчике — не больше 25%', () => {
    const db = newDb()
    const quotes = stakeOffer(db, 'AFL').quotes
    expect(quotes.find((q) => q.pct === 25)!.blocked).toBeNull()
    expect(quotes.find((q) => q.pct === 51)!.blocked).toMatch(/государство/)
    expect(() => buyStake(db, 'AFL', 51)).toThrow()
  })

  it('без денег купить нельзя', () => {
    const db = newDb()
    db.prepare('UPDATE pilot SET cash = 1000 WHERE id = 1').run()
    const icao = privateAirline(db)
    expect(stakeOffer(db, icao).quotes[0].blocked).toBe('Не хватает денег')
    expect(() => buyStake(db, icao, 10)).toThrow()
  })

  it('продажа возвращает деньги по рынку за вычетом комиссии', () => {
    const db = newDb()
    const icao = privateAirline(db)
    buyStake(db, icao, 25)
    const before = pilotRow(db).cash
    const expected = stakeOffer(db, icao).saleValue
    expect(expected).toBeCloseTo(stakeOffer(db, icao).marketCap * 0.25 * 0.98, -2)
    expect(sellStake(db, icao)).toBe(expected)
    expect(pilotRow(db).cash).toBeCloseTo(before + expected, 0)
    expect(listStakes(db)).toHaveLength(0)
  })

  it('дивиденды идут по проценту доли, за вычетом налога', () => {
    const db = newDb()
    const icao = privateAirline(db)
    buyStake(db, icao, 10)
    const s = loadStates(db).get(icao)!
    const before = pilotRow(db).cash
    payStakeDividends(db, { [icao]: 0.5 }, 20)
    const expected = Math.round(0.5 * s.shares * 1e6 * 0.1 * 0.8)
    expect(pilotRow(db).cash - before).toBeCloseTo(expected, 0)
    expect(listStakes(db)[0].dividends).toBe(expected)
  })

  it('при банкротстве частной компании доля сгорает, выходит новость', () => {
    const db = newDb()
    const icao = privateAirline(db)
    buyStake(db, icao, 25)
    loadStates(db).get(icao)!.debt = 1e15
    const news = airlinesMonthly(db, macroState(db), 'stakes-test')
    expect(listStakes(db)).toHaveLength(0)
    expect(news.some((n) => n.title === 'Ваша доля сгорела')).toBe(true)
  })
})
