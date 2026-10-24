import type { Airline, AirlineArchetype } from './world'
import type { FlightRecord, FlightSource, SimConnectionStatus, SimDiagnostics, TrackerState } from './sim'
import type { PilotStats, RankId } from './career'
import type { CatchUpReport, MacroOverview } from './economy'
import type { Family, InvestmentKind, LifeState, PricedCatalog } from './lifestyle'
import type {
  AirlineDetailEconomy,
  AirlineMarketRow,
  Autopilot,
  DestinationOption,
  FoundAirlineInput,
  FoundQuote,
  FoundTypeOption,
  ManageState,
  PlayerAirline,
  Stake,
  StakeOffer
} from './airlines'

export type GameMode = 'pilot' | 'owner'

/** Вариант старта в режиме владельца. */
export type OwnerStart = 'new' | 'existing'

export interface ProfileSummary {
  id: string
  name: string
  pilotName: string
  mode: GameMode
  /** Момент создания мира (UTC, ISO 8601). Мир живёт с этой точки. */
  worldStartUtc: string
  /** До какого момента мир уже просчитан (UTC, ISO 8601). */
  lastSimulatedUtc: string
}

export interface CreateProfileInput {
  name: string
  pilotName: string
  mode: GameMode
  ownerStart?: OwnerStart
  /** Стартовый капитал профиля «Владелец», млн $ (OWNER_CAPITAL_OPTIONS). */
  startCapitalMusd?: number
  /** Семья пилота: партнёр и число детей. */
  partner?: boolean
  children?: number
}

export interface AirlineSummary {
  icao: string
  iata: string
  name: string
  country: string
  archetype: AirlineArchetype
  reputation: number
  fleetSize: number
  hubs: string[]
  destinations: number
}

export interface PlaceRef {
  icao: string
  iata: string | null
  name: string
  city: string | null
  country: string
}

export interface AirlineDetail extends Omit<Airline, 'fleet' | 'network'> {
  fleet: { type: string; count: number; name: string }[]
  network: { hub: PlaceRef; destinations: PlaceRef[] }[]
}

// ——— Карьера пилота ———

export interface ScheduledFlight {
  /** `${callsign}-${день}`: стабильный id рейса в конкретные сутки. */
  id: string
  airline: string
  flightNo: string
  callsign: string
  dep: string
  arr: string
  depAt: number
  arrAt: number
  blockMin: number
  distanceKm: number
  typeId: string
  pax: number
  cargoKg: number
  /** Средний тариф в одну сторону, $ (из экономики авиакомпании). */
  avgFare: number | null
}

export interface DispatchFlight extends ScheduledFlight {
  typeName: string
  bookable: boolean
  blockedReason: string | null
  /** Ожидаемая оплата без премий, с учётом множителя. */
  estPay: number
}

/** Что карьера сделала с завершённым полётом. */
export interface CareerOutcome {
  bookingId: number
  status: 'completed' | 'awaiting_delay' | 'not_counted' | 'cancelled' | 'retry'
  message: string
  /** Оплата на руки, после налога. */
  pay?: number
  /** Удержанный налог. */
  tax?: number
  repDelta?: number
  promotedTo?: string
  delayMin?: number
  fired?: boolean
}

export interface FlightFinished {
  flightId: number | null
  outcome: CareerOutcome | null
}

export type EmployerKind = 'airline' | 'charter'

export interface CharterOperator {
  id: string
  name: string
  description: string
  /** Типы самолётов оператора (id каталога). */
  fleet: string[]
}

export interface RatingInfo {
  id: string
  name: string
  price: number
  obtainedAt?: string
}

export interface PilotState {
  name: string
  rank: RankId
  /** У CEO своей компании звание всегда «CEO». */
  rankName: string
  /** Пилот — генеральный директор своей компании и летает в ней. */
  ceo: boolean
  employerKind: EmployerKind | null
  employerId: string | null
  employerName: string | null
  employerIata: string | null
  base: string | null
  location: string | null
  cash: number
  /** Репутация у текущего работодателя, 0–100. */
  reputation: number
  ratings: RatingInfo[]
  /** Налёт и полёты в карьере (только засчитанные рейсы). */
  stats: PilotStats
  /** needsTri — для звания инструктора не хватает сертификата TRI. */
  nextRank: { id: RankId; name: string; minHours: number; needsTri: boolean } | null
}

export type BookingStatus = 'booked' | 'awaiting_delay' | 'completed' | 'cancelled' | 'missed'

export type ClientKind = 'government' | 'corporate' | 'private' | 'special'

export interface CharterDetails {
  clientId: number
  clientName: string
  clientTitle: string
  clientKind: ClientKind
  story: string
  contractUsd: number
  /** Крайний срок вылета (off block), мс UTC. */
  deadline: number
}

