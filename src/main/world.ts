import type { AircraftType, Airline, Airport } from '@shared/world'
import type { AirlineDetail, AirlineSummary, PlaceRef } from '@shared/types'
import airportsJson from '../../data/airports.json'
import typesJson from '../../data/aircraft-types.json'
import russiaCis from '../../data/airlines/russia-cis.json'
import europe from '../../data/airlines/europe.json'
import middleEastAfrica from '../../data/airlines/middle-east-africa.json'
import asiaPacific from '../../data/airlines/asia-pacific.json'
import americas from '../../data/airlines/americas.json'
import cargo from '../../data/airlines/cargo.json'

/** Статический мир: загружается один раз, общий для всех профилей. */
export const airports = new Map((airportsJson as Airport[]).map((a) => [a.icao, a]))
export const aircraftTypes = new Map((typesJson as AircraftType[]).map((t) => [t.id, t]))
export const airlines = new Map(
  ([...russiaCis, ...europe, ...middleEastAfrica, ...asiaPacific, ...americas, ...cargo] as Airline[]).map((a) => [a.icao, a])
)

/** Компании, основанные игроком в открытом профиле: регистрируются в airlines при открытии. */
export const playerAirlineIds = new Set<string>()

const destinationsOf = (al: Airline) => new Set(al.network.flatMap((n) => n.destinations))

export function listAirlines(): AirlineSummary[] {
  return [...airlines.values()].map((al) => ({
    icao: al.icao,
    iata: al.iata,
    name: al.name,
    country: al.country,
    archetype: al.archetype,
    reputation: al.reputation,
    fleetSize: al.fleet.reduce((s, f) => s + f.count, 0),
    hubs: al.network.map((n) => n.hub),
    destinations: destinationsOf(al).size
  }))
}

export function place(code: string): PlaceRef {
  const a = airports.get(code)
  return { icao: code, iata: a?.iata ?? null, name: a?.name ?? code, city: a?.city ?? null, country: a?.country ?? '' }
}

export const places = (codes: string[]): Record<string, PlaceRef> => Object.fromEntries(codes.map((c) => [c, place(c)]))

export function getAirline(icao: string): AirlineDetail {
  const al = airlines.get(icao)
  if (!al) throw new Error(`Авиакомпания ${icao} не найдена`)
  return {
    ...al,
    fleet: al.fleet.map((f) => ({ ...f, name: aircraftTypes.get(f.type)?.name ?? f.type })),
    network: al.network.map((n) => ({ hub: place(n.hub), destinations: n.destinations.map(place) }))
  }
}
