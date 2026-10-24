import type { DestinationOption, FoundAirlineInput, FoundQuote, FoundTypeOption, PlayerAirline } from '@shared/airlines'
import type { AircraftType, Airline, AirlineArchetype } from '@shared/world'
import { transaction, type Db } from '../db'
import { aircraftTypes, airlines, airports, playerAirlineIds } from '../world'
import { distanceKm } from '../tracker/geo'
import { blockMinutes } from '../career/schedule'
import { addTransaction, pilotRow, resign } from '../career/career'
import { macroState } from '../economy/state'
import { dailyDemand } from './demand'
import { LEASE_RATE, initialStaff } from './sim'
import { loadStates, saveStates, type AirlineState } from './state'

/**
 * Своя авиакомпания игрока — единственное исключение из правила «новые компании не появляются».
 * Статичная часть живёт в таблице player_airline и при открытии профиля регистрируется в общем
 * справочнике airlines, чтобы экономика, расписание и рынок работали с ней как с любой другой.
 */

/** Сертификат эксплуатанта, регистрация, первый офис — в долларах базового года. */
const SETUP_FEE = 400_000
/** Минимум денег на счёте после старта сверх двух месяцев лизинга. */
const MIN_WORKING_CAPITAL = 200_000
const MAX_LOAN_MULTIPLE = 3
/** Ставки по кредиту в месяц: с личным поручительством банк рискует меньше. */
const RATE_GUARANTEED = 0.006
const RATE_PLAIN = 0.011
const START_REPUTATION = 40
const MAX_DESTINATIONS = 3
const MAX_LOGO_CHARS = 400_000
/** Блок-часов в сутки на самолёт — как в экономике авиакомпаний. */
const BLOCK_HOURS_PER_DAY = 13

interface PlayerAirlineRow {
  icao: string
  iata: string
  name: string
  callsign: string
  country: string
  archetype: AirlineArchetype
  hub: string
  logo: string | null
  founded_at: number
}

const rows = (db: Db): PlayerAirlineRow[] =>
  db.prepare('SELECT * FROM player_airline ORDER BY founded_at').all() as unknown as PlayerAirlineRow[]

function toAirline(r: PlayerAirlineRow): Airline {
  return {
    icao: r.icao,
    iata: r.iata,
    name: r.name,
    callsign: r.callsign,
    country: r.country,
    archetype: r.archetype,
    reputation: START_REPUTATION,
    // Флот и сеть берутся из живого состояния; здесь только база для решений экономики.
    fleet: [],
    network: [{ hub: r.hub, destinations: [] }]
  }
}

/** Регистрирует компании игрока открытого профиля в справочнике (и убирает компании прошлого профиля). */
export function registerPlayerAirlines(db: Db | null): void {
  for (const icao of playerAirlineIds) airlines.delete(icao)
  playerAirlineIds.clear()
  if (!db) return
  for (const r of rows(db)) {
    airlines.set(r.icao, toAirline(r))
    playerAirlineIds.add(r.icao)
  }
  // Компании, основанные до того, как база CEO стала базой компании.
  const own = rows(db)[0]
  if (own && !pilotRow(db).base) homeAtHub(db, own.hub)
}

/**
 * База CEO — база его компании: по её стране считаются цены, налоги и личная жизнь.
 * Где пилот физически находится, не меняем, если он уже где-то есть.
 */
function homeAtHub(db: Db, hub: string): void {
  db.prepare('UPDATE pilot SET base = ?, location = COALESCE(location, ?) WHERE id = 1').run(hub, hub)
}

export function playerAirlines(db: Db): PlayerAirline[] {
  return rows(db).map((r) => ({
    icao: r.icao,
    iata: r.iata,
    name: r.name,
    callsign: r.callsign,
    country: r.country,
    archetype: r.archetype,
    hub: r.hub,
    logo: r.logo,
    foundedAt: r.founded_at
  }))
}

// ——— варианты для формы ———

/** Какие самолёты подходят типу компании. */
export function typeFits(t: AircraftType, archetype: AirlineArchetype): boolean {
  if (t.category === 'bizjet') return false
  if (archetype === 'cargo') return t.category === 'freighter'
  if (t.category === 'freighter') return false
  if (archetype === 'regional') return t.category === 'turboprop' || t.category === 'regional'
  if (archetype === 'lowcost') return t.category === 'narrowbody' || t.category === 'regional'
  if (archetype === 'leisure') return t.category === 'narrowbody' || t.category === 'widebody'
  return true
}

const monthlyLease = (t: AircraftType, cpi: number): number => Math.round(t.valueMusd * 1e6 * LEASE_RATE * cpi)

export function foundTypeOptions(db: Db, archetype: AirlineArchetype): FoundTypeOption[] {
  const cpi = macroState(db).cpi
  return [...aircraftTypes.values()]
    .filter((t) => typeFits(t, archetype))
    .map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      seats: t.seats,
      cargoKg: t.cargoKg,
      rangeKm: t.rangeKm,
      monthlyLease: monthlyLease(t, cpi),
      price: Math.round(t.valueMusd * 1e6 * cpi)
    }))
    .sort((a, b) => a.monthlyLease - b.monthlyLease)
}

