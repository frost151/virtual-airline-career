import { describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db'
import { setWorld } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import * as career from '../career/career'
import * as life from './life'
import { FATIGUE_LIMIT } from '@shared/lifestyle'

const START = Date.UTC(2026, 9, 23, 12, 0, 0)
const DAY = 86_400_000

function newDb(opts: { partner?: boolean; children?: number } = {}): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at, partner, children)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?, ?, ?)`
  ).run(iso, iso, iso, opts.partner ? 1 : 0, opts.children ?? 0)
  setWorld(db, 'seed', 'life-test')
  career.hire(db, { kind: 'airline', employerId: 'SVR', base: 'USSS', ratingId: 'A320' })
  return db
}

const cash = (db: Db) => career.pilotState(db).cash

describe('цены', () => {
  it('в России отечественные машины без пошлины, импорт дороже', () => {
    const c = life.catalogFor(newDb())
    expect(c.country).toBe('RU')
    const granta = c.cars.find((x) => x.id === 'lada-granta')!
    const corolla = c.cars.find((x) => x.id === 'toyota-corolla')!
    expect(granta.localPrice).toBe(9500)
    expect(granta.imported).toBe(false)
    expect(corolla.localPrice).toBeGreaterThan(24000 * 1.4)
    expect(c.cars.length).toBeGreaterThan(70)
  })

  it('семья дорожает: поездки и жизнь', () => {
    const single = life.catalogFor(newDb())
    const family = life.catalogFor(newDb({ partner: true, children: 2 }))
    const beach = (c: typeof single) => c.rest.find((r) => r.id === 'beach')!.localPrice
    expect(beach(family)).toBeGreaterThan(beach(single) * 2)
    expect(life.lifeState(newDb({ partner: true, children: 2 })).roomsNeeded).toBe(2)
  })
})

describe('жизнь', () => {
  it('усталость копится от рейсов, блокирует бронирование и снимается только отдыхом', () => {
    const db = newDb()
    db.prepare('UPDATE pilot SET fatigue = ? WHERE id = 1').run(FATIGUE_LIMIT + 5)
    expect(() => career.dispatchSchedule(db, START).find((f) => f.bookable) && career.bookScheduled(db, career.dispatchSchedule(db, START).find((f) => f.bookable)!.id, START)).toThrow(/устали/)
    life.rentHome(db, 'flat2')
    // Неделя дома — усталость снижается, но совсем немного.
    advanceWorld(db, START + 7 * DAY)
    expect(life.lifeState(db).fatigue).toBeGreaterThan(80)
    life.takeRest(db, 'vacation')
    expect(life.lifeState(db).fatigue).toBe(0)
    expect(life.lifeState(db).fitToFly.ok).toBe(true)
  })

  it('ипотека: первый взнос, ежемесячные платежи, просрочка и изъятие', () => {
    const db = newDb()
    db.prepare('UPDATE pilot SET cash = 200000 WHERE id = 1').run()
    life.buyHome(db, 'flat2', 20, 20)
    const s = life.lifeState(db)
    const home = s.assets.find((a) => a.kind === 'home')!
    expect(home.residence).toBe(true)
    expect(s.loans).toHaveLength(1)
    expect(s.loans[0].balance).toBeCloseTo(home.purchasePrice * 0.8, -2)
    expect(cash(db)).toBeCloseTo(200000 - home.purchasePrice * 0.2, -1)

    // Месяц с деньгами — платёж прошёл, долг уменьшился.
    const before = s.loans[0].balance
    advanceWorld(db, START + 40 * DAY)
    expect(life.lifeState(db).loans[0].balance).toBeLessThan(before)

    // Денег нет — три просрочки подряд, и банк забирает квартиру.
    db.prepare('UPDATE pilot SET cash = 0 WHERE id = 1').run()
    advanceWorld(db, START + 140 * DAY)
    const after = life.lifeState(db)
    expect(after.loans).toHaveLength(0)
    expect(after.assets.some((a) => a.kind === 'home' && a.ownership === 'own')).toBe(false)
  })

  it('машина в кредит дешевеет, продажа гасит кредит', () => {
    const db = newDb()
    db.prepare('UPDATE pilot SET cash = 100000 WHERE id = 1').run()
    life.buyCar(db, 'toyota-camry', 30, 3)
    const car = life.lifeState(db).assets.find((a) => a.kind === 'car')!
    advanceWorld(db, START + 70 * DAY)
    const later = life.lifeState(db).assets.find((a) => a.kind === 'car')!
    expect(later.value).toBeLessThan(car.value)
    life.sellAsset(db, later.id)
    expect(life.lifeState(db).loans).toHaveLength(0)
    expect(life.lifeState(db).assets).toHaveLength(0)
  })

  it('налог страны базы удерживается с зарплаты', () => {
    const db = newDb()
    const f = career.dispatchSchedule(db, START).find((x) => x.bookable)!
    const b = career.bookScheduled(db, f.id, START)
    db.prepare(
      `INSERT INTO flights (source, status, departure, arrival, aircraft_title, block_off_at, takeoff_at, landing_at, block_on_at,
        distance_km, fuel_used_kg, max_alt_ft, score, events_json, track_json, created_at)
       VALUES ('msfs', 'completed', ?, ?, 'A320', ?, ?, ?, ?, 600, 2000, 30000, 85, '[]', '[]', ?)`
    ).run(b.dep, b.arr, b.depAt, b.depAt + 600_000, b.depAt + 6_000_000, b.depAt + 7_200_000, new Date().toISOString())
    const fid = (db.prepare('SELECT MAX(id) AS id FROM flights').get() as { id: number }).id
    const before = cash(db)
    const out = career.onFlightFinished(db, b.id, (await_(db, fid)), false)
    expect(out.tax).toBeGreaterThan(0)
    expect(out.tax! / (out.pay! + out.tax!)).toBeCloseTo(0.13, 2)
    expect(cash(db) - before).toBe(out.pay)
    expect(life.lifeState(db).fatigue).toBeGreaterThan(10)
  })

  it('ежемесячно списываются расходы на жизнь, семья тратит больше', () => {
    const single = newDb()
    const family = newDb({ partner: true, children: 2 })
    advanceWorld(single, START + 40 * DAY)
    advanceWorld(family, START + 40 * DAY)
    // Сравниваем именно расходы на жизнь: случайные события у них разные.
    const living = (db: Db) =>
      -(db.prepare("SELECT SUM(amount) AS s FROM transactions WHERE description = 'Расходы на жизнь за месяц'").get() as { s: number }).s
    expect(living(single)).toBeGreaterThan(0)
    expect(living(family) / living(single)).toBeCloseTo(2.6, 1)
  })

  it('без отдыха и жилья удовлетворённость падает', () => {
    const db = newDb()
    advanceWorld(db, START + 100 * DAY)
    expect(life.lifeState(db).satisfaction).toBeLessThan(45)
  })
})

import { getFlight } from '../logbook'
const await_ = (db: Db, id: number) => getFlight(db, id)
