import type { Airport } from '@shared/world'

const R_KM = 6371
const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2))
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1))
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Точка на расстоянии distKm по курсу bearing от исходной. */
export function destinationPoint(lat: number, lon: number, bearing: number, distKm: number): [number, number] {
  const d = distKm / R_KM
  const b = rad(bearing)
  const la1 = rad(lat)
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b))
  const lo2 = rad(lon) + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2))
  return [deg(la2), ((deg(lo2) + 540) % 360) - 180]
}

/** Ближайший аэропорт в радиусе maxKm (по умолчанию 8 км — в пределах территории крупного аэропорта). */
export function nearestAirport(airports: Iterable<Airport>, lat: number, lon: number, maxKm = 8): Airport | null {
  let best: Airport | null = null
  let bestKm = maxKm
  for (const a of airports) {
    // Грубый отсев по широте/долготе, чтобы не считать синусы для всех 8000 аэропортов.
    if (Math.abs(a.lat - lat) > 0.2 || Math.abs(a.lon - lon) > 0.4) continue
    const km = distanceKm(lat, lon, a.lat, a.lon)
    if (km < bestKm) {
      best = a
      bestKm = km
    }
  }
  return best
}
