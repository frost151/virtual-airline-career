// Собирает data/airports.json из открытой базы OurAirports (public domain).
// Запуск: node scripts/build-airports.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = 'https://davidmegginson.github.io/ourairports-data'

/** Минимальный CSV-парсер с поддержкой кавычек. */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [header, ...data] = rows
  return data.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

async function load(name) {
  const res = await fetch(`${BASE}/${name}`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return parseCsv(await res.text())
}

const PAVED = /^(asp|con|bit|pem|tar|asph|conc|paved)/i
const TYPE = { large_airport: 'large', medium_airport: 'medium', small_airport: 'small' }

const [airports, runways] = await Promise.all([load('airports.csv'), load('runways.csv')])

// Самая длинная действующая полоса аэропорта, м; отдельно — с твёрдым покрытием.
const longest = new Map()
for (const r of runways) {
  if (r.closed === '1') continue
  const m = Math.round(Number(r.length_ft) * 0.3048)
  if (!m) continue
  const cur = longest.get(r.airport_ident) ?? { any: 0, paved: 0 }
  cur.any = Math.max(cur.any, m)
  if (PAVED.test(r.surface)) cur.paved = Math.max(cur.paved, m)
  longest.set(r.airport_ident, cur)
}

const result = []
for (const a of airports) {
  const type = TYPE[a.type]
  if (!type) continue
  const icao = a.icao_code || a.gps_code
  if (!/^[A-Z]{4}$/.test(icao)) continue
  const rwy = longest.get(a.ident) ?? { any: 0, paved: 0 }
  const scheduled = a.scheduled_service === 'yes'
  // Мелкие аэродромы оставляем только с регулярными рейсами или с твёрдой ВПП от 1200 м (бизнес-авиация).
  if (type === 'small' && !scheduled && rwy.paved < 1200) continue
  result.push({
    icao,
    iata: a.iata_code || null,
    name: a.name,
    city: a.municipality || null,
    country: a.iso_country,
    lat: Number(Number(a.latitude_deg).toFixed(5)),
    lon: Number(Number(a.longitude_deg).toFixed(5)),
    elevFt: a.elevation_ft ? Number(a.elevation_ft) : 0,
    type,
    scheduled,
    rwyM: rwy.paved || rwy.any
  })
}

result.sort((x, y) => x.icao.localeCompare(y.icao))
mkdirSync('data', { recursive: true })
writeFileSync('data/airports.json', JSON.stringify(result))
const byType = result.reduce((acc, a) => ((acc[a.type] = (acc[a.type] ?? 0) + 1), acc), {})
console.log(`Аэропортов: ${result.length}`, byType)
