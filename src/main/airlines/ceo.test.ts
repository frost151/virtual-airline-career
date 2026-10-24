import { afterEach, describe, expect, it } from 'vitest'
import type { FlightRecord } from '@shared/sim'
import { openDatabase, type Db } from '../db'
import { setWorld, macroState } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import * as career from '../career/career'
import { saveFlight, getFlight } from '../logbook'
import type { FlightDraft } from '../tracker/tracker'
import { monthlyBudget } from '../lifestyle/life'
import { loadStates } from './state'
import { airlinesMonthly } from './economy'
import { destinationOptions, foundAirline, foundQuote, playerAirlines, registerPlayerAirlines } from './player'
import * as m from './manage'
import type { FoundAirlineInput } from '@shared/airlines'
import { CEO_FLIGHT_SHARE, flightProfit } from './ceo'

const START = Date.UTC(2026, 9, 23, 12)
const ICAO = 'NVQ'

function newDb(withMonth = true): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'owner', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'ceo-test')
  advanceWorld(db, START)
  career.pilotRow(db)
  db.prepare('UPDATE pilot SET cash = 1e8 WHERE id = 1').run()
  registerPlayerAirlines(db)
  foundAirline(db, {
    name: 'Neva Air',
    icao: ICAO,
    iata: 'Q7',
    callsign: 'NEVA',
    archetype: 'lowcost',
    hub: 'UUWW',
    typeId: 'A320',
    destinations: destinationOptions(db, 'UUWW', 'A320')
      .slice(0, 2)
      .map((d) => d.icao),
    contribution: 2e7,
    loan: 0,
    guaranteed: false,
    logo: null
  })
  // Месяц работы — у маршрутов появляется прибыль; допуск на A320 — чтобы летать.
  if (withMonth) airlinesMonthly(db, macroState(db), 'ceo-test')
  career.buyRating(db, 'A320')
  return db
}

function fly(db: Db, b: { dep: string; arr: string; depAt: number; blockMin: number }): FlightRecord {
  const off = b.depAt + 5 * 60_000
  const draft: FlightDraft = {
    source: 'msfs',
    status: 'completed',
    departure: b.dep,
    arrival: b.arr,
    aircraft: null,
    blockOffAt: off,
    takeoffAt: off + 10 * 60_000,
    landingAt: off + (b.blockMin - 10) * 60_000,
    blockOnAt: off + b.blockMin * 60_000,
    distanceKm: 600,
    fuelUsedKg: 2500,
    maxAltFt: 33000,
    landing: { t: 0, vsFpm: -150, gForce: 1.1, iasKt: 135, pitchDeg: 4, bankDeg: 0, bounces: 0, grade: 'Отличная', penalty: 0 },
    score: 80,
    events: [],
    track: []
  }
  return getFlight(db, saveFlight(db, draft))
}

afterEach(() => registerPlayerAirlines(null))

const anyInput = (db: Db): FoundAirlineInput => ({
  name: 'X',
  icao: 'XXX',
  iata: 'X1',
  callsign: '',
  archetype: 'lowcost',
  hub: 'UUWW',
  typeId: 'A320',
  destinations: destinationOptions(db, 'UUWW', 'A320')
    .slice(0, 1)
    .map((d) => d.icao),
  contribution: 2e7,
  loan: 0,
  guaranteed: false,
  logo: null
})

