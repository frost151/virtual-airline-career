import type { CatchUpReport, SkipPreset } from '@shared/economy'
import { PREP_MINUTES } from '@shared/career'
import type { Db } from './db'
import { shiftClock, worldNow } from './worldTime'
import { advanceWorld } from './economy/clock'
import { getBooking, openBooking, requireFit, retimeBooking } from './career/career'

/**
 * Перемотка времени: игрок не ждёт реального часа вылета и итогов месяца.
 * Часы мира сдвигаются вперёд, мир досчитывается как после закрытой программы.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** Сколько мотать для пресета: «до 1-го числа» — к часу ночи первого числа, когда подводятся итоги месяца. */
export function skipPresetMs(db: Db, preset: SkipPreset): number {
  if (preset === '3h') return 3 * HOUR
  if (preset === '1d') return DAY
  if (preset === '1w') return 7 * DAY
  const now = new Date(worldNow(db))
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 1) - now.getTime()
}

/** Перемотка мимо вылета своей брони сорвала бы рейс — её не даём. */
export function requireSkippable(db: Db, ms: number): void {
  const b = openBooking(db)
  if (b?.status === 'booked' && b.depAt < worldNow(db) + ms) {
    throw new Error(`Перемотка сорвёт рейс ${b.flightNo} — сначала выполните или отмените бронь`)
  }
}

/** Перемотать мир. */
export function skipWorld(db: Db, ms: number): CatchUpReport | null {
  requireSkippable(db, ms)
  shiftClock(db, ms)
  const report = advanceWorld(db, worldNow(db))
  return report && { ...report, skipped: true }
}

/**
 * «Начать полёт» по брони: вылет будет через prepMin минут. Если до него ещё далеко — мир перематывается,
 * если уже ближе — вылет переносится. Опоздание дальше считается от этого времени.
 */
export function prepareDeparture(db: Db, bookingId: number, prepMin: number): CatchUpReport | null {
  if (!(PREP_MINUTES as readonly number[]).includes(prepMin)) throw new Error('Такого времени на подготовку нет')
  const b = getBooking(db, bookingId)
  if (b.status !== 'booked') throw new Error('Бронь уже закрыта')
  const prep = prepMin * 60_000
  const jump = Math.max(0, b.depAt - prep - worldNow(db))
  // Медкомиссия могла закончиться за время перемотки — проверяем на момент вылета.
  requireFit(db, worldNow(db) + jump)
  let report: CatchUpReport | null = null
  if (jump > 0) {
    shiftClock(db, jump)
    report = advanceWorld(db, worldNow(db))
  } else {
    retimeBooking(db, b.id, worldNow(db) + prep)
  }
  return report && { ...report, skipped: true }
}
