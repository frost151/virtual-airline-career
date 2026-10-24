import { afterEach, describe, expect, it } from 'vitest'
import type { FoundAirlineInput } from '@shared/airlines'
import { openDatabase, type Db } from '../db'
import { setWorld, macroState } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import { pilotRow } from '../career/career'
import { lifeCountry } from '../lifestyle/life'
import { airlines, playerAirlineIds } from '../world'
import { loadStates } from './state'
import { airlinesMonthly, marketRows } from './economy'
import { listStakes } from './stakes'
import { destinationOptions, foundAirline, foundQuote, registerPlayerAirlines } from './player'

const START = Date.UTC(2026, 9, 23, 12)

function newDb(cash = 5e6): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'owner', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'player-test')
  advanceWorld(db, START)
  pilotRow(db)
  db.prepare('UPDATE pilot SET cash = ? WHERE id = 1').run(cash)
  registerPlayerAirlines(db)
  return db
}

function input(db: Db, patch: Partial<FoundAirlineInput> = {}): FoundAirlineInput {
  const dests = destinationOptions(db, 'ULLI', 'AT76')
    .slice(0, 2)
    .map((d) => d.icao)
  return {
    name: 'Neva Air',
    icao: 'NVQ',
    iata: 'Q7',
    callsign: 'NEVA',
    archetype: 'regional',
    hub: 'ULLI',
    typeId: 'AT76',
    destinations: dests,
    contribution: 2e6,
    loan: 0,
    guaranteed: false,
    logo: null,
    ...patch
  }
}

afterEach(() => registerPlayerAirlines(null))

describe('своя авиакомпания', () => {
  it('из Пулково на ATR 72 есть направления, самые востребованные сверху', () => {
    const db = newDb()
    const d = destinationOptions(db, 'ULLI', 'AT76')
    expect(d.length).toBeGreaterThan(5)
    expect(d[0].demand).toBeGreaterThanOrEqual(d[d.length - 1].demand)
    // Дальность ATR 72 — 1500 км.
    expect(Math.max(...d.map((x) => x.km))).toBeLessThanOrEqual(1500 * 0.9)
  })

  it('проверяет коды, деньги и резерв', () => {
    const db = newDb()
    expect(foundQuote(db, input(db)).errors).toEqual([])
    expect(foundQuote(db, input(db, { icao: 'AFL' })).errors).toContain('Код ICAO AFL уже занят')
    expect(foundQuote(db, input(db, { iata: 'SU' })).errors).toContain('Код IATA SU уже занят')
    expect(foundQuote(db, input(db, { contribution: 6e6 })).errors).toContain('У вас нет столько денег')
    expect(foundQuote(db, input(db, { contribution: 3e5 })).errors.join()).toMatch(/резерв/)
    expect(foundQuote(db, input(db, { loan: 7e6 })).errors.join()).toMatch(/Банк/)
    // Грузовой компании пассажирский ATR не подходит.
    expect(foundQuote(db, input(db, { archetype: 'cargo' })).errors.join()).toMatch(/самолёт/)
  })

  it('основанная компания живёт в экономике как любая другая', () => {
    const db = newDb()
    const q = foundQuote(db, input(db, { loan: 1e6, guaranteed: true }))
    foundAirline(db, input(db, { loan: 1e6, guaranteed: true }))

    expect(pilotRow(db).cash).toBe(3e6)
    // База CEO — база компании: цены и налоги считаются по её стране.
    expect(pilotRow(db).base).toBe('ULLI')
    expect(lifeCountry(db)).toBe('RU')
    expect(playerAirlineIds.has('NVQ')).toBe(true)
    expect(airlines.get('NVQ')!.name).toBe('Neva Air')
    expect(listStakes(db)[0]).toMatchObject({ icao: 'NVQ', pct: 100, founded: true, control: true })
    const s = loadStates(db).get('NVQ')!
    expect(s.cash).toBe(q.cashAfter)
    expect(s.debt).toBe(1e6)
    expect(s.debtRate).toBe(0.006)
    expect(s.fleet).toEqual({ AT76: 1 })
    expect(s.routes).toHaveLength(2)

    // Месячный шаг считает её рынок и финансы, на «Рынке» она видна.
    airlinesMonthly(db, macroState(db), 'player-test')
    const after = loadStates(db).get('NVQ')!
    expect(after.last!.revenue).toBeGreaterThan(0)
    expect(after.last!.lf).toBeGreaterThan(0)
    expect(marketRows(db).some((r) => r.icao === 'NVQ')).toBe(true)

    // Вторую свою компанию не основать, закрытие профиля убирает её из справочника.
    expect(foundQuote(db, input(db, { icao: 'NVZ', iata: 'Q8', name: 'Other' })).errors).toContain('У вас уже есть своя компания')
    registerPlayerAirlines(null)
    expect(airlines.has('NVQ')).toBe(false)
  })
})
