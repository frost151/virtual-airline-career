import type { MacroState } from '@shared/economy'
import type { Db } from '../db'
import { seededRng } from '@shared/random'
import { initialMacro, isFirstOfMonth, jetFuelUsdPerKg, stepDay, stepMonth } from './macro'

/** Хранилище состояния мира (таблица world) и текущая макроэкономика. */

const DAY_MS = 86_400_000
export const dayOf = (ms: number): number => Math.floor(ms / DAY_MS)

export function getWorld(db: Db, key: string): string | null {
  const r = db.prepare('SELECT value FROM world WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}

export function setWorld(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO world (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function insertMacroPoint(db: Db, s: MacroState): void {
  db.prepare('INSERT OR REPLACE INTO macro_daily (day, brent, jet_usd_kg, cpi, cycle, demand) VALUES (?, ?, ?, ?, ?, ?)').run(
    s.day,
    +s.brent.toFixed(2),
    +jetFuelUsdPerKg(s.brent).toFixed(4),
    +s.cpi.toFixed(5),
    s.cycle,
    +s.demandIndex.toFixed(4)
  )
}

const PREHISTORY_DAYS = 365

export function macroState(db: Db): MacroState {
  const raw = getWorld(db, 'macro')
  if (raw) return JSON.parse(raw) as MacroState
  const p = db.prepare('SELECT world_start_utc FROM profile WHERE id = 1').get() as { world_start_utc: string }
  const startDay = dayOf(Date.parse(p.world_start_utc))
  const seed = getWorld(db, 'seed') ?? 'prehistory'

  // Год «предыстории» до старта мира — чтобы графики не были пустыми. Без новостей;
  // уровень цен нормируем так, чтобы на старте он был ровно 1.0.
  let s = initialMacro(startDay - PREHISTORY_DAYS)
  const points: MacroState[] = [s]
  while (s.day < startDay) {
    s = stepDay(s, seededRng(`${seed}|pre|${s.day + 1}`)).state
    if (isFirstOfMonth(s.day)) s = stepMonth(s, seededRng(`${seed}|premonth|${s.day}`)).state
    points.push(s)
  }
  const norm = s.cpi
  for (const pt of points) insertMacroPoint(db, { ...pt, cpi: pt.cpi / norm })
  const state: MacroState = { ...s, cpi: 1, cycleSinceDay: startDay - 180 }
  setWorld(db, 'macro', JSON.stringify(state))
  return state
}

/** Текущий уровень цен (1.0 на старте мира) — им индексируются зарплаты и цены. */
export const priceLevel = (db: Db): number => macroState(db).cpi
