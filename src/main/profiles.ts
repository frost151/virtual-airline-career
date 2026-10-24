import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { openDatabase, type Db } from './db'
import type { CreateProfileInput, ProfileSummary } from '@shared/types'
import { registerPlayerAirlines } from './airlines/player'
import { addTransaction, pilotRow } from './career/career'
import { OWNER_CAPITAL_OPTIONS } from '@shared/airlines'

/** Каждый профиль (сохранение) — отдельный файл SQLite в userData/profiles. */
function profilesDir(): string {
  const dir = join(app.getPath('userData'), 'profiles')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const profilePath = (id: string): string => join(profilesDir(), `${id}.sqlite`)

interface ProfileRow {
  name: string
  pilot_name: string
  mode: 'pilot' | 'owner'
  world_start_utc: string
  last_simulated_utc: string
}

function readSummary(id: string, db: Db): ProfileSummary | null {
  const row = db.prepare('SELECT * FROM profile WHERE id = 1').get() as unknown as ProfileRow | undefined
  if (!row) return null
  return {
    id,
    name: row.name,
    pilotName: row.pilot_name,
    mode: row.mode,
    worldStartUtc: row.world_start_utc,
    lastSimulatedUtc: row.last_simulated_utc
  }
}

let active: { id: string; db: Db } | null = null

export function listProfiles(): ProfileSummary[] {
  const result: ProfileSummary[] = []
  for (const file of readdirSync(profilesDir())) {
    if (!file.endsWith('.sqlite')) continue
    const id = file.slice(0, -'.sqlite'.length)
    if (active?.id === id) {
      const s = readSummary(id, active.db)
      if (s) result.push(s)
      continue
    }
    const db = openDatabase(profilePath(id))
    try {
      const s = readSummary(id, db)
      if (s) result.push(s)
    } finally {
      db.close()
    }
  }
  return result.sort((a, b) => b.lastSimulatedUtc.localeCompare(a.lastSimulatedUtc))
}

export function createProfile(input: CreateProfileInput): ProfileSummary {
  const name = input.name.trim()
  const pilotName = input.pilotName.trim()
  if (!name || !pilotName) throw new Error('Название профиля и имя пилота обязательны')

  const id = randomUUID()
  const now = new Date().toISOString()
  const db = openDatabase(profilePath(id))
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, owner_start, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, pilotName, input.mode, input.mode === 'owner' ? (input.ownerStart ?? 'new') : null, now, now, now)
  db.prepare('UPDATE profile SET partner = ?, children = ? WHERE id = 1').run(input.partner ? 1 : 0, Math.max(0, Math.min(6, Math.round(input.children ?? 0))))
  if (input.mode === 'owner') {
    const musd = (OWNER_CAPITAL_OPTIONS as readonly number[]).includes(input.startCapitalMusd ?? 0) ? input.startCapitalMusd! : 5
    pilotRow(db)
    addTransaction(db, musd * 1e6, 'Стартовый капитал инвестора')
  }
  db.close()
  return openProfile(id)
}

export function openProfile(id: string): ProfileSummary {
  closeProfile()
  const file = profilePath(id)
  if (!existsSync(file)) throw new Error('Профиль не найден')
  const db = openDatabase(file)
  const summary = readSummary(id, db)
  if (!summary) {
    db.close()
    throw new Error('Файл профиля повреждён')
  }
  active = { id, db }
  registerPlayerAirlines(db)
  return summary
}

export function closeProfile(): void {
  active?.db.close()
  active = null
  registerPlayerAirlines(null)
}

/** Удаляет профиль безвозвратно: файл базы и служебные файлы SQLite (-wal, -shm). */
export function deleteProfile(id: string): void {
  // id — UUID из имени файла; другое не принимаем, чтобы не удалить лишнего.
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Профиль не найден')
  if (active?.id === id) closeProfile()
  const file = profilePath(id)
  if (!existsSync(file)) throw new Error('Профиль не найден')
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true })
}

/** Фото пилота длиннее этого не храним: интерфейс сам уменьшает картинку. */
const MAX_PHOTO_CHARS = 600_000

export function getPhoto(): string | null {
  return (activeDb().prepare('SELECT photo FROM profile WHERE id = 1').get() as { photo: string | null }).photo
}

export function setPhoto(photo: string | null): void {
  if (photo !== null && (!photo.startsWith('data:image/') || photo.length > MAX_PHOTO_CHARS)) throw new Error('Фото — картинка до 450 КБ')
  activeDb().prepare('UPDATE profile SET photo = ? WHERE id = 1').run(photo)
}

/** База открытого профиля; без профиля летать и вести бортжурнал нельзя. */
export function activeDb(): Db {
  if (!active) throw new Error('Профиль не открыт')
  return active.db
}

export function currentProfile(): ProfileSummary | null {
  return active ? readSummary(active.id, active.db) : null
}
