import { describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db'
import { setWorld, macroState } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import * as career from '../career/career'
import { effectiveAirline, loadStates, saveStates } from './state'
import { airlinesMonthly, marketRows } from './economy'
import { departuresFrom } from '../career/schedule'
import { aircraftTypes } from '../world'

const START = Date.UTC(2026, 9, 23, 12)
const DAY = 86_400_000

function newDb(): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'airlines-test')
  advanceWorld(db, START)
  return db
}

describe('экономика авиакомпаний', () => {
  it('у всех компаний есть финансы, загрузка в разумных пределах', () => {
    const db = newDb()
    const rows = marketRows(db)
    expect(rows.length).toBe(84)
    for (const r of rows) {
      expect(r.last).not.toBeNull()
      expect(r.sharePrice).toBeGreaterThan(0)
      expect(r.last!.lf).toBeGreaterThan(0.2)
      expect(r.last!.lf).toBeLessThanOrEqual(1)
    }
  })

  it('загрузка рейсов в расписании пилота берётся из модели спроса, видно средний тариф', () => {
    const db = newDb()
    const al = effectiveAirline(db, 'SVR')
    const flights = departuresFrom(al, 'USSS', START, START + DAY)
    expect(flights.length).toBeGreaterThan(5)
    const s = loadStates(db).get('SVR')!
    for (const f of flights.filter((x) => x.pax > 0)) {
      const route = s.routes.find((r) => r.hub === 'USSS' && r.dest === f.arr)!
      const seats = aircraftTypes.get(f.typeId)!.seats
      expect(f.pax / seats).toBeGreaterThan(route.lf * 0.85)
      expect(f.pax / seats).toBeLessThan(Math.min(1, route.lf * 1.15) + 0.01)
      expect(f.avgFare).toBeGreaterThan(0)
    }
  })

  it('частная компания при банкротстве начинает с одного самолёта, пилот теряет работу', () => {
    const db = newDb()
    career.hire(db, { kind: 'airline', employerId: 'PBD', base: 'UUWW', ratingId: 'B737' })
    const states = loadStates(db)
    const pbd = states.get('PBD')!
    pbd.debt = pbd.last!.revenue * 50
    saveStates(db, states)
    const news = airlinesMonthly(db, macroState(db), 'airlines-test')
    const after = loadStates(db).get('PBD')!
    expect(Object.values(after.fleet).reduce((a, b) => a + b, 0)).toBe(1)
    expect(after.routes.filter((r) => r.freq > 0)).toHaveLength(1)
    expect(after.status).toBe('restarted')
    expect(news.some((n) => n.title.includes('Pobeda обанкротилась'))).toBe(true)
    expect(news.some((n) => n.title === 'Вы потеряли работу')).toBe(true)
    expect(career.pilotState(db).employerId).toBeNull()
  })

  it('национального перевозчика спасает государство', () => {
    const db = newDb()
    const states = loadStates(db)
    const afl = states.get('AFL')!
    const fleetBefore = Object.values(afl.fleet).reduce((a, b) => a + b, 0)
    afl.debt = afl.last!.revenue * 50
    saveStates(db, states)
    const news = airlinesMonthly(db, macroState(db), 'airlines-test')
    const after = loadStates(db).get('AFL')!
    expect(Object.values(after.fleet).reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(fleetBefore - 5)
    expect(after.debt).toBeLessThan(afl.last!.revenue * 50)
    expect(news.some((n) => n.title === 'Государство спасает Aeroflot')).toBe(true)
  })

  it('год жизни мира: новости о рейсах и флоте, история котировок', () => {
    const db = newDb()
    advanceWorld(db, START + 400 * DAY)
    const airlineNews = db.prepare("SELECT COUNT(*) AS n FROM news WHERE category = 'airline'").get() as { n: number }
    expect(airlineNews.n).toBeGreaterThan(20)
    const hist = db.prepare("SELECT COUNT(*) AS n FROM airline_monthly WHERE icao = 'DLH'").get() as { n: number }
    expect(hist.n).toBeGreaterThanOrEqual(12)
  })
})