const airportLabel = (icao: string): string => {
  const a = airports.get(icao)
  if (!a) return icao
  // Оба кода в подписи: по ним ищут в выпадающих списках.
  return `${a.city ?? a.name} — ${a.name} (${a.icao}${a.iata ? ` / ${a.iata}` : ''})`
}

/** Базой может быть любой аэропорт с регулярными рейсами, крупный или средний. */
export function hubOptions(): { value: string; label: string }[] {
  return [...airports.values()]
    .filter((a) => a.scheduled && a.type !== 'small')
    .map((a) => ({ value: a.icao, label: airportLabel(a.icao) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Направления из базы, до которых долетит выбранный тип, — самые востребованные сверху. */
export function destinationOptions(db: Db, hub: string, typeId: string): DestinationOption[] {
  const h = airports.get(hub)
  const t = aircraftTypes.get(typeId)
  if (!h || !t) return []
  const competitors = new Map<string, number>()
  for (const s of loadStates(db).values())
    for (const r of s.routes) {
      if (r.freq <= 0) continue
      if (r.hub === hub) competitors.set(r.dest, (competitors.get(r.dest) ?? 0) + 1)
      else if (r.dest === hub) competitors.set(r.hub, (competitors.get(r.hub) ?? 0) + 1)
    }
  const out: DestinationOption[] = []
  for (const a of airports.values()) {
    if (a.icao === hub || !a.scheduled || a.type === 'small') continue
    if (a.rwyM && a.rwyM < t.minRunwayM * 0.75) continue
    const km = distanceKm(h.lat, h.lon, a.lat, a.lon)
    if (km < 150 || km > t.rangeKm * 0.9) continue
    out.push({
      icao: a.icao,
      label: airportLabel(a.icao),
      km: Math.round(km),
      demand: Math.round(dailyDemand(hub, a.icao, km, 1, 1)),
      competitors: competitors.get(a.icao) ?? 0
    })
  }
  return out.sort((a, b) => b.demand - a.demand).slice(0, 80)
}

// ——— основание ———

function validate(db: Db, input: FoundAirlineInput): string[] {
  const errors: string[] = []
  const name = input.name.trim()
  const icao = input.icao.trim().toUpperCase()
  const iata = input.iata.trim().toUpperCase()
  if (rows(db).length) errors.push('У вас уже есть своя компания')
  if (!name) errors.push('Укажите название')
  else if ([...airlines.values()].some((a) => a.name.toLowerCase() === name.toLowerCase()))
    errors.push('Такое название уже занято')
  if (!/^[A-Z]{3}$/.test(icao)) errors.push('Код ICAO — три латинские буквы')
  else if (airlines.has(icao)) errors.push(`Код ICAO ${icao} уже занят`)
  if (!/^(?=.*[A-Z])[A-Z0-9]{2}$/.test(iata)) errors.push('Код IATA — две латинские буквы или буква и цифра')
  else if ([...airlines.values()].some((a) => a.iata === iata)) errors.push(`Код IATA ${iata} уже занят`)
  const type = aircraftTypes.get(input.typeId)
  if (!type || !typeFits(type, input.archetype)) errors.push('Выберите самолёт, подходящий типу компании')
  if (!airports.get(input.hub)) errors.push('Выберите базовый аэропорт')
  if (!input.destinations.length) errors.push('Выберите хотя бы одно направление')
  if (input.destinations.length > MAX_DESTINATIONS) errors.push(`На старте — не больше ${MAX_DESTINATIONS} направлений`)
  const h = airports.get(input.hub)
  if (type && h) {
    for (const d of input.destinations) {
      const a = airports.get(d)
      if (!a || d === h.icao || distanceKm(h.lat, h.lon, a.lat, a.lon) > type.rangeKm * 0.9)
        errors.push(`${d}: не долететь из базы`)
      else if (a.rwyM && a.rwyM < type.minRunwayM * 0.75) errors.push(`${d}: слишком короткая ВПП для ${type.name}`)
    }
  }
  if (input.logo && (!input.logo.startsWith('data:image/') || input.logo.length > MAX_LOGO_CHARS))
    errors.push('Логотип — картинка до 300 КБ')
  return errors
}

export function foundQuote(db: Db, input: FoundAirlineInput): FoundQuote {
  const cpi = macroState(db).cpi
  const type = aircraftTypes.get(input.typeId)
  const lease = type ? monthlyLease(type, cpi) : 0
  const setupFee = Math.round(SETUP_FEE * cpi)
  const deposit = lease * 3
  const reserve = Math.round(lease * 2 + MIN_WORKING_CAPITAL * cpi)
  const contribution = Math.max(0, Math.round(input.contribution))
  const loan = Math.max(0, Math.round(input.loan))
  const maxLoan = contribution * MAX_LOAN_MULTIPLE
  const cashAfter = contribution + loan - setupFee - deposit
  const errors = validate(db, input)
  if (contribution > pilotRow(db).cash) errors.push('У вас нет столько денег')
  if (loan > maxLoan) errors.push(`Банк даёт не больше ${MAX_LOAN_MULTIPLE} ваших вложений`)
  if (cashAfter < reserve) errors.push('Не хватает капитала: после старта на счёте должен остаться резерв')
  return {
    setupFee,
    deposit,
    monthlyLease: lease,
    reserve,
    cashAfter,
    maxLoan,
    loanRatePct: (input.guaranteed ? RATE_GUARANTEED : RATE_PLAIN) * 100,
    errors
  }
}

/**
 * Частоты на старте: по рейсу в день на каждое направление, потом добавляем рейсы туда,
 * где спрос выше, пока у самолёта есть лётное время.
 */
function startFrequencies(type: AircraftType, hub: string, destinations: string[]): Map<string, number> {
  const h = airports.get(hub)!
  const legs = destinations.map((dest) => {
    const d = airports.get(dest)!
    const km = distanceKm(h.lat, h.lon, d.lat, d.lon)
    // Блок-часы считаем как экономика авиакомпаний: без стоянок между рейсами.
    return {
      dest,
      roundTrip: 2 * blockMinutes(type, km),
      demand: dailyDemand(hub, dest, km, 1, 1),
      freq: 1
    }
  })
  let left = BLOCK_HOURS_PER_DAY * 60 - legs.reduce((s, l) => s + l.roundTrip, 0)
  for (;;) {
    const next = legs
      .filter((l) => l.freq < 6 && l.roundTrip <= left)
      .sort((a, b) => b.demand / (b.freq + 1) - a.demand / (a.freq + 1))[0]
    if (!next) break
    next.freq++
    left -= next.roundTrip
  }
  return new Map(legs.map((l) => [l.dest, l.freq]))
}

/** Основывает компанию: деньги игрока и кредит — на счёт компании, пилот увольняется и становится CEO. */
export function foundAirline(db: Db, input: FoundAirlineInput): PlayerAirline {
  const q = foundQuote(db, input)
  if (q.errors.length) throw new Error(q.errors[0])
  const icao = input.icao.trim().toUpperCase()
  const iata = input.iata.trim().toUpperCase()
  const name = input.name.trim()
  const hub = airports.get(input.hub)!
  const type = aircraftTypes.get(input.typeId)!
  const contribution = Math.round(input.contribution)
  const loan = Math.round(input.loan)
  const now = Date.now()

  const state: AirlineState = {
    icao,
    cash: q.cashAfter,
    debt: loan,
    debtRate: input.guaranteed ? RATE_GUARANTEED : RATE_PLAIN,
    autopilot: { fleet: false, routes: false, fares: false, staff: false },
    // Пока игрок не назначил себе зарплату и дивиденды, прибыль остаётся в компании.
    ceoSalary: 0,
    payout: 0,
    reputation: START_REPUTATION,
    fleet: { [type.id]: 1 },
    routes: [...startFrequencies(type, hub.icao, input.destinations)].map(([dest, freq]) => ({
      hub: hub.icao,
      dest,
      freq,
      lf: 0.6,
      fare: 0,
      profit: 0,
      badMonths: 0
    })),
    // До IPO акции не торгуются: оценка — вложенный капитал.
    shares: Math.max(0.01, contribution / 10 / 1e6),
    sharePrice: 10,
    prevSharePrice: 10,
    status: 'ok',
    restarts: 0,
    last: null,
    recentProfit: [],
    version: 1
  }

  transaction(db, () => {
    if (pilotRow(db).employer_id) resign(db)
    homeAtHub(db, hub.icao)
    addTransaction(db, -contribution, `Вложение в капитал ${name}`)
    db.prepare(
      `INSERT INTO player_airline (icao, iata, name, callsign, country, archetype, hub, logo, founded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      icao,
      iata,
      name,
      input.callsign.trim().toUpperCase() || name.toUpperCase(),
      hub.country,
      input.archetype,
      hub.icao,
      input.logo,
      now
    )
    db.prepare('INSERT INTO stakes (icao, pct, cost, founded, guaranteed, acquired_at) VALUES (?, 100, ?, 1, ?, ?)').run(
      icao,
      contribution,
      input.guaranteed ? 1 : 0,
      now
    )
    registerPlayerAirlines(db)
    // Штат под стартовое расписание с запасом: экипажи набраны к первому рейсу.
    state.staff = initialStaff(state)
    const states = loadStates(db)
    states.set(icao, state)
    saveStates(db, states)
    db.prepare('INSERT INTO news (t, category, title, body) VALUES (?, ?, ?, ?)').run(
      now,
      'airline',
      `Новая авиакомпания: ${name}`,
      `В ${hub.city ?? hub.name} основан новый перевозчик. На старте — один ${type.name} и ${input.destinations.length} направлени${input.destinations.length === 1 ? 'е' : 'я'}.`
    )
  })
  return playerAirlines(db).find((a) => a.icao === icao)!
}
