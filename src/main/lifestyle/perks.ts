import type { AssetKind } from '@shared/lifestyle'
import { FATIGUE_LIMIT } from '@shared/lifestyle'
import type { Db } from '../db'
import { CARS, COLLECTIBLES, GA_AIRCRAFT, HOUSING, SUBSCRIPTIONS, carPrestige } from './catalog'
import { worldNow } from '../worldTime'

/**
 * То, что личная жизнь даёт карьере: допуск к полётам, престиж, образование.
 * Модуль не зависит от карьеры — его используют и карьера, и личная жизнь.
 */

const YEAR_MS = 365 * 86_400_000

export interface AssetRow {
  id: number
  kind: AssetKind
  item_id: string
  name: string
  ownership: 'own' | 'rent'
  country: string
  airport: string | null
  value: number
  purchase_price: number
  residence: number
  rented_out: number
  bought_at: number
}

export function assetRows(db: Db): AssetRow[] {
  return db.prepare('SELECT * FROM assets ORDER BY id').all() as unknown as AssetRow[]
}

export function assetPrestige(r: AssetRow): number {
  if (r.kind === 'home') return HOUSING.find((x) => x.id === r.item_id)!.prestige
  if (r.kind === 'car') return carPrestige(CARS.find((c) => c.id === r.item_id)!.price)
  if (r.kind === 'aircraft') return GA_AIRCRAFT.find((a) => a.id === r.item_id)!.prestige
  return COLLECTIBLES.find((c) => c.id === r.item_id)!.prestige
}

export const listIds = (db: Db, table: 'subscriptions' | 'education'): string[] =>
  (db.prepare(`SELECT id FROM ${table}`).all() as { id: string }[]).map((r) => r.id)

export const hasEducation = (db: Db, id: string): boolean => listIds(db, 'education').includes(id)

/** Престиж: жильё + лучшая машина + самолёт + коллекции + клубы. Не больше 100. */
export function prestige(db: Db): number {
  const rows = assetRows(db)
  const best = (k: AssetKind, filter: (r: AssetRow) => boolean = () => true) =>
    Math.max(0, ...rows.filter((r) => r.kind === k && filter(r)).map(assetPrestige))
  const home = best('home', (r) => !!r.residence || r.ownership === 'own')
  const collect = Math.min(30, rows.filter((r) => r.kind === 'collectible').reduce((s, r) => s + assetPrestige(r), 0))
  const clubs = listIds(db, 'subscriptions').reduce((s, id) => s + (SUBSCRIPTIONS.find((x) => x.id === id)?.prestige ?? 0), 0)
  return Math.min(100, Math.round(home + best('car') + best('aircraft') + collect + clubs))
}

/** Срок медкомиссии; при первом обращении — год от начала мира. */
export function medicalUntil(db: Db): number {
  const r = db.prepare('SELECT medical_until AS m FROM pilot WHERE id = 1').get() as { m: number | null } | undefined
  if (r?.m) return r.m
  const start = Date.parse((db.prepare('SELECT world_start_utc AS v FROM profile WHERE id = 1').get() as { v: string }).v)
  db.prepare('UPDATE pilot SET medical_until = ? WHERE id = 1').run(start + YEAR_MS)
  return start + YEAR_MS
}

/** Можно ли сейчас летать: усталость и медкомиссия. */
export function fitToFly(db: Db, now = worldNow(db)): { ok: boolean; reason: string | null } {
  const r = db.prepare('SELECT fatigue FROM pilot WHERE id = 1').get() as { fatigue: number } | undefined
  if ((r?.fatigue ?? 0) >= FATIGUE_LIMIT) return { ok: false, reason: 'Вы слишком устали. Отдохните — раздел «Личная жизнь» → «Отдых».' }
  if (medicalUntil(db) < now) return { ok: false, reason: 'Истекла медкомиссия. Пройдите её в разделе «Личная жизнь».' }
  return { ok: true, reason: null }
}

/** Усталость за рейс: 6 за каждый блок-час и 4 за сам рейс (сборы, брифинг). */
export function addFlightFatigue(db: Db, blockHours: number): void {
  db.prepare('UPDATE pilot SET fatigue = MIN(100, fatigue + ?) WHERE id = 1').run(blockHours * 6 + 4)
}
