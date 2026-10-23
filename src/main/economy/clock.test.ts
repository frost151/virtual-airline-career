import { describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db'
import { advanceWorld, macroOverview } from './clock'
import { priceLevel, setWorld } from './state'
import { stepDay, initialMacro } from './macro'
import { seededRng } from '@shared/random'

const START = Date.UTC(2026, 9, 23, 12, 0, 0)
const DAY = 86_400_000

function newDb(seed = 'test-seed'): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', seed)
  return db
}

describe('часы мира', () => {
  it('в те же сутки ничего не досчитывается', () => {
    const db = newDb()
    expect(advanceWorld(db, START + 3_600_000)).toBeNull()
  })

  it('год без программы: инфляция, нефть в разумных пределах, новости каждый месяц', () => {
    const db = newDb()
    const report = advanceWorld(db, START + 365 * DAY)!
    expect(report).not.toBeNull()
    expect(report.cpiTo).toBeGreaterThan(1.005)
    expect(report.cpiTo).toBeLessThan(1.08)
    const o = macroOverview(db)
    // 365 дней предыстории + год мира, а смотрим последний год.
    expect(o.history.length).toBeGreaterThan(360)
    for (const p of o.history) {
      expect(p.brent).toBeGreaterThan(25)
      expect(p.brent).toBeLessThan(200)
    }
    expect(report.news.filter((n) => n.category === 'month').length).toBe(12)
    expect(priceLevel(db)).toBeCloseTo(report.cpiTo)
    // Повторный вызов в тот же момент — ничего нового.
    expect(advanceWorld(db, START + 365 * DAY)).toBeNull()
  })

  it('досчёт кусками даёт ту же историю, что и одним разом', () => {
    const a = newDb()
    const b = newDb()
    advanceWorld(a, START + 90 * DAY)
    for (let d = 1; d <= 90; d += 7) advanceWorld(b, START + d * DAY)
    advanceWorld(b, START + 90 * DAY)
    expect(macroOverview(b).current.brent).toBeCloseTo(macroOverview(a).current.brent, 6)
    expect(macroOverview(b).news.length).toBe(macroOverview(a).news.length)
  })

  it('у разных миров разная история', () => {
    const a = newDb('seed-a')
    const b = newDb('seed-b')
    advanceWorld(a, START + 60 * DAY)
    advanceWorld(b, START + 60 * DAY)
    expect(macroOverview(a).current.brent).not.toBeCloseTo(macroOverview(b).current.brent, 3)
  })

  it('нефть тянется к среднему, а не уходит в бесконечность', () => {
    let s = initialMacro(0)
    const prices: number[] = []
    for (let d = 1; d <= 3650; d++) {
      s = stepDay(s, seededRng(`x|${d}`)).state
      prices.push(s.brent)
    }
    const avg = prices.reduce((x, y) => x + y, 0) / prices.length
    expect(avg).toBeGreaterThan(55)
    expect(avg).toBeLessThan(110)
  })
})
