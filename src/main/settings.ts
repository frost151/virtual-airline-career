import type { Settings } from '@shared/types'
import type { Db } from './db'

const DEFAULTS: Settings = {
  simbriefUsername: '',
  payMultiplier: 1,
  demoCountsForCareer: false,
  cheatMode: false
}

export function getSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  return { ...DEFAULTS, ...stored }
}

export function saveSettings(db: Db, patch: Partial<Settings>): Settings {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULTS)) continue
    if (k === 'payMultiplier' && ![1, 2, 5, 10].includes(v as number)) throw new Error('Множитель: 1, 2, 5 или 10')
    stmt.run(k, JSON.stringify(v))
  }
  return getSettings(db)
}