describe('CEO летает в своей компании', () => {
  it('основатель — CEO своей компании: звание не растёт, уволиться нельзя, оклада пилота нет', () => {
    const db = newDb()
    const p = career.pilotState(db)
    expect(p).toMatchObject({ ceo: true, rankName: 'CEO', employerId: ICAO, base: 'UUWW', nextRank: null })
    expect(() => career.resign(db)).toThrow(/CEO/)
    expect(monthlyBudget(db).some((l) => l.label.startsWith('Оклад'))).toBe(false)
    expect(() => career.hire(db, { kind: 'airline', employerId: 'SVR', base: 'USSS', ratingId: 'A320' })).toThrow(/CEO/)
  })

  it('сразу после основания доля с рейса видна по прогнозу месяца', () => {
    const db = newDb(false)
    expect(loadStates(db).get(ICAO)!.last).toBeNull()
    const flights = career.dispatchSchedule(db, Date.now()).filter((f) => f.bookable)
    expect(flights.length).toBeGreaterThan(0)
    expect(flights.some((f) => f.estPay > 0)).toBe(true)
    expect(flights.every((f) => (f.avgFare ?? 0) > 0)).toBe(true)
  })

  it('за рейс CEO получает долю прибыли, компания экономит на пилоте', () => {
    const db = newDb()
    const now = Date.now()
    const flight = career.dispatchSchedule(db, now).find((f) => f.bookable)!
    expect(flight).toBeDefined()
    const cut = Math.max(0, flightProfit(db, ICAO, flight.dep, flight.arr)) * CEO_FLIGHT_SHARE
    expect(flight.estPay).toBe(Math.round(cut))

    const b = career.bookScheduled(db, flight.id, now)
    const companyCash = loadStates(db).get(ICAO)!.cash
    const rank = career.pilotRow(db).rank
    const out = career.onFlightFinished(db, b.id, fly(db, b), false)
    expect(out.status).toBe('completed')
    expect(out.pay! + out.tax!).toBe(Math.round(cut))
    expect(out.promotedTo).toBeUndefined()
    expect(career.pilotRow(db).rank).toBe(rank)
    // Компания отдала CEO его долю, но не платила одному пилоту: экономия больше доли с одного рейса.
    const after = loadStates(db).get(ICAO)!.cash
    expect(after).not.toBe(companyCash)
    expect(after - companyCash).toBeGreaterThan(-cut)
  })
})

describe('банкротство своей компании и IPO', () => {
  const bankrupt = (db: Db) => {
    loadStates(db).get(ICAO)!.debt = 5e8
    return airlinesMonthly(db, macroState(db), 'ceo-test')
  }

  it('без поручительства: доля сгорает, CEO остаётся без работы, можно основать новую', () => {
    const db = newDb()
    const cash = career.pilotRow(db).cash
    const news = bankrupt(db)
    expect(news.some((n) => n.title.includes('обанкротилась'))).toBe(true)
    const p = career.pilotState(db)
    expect(p.ceo).toBe(false)
    expect(p.employerId).toBeNull()
    expect(career.pilotRow(db).cash).toBeGreaterThanOrEqual(cash)
    // Компания осталась в мире, но уже не наша.
    expect(loadStates(db).get(ICAO)!.status).toBe('restarted')
    expect(m.manageState).toBeDefined()
    expect(() => m.manageState(db, ICAO)).toThrow(/контроля/)
    expect(playerAirlines(db).find((a) => a.icao === ICAO)!.active).toBe(false)
    expect(foundQuote(db, { ...anyInput(db), icao: 'NVZ', iata: 'Q8', name: 'Neva Two' }).errors).not.toContain('У вас уже есть своя компания')
  })

  it('с поручительством банк взыскивает часть долга: со счёта и личным кредитом', () => {
    const db = newDb()
    db.prepare('UPDATE stakes SET guaranteed = 1').run()
    db.prepare('UPDATE pilot SET cash = 1e6 WHERE id = 1').run()
    const news = bankrupt(db)
    expect(news.some((n) => n.title.includes('поручительству'))).toBe(true)
    expect(career.pilotRow(db).cash).toBeLessThan(1e6)
    const loan = db.prepare("SELECT * FROM loans WHERE kind = 'guarantee'").get() as { balance: number } | undefined
    expect(loan!.balance).toBeGreaterThan(1e8)
  })

  it('деньги можно вложить в компанию, IPO — после трёх прибыльных месяцев', () => {
    const db = newDb()
    const before = m.manageState(db, ICAO)
    m.injectCapital(db, ICAO, 1e6)
    expect(m.manageState(db, ICAO).cash).toBe(before.cash + 1e6)
    expect(m.manageState(db, ICAO).ipo!.blocked).toMatch(/отчётность/)
    // Отчётность за три месяца (повторный шаг в тот же день мира перезаписал бы один и тот же месяц).
    for (let i = 1; i <= 3; i++)
      db.prepare('INSERT OR REPLACE INTO airline_monthly (icao, month, revenue, profit, lf, share_price, cash) VALUES (?, ?, 1, 1, 0.8, 10, 1)').run(
        ICAO,
        START - i * 31 * 86_400_000
      )
    const st = m.manageState(db, ICAO)
    expect(st.ipo!.blocked).toBeNull()
    const opt = st.ipo!.options.find((o) => o.pct === 25)!
    m.goPublic(db, ICAO, 25)
    const after = m.manageState(db, ICAO)
    expect(after.pct).toBe(75)
    expect(after.ipo).toBeNull()
    expect(after.cash).toBe(st.cash + opt.proceeds)
    expect(career.pilotState(db).ceo).toBe(true)
  })
})
