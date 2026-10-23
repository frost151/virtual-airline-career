import type { ScheduledFlight } from '@shared/types'
import type { AircraftType, Airline } from '@shared/world'
import { between, hashString, seededRng } from '@shared/random'
import { aircraftTypes, airports } from '../world'
import { distanceKm } from '../tracker/geo'

const DAY_MS = 86_400_000
/** Время на руление, набор и снижение сверх чистого крейсерского времени. */
const BLOCK_OVERHEAD_MIN = 30

const roundTo5 = (min: number) => Math.ceil(min / 5) * 5

export function blockMinutes(type: AircraftType, km: number): number {
  return roundTo5((km / (type.cruiseKt * 1.852)) * 60 + BLOCK_OVERHEAD_MIN)
}

function turnaroundMin(t: AircraftType): number {
  if (t.category === 'widebody' || t.category === 'freighter') return 100
  if (t.category === 'turboprop' || t.category === 'regional') return 35
  return 50
}

/** Тип под маршрут: хватает дальности и полосы, по размеру подходит к расстоянию. */
export function pickType(al: Airline, km: number, dep: string, arr: string, rng: () => number): AircraftType | null {
  const rwy = Math.min(airports.get(dep)?.rwyM || 99999, airports.get(arr)?.rwyM || 99999)
  const candidates = al.fleet
    .map((f) => ({ t: aircraftTypes.get(f.type)!, count: f.count }))
    .filter(({ t }) => t && (al.archetype === 'cargo') === (t.category === 'freighter'))
    .filter(({ t }) => t.rangeKm >= km * 1.05 && t.minRunwayM <= rwy * 1.15)
  if (!candidates.length) return null

  const weighted = candidates.map(({ t, count }) => {
    let w = count
    if (t.category === 'widebody' && km < 3000) w *= 0.03
    if ((t.category === 'turboprop' || t.category === 'regional') && km < 1500) w *= 2
    if ((t.category === 'turboprop' || t.category === 'regional') && km > 2500) w *= 0.2
    return { t, w }
  })
  const total = weighted.reduce((s, x) => s + x.w, 0)
  let r = rng() * total
  for (const x of weighted) {
    r -= x.w
    if (r <= 0) return x.t
  }
  return weighted[weighted.length - 1].t
}

export function frequency(al: Airline, km: number, dest: string): number {
  if (km > 7000) return 1
  const large = airports.get(dest)?.type === 'large'
  if (al.archetype === 'cargo') return 1
  if (large && km < 3000) return al.archetype === 'legacy' ? 3 : 2
  return large ? 2 : 1
}

const cache = new Map<string, ScheduledFlight[]>()

/**
 * Расписание авиакомпании на сутки (рейсы, вылетающие из хабов в эти UTC-сутки, и обратные к ним).
 * Номера и время стабильны изо дня в день; загрузка меняется по дням.
 */
export function airlineDaySchedule(al: Airline, dayStart: number): ScheduledFlight[] {
  const key = `${al.icao}|${dayStart}|${al.version ?? 0}`
  const hit = cache.get(key)
  if (hit) return hit

  const routes = al.network
    .flatMap((n) => n.destinations.map((d) => ({ hub: n.hub, dest: d, live: n })))
    .sort((a, b) => hashString(`${a.hub}${a.dest}`) - hashString(`${b.hub}${b.dest}`))

  const out: ScheduledFlight[] = []
  const weekday = new Date(dayStart).getUTCDay()

  routes.forEach(({ hub, dest, live }, i) => {
    const h = airports.get(hub)
    const d = airports.get(dest)
    if (!h || !d) return
    const km = distanceKm(h.lat, h.lon, d.lat, d.lon)
    // Живая сеть (экономика в профиле) задаёт частоты; иначе — эвристика по размеру аэропорта.
    const freq = live.freq?.[dest] ?? frequency(al, km, dest)
    if (freq <= 0) return
    const routeLf = live.lf?.[dest]
    const avgFare = live.fare?.[dest] ?? null
    // Грузовые и сверхдальние рейсы — не каждый день.
    if ((al.archetype === 'cargo' || km > 9000) && hashString(`${al.icao}${hub}${dest}${weekday}`) % 7 >= 5) return

    for (let k = 0; k < freq; k++) {
      const rng = seededRng(`${al.icao}|${hub}|${dest}|${k}`)
      const loadRng = seededRng(`${al.icao}|${hub}|${dest}|${k}|${dayStart}`)
      const type = pickType(al, km, hub, dest, rng)
      if (!type) return

      // Местное время вылета 06:00–22:00, разнесённое по частотам; переводим в UTC по долготе хаба.
      const slot = 960 / freq
      const localMin = 360 + k * slot + Math.floor(rng() * Math.max(30, slot - 60))
      const utcMin = Math.round(localMin - (h.lon / 15) * 60)
      const depAt = dayStart + roundTo5(utcMin) * 60_000
      const block = blockMinutes(type, km)
      const num = 100 + i * 6 + k * 2
      const base = { airline: al.icao, distanceKm: Math.round(km), typeId: type.id, blockMin: block }

      // Загрузка — из модели спроса за прошлый месяц с разбросом по рейсам; без экономики — случайная.
      const lfFor = (lo: number, hi: number) =>
        routeLf !== undefined ? Math.min(1, Math.max(0.2, routeLf * between(loadRng, 0.88, 1.12))) : between(loadRng, lo, hi)
      const load = () =>
        type.category === 'freighter'
          ? { pax: 0, cargoKg: Math.round(type.cargoKg * lfFor(0.55, 0.95)), avgFare }
          : {
              pax: Math.round(type.seats * lfFor(0.62, 0.96)),
              cargoKg: Math.round(type.cargoKg * between(loadRng, 0.15, 0.7)),
              avgFare
            }

      out.push({
        ...base,
        ...load(),
        id: `${al.icao}${num}-${dayStart}`,
        flightNo: `${al.iata}${num}`,
        callsign: `${al.icao}${num}`,
        dep: hub,
        arr: dest,
        depAt,
        arrAt: depAt + block * 60_000
      })
      const backDep = depAt + (block + turnaroundMin(type)) * 60_000
      out.push({
        ...base,
        ...load(),
        id: `${al.icao}${num + 1}-${dayStart}`,
        flightNo: `${al.iata}${num + 1}`,
        callsign: `${al.icao}${num + 1}`,
        dep: dest,
        arr: hub,
        depAt: roundTo5(backDep / 60_000) * 60_000,
        arrAt: roundTo5(backDep / 60_000) * 60_000 + block * 60_000
      })
    }
  })

  if (cache.size > 200) cache.clear()
  cache.set(key, out)
  return out
}

export const utcDayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS

/** Рейсы авиакомпании из аэропорта, вылетающие в окне [from, to). */
export function departuresFrom(al: Airline, airport: string, from: number, to: number): ScheduledFlight[] {
  const result: ScheduledFlight[] = []
  for (let day = utcDayStart(from) - DAY_MS; day <= utcDayStart(to); day += DAY_MS) {
    for (const f of airlineDaySchedule(al, day)) {
      if (f.dep === airport && f.depAt >= from && f.depAt < to) result.push(f)
    }
  }
  return result.sort((a, b) => a.depAt - b.depAt)
}

export function findScheduledFlight(al: Airline, id: string): ScheduledFlight | null {
  const day = Number(id.split('-').pop())
  return airlineDaySchedule(al, day).find((f) => f.id === id) ?? null
}
