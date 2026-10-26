import { describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db'
import { setWorld } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import { loadStates } from './state'
import { fleetPositions, liveFlights, networkMap } from './tails'

const START = Date.UTC(2026, 9, 23, 12)

function newDb(): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'tails-test')
  advanceWorld(db, START)
  return db
}

describe('борта и карта полётов', () => {
  const db = newDb()

  it('у каждого самолёта есть регистрация, номера в компании не повторяются', () => {
    for (const s of loadStates(db).values()) {
      const regs = Object.values(s.regs ?? {}).flat()
      expect(regs.length).toBe(Object.values(s.fleet).reduce((a, b) => a + b, 0))
      expect(new Set(regs).size).toBe(regs.length)
    }
    const dlh = loadStates(db).get('DLH')!
    expect(Object.values(dlh.regs!).flat().filter((r) => !/^D-A[IB][A-Z]{2}$/.test(r))).toEqual([])
  })

  it('в воздухе тысячи бортов, считается быстро', () => {
    const t0 = performance.now()
    const flights = liveFlights(db, START)
    const ms = performance.now() - t0
    expect(flights.length).toBeGreaterThan(1000)
    expect(flights.every((f) => f.depAt <= START && f.arrAt > START)).toBe(true)
    expect(flights.filter((f) => f.reg).length / flights.length).toBeGreaterThan(0.95)
    // Второй вызов — из кэша расписаний и оборотов.
    const t1 = performance.now()
    liveFlights(db, START + 60_000)
    console.log(`liveFlights: ${flights.length} бортов, ${ms.toFixed(0)} мс, повторно ${(performance.now() - t1).toFixed(0)} мс`)
  })

  it('борт не летит двумя рейсами сразу, положение меняется со временем', () => {
    const now = loadStates(db).get('AFL')!
    expect(now).toBeTruthy()
    const pos = fleetPositions(db, 'AFL', START)
    expect(pos.length).toBe(Object.values(now.fleet).reduce((a, b) => a + b, 0))
    const air = pos.filter((p) => p.status === 'air')
    expect(air.length).toBeGreaterThan(0)
    const later = fleetPositions(db, 'AFL', START + 6 * 3_600_000)
    expect(later.map((p) => p.status + p.at).join()).not.toBe(pos.map((p) => p.status + p.at).join())
    const live = liveFlights(db, START, ['AFL'])
    const regs = live.map((f) => f.reg).filter(Boolean)
    expect(new Set(regs).size).toBeGreaterThan(regs.length * 0.9)
  })

  it('сеть компании для карты', () => {
    const net = networkMap(db, 'AFL')
    expect(net.hubs).toContain('UUEE')
    expect(net.routes.length).toBeGreaterThan(20)
    expect(net.routes.every((r) => net.airports[r.hub] && net.airports[r.dest])).toBe(true)
  })
})
