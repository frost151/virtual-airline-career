import type { AircraftCategory, AirlineArchetype, OneWayLeg } from './world'

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
  /** Тип самолёта, назначенный владельцем (без поля — выбирается по флоту). */
  type?: string
  /** Наценка на этом рейсе (без поля — общая по компании). */
  fareMult?: number
  /** Номер первого рейса «туда», заданный владельцем (без поля — по порядку маршрутов). */
  num?: number
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
  /** Доля рейсов, отменённых из-за нехватки экипажей. */
  cancelled?: number
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
  /** Игрок владеет ею сейчас (false — компания потеряна при банкротстве и живёт дальше без него). */
  active: boolean
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
  staff: boolean
}

/** Штат компании, если персоналом управляет игрок. */
export interface Staff {
  pilots: number
  cabin: number
  /** Уровень зарплат к рынку, 0,8–1,3. */
  payLevel: number
  /** Уровень сервиса на борту, 0,8–1,3. */
  service: number
  /** Новички на переподготовке: выйдут в рейсы к readyAt. */
  training: { pilots: number; cabin: number; readyAt: number }[]
}

export const STAFF_LEVEL_MIN = 0.8
export const STAFF_LEVEL_MAX = 1.3

export interface StaffInfo extends Staff {
  /** Сколько нужно расписанию. */
  pilotsNeeded: number
  cabinNeeded: number
  /** Зарплата в месяц на одного (с налогами и соцпакетом), $. */
  pilotSalary: number
  cabinSalary: number
  /** Фонд оплаты труда экипажей в месяц, $. */
  payroll: number
  /** Найм и переподготовка одного новичка, $. */
  hireCostPilot: number
  hireCostCabin: number
  /** Сколько людей уходит в месяц при нынешних зарплатах, %. */
  attritionPct: number
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
  /** Тип, который летает на маршруте сейчас (назначенный или выбранный по флоту). */
  typeId: string | null
  typeName: string | null
  /** Тип назначен владельцем (иначе — «Авто»). */
  typeAssigned: boolean
  /** Типы флота, которые могут летать по маршруту. */
  typeOptions: { id: string; name: string }[]
  /** Блок-часов в месяц на маршруте. */
  blockHours: number
  /** Номер первого рейса «туда» (без кода компании); следующие частоты +2, обратные +1. */
  flightNum: number
}

/** Рынок маршрута: конкуренты и прогноз своего рейса при разной наценке. */
export interface FarePreview {
  /** Спрос, пассажиров в сутки в одну сторону. */
  demand: number
  /** Наценка сейчас. */
  current: number
  /** У рейса своя наценка (иначе — общая по компании). */
  own: boolean
  competitors: {
    icao: string
    iata: string
    name: string
    archetype: AirlineArchetype
    freq: number
    typeName: string
    /** Средний тариф в одну сторону за прошлый месяц, $. */
    fare: number
    lf: number
    reputation: number
  }[]
  /** Прогноз своего рейса: загрузка, тариф, пассажиров в сутки (в обе стороны), выручка и прибыль в месяц. */
  curve: { mult: number; lf: number; fare: number; paxPerDay: number; revenue: number; profit: number }[]
}

/** Советник по маршрутам: разбор нынешних рейсов и лучшие новые направления. */
export interface RouteAdvice {
  existing: {
    hub: string
    dest: string
    freq: number
    typeName: string
    /** Операционная прибыль в месяц: за прошлый месяц или прогноз, $. */
    profit: number
    lf: number
    verdict: 'keep' | 'more' | 'less' | 'replace' | 'close'
    reason: string
    /** Чем заменить самолёт (verdict = replace). */
    typeId?: string
  }[]
  suggestions: {
    hub: string
    dest: string
    km: number
    typeId: string
    typeName: string
    lf: number
    fare: number
    /** Прогноз операционной прибыли в месяц при одном рейсе в день, $. */
    profit: number
    competitors: number
    /** Хватает свободных часов этого типа. */
    fits: boolean
  }[]
  /** Свободные блок-часы по типам в месяц. */
  spare: { typeId: string; name: string; hours: number }[]
}

