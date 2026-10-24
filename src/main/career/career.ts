import type {
  Booking,
  CareerOutcome,
  CharterDetails,
  CharterOffer,
  DispatchFlight,
  EmployerKind,
  HireInput,
  HireOption,
  PilotState,
  RatingInfo,
  Transaction
} from '@shared/types'
import type { FlightRecord } from '@shared/sim'
import {
  RANKS,
  STARTING_CASH,
  QUALITY_BONUS,
  canFlyCategory,
  hireRequirementHours,
  hourlyRate,
  nextRankIfEligible,
  rankById,
  ratingFor,
  rankIndex,
  type PilotStats,
  type RankId
} from '@shared/career'
import { DELAY_CODES } from '@shared/delayCodes'
import { seededRng } from '@shared/random'
import { transaction, type Db } from '../db'
import { aircraftTypes, airlines, airports, playerAirlineIds } from '../world'
import { getFlight } from '../logbook'
import { getSettings } from '../settings'
import { priceLevel } from '../economy/state'
import { addFlightFatigue, fitToFly, hasEducation, prestige } from '../lifestyle/perks'
import { countryParams } from '../lifestyle/catalog'
import { needsInspection } from '../tracker/landing'
import { departuresFrom, findScheduledFlight } from './schedule'
import { effectiveAirline } from '../airlines/state'
import { CHARTER_BASES, CHARTER_OPERATORS, charterOffers, charterOperator, createPerson, updateRelationship } from './charter'

const HOUR = 3_600_000
/** Опоздание больше этого требует причины. */
export const DELAY_THRESHOLD_MIN = 15
/** Бронь можно бесплатно отменить, если до вылета больше этого. */
const FREE_CANCEL_MS = 2 * HOUR
/** Не вылетел через столько после времени по расписанию — рейс считается сорванным. */
const MISSED_AFTER_MS = 3 * HOUR
const BASE_CHANGE_COST = 1_500
const FIRE_BELOW_REPUTATION = 20
const CHARTER_CALLSIGN: Record<string, string> = { 'aurora-exec': 'AUX', 'meridian-jet': 'MRJ', 'atlant-ba': 'ATB' }

export interface PilotRow {
  rank: RankId
  employer_kind: EmployerKind | null
  employer_id: string | null
  base: string | null
  location: string | null
  cash: number
  reputation: number
  hired_at: string | null
  fatigue: number
  health: number
  satisfaction: number
  medical_until: number | null
}

// ——— пилот ———

export function pilotRow(db: Db): PilotRow {
  let row = db.prepare('SELECT * FROM pilot WHERE id = 1').get() as unknown as PilotRow | undefined
  if (!row) {
    db.prepare('INSERT INTO pilot (id, rank, cash, reputation) VALUES (1, ?, ?, 50)').run('trainee', STARTING_CASH)
    addTransaction(db, STARTING_CASH, 'Личные сбережения на старте карьеры', false)
    row = db.prepare('SELECT * FROM pilot WHERE id = 1').get() as unknown as PilotRow
  }
  return row
}

export function addTransaction(db: Db, amount: number, description: string, applyToCash = true): void {
  db.prepare('INSERT INTO transactions (t, amount, description) VALUES (?, ?, ?)').run(Date.now(), amount, description)
  if (applyToCash) db.prepare('UPDATE pilot SET cash = cash + ? WHERE id = 1').run(amount)
}

export function changeReputation(db: Db, delta: number): void {
  db.prepare('UPDATE pilot SET reputation = MAX(0, MIN(100, reputation + ?)) WHERE id = 1').run(delta)
}

export function pilotStats(db: Db): PilotStats {
  const rows = db
    .prepare(
      `SELECT f.block_off_at AS off, f.block_on_at AS onb, f.score AS score
       FROM bookings b JOIN flights f ON f.id = b.flight_id
       WHERE b.status = 'completed' ORDER BY f.id DESC`
    )
    .all() as { off: number | null; onb: number | null; score: number }[]
  const bonus = (db.prepare('SELECT bonus_hours AS b FROM pilot WHERE id = 1').get() as { b: number } | undefined)?.b ?? 0
  const hours = rows.reduce((s, r) => s + (r.off && r.onb ? (r.onb - r.off) / HOUR : 0), 0) + bonus
  const recent = rows.slice(0, 20)
  const avgScore = recent.length ? recent.reduce((s, r) => s + r.score, 0) / recent.length : 0
  return { hours: +hours.toFixed(1), flights: rows.length, avgScore: Math.round(avgScore) }
}

