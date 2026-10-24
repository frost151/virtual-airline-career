import type { FlightRecord } from '@shared/sim'
import type { Db } from './db'
import type { FlightDraft } from './tracker/tracker'
import { worldNow } from './worldTime'

interface FlightRow {
  id: number
  source: FlightRecord['source']
  status: FlightRecord['status']
  departure: string | null
  arrival: string | null
  aircraft_title: string
  aircraft_type: string | null
  block_off_at: number | null
  takeoff_at: number | null
  landing_at: number | null
  block_on_at: number | null
  distance_km: number
  fuel_used_kg: number
  max_alt_ft: number
  landing_json: string | null
  score: number
  events_json: string
  track_json: string
  delay_code: string | null
  created_at: string
}

export function saveFlight(db: Db, d: FlightDraft): number {
  const res = db
    .prepare(
      `INSERT INTO flights (source, status, departure, arrival, aircraft_title, aircraft_type, block_off_at, takeoff_at,
        landing_at, block_on_at, distance_km, fuel_used_kg, max_alt_ft, landing_json, score, events_json, track_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      d.source,
      d.status,
      d.departure,
      d.arrival,
      d.aircraft?.title ?? 'Неизвестный самолёт',
      d.aircraft?.typeId ?? null,
      d.blockOffAt,
      d.takeoffAt,
      d.landingAt,
      d.blockOnAt,
      d.distanceKm,
      d.fuelUsedKg,
      d.maxAltFt,
      d.landing ? JSON.stringify(d.landing) : null,
      d.score,
      JSON.stringify(d.events),
      JSON.stringify(d.track),
      new Date(worldNow(db)).toISOString()
    )
  return Number(res.lastInsertRowid)
}

const toRecord = (r: FlightRow, withTrack: boolean): FlightRecord => ({
  id: r.id,
  source: r.source,
  status: r.status,
  departure: r.departure,
  arrival: r.arrival,
  aircraftTitle: r.aircraft_title,
  aircraftType: r.aircraft_type,
  blockOffAt: r.block_off_at,
  takeoffAt: r.takeoff_at,
  landingAt: r.landing_at,
  blockOnAt: r.block_on_at,
  distanceKm: r.distance_km,
  fuelUsedKg: r.fuel_used_kg,
  maxAltFt: r.max_alt_ft,
  landing: r.landing_json ? JSON.parse(r.landing_json) : null,
  score: r.score,
  events: JSON.parse(r.events_json),
  track: withTrack ? JSON.parse(r.track_json) : [],
  delayCode: r.delay_code,
  createdAt: r.created_at
})

/** Список без трека — он нужен только в карточке полёта. */
export function listFlights(db: Db): FlightRecord[] {
  const rows = db.prepare('SELECT * FROM flights ORDER BY id DESC').all() as unknown as FlightRow[]
  return rows.map((r) => toRecord(r, false))
}

export function getFlight(db: Db, id: number): FlightRecord {
  const row = db.prepare('SELECT * FROM flights WHERE id = ?').get(id) as unknown as FlightRow | undefined
  if (!row) throw new Error('Полёт не найден')
  return toRecord(row, true)
}