/** Будущий рейс: для формы «Открыть рейс». */
export interface RouteQuote {
  km: number
  /** Оценка спроса, пассажиров в сутки в одну сторону. */
  demand: number
  /** Сколько других компаний уже летает по этой паре. */
  competitors: number
  /** Такой рейс у компании уже есть. */
  exists: boolean
  /** Оба аэропорта принимают регулярные рейсы. */
  scheduled: boolean
  /** Самолёты флота; reason — почему тип не выполнит рейс (null — выполнит). */
  types: { id: string; name: string; rangeKm: number; reason: string | null }[]
}

export interface ManageState {
  icao: string
  iata: string
  name: string
  /** Рейсы в одну сторону, ждущие обратного. landed — самолёт уже стоит в аэропорту прилёта. */
  legs: (OneWayLeg & { typeName: string; landed: boolean })[]
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
  /** Загрузка флота по типам: у каждого типа свои самолёты. */
  typeHours: { typeId: string; name: string; needed: number; available: number }[]
  cash: number
  debt: number
  /** Ставка по долгу в месяц, %. */
  debtRatePct: number
  /** Сколько ещё можно занять, $. */
  borrowLimit: number
  /** Персонал: null — экипажами управляет заместитель, расходы считаются по налёту. */
  staff: StaffInfo | null
  status: AirlineStatus
  /** При каком долге банк начнёт банкротство, $. */
  bankruptcyDebt: number
  /** Компанию основал игрок. */
  founded: boolean
  /** Поручительство игрока по долгам компании. */
  guaranteed: boolean
  /** Доля игрока, %. */
  pct: number
  /** Выход на биржу: null — уже на бирже или компания не своя. */
  ipo: IpoOffer | null
  ceoSalary: number
  /** Больше совет директоров не утвердит, $ в месяц. */
  ceoSalaryCap: number
  /** Доля квартальной прибыли на дивиденды, %. */
  payoutPct: number
  /** Сколько можно выплачивать, чтобы у компании остался резерв, %; null — квартал убыточный. */
  payoutRecommended: number | null
  last: AirlineFinance | null
  history: AirlineHistoryPoint[]
}

/** Выставленные на биржу акции своей компании. */
export interface Offering {
  /** Сколько процентов компании выставлено. */
  pct: number
  /** Сколько из них уже раскупили. */
  sold: number
  /** Сколько получила компания (после комиссии), $. */
  proceeds: number
  startedAt: number
}

export interface IpoOffer {
  /** Почему сейчас нельзя выставить акции (null — можно). */
  blocked: string | null
  /** Компания уже на бирже (следующие выпуски — дополнительные). */
  listed: boolean
  /** Капитализация или оценка компании, $. */
  valuation: number
  /** Сколько процентов можно выставить, чтобы у игрока осталось 51%. */
  maxPct: number
  /** Комиссия банков, %. */
  feePct: number
  /** Какую долю выставленного инвесторы раскупят за месяц при нынешних дивидендах и росте, %. */
  appetitePct: number
  offering: Offering | null
}

export interface AirlineDetailEconomy {
  row: AirlineMarketRow
  history: AirlineHistoryPoint[]
  routes: RouteState[]
}

// ——— борта и карты ———

/** Рейс в воздухе для карты полётов. */
export interface LiveFlight {
  id: string
  airline: string
  iata: string
  name: string
  flightNo: string
  /** Регистрация борта. */
  reg: string | null
  typeId: string
  typeName: string
  /** Категория самолёта — от неё силуэт и размер на карте. */
  category: AircraftCategory
  dep: string
  arr: string
  depCity: string
  arrCity: string
  depAt: number
  arrAt: number
  /** Координаты вылета и прилёта [lat, lon]. */
  from: [number, number]
  to: [number, number]
}

/** Где сейчас борт компании. */
export interface TailPosition {
  reg: string
  typeId: string
  typeName: string
  status: 'air' | 'ground'
  /** Аэропорт, где стоит самолёт (на земле). */
  at: string | null
  flight: LiveFlight | null
  next: { flightNo: string; dep: string; arr: string; depAt: number } | null
  /** Улетел рейсом в одну сторону и ждёт обратного. */
  stranded: boolean
}

/** Маршрутная сеть для карты. */
export interface NetworkMap {
  icao: string
  iata: string
  name: string
  hubs: string[]
  airports: Record<string, { lat: number; lon: number; name: string; iata: string | null }>
  routes: { hub: string; dest: string; freq: number; oneWay?: boolean }[]
}
