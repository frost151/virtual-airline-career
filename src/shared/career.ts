import type { AircraftCategory, AircraftType } from './world'

/** Правила карьеры пилота: звания, допуски, зарплата. Всё в USD. */

export type RankId = 'trainee' | 'fo' | 'captain' | 'senior_captain' | 'instructor'

export interface Rank {
  id: RankId
  name: string
  /** Налёт для повышения. Рассчитан на реальное время полётов в симуляторе, поэтому скромнее настоящего. */
  minHours: number
  /** Множитель к базовой ставке (стажёр = 1). */
  payMult: number
}

export const RANKS: Rank[] = [
  { id: 'trainee', name: 'Стажёр', minHours: 0, payMult: 1 },
  { id: 'fo', name: 'Второй пилот', minHours: 10, payMult: 1.8 },
  { id: 'captain', name: 'Командир ВС', minHours: 60, payMult: 3 },
  { id: 'senior_captain', name: 'Старший командир', minHours: 200, payMult: 4.2 },
  { id: 'instructor', name: 'Пилот-инструктор', minHours: 500, payMult: 6 }
]

export const rankById = (id: RankId): Rank => RANKS.find((r) => r.id === id)!
export const rankIndex = (id: RankId): number => RANKS.findIndex((r) => r.id === id)

/** Ставка стажёра за блок-час; у остальных званий — умноженная на payMult. */
export const BASE_RATE: Record<AircraftCategory, number> = {
  turboprop: 45,
  regional: 55,
  narrowbody: 70,
  widebody: 95,
  freighter: 85,
  bizjet: 80
}

/** Ежемесячный оклад стажёра в штате; у остальных званий — умноженный на payMult. */
export const MONTHLY_BASE = 1500

export const monthlySalary = (rank: RankId): number => MONTHLY_BASE * rankById(rank).payMult

export const STARTING_CASH = 30_000

/**
 * «Начать полёт» по брони: сколько минут до вылета игрок берёт на подготовку.
 * Часы мира перематываются так, чтобы вылет был ровно через это время.
 */
export const PREP_MINUTES = [10, 30, 60, 120] as const
/** Бонус к зарплате за рейс с оценкой ≥ 90. */
export const QUALITY_BONUS = 0.1

/** Группы допусков: один допуск покрывает всё семейство. */
export interface RatingGroup {
  id: string
  name: string
  price: number
}

const FAMILY_RULES: { test: (t: AircraftType) => boolean; group: RatingGroup }[] = [
  { test: (t) => ['A319', 'A320', 'A321', 'A20N', 'A21N', 'ACJ319'].includes(t.id), group: { id: 'A320', name: 'Airbus A320 family', price: 20_000 } },
  { test: (t) => ['BCS1', 'BCS3'].includes(t.id), group: { id: 'A220', name: 'Airbus A220', price: 18_000 } },
  { test: (t) => ['A332', 'A333', 'A339', 'A332F'].includes(t.id), group: { id: 'A330', name: 'Airbus A330', price: 32_000 } },
  { test: (t) => ['A359', 'A35K', 'A359ULR'].includes(t.id), group: { id: 'A350', name: 'Airbus A350', price: 38_000 } },
  { test: (t) => t.id === 'A388', group: { id: 'A380', name: 'Airbus A380', price: 45_000 } },
  { test: (t) => ['B736', 'B737', 'B738', 'B739', 'B38M', 'B39M', 'BBJ', 'B738F'].includes(t.id), group: { id: 'B737', name: 'Boeing 737', price: 20_000 } },
  { test: (t) => ['B752', 'B752F'].includes(t.id), group: { id: 'B757', name: 'Boeing 757', price: 22_000 } },
  { test: (t) => ['B763', 'B763F'].includes(t.id), group: { id: 'B767', name: 'Boeing 767', price: 28_000 } },
  { test: (t) => ['B772', 'B77L', 'B77W', 'B77F'].includes(t.id), group: { id: 'B777', name: 'Boeing 777', price: 38_000 } },
  { test: (t) => ['B788', 'B789', 'B78X'].includes(t.id), group: { id: 'B787', name: 'Boeing 787', price: 38_000 } },
  { test: (t) => ['B748', 'B748F', 'B744F'].includes(t.id), group: { id: 'B747', name: 'Boeing 747', price: 42_000 } },
  { test: (t) => ['E170', 'E175', 'E190', 'E195'].includes(t.id), group: { id: 'EJET', name: 'Embraer E-Jet', price: 14_000 } },
  { test: (t) => ['E290', 'E295'].includes(t.id), group: { id: 'EJET2', name: 'Embraer E-Jet E2', price: 15_000 } },
  { test: (t) => ['AT46', 'AT76'].includes(t.id), group: { id: 'ATR', name: 'ATR 42/72', price: 9_000 } },
  { test: (t) => t.id === 'DH8D', group: { id: 'DH8', name: 'Dash 8-400', price: 10_000 } },
  { test: (t) => ['CRJ7', 'CRJ9'].includes(t.id), group: { id: 'CRJ', name: 'Bombardier CRJ', price: 12_000 } },
  { test: (t) => t.id === 'C750', group: { id: 'C750', name: 'Cessna Citation X', price: 15_000 } }
]

/** Допуск для типа; у редких типов (Ту-204, Ан-124…) — отдельный допуск на сам тип. */
export function ratingFor(t: AircraftType): RatingGroup {
  const rule = FAMILY_RULES.find((r) => r.test(t))
  if (rule) return rule.group
  const price = t.category === 'widebody' || t.mtowKg > 150_000 ? 35_000 : 18_000
  return { id: t.id, name: t.name, price }
}

/** Минимальный налёт в игре для приёма в авиакомпанию — зависит от её престижа. */
export function hireRequirementHours(reputation: number, archetype: string): number {
  if (reputation >= 80) return 50
  if (reputation >= 70) return 15
  if (archetype === 'cargo') return 20
  return 0
}

export function hourlyRate(category: AircraftCategory, rank: RankId): number {
  return BASE_RATE[category] * rankById(rank).payMult
}

export interface PilotStats {
  hours: number
  flights: number
  avgScore: number
}

/**
 * Следующее звание, если хватает налёта (повышение — по одному шагу).
 * Для пилота-инструктора дополнительно нужен сертификат TRI.
 */
export function nextRankIfEligible(current: RankId, stats: PilotStats, hasTri = false): RankId | null {
  const next = RANKS[rankIndex(current) + 1]
  if (!next) return null
  if (next.id === 'instructor' && !hasTri) return null
  return stats.hours >= next.minHours ? next.id : null
}

/** Стажёров на широкофюзеляжные самолёты не ставят. */
export function canFlyCategory(rank: RankId, category: AircraftCategory): boolean {
  if (category === 'widebody') return rankIndex(rank) >= rankIndex('fo')
  return true
}
