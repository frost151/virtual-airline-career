import type {
  CarModel,
  Collectible,
  CountryParams,
  Course,
  GaAircraft,
  HousingOption,
  PricedCatalog,
  RestOption,
  SubscriptionOption
} from '@shared/lifestyle'
import type { EconomicCycle } from '@shared/economy'
import countriesJson from '../../../data/lifestyle/countries.json'
import carsJson from '../../../data/lifestyle/cars.json'
import catalogJson from '../../../data/lifestyle/catalog.json'

export const CARS = carsJson as CarModel[]
export const HOUSING = catalogJson.housing as HousingOption[]
export const GA_AIRCRAFT = catalogJson.aircraft as GaAircraft[]
export const REST = catalogJson.rest as RestOption[]
export const SUBSCRIPTIONS = catalogJson.subscriptions as SubscriptionOption[]
export const COURSES = catalogJson.education as Course[]
export const COLLECTIBLES = catalogJson.collectibles as Collectible[]

const COUNTRIES = countriesJson.countries as Record<string, CountryParams>
export const countryParams = (code: string | null): CountryParams => (code && COUNTRIES[code]) || countriesJson.default

/** Множитель «местных» цен услуг относительно эталона ($1 500 в месяц на жизнь). */
export const serviceFactor = (p: CountryParams): number => Math.min(1.6, Math.max(0.45, p.col / 1500))

export const familyLivingFactor = (partner: boolean, children: number): number => 1 + (partner ? 0.7 : 0) + 0.45 * children
export const familyTripFactor = (partner: boolean, children: number): number => 1 + (partner ? 0.8 : 0) + 0.5 * children
export const roomsNeeded = (children: number): number => 1 + Math.ceil(children / 2)

/** Престиж машины растёт логарифмически с ценой: «Гранта» ≈ 2, S-класс ≈ 33, Chiron ≈ 73. */
export const carPrestige = (price: number): number => Math.max(0, Math.min(80, Math.round(Math.log10(price / 8000) * 28)))

export function carPrice(car: CarModel, country: string | null, level: number): number {
  const p = countryParams(country)
  const duty = car.origin === country ? 1 : p.carImport
  return Math.round((car.price * duty * level) / 100) * 100
}

/** Страховка + ТО + топливо в месяц. */
export function carMonthly(car: CarModel, country: string | null, level: number): number {
  const p = countryParams(country)
  return Math.round((120 + car.price * 0.006 + (car.electric ? 60 : 150)) * serviceFactor(p) * level)
}

export const housingRent = (h: HousingOption, country: string | null, level: number): number =>
  Math.round(h.rent * countryParams(country).housing * level)

export const housingPrice = (h: HousingOption, country: string | null, level: number): number =>
  Math.round((h.price * countryParams(country).housing * level) / 1000) * 1000

/** Ставки по годам: ипотека по стране, автокредит дороже, вклад зависит от фазы экономики. */
export function rates(country: string | null, cycle: EconomicCycle) {
  const m = countryParams(country).mortgage
  const deposit = Math.max(1, m * 0.6 + (cycle === 'boom' ? 1 : cycle === 'recession' ? -1 : 0))
  return { mortgage: m, auto: m + 4, aircraft: m + 2, deposit: +deposit.toFixed(1), bonds: +(deposit + 1.5).toFixed(1) }
}

export const MEDICAL_BASE = 400

export function pricedCatalog(country: string | null, level: number, cycle: EconomicCycle, partner: boolean, children: number): PricedCatalog {
  const p = countryParams(country)
  const sf = serviceFactor(p)
  const trip = familyTripFactor(partner, children)
  return {
    country,
    cars: CARS.map((c) => ({
      ...c,
      localPrice: carPrice(c, country, level),
      monthly: carMonthly(c, country, level),
      prestige: carPrestige(c.price),
      imported: c.origin !== country
    })),
    housing: HOUSING.map((h) => ({ ...h, localRent: housingRent(h, country, level), localPrice: housingPrice(h, country, level) })),
    aircraft: GA_AIRCRAFT.map((a) => ({ ...a, localPrice: Math.round(a.price * level), localMonthly: Math.round(a.monthly * level) })),
    rest: REST.map((r) => ({ ...r, localPrice: Math.round(r.price * sf * level * (r.family ? trip : 1)) })),
    subscriptions: SUBSCRIPTIONS.map((s) => ({ ...s, localMonthly: Math.round(s.monthly * sf * level) })),
    education: COURSES.map((c) => ({ ...c, localPrice: Math.round(c.price * level) })),
    collectibles: COLLECTIBLES.map((c) => ({ ...c, localPrice: Math.round(c.price * level) })),
    rates: rates(country, cycle),
    medicalCost: Math.round(MEDICAL_BASE * sf * level)
  }
}

/** Ежемесячный аннуитетный платёж. */
export function annuity(principal: number, annualRatePct: number, months: number): number {
  const r = annualRatePct / 100 / 12
  if (r === 0) return principal / months
  return (principal * r) / (1 - (1 + r) ** -months)
}
