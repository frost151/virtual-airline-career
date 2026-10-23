import { expect, it } from 'vitest'
import { openDatabase } from './db'
import { saveSettings } from './settings'
import * as career from './career/career'
import * as cheats from './cheats'
import { lifeState } from './lifestyle/life'

it('читы работают только во включённом режиме', () => {
  const db = openDatabase(':memory:')
  const iso = new Date().toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'pilot', ?, ?, ?)`
  ).run(iso, iso, iso)
  career.hire(db, { kind: 'airline', employerId: 'SVR', base: 'USSS', ratingId: 'A320' })

  expect(() => cheats.cheatMoney(db, 1000)).toThrow(/выключен/)
  saveSettings(db, { cheatMode: true })

  cheats.cheatMoney(db, 1_000_000)
  expect(career.pilotState(db).cash).toBe(1_030_000)

  cheats.cheatHours(db, 60)
  const s = career.pilotState(db)
  expect(s.stats.hours).toBe(60)
  expect(s.rank).toBe('captain')

  db.prepare('UPDATE pilot SET fatigue = 95 WHERE id = 1').run()
  cheats.cheatRest(db)
  expect(lifeState(db).fitToFly.ok).toBe(true)

  cheats.cheatTeleport(db, 'egll')
  expect(career.pilotState(db).location).toBe('EGLL')
  expect(() => cheats.cheatTeleport(db, 'XXXX')).toThrow()

  cheats.cheatRating(db, 'B777')
  expect(career.pilotState(db).ratings.map((r) => r.id)).toContain('B777')
})
