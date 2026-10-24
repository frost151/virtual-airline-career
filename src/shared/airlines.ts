import type { AirlineArchetype } from './world'

/** Экономика авиакомпаний: общие типы для main и интерфейса. */

export interface RouteState {
  hub: string
  dest: string
  /** Рейсов в день в одну сторону. */
  freq: number
  /** Загрузка за прошлый месяц, 0–1. */
  lf: number
  /** Средний тариф в одну сторону, $. */
  fare: number
  /** Прибыль маршрута за прошлый месяц, $. */
  profit: number
  /** Месяцев подряд в убытке — для решения о закрытии. */
  badMonths: number
}

export type AirlineStatus = 'ok' | 'distress' | 'restarted'

export interface AirlineFinance {
  revenue: number
  costs: number
  profit: number
  pax: number
  /** Средняя загрузка по сети. */
  lf: number
  /** Использование флота: блок-часы, нужные расписанию, к доступным. */
  utilization: number
  costBreakdown: Record<string, number>
}

export interface AirlineMarketRow {
  icao: string
  iata: string
  name: string
  country: string
  national: boolean
  status: AirlineStatus
  reputation: number
  fleetSize: number
  routes: number
  cash: number
  debt: number
  sharePrice: number
  /** Изменение цены акции за месяц, %. */
  shareChange: number
  last: AirlineFinance | null
}

export interface AirlineHistoryPoint {
  month: number
  revenue: number
  profit: number
  lf: number
  sharePrice: number
  cash: number
}

/** Пакеты, которые можно купить в существующей компании. 51% — контрольный. */
export const STAKE_LEVELS = [10, 25, 51] as const
export const CONTROL_PCT = 51
/** В национальном перевозчике контроль остаётся у государства. */
export const FLAG_CARRIER_MAX_PCT = 25

/** Доля игрока в авиакомпании. */
export interface Stake {
  icao: string
  name: string
  pct: number
  /** Сколько заплачено за долю всего, $. */
  cost: number
  /** Сколько стоит доля по текущей цене акций, $. */
  value: number
  /** Дивиденды, полученные по доле за всё время (после налога), $. */
  dividends: number
  control: boolean
  /** Компанию основал сам игрок. */
  founded: boolean
  acquiredAt: number
}

export interface StakeQuote {
  /** До какой доли докупаем. */
  pct: number
  /** Цена докупки с надбавкой за пакет, $. */
  price: number
  /** Почему нельзя купить (null — можно). */
  blocked: string | null
}

export interface StakeOffer {
  stake: Stake | null
  quotes: StakeQuote[]
  /** Сколько получит игрок, если продаст долю сейчас, $. */
  saleValue: number
  /** Капитализация компании, $. */
  marketCap: number
}

// ——— своя авиакомпания ———

/** Стартовый капитал профиля «Владелец», млн $. */
export const OWNER_CAPITAL_OPTIONS = [2, 5, 20, 100] as const

export interface FoundAirlineInput {
  name: string
  icao: string
  iata: string
  callsign: string
  archetype: AirlineArchetype
  hub: string
  typeId: string
  /** Первые направления из базы (1–3). */
  destinations: string[]
  /** Сколько своих денег вкладывает игрок, $. */
  contribution: number
  /** Кредит банка, $. */
  loan: number
  /** Личное поручительство по кредиту: ставка ниже, но при банкротстве долг переходит на игрока. */
  guaranteed: boolean
  /** Логотип (data URL) или null — буквенный значок. */
  logo: string | null
}

export interface FoundQuote {
  /** Сертификат эксплуатанта, регистрация, первые офисы, $. */
  setupFee: number
  /** Залог за лизинг самолёта (3 месяца), $. */
  deposit: number
  monthlyLease: number
  /** Минимум денег на счёте после старта, $. */
  reserve: number
  /** Сколько денег будет у компании в первый день, $. */
  cashAfter: number
  maxLoan: number
  /** Ставка по кредиту в месяц, %. */
  loanRatePct: number
  /** Что мешает основать (пусто — можно). */
  errors: string[]
}

export interface FoundTypeOption {
  id: string
  name: string
  category: string
  seats: number
  cargoKg: number
  rangeKm: number
  monthlyLease: number
  /** Цена покупки, $. */
  price: number
}

export interface DestinationOption {
  icao: string
  label: string
  km: number
  /** Оценка спроса, пассажиров в сутки в одну сторону. */
  demand: number
  /** Сколько компаний уже летает по этой паре. */
  competitors: number
}

export interface PlayerAirline {
  icao: string
  iata: string
  name: string
  callsign: string
  country: string
  archetype: AirlineArchetype
  hub: string
  logo: string | null
  foundedAt: number
}

// ——— управление компанией ———

/** Разделы, где решения может принимать ИИ-заместитель (true) или сам игрок (false). */
export interface Autopilot {
  fleet: boolean
  routes: boolean
  fares: boolean
}

export interface Delivery {
  type: string
  count: number
  owned: boolean
  /** Когда самолёт войдёт в строй, мс UTC. */
  arriveAt: number
}

export const FARE_MULT_MIN = 0.7
export const FARE_MULT_MAX = 1.3

export interface FleetRow {
  typeId: string
  name: string
  count: number
  owned: number
  leased: number
  /** Лизинг в месяц за один самолёт, $. */
  monthlyLease: number
  /** Цена покупки нового (или типичного) самолёта, $. */
  price: number
  /** Сколько дадут при продаже своего, $. */
  salePrice: number
}

export interface ManagedRoute extends RouteState {
  km: number
  typeName: string | null
  /** Блок-часов в месяц на маршруте. */
  blockHours: number
}

export interface ManageState {
  icao: string
  name: string
  archetype: AirlineArchetype
  autopilot: Autopilot
  fareMult: number
  fleet: FleetRow[]
  deliveries: (Delivery & { name: string })[]
  routes: ManagedRoute[]
  /** Аэропорты, откуда можно открывать рейсы: базы и уже обслуживаемые города. */
  origins: string[]
  /** Самолёты, которые подходят компании, — для заказа. */
  types: FoundTypeOption[]
  /** Сколько блок-часов в месяц требует расписание и сколько даёт флот. */
  blockHoursNeeded: number
  blockHoursAvailable: number
  cash: number
  debt: number
  /** Ставка по долгу в месяц, %. */
  debtRatePct: number
  /** Сколько ещё можно занять, $. */
  borrowLimit: number
  ceoSalary: number
  /** Больше совет директоров не утвердит, $ в месяц. */
  ceoSalaryCap: number
  /** Доля квартальной прибыли на дивиденды, %. */
  payoutPct: number
  last: AirlineFinance | null
  history: AirlineHistoryPoint[]
}

export interface AirlineDetailEconomy {
  row: AirlineMarketRow
  history: AirlineHistoryPoint[]
  routes: RouteState[]
}
