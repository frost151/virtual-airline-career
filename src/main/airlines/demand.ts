import type { AirlineArchetype, Airport } from '@shared/world'
import { airlines, airports } from '../world'
import { countryParams } from '../lifestyle/catalog'

/**
 * Спрос на перелёты и тарифы.
 * Гравитационная модель: поток между городами растёт с их «весом» и доходами и падает с расстоянием.
 */

/** Сколько авиакомпаний держат в аэропорту хаб — крупные хабы притягивают пассажиров. */
const hubCount = new Map<string, number>()
for (const al of airlines.values()) for (const n of al.network) hubCount.set(n.hub, (hubCount.get(n.hub) ?? 0) + 1)

const SIZE: Record<Airport['type'], number> = { large: 1, medium: 0.3, small: 0.08 }

export function airportWeight(icao: string): number {
  const a = airports.get(icao)
  if (!a) return 0.1
  return SIZE[a.type] * (1 + 0.6 * Math.min(4, hubCount.get(icao) ?? 0))
}

/** Доходы населения — по стоимости жизни страны. */
const income = (icao: string) => Math.min(1.6, Math.max(0.35, countryParams(airports.get(icao)?.country ?? null).col / 1500))

/** Калибровка: два крупных аэропорта-хаба в 1000 км ≈ 3 500 пассажиров в день в обе стороны. */
const K = 950

/**
 * Пассажиров в день в одну сторону между A и B.
 * season — сезонность месяца, demand — индекс спроса из фазы экономики.
 */
export function dailyDemand(a: string, b: string, km: number, season: number, demand: number): number {
  const dist = Math.pow(Math.max(km, 300) / 1000, -0.55)
  // Доходы влияют мягко: в бедных, но густонаселённых странах (Индия) летают много.
  return (K * airportWeight(a) * airportWeight(b) * Math.pow(income(a) * income(b), 0.25) * dist * season * demand) / 2
}

const ARCHETYPE_FARE: Record<AirlineArchetype, number> = { legacy: 0.93, lowcost: 0.58, leisure: 0.74, regional: 1.02, cargo: 1 }

/** Средний тариф в одну сторону (все классы вместе), $. Дальние перелёты дешевле за километр. */
export function averageFare(km: number, archetype: AirlineArchetype, lf: number, priceLevel: number): number {
  const base = 40 + 0.11 * Math.min(km, 1500) + 0.075 * Math.max(0, km - 1500)
  // Полные рейсы продаются дороже: последние места — по высоким тарифам.
  const yieldMgmt = 0.85 + 0.3 * Math.min(1, lf)
  return Math.round(base * ARCHETYPE_FARE[archetype] * yieldMgmt * priceLevel)
}

/** Выручка от груза: $ за кг на маршруте (средняя ставка). */
export const cargoRatePerKg = (km: number, priceLevel: number): number => (0.34 + 0.00026 * km) * priceLevel

/** Чувствительность к цене: лоукостеры отбирают пассажиров ценой. */
export const PRICE_APPEAL: Record<AirlineArchetype, number> = { legacy: 1, lowcost: 1.25, leisure: 1.05, regional: 0.95, cargo: 1 }

/** Себестоимость по типу компании: у лоукостеров дешевле экипажи, сборы и офис. */
export const COST_PROFILE: Record<AirlineArchetype, { overhead: number; ops: number }> = {
  legacy: { overhead: 0.27, ops: 1 },
  lowcost: { overhead: 0.15, ops: 0.78 },
  leisure: { overhead: 0.19, ops: 0.9 },
  regional: { overhead: 0.23, ops: 0.95 },
  cargo: { overhead: 0.17, ops: 1 }
}