function ownedRatings(db: Db): RatingInfo[] {
  const rows = db.prepare('SELECT id, name, obtained_at FROM ratings ORDER BY obtained_at').all() as {
    id: string
    name: string
    obtained_at: string
  }[]
  return rows.map((r) => ({ id: r.id, name: r.name, price: 0, obtainedAt: r.obtained_at }))
}

function employerName(kind: EmployerKind | null, id: string | null): string | null {
  if (!kind || !id) return null
  return kind === 'airline' ? (airlines.get(id)?.name ?? id) : (charterOperator(id)?.name ?? id)
}

export function pilotState(db: Db): PilotState {
  const p = pilotRow(db)
  const profile = db.prepare('SELECT pilot_name FROM profile WHERE id = 1').get() as { pilot_name: string }
  const next = RANKS[rankIndex(p.rank) + 1] ?? null
  return {
    name: profile.pilot_name,
    rank: p.rank,
    rankName: rankById(p.rank).name,
    employerKind: p.employer_kind,
    employerId: p.employer_id,
    employerName: employerName(p.employer_kind, p.employer_id),
    employerIata: p.employer_kind === 'airline' && p.employer_id ? (airlines.get(p.employer_id)?.iata ?? null) : null,
    base: p.base,
    location: p.location,
    cash: Math.round(p.cash),
    reputation: Math.round(p.reputation),
    ratings: ownedRatings(db),
    stats: pilotStats(db),
    nextRank: next && {
      id: next.id,
      name: next.name,
      minHours: next.minHours,
      needsTri: next.id === 'instructor' && !hasEducation(db, 'tri')
    }
  }
}

// ——— найм ———