export interface Booking {
  id: number
  kind: 'scheduled' | 'charter'
  flightNo: string
  callsign: string
  /** ICAO авиакомпании или id чартерного оператора. */
  operator: string
  dep: string
  arr: string
  depAt: number
  arrAt: number
  typeId: string
  pax: number
  cargoKg: number
  distanceKm: number
  blockMin: number
  status: BookingStatus
  flightId: number | null
  delayMin: number | null
  delayCode: string | null
  pay: number | null
  charter: CharterDetails | null
  createdAt: string
  /** Средний тариф рейса, $ (у чартеров — нет). */
  avgFare: number | null
}

export interface CharterOffer {
  id: string
  client: { id: number | null; name: string; title: string; kind: ClientKind; country: string; relationship: number }
  story: string
  dep: string
  arr: string
  depAt: number
  deadline: number
  typeId: string
  pax: number
  distanceKm: number
  blockMin: number
  contractUsd: number
  pilotPay: number
}

export interface Person {
  id: number
  kind: ClientKind
  name: string
  title: string
  country: string
  relationship: number
  flights: number
}

export interface Transaction {
  id: number
  t: number
  amount: number
  description: string
}

export interface HireOption {
  kind: EmployerKind
  id: string
  /** IATA-код для логотипа (у вымышленных операторов — null). */
  iata: string | null
  name: string
  country: string | null
  archetype: AirlineArchetype | 'charter'
  reputation: number
  requiredHours: number
  eligible: boolean
  bases: string[]
  /** Допуски, которые работодатель оплатит при найме (по своему флоту). */
  ratings: RatingInfo[]
}

export interface HireInput {
  kind: EmployerKind
  employerId: string
  base: string
  ratingId: string
}

export interface OfpSummary {
  origin: string
  destination: string
  alternate: string | null
  route: string
  cruiseAlt: number
  rampFuelKg: number
  tripFuelKg: number
  zfwKg: number
  towKg: number
  pax: number
  enrouteMin: number
  aircraftIcao: string
}

export type PayMultiplier = 1 | 2 | 5 | 10

export interface Settings {
  simbriefUsername: string
  /** Игровой множитель заработка пилота (расходы не меняются). */
  payMultiplier: PayMultiplier
  /** Для тестирования без симулятора: демо-полёт по брони засчитывается в карьеру. */
  demoCountsForCareer: boolean
  /** Режим читера: панель с деньгами, налётом, отдыхом и т.д. */
  cheatMode: boolean
}

export interface WikiImage {
  image: string
  /** Страница-источник в Википедии (для подписи). */
  page: string
  title: string
}

