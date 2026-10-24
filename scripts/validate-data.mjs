// Проверяет целостность data/: коды аэропортов и типов, дальность маршрутов, длину ВПП.
// Запуск: node scripts/validate-data.mjs
import { readFileSync, readdirSync } from 'node:fs'

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
const airports = new Map(read('data/airports.json').map((a) => [a.icao, a]))
const types = new Map(read('data/aircraft-types.json').map((t) => [t.id, t]))

const errors = []
const warnings = []

const R = 6371
const rad = (d) => (d * Math.PI) / 180
function distanceKm(a, b) {
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const seenIcao = new Set()
const seenIata = new Set()
let airlineCount = 0
let routeCount = 0

for (const file of readdirSync('data/airlines').filter((f) => f.endsWith('.json'))) {
  for (const al of read(`data/airlines/${file}`)) {
    airlineCount++
    const tag = `${file} ${al.icao}`
    if (seenIcao.has(al.icao)) errors.push(`${tag}: дубликат ICAO`)
    if (seenIata.has(al.iata)) errors.push(`${tag}: дубликат IATA ${al.iata}`)
    seenIcao.add(al.icao)
    seenIata.add(al.iata)

    const fleet = al.fleet.map((f) => types.get(f.type))
    al.fleet.forEach((f, i) => !fleet[i] && errors.push(`${tag}: неизвестный тип ${f.type}`))
    const known = fleet.filter(Boolean)
    const paxOrAll = al.archetype === 'cargo' ? known : known.filter((t) => t.category !== 'freighter')
    const maxRange = Math.max(0, ...paxOrAll.map((t) => t.rangeKm))
    const minRwy = Math.min(...paxOrAll.map((t) => t.minRunwayM))

    for (const { hub, destinations } of al.network) {
      const h = airports.get(hub)
      if (!h) {
        errors.push(`${tag}: хаб ${hub} не найден`)
        continue
      }
      const seen = new Set()
      for (const d of destinations) {
        routeCount++
        const a = airports.get(d)
        if (!a) errors.push(`${tag}: аэропорт ${d} не найден`)
        else {
          if (d === hub) errors.push(`${tag}: ${hub} летает сам в себя`)
          const km = distanceKm(h, a)
          if (km > maxRange * 0.97) warnings.push(`${tag}: ${hub}-${d} ${Math.round(km)} км > дальности флота ${maxRange}`)
          if (a.rwyM && a.rwyM < minRwy * 0.75) warnings.push(`${tag}: ${d} ВПП ${a.rwyM} м коротка для флота`)
        }
        if (seen.has(d)) warnings.push(`${tag}: ${hub}-${d} повторяется`)
        seen.add(d)
      }
    }
  }
}

// Профили аддонов: типы должны быть в каталоге, у профиля на L-переменных — сами переменные.
const profiles = read('data/aircraft-profiles.json')
for (const p of profiles) {
  const tag = `aircraft-profiles.json ${p.id}`
  for (const t of [p.defaultType, ...p.types.map((x) => x.type)])
    if (!types.has(t)) errors.push(`${tag}: неизвестный тип ${t}`)
  if (p.lights === 'lvars' && !Object.keys(p.lvars ?? {}).length) errors.push(`${tag}: lights=lvars без lvars`)
  if (!p.match.length) errors.push(`${tag}: пустой match`)
}

for (const w of warnings) console.log('ПРЕДУПРЕЖДЕНИЕ', w)
for (const e of errors) console.log('ОШИБКА', e)
console.log(`Авиакомпаний: ${airlineCount}, маршрутов: ${routeCount}, профилей аддонов: ${profiles.length}, ошибок: ${errors.length}, предупреждений: ${warnings.length}`)
process.exit(errors.length ? 1 : 0)