/** Все уникальные группы допусков из каталога — их можно купить. */
export function allRatings(db: Db): RatingInfo[] {
  const level = priceLevel(db)
  const map = new Map<string, RatingInfo>()
  for (const t of aircraftTypes.values()) {
    const r = ratingFor(t)
    map.set(r.id, { id: r.id, name: r.name, price: Math.round((r.price * level) / 100) * 100 })
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function hireOptions(db: Db): HireOption[] {
  const stats = pilotStats(db)
  const level = priceLevel(db)
  const options: HireOption[] = [...airlines.values()].filter((a) => !playerAirlineIds.has(a.icao)).map((base) => {
    // Живое состояние: после банкротства у компании может остаться один хаб и один самолёт.
    const al = effectiveAirline(db, base.icao)
    const req = hireRequirementHours(al.reputation, al.archetype)
    const ratings = new Map<string, RatingInfo>()
    for (const f of al.fleet) {
      const r = ratingFor(aircraftTypes.get(f.type)!)
      ratings.set(r.id, { id: r.id, name: r.name, price: Math.round((r.price * level) / 100) * 100 })
    }
    return {
      kind: 'airline',
      id: al.icao,
      iata: al.iata,
      name: al.name,
      country: al.country,
      archetype: al.archetype,
      reputation: al.reputation,
      requiredHours: req,
      eligible: stats.hours >= req,
      bases: al.network.map((n) => n.hub),
      ratings: [...ratings.values()]
    }
  })
  for (const op of CHARTER_OPERATORS) {
    const c750 = ratingFor(aircraftTypes.get('C750')!)
    options.push({
      kind: 'charter',
      id: op.id,
      iata: null,
      name: op.name,
      country: null,
      archetype: 'charter',
      reputation: 75,
      requiredHours: 0,
      eligible: true,
      bases: CHARTER_BASES,
      ratings: [{ id: c750.id, name: c750.name, price: c750.price }]
    })
  }
  return options
}

export function hire(db: Db, input: HireInput): PilotState {
  pilotRow(db)
  if (db.prepare('SELECT 1 FROM stakes WHERE founded = 1').get()) throw new Error('Вы CEO своей авиакомпании и летаете только в ней')
  const opt = hireOptions(db).find((o) => o.kind === input.kind && o.id === input.employerId)
  if (!opt) throw new Error('Работодатель не найден')
  if (!opt.eligible) throw new Error(`Нужно не меньше ${opt.requiredHours} ч налёта`)
  if (!opt.bases.includes(input.base)) throw new Error('Такой базы у работодателя нет')
  const rating = opt.ratings.find((r) => r.id === input.ratingId)
  if (!rating) throw new Error('Работодатель не обучает на этот тип')

  transaction(db, () => {
    cancelOpenBookings(db)
    db.prepare(
      `UPDATE pilot SET employer_kind = ?, employer_id = ?, base = ?, location = ?, reputation = 50, hired_at = ? WHERE id = 1`
    ).run(input.kind, input.employerId, input.base, input.base, new Date().toISOString())
    db.prepare('INSERT OR IGNORE INTO ratings (id, name, obtained_at) VALUES (?, ?, ?)').run(
      rating.id,
      rating.name,
      new Date().toISOString()
    )
  })
  return pilotState(db)
}

export function resign(db: Db): PilotState {
  transaction(db, () => {
    cancelOpenBookings(db)
    db.prepare('UPDATE pilot SET employer_kind = NULL, employer_id = NULL, base = NULL, hired_at = NULL WHERE id = 1').run()
  })
  return pilotState(db)
}

export function buyRating(db: Db, ratingId: string): PilotState {
  const r = allRatings(db).find((x) => x.id === ratingId)
  if (!r) throw new Error('Допуск не найден')
  if (ownedRatings(db).some((x) => x.id === ratingId)) throw new Error('Этот допуск уже есть')
  if (pilotRow(db).cash < r.price) throw new Error('Недостаточно денег')
  transaction(db, () => {
    db.prepare('INSERT INTO ratings (id, name, obtained_at) VALUES (?, ?, ?)').run(r.id, r.name, new Date().toISOString())
    addTransaction(db, -r.price, `Переучивание: ${r.name}`)
  })
  return pilotState(db)
}

/** Перелёт пассажиром на базу — бесплатно, как служебный. */
export function returnToBase(db: Db): PilotState {
  const p = pilotRow(db)
  if (!p.base) throw new Error('Нет базы')
  if (openBooking(db)) throw new Error('Сначала выполните или отмените бронь')
  db.prepare('UPDATE pilot SET location = base WHERE id = 1').run()
  return pilotState(db)
}

export function changeBase(db: Db, base: string): PilotState {
  const p = pilotRow(db)
  const opt = hireOptions(db).find((o) => o.kind === p.employer_kind && o.id === p.employer_id)
  if (!opt?.bases.includes(base)) throw new Error('У работодателя нет такой базы')
  const cost = Math.round(BASE_CHANGE_COST * priceLevel(db))
  if (p.cash < cost) throw new Error('Недостаточно денег на переезд')
  if (openBooking(db)) throw new Error('Сначала выполните или отмените бронь')
  transaction(db, () => {
    db.prepare('UPDATE pilot SET base = ?, location = ? WHERE id = 1').run(base, base)
    addTransaction(db, -cost, `Переезд на базу ${base}`)
  })
  return pilotState(db)
}

// ——— брони ———

interface BookingRow {
  id: number
  kind: Booking['kind']
  flight_no: string
  callsign: string
  operator: string
  dep: string
  arr: string
  dep_at: number
  arr_at: number
  type_id: string
  pax: number
  cargo_kg: number
  distance_km: number
  block_min: number
  status: Booking['status']
  flight_id: number | null
  delay_min: number | null
  delay_code: string | null
  pay: number | null
  charter_json: string | null
  created_at: string
  avg_fare: number | null
}

const toBooking = (r: BookingRow): Booking => ({
  id: r.id,
  kind: r.kind,
  flightNo: r.flight_no,
  callsign: r.callsign,
  operator: r.operator,
  dep: r.dep,
  arr: r.arr,
  depAt: r.dep_at,
  arrAt: r.arr_at,
  typeId: r.type_id,
  pax: r.pax,
  cargoKg: r.cargo_kg,
  distanceKm: r.distance_km,
  blockMin: r.block_min,
  status: r.status,
  flightId: r.flight_id,
  delayMin: r.delay_min,
  delayCode: r.delay_code,
  pay: r.pay,
  charter: r.charter_json ? (JSON.parse(r.charter_json) as CharterDetails) : null,
  createdAt: r.created_at,
  avgFare: r.avg_fare
})

export function listBookings(db: Db): Booking[] {
  const rows = db.prepare('SELECT * FROM bookings ORDER BY dep_at DESC LIMIT 200').all() as unknown as BookingRow[]
  return rows.map(toBooking)
}

export function getBooking(db: Db, id: number): Booking {
  const r = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as unknown as BookingRow | undefined
  if (!r) throw new Error('Бронь не найдена')
  return toBooking(r)
}

/** Активная бронь: ещё не выполнена или ждёт причины задержки. Одновременно — только одна. */
export function openBooking(db: Db): Booking | null {
  const r = db.prepare("SELECT * FROM bookings WHERE status IN ('booked', 'awaiting_delay') ORDER BY dep_at LIMIT 1").get() as unknown as
    | BookingRow
    | undefined
  return r ? toBooking(r) : null
}

function cancelOpenBookings(db: Db): void {
  db.prepare("UPDATE bookings SET status = 'cancelled' WHERE status = 'booked'").run()
}

/** Усталость и медкомиссия: без допуска рейсы не берутся. */
export function requireFit(db: Db, now: number): void {
  const fit = fitToFly(db, now)
  if (!fit.ok) throw new Error(fit.reason!)
}

function requireEmployer(db: Db, kind: EmployerKind): PilotRow {
  const p = pilotRow(db)
  if (p.employer_kind !== kind || !p.employer_id) {
    throw new Error(kind === 'airline' ? 'Вы не работаете в авиакомпании' : 'Вы не работаете в чартерной компании')
  }
  return p
}

/** Рейсы работодателя из текущего аэропорта на ближайшие сутки. */
export function dispatchSchedule(db: Db, now: number): DispatchFlight[] {
  const p = requireEmployer(db, 'airline')
  const al = effectiveAirline(db, p.employer_id!)
  if (!p.location) return []
  const rated = new Set(ownedRatings(db).map((r) => r.id))
  const mult = getSettings(db).payMultiplier * priceLevel(db)
  return departuresFrom(al, p.location, now - 30 * 60_000, now + 24 * HOUR).map((f) => {
    const t = aircraftTypes.get(f.typeId)!
    let blockedReason: string | null = null
    if (!rated.has(ratingFor(t).id)) blockedReason = `Нет допуска: ${ratingFor(t).name}`
    else if (!canFlyCategory(p.rank, t.category)) blockedReason = 'Стажёров не ставят на широкофюзеляжные'
    const estPay = Math.round((f.blockMin / 60) * hourlyRate(t.category, p.rank) * mult)
    return { ...f, typeName: t.name, bookable: !blockedReason, blockedReason, estPay }
  })
}

export function bookScheduled(db: Db, flightId: string, now: number): Booking {
  const p = requireEmployer(db, 'airline')
  if (openBooking(db)) throw new Error('У вас уже есть бронь — сначала выполните или отмените её')
  requireFit(db, now)
  const al = effectiveAirline(db, p.employer_id!)
  const f = findScheduledFlight(al, flightId)
  if (!f) throw new Error('Рейс не найден')
  const entry = dispatchSchedule(db, now).find((x) => x.id === flightId)
  if (!entry) throw new Error('Рейс вылетает не из вашего аэропорта или уже ушёл')
  if (!entry.bookable) throw new Error(entry.blockedReason ?? 'Рейс недоступен')
  const res = db
    .prepare(
      `INSERT INTO bookings (kind, flight_no, callsign, operator, dep, arr, dep_at, arr_at, type_id, pax, cargo_kg, distance_km,
        block_min, status, created_at, avg_fare) VALUES ('scheduled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?)`
    )
    .run(f.flightNo, f.callsign, al.icao, f.dep, f.arr, f.depAt, f.arrAt, f.typeId, f.pax, f.cargoKg, f.distanceKm, f.blockMin, new Date().toISOString(), f.avgFare)
  return getBooking(db, Number(res.lastInsertRowid))
}

function charterContext(db: Db, now: number) {
  const p = requireEmployer(db, 'charter')
  const operator = charterOperator(p.employer_id!)!
  const taken = new Set(
    (db.prepare("SELECT charter_json FROM bookings WHERE kind = 'charter'").all() as { charter_json: string }[]).map(
      (r) => (JSON.parse(r.charter_json) as { offerId: string }).offerId
    )
  )
  return {
    location: p.location ?? p.base!,
    operator,
    ratingIds: new Set(ownedRatings(db).map((r) => r.id)),
    rank: p.rank,
    taken,
    now,
    payMultiplier: getSettings(db).payMultiplier,
    priceLevel: priceLevel(db)
  }
}

export function listCharterOffers(db: Db, now: number): CharterOffer[] {
  return charterOffers(db, charterContext(db, now))
}

export function acceptCharter(db: Db, offerId: string, now: number): Booking {
  if (openBooking(db)) throw new Error('У вас уже есть бронь — сначала выполните или отмените её')
  requireFit(db, now)
  const ctx = charterContext(db, now)
  const offer = charterOffers(db, ctx).find((o) => o.id === offerId)
  if (!offer) throw new Error('Заказ больше недоступен')
  return transaction(db, () => {
    const clientId =
      offer.client.id ??
      createPerson(db, { kind: offer.client.kind, name: offer.client.name, title: offer.client.title, country: offer.client.country })
    const details: CharterDetails & { offerId: string; pilotPay: number } = {
      clientId,
      clientName: offer.client.name,
      clientTitle: offer.client.title,
      clientKind: offer.client.kind,
      story: offer.story,
      contractUsd: offer.contractUsd,
      deadline: offer.deadline,
      offerId: offer.id,
      pilotPay: offer.pilotPay
    }
    const prefix = CHARTER_CALLSIGN[ctx.operator.id] ?? 'VIP'
    const num = 100 + Math.floor(seededRng(offer.id)() * 899)
    const res = db
      .prepare(
        `INSERT INTO bookings (kind, flight_no, callsign, operator, dep, arr, dep_at, arr_at, type_id, pax, cargo_kg, distance_km,
          block_min, status, charter_json, created_at) VALUES ('charter', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'booked', ?, ?)`
      )
      .run(
        `${prefix}${num}`,
        `${prefix}${num}`,
        ctx.operator.id,
        offer.dep,
        offer.arr,
        offer.depAt,
        offer.depAt + offer.blockMin * 60_000,
        offer.typeId,
        offer.pax,
        offer.distanceKm,
        offer.blockMin,
        JSON.stringify(details),
        new Date().toISOString()
      )
    return getBooking(db, Number(res.lastInsertRowid))
  })
}

/** Время, после которого вылет считается опозданием. */
const lateAfter = (b: Booking) => (b.charter ? b.charter.deadline : b.depAt + DELAY_THRESHOLD_MIN * 60_000)

export function cancelBooking(db: Db, id: number, now: number): Booking {
  const b = getBooking(db, id)
  if (b.status !== 'booked') throw new Error('Эту бронь уже нельзя отменить')
  transaction(db, () => {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(id)
    if (b.depAt - now < FREE_CANCEL_MS) changeReputation(db, -2)
    if (b.charter) updateRelationship(db, b.charter.clientId, -1)
  })
  return getBooking(db, id)
}

/** Сорванные брони: вовремя не вылетели. Вызывается периодически. */
export function expireBookings(db: Db, now: number): number {
  const stale = (db.prepare("SELECT * FROM bookings WHERE status = 'booked'").all() as unknown as BookingRow[])
    .map(toBooking)
    .filter((b) => lateAfter(b) + MISSED_AFTER_MS < now)
  for (const b of stale) {
    transaction(db, () => {
      db.prepare("UPDATE bookings SET status = 'missed' WHERE id = ?").run(b.id)
      changeReputation(db, -5)
      if (b.charter) updateRelationship(db, b.charter.clientId, -3)
    })
  }
  return stale.length
}

// ——— завершение рейса ———

export function onFlightFinished(db: Db, bookingId: number, flight: FlightRecord, countDemo: boolean): CareerOutcome {
  const b = getBooking(db, bookingId)
  const base = { bookingId }
  if (b.status !== 'booked') return { ...base, status: 'not_counted', message: 'Бронь уже закрыта' }
  if (flight.source === 'demo' && !countDemo) {
    return { ...base, status: 'not_counted', message: 'Демо-полёт не засчитан в карьеру (включается в настройках). Бронь остаётся активной.' }
  }
  if (flight.departure !== b.dep) {
    return { ...base, status: 'not_counted', message: `Вылет не из ${b.dep} — полёт не засчитан, бронь остаётся активной.` }
  }
  db.prepare('UPDATE flights SET booking_id = ? WHERE id = ?').run(bookingId, flight.id)

  if (flight.status === 'crashed') {
    transaction(db, () => {
      db.prepare("UPDATE bookings SET status = 'cancelled', flight_id = ? WHERE id = ?").run(flight.id, bookingId)
      changeReputation(db, -40)
    })
    return { ...base, status: 'cancelled', message: 'Катастрофа. Рейс сорван, репутация сильно пострадала.', repDelta: -40, ...fireIfNeeded(db) }
  }
  if (flight.status !== 'completed') {
    // Не взлетели — можно попробовать ещё раз; взлетели и бросили — рейс сорван.
    if (!flight.takeoffAt) return { ...base, status: 'retry', message: 'Полёт прерван до взлёта. Бронь остаётся активной.' }
    transaction(db, () => {
      db.prepare("UPDATE bookings SET status = 'cancelled', flight_id = ? WHERE id = ?").run(flight.id, bookingId)
      changeReputation(db, -5)
    })
    return { ...base, status: 'cancelled', message: 'Полёт прерван в воздухе — рейс сорван.', repDelta: -5, ...fireIfNeeded(db) }
  }

  const delayMin = flight.blockOffAt ? Math.round((flight.blockOffAt - b.depAt) / 60_000) : 0
  db.prepare('UPDATE bookings SET flight_id = ?, delay_min = ? WHERE id = ?').run(flight.id, delayMin, bookingId)
  db.prepare('UPDATE pilot SET location = ? WHERE id = 1').run(flight.arrival ?? b.arr)

  if (flight.blockOffAt && flight.blockOffAt > lateAfter(b)) {
    db.prepare("UPDATE bookings SET status = 'awaiting_delay' WHERE id = ?").run(bookingId)
    return { ...base, status: 'awaiting_delay', message: `Вылет с опозданием на ${delayMin} мин — укажите причину задержки.`, delayMin }
  }
  return finalizeBooking(db, bookingId, null)
}

export function setDelayReason(db: Db, bookingId: number, code: string): CareerOutcome {
  const b = getBooking(db, bookingId)
  if (b.status !== 'awaiting_delay') throw new Error('Причина задержки для этой брони не требуется')
  if (!DELAY_CODES.some((d) => d.code === code)) throw new Error('Неизвестный код задержки')
  return finalizeBooking(db, bookingId, code)
}

function finalizeBooking(db: Db, bookingId: number, delayCode: string | null): CareerOutcome {
  const b = getBooking(db, bookingId)
  const f = getFlight(db, b.flightId!)
  const p = pilotRow(db)
  const type = aircraftTypes.get(b.typeId)!
  const blockHours = f.blockOffAt && f.blockOnAt ? (f.blockOnAt - f.blockOffAt) / HOUR : b.blockMin / 60
  const diverted = !!f.arrival && f.arrival !== b.arr
  const notes: string[] = []
  let rep = 0

  let pay: number
  if (b.charter) {
    const details = b.charter as CharterDetails & { pilotPay: number }
    const punctual = !f.blockOffAt || f.blockOffAt <= details.deadline
    pay = details.pilotPay * (punctual ? 1 : 0.8)
    if (f.score >= 90) {
      pay *= 1.15
      notes.push('клиент оставил чаевые за плавный полёт')
    }
    if (hasEducation(db, 'vip')) pay *= 1.1
    // Статус пилота впечатляет VIP-клиентов: до +20% к оплате.
    const prestigeBonus = Math.min(20, Math.floor(prestige(db) / 5))
    if (prestigeBonus) {
      pay *= 1 + prestigeBonus / 100
      notes.push(`престиж +${prestigeBonus}%`)
    }
    const rel = (punctual ? 1 : -1) + (f.score >= 85 ? 1 : f.score < 70 ? -1 : 0) + (diverted ? -2 : 0)
    updateRelationship(db, details.clientId, rel)
    notes.push(rel > 0 ? 'клиент доволен' : rel < 0 ? 'клиент недоволен' : 'клиент сдержан')
  } else {
    pay = blockHours * hourlyRate(type.category, p.rank) * getSettings(db).payMultiplier * priceLevel(db)
    if (f.score >= 90) {
      pay *= 1 + QUALITY_BONUS
      notes.push('премия за качество +10%')
    }
    const international = airports.get(b.dep)?.country !== airports.get(b.arr)?.country
    const english = hasEducation(db, 'icao6') ? 6 : hasEducation(db, 'icao5') ? 3 : 0
    if (international && english) {
      pay *= 1 + english / 100
      notes.push(`английский ICAO +${english}%`)
    }
  }
  if (diverted) {
    pay *= 0.5
    rep -= 2
    notes.push(`посадка не в пункте назначения (${f.arrival}) — оплата 50%`)
  }

  // Курс CRM: хорошие рейсы поднимают репутацию быстрее.
  if (f.score >= 90) rep += hasEducation(db, 'crm') ? 2 : 1
  else if (f.score < 70) rep -= 2
  if (f.landing && needsInspection(f.landing)) {
    rep -= 3
    notes.push('жёсткая посадка — самолёт уходит на внеплановую проверку')
  }
  if (delayCode) {
    const d = DELAY_CODES.find((x) => x.code === delayCode)!
    if (['61', '63', '64'].includes(d.code)) rep -= 3
    else if (d.responsibility === 'airline') rep -= 1
  }

  // Налог на доход — по ставке страны базы.
  const baseCountry = p.base ? (airports.get(p.base)?.country ?? null) : null
  const taxPct = countryParams(baseCountry).tax
  const gross = Math.round(pay)
  const tax = Math.round((gross * taxPct) / 100)
  pay = gross - tax
  const promotedTo = transaction(db, () => {
    db.prepare("UPDATE bookings SET status = 'completed', pay = ?, delay_code = ? WHERE id = ?").run(pay, delayCode, bookingId)
    db.prepare('UPDATE flights SET delay_code = ? WHERE id = ?').run(delayCode, f.id)
    addTransaction(db, pay, `Рейс ${b.flightNo} ${b.dep} → ${b.arr}${tax ? ` (налог ${taxPct}%: −$${tax})` : ''}`)
    addFlightFatigue(db, blockHours)
    changeReputation(db, rep)
    // Статистика уже с учётом этого рейса (бронь помечена завершённой выше).
    const next = nextRankIfEligible(p.rank, pilotStats(db), hasEducation(db, 'tri'))
    if (next) db.prepare('UPDATE pilot SET rank = ? WHERE id = 1').run(next)
    return next ? rankById(next).name : undefined
  })

  return {
    bookingId,
    status: 'completed',
    message: notes.length ? notes.join('; ') : 'Рейс выполнен',
    pay,
    tax,
    repDelta: rep,
    promotedTo,
    delayMin: b.delayMin ?? undefined,
    ...fireIfNeeded(db)
  }
}

function fireIfNeeded(db: Db): { fired?: boolean } {
  const p = pilotRow(db)
  if (p.employer_id && p.reputation < FIRE_BELOW_REPUTATION) {
    resign(db)
    return { fired: true }
  }
  return {}
}

export function listTransactions(db: Db): Transaction[] {
  return db.prepare('SELECT * FROM transactions ORDER BY id DESC LIMIT 300').all() as unknown as Transaction[]
}
