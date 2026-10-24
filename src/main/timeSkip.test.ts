import { describe, expect, it } from 'vitest'
import type { FlightRecord } from '@shared/sim'
import { openDatabase, type Db } from './db'
import { setWorld, macroState } from './economy/state'
import { advanceWorld } from './economy/clock'
import * as career from './career/career'
import { saveFlight, getFlight } from './logbook'
import type { FlightDraft } from './tracker/tracker'
import { clockOffset, worldNow } from './worldTime'
import { prepareDeparture, skipPresetMs, skipWorld } from './timeSkip'

const START = Date.UTC(2026, 9, 23, 12)
const MIN = 60_000
const HOUR = 60 * MIN

function newDb(): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'skip-test')
  advanceWorld(db, worldNow(db))
  career.hire(db, { kind: 'airline', employerId: 'SVR', base: 'USSS', ratingId: 'A320' })
  return db
}

/** Бронь на рейс, до которого больше трёх часов. */
function bookFar(db: Db) {
  const now = worldNow(db)
  const f = career.dispatchSchedule(db, now).find((x) => x.bookable && x.depAt - now > 3 * HOUR)!
  return career.bookScheduled(db, f.id, now)
}

function fly(db: Db, b: { dep: string; arr: string; blockMin: number }, blockOffAt: number): FlightRecord {
  const draft: FlightDraft = {
    source: 'msfs',
    status: 'completed',
    departure: b.dep,
    arrival: b.arr,
    aircraft: null,
    blockOffAt,
    takeoffAt: blockOffAt + 10 * MIN,
    landingAt: blockOffAt + (b.blockMin - 10) * MIN,
    blockOnAt: blockOffAt + b.blockMin * MIN,
    distanceKm: 600,
    fuelUsedKg: 2500,
    maxAltFt: 33000,
    landing: { t: 0, vsFpm: -150, gForce: 1.1, iasKt: 135, pitchDeg: 4, bankDeg: 0, bounces: 0, grade: 'Отличная', penalty: 0 },
    score: 90,
    events: [],
    track: []
  }
  return getFlight(db, saveFlight(db, draft))
}

describe('перемотка времени', () => {
  it('«Начать полёт» перематывает мир к вылету минус выбранное время', () => {
    const db = newDb()
    const b = bookFar(db)
    prepareDeparture(db, b.id, 30)
    // Вылет — ровно через 30 минут по часам мира, само время вылета не меняется.
    expect(Math.abs(worldNow(db) - (b.depAt - 30 * MIN))).toBeLessThan(5_000)
    expect(career.getBooking(db, b.id).depAt).toBe(b.depAt)
    expect(clockOffset(db)).toBeGreaterThan(2 * HOUR)
  })

  it('если до вылета меньше выбранного — вылет переносится, опоздание считается от нового времени', () => {
    const db = newDb()
    const b = bookFar(db)
    prepareDeparture(db, b.id, 10)
    const offset = clockOffset(db)
    // Теперь до вылета 10 минут, а игроку нужно два часа: мир не мотается, вылет переносится.
    prepareDeparture(db, b.id, 120)
    expect(clockOffset(db)).toBe(offset)
    const moved = career.getBooking(db, b.id)
    expect(Math.abs(moved.depAt - (worldNow(db) + 120 * MIN))).toBeLessThan(5_000)
    expect(moved.arrAt - moved.depAt).toBe(b.arrAt - b.depAt)

    // Вылет через 5 минут после нового времени — не опоздание.
    const out = career.onFlightFinished(db, b.id, fly(db, moved, moved.depAt + 5 * MIN), false)
    expect(out.status).toBe('completed')
  })

  it('опоздание больше 15 минут от выбранного времени — нужна причина задержки', () => {
    const db = newDb()
    const b = bookFar(db)
    prepareDeparture(db, b.id, 30)
    const out = career.onFlightFinished(db, b.id, fly(db, b, b.depAt + 25 * MIN), false)
    expect(out.status).toBe('awaiting_delay')
    expect(out.delayMin).toBe(25)
  })

  it('перемотка не даёт проскочить свою бронь; без брони — мир досчитывается', () => {
    const db = newDb()
    const b = bookFar(db)
    expect(() => skipWorld(db, 7 * 24 * HOUR)).toThrow(/сорвёт рейс/)
    career.cancelBooking(db, b.id, worldNow(db))

    const day = macroState(db).day
    db.prepare('UPDATE pilot SET fatigue = 60 WHERE id = 1').run()
    const report = skipWorld(db, 7 * 24 * HOUR)
    expect(report?.skipped).toBe(true)
    expect(macroState(db).day).toBe(day + 7)
    // За неделю пилот отдохнул.
    expect(career.pilotRow(db).fatigue).toBeLessThan(60)
  })

  it('«до 1-го числа» — к часу ночи первого числа следующего месяца', () => {
    const db = newDb()
    // Сначала сколько мотать, потом «сейчас»: иначе миллисекунда между вызовами сдвинет цель на 00:59:59.999.
    const skip = skipPresetMs(db, 'month')
    const target = new Date(worldNow(db) + skip)
    expect(target.getUTCDate()).toBe(1)
    expect(target.getUTCHours()).toBe(1)
    expect(target.getTime()).toBeGreaterThan(worldNow(db))
  })
})
