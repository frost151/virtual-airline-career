import { beforeEach, describe, expect, it } from 'vitest'
import type { FlightRecord } from '@shared/sim'
import { openDatabase, type Db } from '../db'
import { airlines, aircraftTypes } from '../world'
import { saveFlight, getFlight } from '../logbook'
import type { FlightDraft } from '../tracker/tracker'
import { airlineDaySchedule, utcDayStart } from './schedule'
import * as career from './career'
import { saveSettings } from '../settings'

const NOW = Date.UTC(2026, 9, 23, 6, 0, 0)

function newDb(): Db {
  const db = openDatabase(':memory:')
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 'test', 'Иван Петров', 'pilot', ?, ?, ?)`
  ).run(new Date(NOW).toISOString(), new Date(NOW).toISOString(), new Date(NOW).toISOString())
  return db
}

/** Полёт по брони, как его вернул бы трекер. */
function fly(db: Db, b: { dep: string; arr: string; depAt: number; blockMin: number }, opts: Partial<FlightDraft> = {}): FlightRecord {
  const off = opts.blockOffAt ?? b.depAt + 5 * 60_000
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
    score: 95,
    events: [],
    track: [],
    ...opts
  }
  return getFlight(db, saveFlight(db, draft))
}

describe('расписание', () => {
  const afl = airlines.get('AFL')!
  const day = utcDayStart(NOW)

  it('стабильно и содержит обратные рейсы', () => {
    const a = airlineDaySchedule(afl, day)
    expect(a.length).toBeGreaterThan(100)
    const out = a.find((f) => f.dep === 'UUEE' && f.arr === 'URSS')!
    const back = a.find((f) => f.dep === 'URSS' && f.arr === 'UUEE' && f.typeId === out.typeId && f.depAt > out.arrAt)
    expect(back).toBeDefined()
    // На следующий день — тот же номер и то же время суток.
    const next = airlineDaySchedule(afl, day + 86_400_000).find((f) => f.flightNo === out.flightNo)!
    expect(next.depAt - out.depAt).toBe(86_400_000)
  })

  it('тип самолёта всегда долетает', () => {
    for (const f of airlineDaySchedule(afl, day)) {
      expect(aircraftTypes.get(f.typeId)!.rangeKm).toBeGreaterThanOrEqual(f.distanceKm * 1.05)
    }
  })
})

describe('карьера в авиакомпании', () => {
  let db: Db
  beforeEach(() => {
    db = newDb()
    career.hire(db, { kind: 'airline', employerId: 'SVR', base: 'USSS', ratingId: 'A320' })
  })

  it('новичка не берут в престижную авиакомпанию', () => {
    const qr = career.hireOptions(db).find((o) => o.id === 'QTR')!
    expect(qr.eligible).toBe(false)
    expect(() => career.hire(db, { kind: 'airline', employerId: 'QTR', base: 'OTHH', ratingId: 'A320' })).toThrow()
  })

  it('рейс по брони оплачивается и переносит пилота', () => {
    const s = career.pilotState(db)
    expect(s.location).toBe('USSS')
    expect(s.ratings.map((r) => r.id)).toEqual(['A320'])

    const flight = career.dispatchSchedule(db, NOW).find((f) => f.bookable)!
    const b = career.bookScheduled(db, flight.id, NOW)
    expect(() => career.bookScheduled(db, flight.id, NOW)).toThrow(/уже есть бронь/)

    const out = career.onFlightFinished(db, b.id, fly(db, b), false)
    expect(out.status).toBe('completed')
    expect(out.pay).toBeGreaterThan(0)
    const after = career.pilotState(db)
    expect(after.location).toBe(b.arr)
    expect(after.cash).toBe(30_000 + out.pay!)
    expect(after.stats.flights).toBe(1)
  })

  it('игровой множитель умножает оплату, но не цены', () => {
    const run = () => {
      const flight = career.dispatchSchedule(db, NOW).find((f) => f.bookable)!
      const b = career.bookScheduled(db, flight.id, NOW)
      return { pay: career.onFlightFinished(db, b.id, fly(db, b), false).pay!, est: flight.estPay }
    }
    const x1 = run()
    saveSettings(db, { payMultiplier: 5 })
    db.prepare("UPDATE pilot SET location = 'USSS' WHERE id = 1").run()
    const x5 = run()
    expect(x5.est / x1.est).toBeCloseTo(5, 1)
    expect(x5.pay).toBeGreaterThan(x1.pay * 4)
    expect(career.allRatings(db).find((r) => r.id === 'B737')!.price).toBe(20_000)
    expect(() => saveSettings(db, { payMultiplier: 3 as never })).toThrow()
  })

  it('опоздание требует причину; вина экипажа бьёт по репутации', () => {
    const flight = career.dispatchSchedule(db, NOW).find((f) => f.bookable)!
    const b = career.bookScheduled(db, flight.id, NOW)
    const out = career.onFlightFinished(db, b.id, fly(db, b, { blockOffAt: b.depAt + 40 * 60_000 }), false)
    expect(out.status).toBe('awaiting_delay')
    expect(out.delayMin).toBe(40)
    const done = career.setDelayReason(db, b.id, '63')
    expect(done.status).toBe('completed')
    expect(done.repDelta).toBe(1 - 3)
  })

  it('сбой симулятора как причина не штрафуется', () => {
    const flight = career.dispatchSchedule(db, NOW).find((f) => f.bookable)!
    const b = career.bookScheduled(db, flight.id, NOW)
    career.onFlightFinished(db, b.id, fly(db, b, { blockOffAt: b.depAt + 30 * 60_000 }), false)
    expect(career.setDelayReason(db, b.id, 'SC').repDelta).toBe(1)
  })

  it('демо-полёт не засчитывается без настройки', () => {
    const flight = career.dispatchSchedule(db, NOW).find((f) => f.bookable)!
    const b = career.bookScheduled(db, flight.id, NOW)
    const out = career.onFlightFinished(db, b.id, fly(db, b, { source: 'demo' }), false)
    expect(out.status).toBe('not_counted')
    expect(career.openBooking(db)?.id).toBe(b.id)
  })

  it('сорванная бронь снижает репутацию', () => {
    const flight = career.dispatchSchedule(db, NOW).find((f) => f.bookable)!
    const b = career.bookScheduled(db, flight.id, NOW)
    expect(career.expireBookings(db, b.depAt + 4 * 3_600_000)).toBe(1)
    expect(career.pilotState(db).reputation).toBe(45)
  })

  it('после 10 часов налёта — второй пилот', () => {
    let now = NOW
    let promoted: string | undefined
    for (let i = 0; i < 12 && !promoted; i++) {
      const flight = career.dispatchSchedule(db, now).find((f) => f.bookable)!
      const b = career.bookScheduled(db, flight.id, now)
      const out = career.onFlightFinished(db, b.id, fly(db, b, { blockOnAt: b.depAt + 5 * 60_000 + 130 * 60_000 }), false)
      promoted = out.promotedTo
      now = b.arrAt + 3_600_000
    }
    expect(promoted).toBe('Второй пилот')
    expect(career.pilotState(db).rank).toBe('fo')
  })
})

describe('VIP-чартеры', () => {
  it('заказы с историями, министры сохраняются в профиле', () => {
    const db = newDb()
    career.hire(db, { kind: 'charter', employerId: 'atlant-ba', base: 'UUWW', ratingId: 'C750' })
    const offers = career.listCharterOffers(db, NOW)
    expect(offers.length).toBeGreaterThan(0)
    for (const o of offers) {
      expect(o.story.length).toBeGreaterThan(40)
      expect(o.client.name).toMatch(/[А-Яа-яЁё]/)
      expect(o.typeId).toBe('C750')
      expect(o.pilotPay).toBeGreaterThan(0)
    }
    // Тот же 4-часовой интервал — те же заказы.
    expect(career.listCharterOffers(db, NOW + 60_000).map((o) => o.story)).toEqual(offers.map((o) => o.story))

    const b = career.acceptCharter(db, offers[0].id, NOW)
    expect(b.kind).toBe('charter')
    expect(career.listCharterOffers(db, NOW).some((o) => o.id === offers[0].id)).toBe(false)

    const out = career.onFlightFinished(db, b.id, fly(db, b, { blockOffAt: b.depAt }), false)
    expect(out.status).toBe('completed')
    // До налога: чаевые за плавный полёт сверх суммы заказа.
    expect(out.pay! + out.tax!).toBeGreaterThan(offers[0].pilotPay)
  })
})
