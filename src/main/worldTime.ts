import type { Db } from './db'

/**
 * Часы мира: реальное время плюс накопленная перемотка (profile.clock_offset_ms).
 * Всё игровое — брони, расписание, зарплаты, экономика, бортжурнал — живёт по этим часам.
 * Пока программа закрыта, мир идёт вместе с реальным временем; перемотка только добавляет.
 */

const cache = new WeakMap<Db, number>()

export function clockOffset(db: Db): number {
  let offset = cache.get(db)
  if (offset === undefined) {
    offset = (db.prepare('SELECT clock_offset_ms AS o FROM profile WHERE id = 1').get() as { o: number } | undefined)?.o ?? 0
    cache.set(db, offset)
  }
  return offset
}

export const worldNow = (db: Db): number => Date.now() + clockOffset(db)

/** Перемотать часы мира вперёд. Сам мир (дни, месяцы) досчитывает advanceWorld. */
export function shiftClock(db: Db, ms: number): void {
  if (!(ms > 0)) return
  db.prepare('UPDATE profile SET clock_offset_ms = clock_offset_ms + ? WHERE id = 1').run(Math.round(ms))
  cache.delete(db)
}