export interface Api {
  profiles: {
    list(): Promise<ProfileSummary[]>
    create(input: CreateProfileInput): Promise<ProfileSummary>
    open(id: string): Promise<ProfileSummary>
    close(): Promise<void>
    current(): Promise<ProfileSummary | null>
    /** Удалить профиль безвозвратно. */
    delete(id: string): Promise<void>
    /** Фото пилота открытого профиля (data URL) или null. */
    photo(): Promise<string | null>
    setPhoto(photo: string | null): Promise<void>
  }
  world: {
    airlines(): Promise<AirlineSummary[]>
    airline(icao: string): Promise<AirlineDetail>
    places(codes: string[]): Promise<Record<string, PlaceRef>>
    /** Запасная ссылка на логотип, если на основном CDN его нет (null — нет нигде). */
    logoFallback(iata: string): Promise<string | null>
    /** Сводка «Пока вас не было» (выдаётся один раз после открытия профиля). */
    report(): Promise<CatchUpReport | null>
    macro(): Promise<MacroOverview>
    onChanged(cb: () => void): () => void
  }
  sim: {
    status(): Promise<SimConnectionStatus>
    onStatus(cb: (s: SimConnectionStatus) => void): () => void
    diagnostics(): Promise<SimDiagnostics>
    setProbes(names: string[]): Promise<void>
  }
  tracker: {
    state(): Promise<TrackerState>
    start(source: FlightSource, bookingId?: number | null): Promise<TrackerState>
    finish(): Promise<FlightFinished | null>
    onUpdate(cb: (s: TrackerState) => void): () => void
    onFinished(cb: (r: FlightFinished) => void): () => void
  }
  logbook: {
    list(): Promise<FlightRecord[]>
    get(id: number): Promise<FlightRecord>
  }
  career: {
    state(): Promise<PilotState>
    hireOptions(): Promise<HireOption[]>
    hire(input: HireInput): Promise<PilotState>
    resign(): Promise<PilotState>
    allRatings(): Promise<RatingInfo[]>
    buyRating(id: string): Promise<PilotState>
    returnToBase(): Promise<PilotState>
    changeBase(base: string): Promise<PilotState>
    transactions(): Promise<Transaction[]>
    clients(): Promise<Person[]>
  }
  dispatch: {
    schedule(): Promise<DispatchFlight[]>
    book(flightId: string): Promise<Booking>
    bookings(): Promise<Booking[]>
    open(): Promise<Booking | null>
    cancel(id: number): Promise<Booking>
    charterOffers(): Promise<CharterOffer[]>
    acceptCharter(id: string): Promise<Booking>
    delayReason(bookingId: number, code: string): Promise<CareerOutcome>
    simbriefUrl(bookingId: number): Promise<string>
    fetchOfp(): Promise<OfpSummary>
  }
  life: {
    state(): Promise<LifeState>
    catalog(): Promise<PricedCatalog>
    setFamily(f: Family): Promise<LifeState>
    rentHome(itemId: string): Promise<LifeState>
    buyHome(itemId: string, downPct: number, years: number): Promise<LifeState>
    setResidence(assetId: number): Promise<LifeState>
    setRentedOut(assetId: number, on: boolean): Promise<LifeState>
    buyCar(itemId: string, downPct: number, years: number): Promise<LifeState>
    buyAircraft(itemId: string, downPct: number, years: number): Promise<LifeState>
    buyCollectible(itemId: string): Promise<LifeState>
    sell(assetId: number): Promise<LifeState>
    repayLoan(loanId: number): Promise<LifeState>
    rest(id: string): Promise<LifeState>
    subscribe(id: string, on: boolean): Promise<LifeState>
    enroll(courseId: string): Promise<LifeState>
    renewMedical(): Promise<LifeState>
    invest(kind: InvestmentKind, amount: number, icao?: string | null): Promise<LifeState>
    withdraw(id: number): Promise<LifeState>
    /** Фото машины из Википедии (null — нет интернета или фото). */
    carImage(carId: string): Promise<WikiImage | null>
  }
  cheat: {
    addMoney(amount: number): Promise<void>
    addHours(hours: number): Promise<void>
    rest(): Promise<void>
    heal(): Promise<void>
    medical(): Promise<void>
    reputation(): Promise<void>
    rating(ratingId: string): Promise<void>
    teleport(icao: string): Promise<void>
  }
  market: {
    rows(): Promise<AirlineMarketRow[]>
    detail(icao: string): Promise<AirlineDetailEconomy>
    stakes(): Promise<Stake[]>
    stakeOffer(icao: string): Promise<StakeOffer>
    buyStake(icao: string, pct: number): Promise<void>
    sellStake(icao: string): Promise<number>
  }
  owner: {
    companies(): Promise<PlayerAirline[]>
    hubOptions(): Promise<{ value: string; label: string }[]>
    typeOptions(archetype: AirlineArchetype): Promise<FoundTypeOption[]>
    destinations(hub: string, typeId: string): Promise<DestinationOption[]>
    quote(input: FoundAirlineInput): Promise<FoundQuote>
    found(input: FoundAirlineInput): Promise<PlayerAirline>
  }
  /** Управление компанией с контрольным пакетом. Действия возвращают обновлённую сводку. */
  manage: {
    state(icao: string): Promise<ManageState>
    routeOptions(icao: string, origin: string): Promise<DestinationOption[]>
    setAutopilot(icao: string, patch: Partial<Autopilot>): Promise<ManageState>
    setFareMult(icao: string, mult: number): Promise<ManageState>
    setFrequency(icao: string, hub: string, dest: string, freq: number): Promise<ManageState>
    openRoute(icao: string, origin: string, dest: string, freq: number): Promise<ManageState>
    lease(icao: string, typeId: string, count: number): Promise<ManageState>
    buy(icao: string, typeId: string, count: number): Promise<ManageState>
    returnLease(icao: string, typeId: string): Promise<ManageState>
    sell(icao: string, typeId: string): Promise<ManageState>
    borrow(icao: string, amount: number): Promise<ManageState>
    repay(icao: string, amount: number): Promise<ManageState>
    setCeoSalary(icao: string, amount: number): Promise<ManageState>
    setPayout(icao: string, pct: number): Promise<ManageState>
    hire(icao: string, role: 'pilots' | 'cabin', count: number): Promise<ManageState>
    fire(icao: string, role: 'pilots' | 'cabin', count: number): Promise<ManageState>
    setPayLevel(icao: string, level: number): Promise<ManageState>
    setService(icao: string, level: number): Promise<ManageState>
    /** Вложить личные деньги в компанию. */
    inject(icao: string, amount: number): Promise<ManageState>
    /** Выйти на биржу, продав pct% компании. */
    ipo(icao: string, pct: number): Promise<ManageState>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  /** Открыть ссылку во внешнем браузере. */
  openExternal(url: string): Promise<void>
}
