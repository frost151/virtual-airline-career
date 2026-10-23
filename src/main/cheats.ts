import { nextRankIfEligible } from '@shared/career'
import { transaction, type Db } from './db'
import { getSettings } from './settings'
import { addTransaction, allRatings, pilotRow, pilotStats } from './career/career'
import { hasEducation } from './lifestyle/perks'
import { airports } from './world'

/**
 * Режим читера: всё работает, только если он включён в настройках.
 * Каждое действие видно в истории операций с пометкой «[чит]».
 */

const YEAR_MS = 365 * 86_400_000

function requireCheats(db: Db): void {
  if (!getSettings(db).cheatMode) throw new Error('Режим читера выключен — включите его в настройках')
}

export function cheatMoney(db: Db, amount: number): void {
  requireCheats(db)
  if (!Number.isFinite(amount) || amount === 0) throw new Error('Укажите сумму')
  addTransaction(db, Math.round(amount), '[чит] Деньги')
}

/** Добавляет налёт и сразу проверяет повышения (можно перескочить несколько званий). */
export function cheatHours(db: Db, hours: number): void {
  requireCheats(db)
  if (!(hours > 0)) throw new Error('Укажите часы')
  transaction(db, () => {
    db.prepare('UPDATE pilot SET bonus_hours = bonus_hours + ? WHERE id = 1').run(hours)
    for (let guard = 0; guard < 5; guard++) {
      const next = nextRankIfEligible(pilotRow(db).rank, pilotStats(db), hasEducation(db, 'tri'))
      if (!next) break
      db.prepare('UPDATE pilot SET rank = ? WHERE id = 1').run(next)
    }
  })
}

export function cheatRest(db: Db): void {
  requireCheats(db)
  db.prepare('UPDATE pilot SET fatigue = 0 WHERE id = 1').run()
}

export function cheatHeal(db: Db): void {
  requireCheats(db)
  db.prepare('UPDATE pilot SET health = 100, satisfaction = 100 WHERE id = 1').run()
}

export function cheatMedical(db: Db): void {
  requireCheats(db)
  db.prepare('UPDATE pilot SET medical_until = ? WHERE id = 1').run(Date.now() + YEAR_MS)
}

export function cheatReputation(db: Db): void {
  requireCheats(db)
  db.prepare('UPDATE pilot SET reputation = 100 WHERE id = 1').run()
}

export function cheatRating(db: Db, ratingId: string): void {
  requireCheats(db)
  const r = allRatings(db).find((x) => x.id === ratingId)
  if (!r) throw new Error('Допуск не найден')
  db.prepare('INSERT OR IGNORE INTO ratings (id, name, obtained_at) VALUES (?, ?, ?)').run(r.id, r.name, new Date().toISOString())
}

/** Мгновенно перенестись в аэропорт (например, на базу или к нужному рейсу). */
export function cheatTeleport(db: Db, icao: string): void {
  requireCheats(db)
  const code = icao.trim().toUpperCase()
  if (!airports.has(code)) throw new Error(`Аэропорт ${code} не найден`)
  db.prepare('UPDATE pilot SET location = ? WHERE id = 1').run(code)
}
