import {
  CONTROL_PCT,
  FARE_MULT_MAX,
  FARE_MULT_MIN,
  STAFF_LEVEL_MAX,
  STAFF_LEVEL_MIN,
  type Autopilot,
  type RouteQuote,
  type RouteState,
  type FleetRow,
  type ManageState,
  type FarePreview,
  type TailPosition,
  type RouteAdvice,
  type IpoOffer,
  type Staff,
  type StaffInfo
} from '@shared/airlines'
import { transaction, type Db } from '../db'
import { addTransaction, pilotRow } from '../career/career'
import { aircraftTypes, airlines, airports, playerAirlineIds } from '../world'
import { distanceKm } from '../tracker/geo'
import { macroState } from '../economy/state'
import {
  LEASE_RATE,
  attritionRate,
  crewSalaries,
  fairValue,
  fillSchedule,
  initialStaff,
  maxFreq,
  planBlockHours,
  projectAirline,
  routeFarePreview,
  estimateRoute,
  routeCandidates,
  servedPairs,
  staffManaged,
  staffNeeds
} from './sim'
import { loadStates, saveStates, withState, type AirlineState } from './state'
import type { AircraftType } from '@shared/world'
import { blockMinutes, typeServes } from '../career/schedule'
import { foundTypeOptions, typeFits } from './player'
import { dailyDemand } from './demand'
import { worldNow } from '../worldTime'
import type { NewsDraft } from '../economy/macro'
import { normalizeRegistration } from './registrations'
import { fleetPositions } from './tails'
import { routeNumbers } from '../career/schedule'

/**
 * Управление компанией, где у игрока контрольный пакет: флот, маршруты, тарифы, деньги.
 * Решения действуют сразу, итоги — в месячном шаге экономики. Разделы, оставленные заместителю,
 * ведёт ИИ (decide в sim.ts), и игрок их не правит.
 */

/** Залог за лизинг — 3 месяца; при возврате самолёта отдают 2. */
const LEASE_DEPOSIT_MONTHS = 3
const LEASE_REFUND_MONTHS = 2
/** Свой самолёт продаётся дешевле рыночной цены. */
const RESALE = 0.85
/** Кредит: не больше полугодовой выручки (минимум $2 млн) плюс 60% стоимости своих самолётов. */
const BORROW_REVENUE_MONTHS = 6
const BORROW_MIN = 2_000_000
const BORROW_OWNED_SHARE = 0.6
/** Зарплата CEO: до 3% месячной выручки, но не меньше $15 тыс. — так нельзя вынуть всю кассу. */
const CEO_SALARY_SHARE = 0.03
const CEO_SALARY_MIN_CAP = 15_000

interface StakeInfoRow {
  pct: number
  founded: number
  guaranteed: number
}

const stakeOf = (db: Db, icao: string) => db.prepare('SELECT pct, founded, guaranteed FROM stakes WHERE icao = ?').get(icao) as StakeInfoRow | undefined

function requireControl(db: Db, icao: string): AirlineState {
  const row = stakeOf(db, icao)
  if (!row || row.pct < CONTROL_PCT) throw new Error('У вас нет контроля над этой компанией')
  const s = loadStates(db).get(icao)
  if (!s) throw new Error('Авиакомпания не найдена')
  return s
}

const autopilotOf = (s: AirlineState): Autopilot => ({ fleet: true, routes: true, fares: true, staff: true, ...s.autopilot })

function requireManual(s: AirlineState, part: keyof Autopilot): void {
  const label = { fleet: 'Флотом', routes: 'Маршрутами', fares: 'Тарифами', staff: 'Персоналом' }[part]
  if (autopilotOf(s)[part]) throw new Error(`${label} сейчас управляет заместитель — возьмите раздел на себя`)
}

/** Изменения сохраняем и сбрасываем кэш расписания (version). */
function commit(db: Db, s: AirlineState): void {
  s.version++
  saveStates(db, loadStates(db))
}

const cpi = (db: Db) => macroState(db).cpi
const routeKm = (a: string, b: string) => {
  const h = airports.get(a)!
  const d = airports.get(b)!
  return distanceKm(h.lat, h.lon, d.lat, d.lon)
}
const fleetCount = (s: AirlineState) => Object.values(s.fleet).reduce((a, b) => a + b, 0)

function aircraftType(s: AirlineState, typeId: string) {
  const t = aircraftTypes.get(typeId)
  const al = airlines.get(s.icao)!
  if (!t || !typeFits(t, al.archetype)) throw new Error('Этот самолёт не подходит компании')
  return t
}

function borrowLimit(db: Db, s: AirlineState): number {
  const level = cpi(db)
  const ownedValue = Object.entries(s.owned ?? {}).reduce((sum, [t, n]) => sum + (aircraftTypes.get(t)?.valueMusd ?? 0) * 1e6 * level * n, 0)
  const base = Math.max(BORROW_MIN * level, monthRevenue(db, s) * BORROW_REVENUE_MONTHS)
  return Math.max(0, Math.round(base + ownedValue * BORROW_OWNED_SHARE - s.debt))
}

const ceoSalaryCap = (db: Db, s: AirlineState): number =>
  Math.round(Math.max(CEO_SALARY_MIN_CAP * cpi(db), monthRevenue(db, s) * CEO_SALARY_SHARE))

/** Выручка за месяц; у новой компании без итогов — по прогнозу. */
const monthRevenue = (db: Db, s: AirlineState): number => (s.last ?? projectAirline(db, s.icao)?.last)?.revenue ?? 0

// ——— сводка ———

export function manageState(db: Db, icao: string): ManageState {
  const s = requireControl(db, icao)
  const al = airlines.get(icao)!
  const level = cpi(db)
  const plan = planBlockHours(s)
  const fleet: FleetRow[] = Object.entries(s.fleet)
    .filter(([, n]) => n > 0)
    .map(([typeId, count]) => {
      const t = aircraftTypes.get(typeId)!
      const owned = Math.min(count, s.owned?.[typeId] ?? 0)
      return {
        typeId,
        name: t.name,
        count,
        owned,
        leased: count - owned,
        monthlyLease: Math.round(t.valueMusd * 1e6 * LEASE_RATE * level),
        price: Math.round(t.valueMusd * 1e6 * level),
        salePrice: Math.round(t.valueMusd * 1e6 * level * RESALE)
      }
    })
  const active = s.routes.filter((r) => r.freq > 0)
  const numbers = routeNumbers(withState(al, s))
  const now = worldNow(db)
  const history = db
    .prepare('SELECT month, revenue, profit, lf, share_price AS sharePrice, cash FROM airline_monthly WHERE icao = ? ORDER BY month')
    .all(icao) as unknown as ManageState['history']
  return {
    icao,
    iata: al.iata,
    name: al.name,
    archetype: al.archetype,
    autopilot: autopilotOf(s),
    legs: (s.legs ?? []).map((l) => ({
      ...l,
      typeName: aircraftTypes.get(l.type)?.name ?? l.type,
      landed: now >= l.depAt + 60_000 * blockMinutes(aircraftTypes.get(l.type)!, routeKm(l.hub, l.dest))
    })),
    fareMult: s.fareMult ?? 1,
    fleet,
    deliveries: (s.deliveries ?? []).map((d) => ({ ...d, name: aircraftTypes.get(d.type)?.name ?? d.type })),
    routes: active
      .map((r) => {
        const p = plan.routes.get(r)
        const km = p?.km ?? 0
        return {
          ...r,
          km: Math.round(km),
          typeId: p?.type?.id ?? null,
          typeName: p?.type?.name ?? null,
          typeAssigned: !!r.type && r.type === p?.type?.id,
          typeOptions: servingTypes(s, r.hub, r.dest, km).map((t) => ({ id: t.id, name: t.name })),
          blockHours: Math.round(p?.blockHours ?? 0),
          flightNum: numbers.get(`${r.hub}-${r.dest}`) ?? 0
        }
      })
      .sort((a, b) => b.profit - a.profit),
    origins: [...new Set([...active.map((r) => r.hub), ...active.map((r) => r.dest), ...al.network.map((n) => n.hub)])],
    types: foundTypeOptions(db, al.archetype),
    blockHoursNeeded: Math.round(plan.needed),
    blockHoursAvailable: Math.round(plan.available),
    typeHours: [...plan.byType].map(([typeId, h]) => ({
      typeId,
      name: aircraftTypes.get(typeId)?.name ?? typeId,
      needed: Math.round(h.needed),
      available: Math.round(h.available)
    })),
    cash: Math.round(s.cash),
    debt: Math.round(s.debt),
    debtRatePct: +((s.debtRate ?? 0.007) * 100).toFixed(2),
    borrowLimit: borrowLimit(db, s),
    staff: staffInfo(db, s),
    status: s.status,
    bankruptcyDebt: bankruptcyDebt(db, s),
    founded: !!stakeOf(db, icao)?.founded,
    guaranteed: !!stakeOf(db, icao)?.guaranteed,
    pct: Math.round((stakeOf(db, icao)?.pct ?? 0) * 10) / 10,
    ipo: ipoOffer(db, s),
    ceoSalary: s.ceoSalary ?? 0,
    ceoSalaryCap: ceoSalaryCap(db, s),
    payoutPct: Math.round((s.payout ?? 0.3) * 100),
    payoutRecommended: recommendedPayout(s),
    last: s.last,
    history
  }
}

export function setAutopilot(db: Db, icao: string, patch: Partial<Autopilot>): void {
  const s = requireControl(db, icao)
  s.autopilot = { ...autopilotOf(s), ...patch }
  // Тарифы заместитель держит рыночными.
  if (s.autopilot.fares) {
    s.fareMult = 1
    for (const r of s.routes) delete r.fareMult
  }
  // Отдали маршруты заместителю — он сразу занимает самолёты работой.
  if (patch.routes) deputyRoutes(db, s)
  // Берём персонал на себя — заместитель передаёт штат под нынешнее расписание.
  if (!s.autopilot.staff && !s.staff) s.staff = initialStaff(s)
  commit(db, s)
}

// ——— тарифы ———

export function setFareMult(db: Db, icao: string, mult: number): void {
  const s = requireControl(db, icao)
  requireManual(s, 'fares')
  s.fareMult = Math.round(Math.min(FARE_MULT_MAX, Math.max(FARE_MULT_MIN, mult)) * 20) / 20
  commit(db, s)
}

const FARE_STEPS = Array.from({ length: Math.round((FARE_MULT_MAX - FARE_MULT_MIN) * 100) + 1 }, (_, i) => +(FARE_MULT_MIN + i / 100).toFixed(2))

/** Конкуренты на маршруте и прогноз загрузки при любой наценке — для карточки рейса. */
export function farePreview(db: Db, icao: string, hub: string, dest: string): FarePreview {
  requireControl(db, icao)
  return routeFarePreview(db, icao, hub, dest, FARE_STEPS)
}

/** Наценка на одном рейсе (null — как у компании в целом). */
export function setRouteFare(db: Db, icao: string, hub: string, dest: string, mult: number | null): void {
  const s = requireControl(db, icao)
  requireManual(s, 'fares')
  const r = s.routes.find((x) => x.hub === hub && x.dest === dest && x.freq > 0)
  if (!r) throw new Error('Маршрут не найден')
  if (mult === null) delete r.fareMult
  else r.fareMult = Math.round(Math.min(FARE_MULT_MAX, Math.max(FARE_MULT_MIN, mult)) * 100) / 100
  commit(db, s)
}

// ——— маршруты ———

/** Расписание не должно требовать больше блок-часов, чем есть у флота. */
function requireCapacity(s: AirlineState): void {
  const plan = planBlockHours(s)
  for (const [r, p] of plan.routes)
    if (r.freq > 0 && !p.type) throw new Error(`Маршрут ${r.hub} — ${r.dest} некому обслуживать: ни один самолёт флота туда не долетит`)
  for (const [typeId, h] of plan.byType)
    if (h.needed > h.available * 1.0001)
      throw new Error(
        `Самолётов ${aircraftTypes.get(typeId)?.name ?? typeId} не хватит: их рейсам нужно ${Math.round(h.needed)} блок-ч в месяц, а они дают ${Math.round(h.available)}`
      )
}

/** Типы флота, которые могут летать по маршруту. */
function servingTypes(s: AirlineState, hub: string, dest: string, km: number): AircraftType[] {
  const al = withState(airlines.get(s.icao)!, s)
  return Object.entries(s.fleet)
    .filter(([, n]) => n > 0)
    .map(([id]) => aircraftTypes.get(id)!)
    .filter((t) => t && typeServes(al, t, km, hub, dest))
}

/** Назначить маршруту тип самолёта (null — «Авто»: выбор по флоту). */
export function setRouteType(db: Db, icao: string, hub: string, dest: string, typeId: string | null): void {
  const s = requireControl(db, icao)
  requireManual(s, 'routes')
  const r = s.routes.find((x) => x.hub === hub && x.dest === dest && x.freq > 0)
  if (!r) throw new Error('Маршрут не найден')
  const h = airports.get(hub)!
  const d = airports.get(dest)!
  if (typeId && !servingTypes(s, hub, dest, distanceKm(h.lat, h.lon, d.lat, d.lon)).some((t) => t.id === typeId))
    throw new Error('Этот самолёт не долетит или его нет во флоте')
  const prev = r.type
  if (typeId) r.type = typeId
  else delete r.type
  try {
    requireCapacity(s)
  } catch (e) {
    if (prev) r.type = prev
    else delete r.type
    throw e
  }
  commit(db, s)
}

export function setFrequency(db: Db, icao: string, hub: string, dest: string, freq: number): void {
  const s = requireControl(db, icao)
  requireManual(s, 'routes')
  const r = s.routes.find((x) => x.hub === hub && x.dest === dest)
  if (!r) throw new Error('Маршрут не найден')
  const next = Math.max(0, Math.min(maxFreq(r), Math.round(freq)))
  if (next === 0 && s.routes.filter((x) => x.freq > 0).length <= 1) throw new Error('Нельзя закрыть последний маршрут')
  const prev = r.freq
  r.freq = next
  r.badMonths = 0
  if (next > prev) {
    try {
      requireCapacity(s)
    } catch (e) {
      r.freq = prev
      throw e
    }
  }
  commit(db, s)
}

/** Аэропорт годится для регулярного рейса. */
const servesScheduled = (code: string) => {
  const a = airports.get(code)
  return !!a && a.scheduled && a.type !== 'small'
}

const samePair = (r: RouteState, a: string, b: string) => (r.hub === a && r.dest === b) || (r.hub === b && r.dest === a)

/** Что известно о будущем рейсе: расстояние, спрос, конкуренты и какие самолёты флота его выполнят. */
export function routeQuote(db: Db, icao: string, origin: string, dest: string): RouteQuote {
  const s = requireControl(db, icao)
  const o = airports.get(origin)
  const d = airports.get(dest)
  if (!o || !d || origin === dest) throw new Error('Выберите разные аэропорты')
  const km = distanceKm(o.lat, o.lon, d.lat, d.lon)
  const al = withState(airlines.get(s.icao)!, s)
  const rwy = Math.min(o.rwyM || 99999, d.rwyM || 99999)
  const types = Object.entries(s.fleet)
    .filter(([, n]) => n > 0)
    .map(([id]) => aircraftTypes.get(id)!)
    .map((t) => {
      let reason: string | null = null
      if (t.rangeKm < km * 1.05) reason = 'не долетит: дальность ' + Math.round(t.rangeKm).toLocaleString('ru-RU') + ' км'
      else if (t.minRunwayM > rwy * 1.15) reason = 'коротка ВПП (' + rwy + ' м)'
      else if (!typeServes(al, t, km, origin, dest)) reason = 'не подходит компании'
      return { id: t.id, name: t.name, rangeKm: t.rangeKm, reason }
    })
  let competitors = 0
  for (const x of loadStates(db).values())
    if (x.icao !== icao && x.routes.some((r) => r.freq > 0 && samePair(r, origin, dest))) competitors++
  return {
    km: Math.round(km),
    demand: Math.round(dailyDemand(origin, dest, km, 1, 1)),
    competitors,
    exists: s.routes.some((r) => r.freq > 0 && samePair(r, origin, dest)),
    scheduled: servesScheduled(origin) && servesScheduled(dest),
    types
  }
}

/** Открыть рейс между любыми аэропортами с регулярными рейсами на выбранном типе самолёта. */
export function openRoute(
  db: Db,
  icao: string,
  origin: string,
  dest: string,
  freq: number,
  typeId: string,
  withReturn = true
): void {
  const s = requireControl(db, icao)
  requireManual(s, 'routes')
  if (!withReturn) return openOneWay(db, s, origin, dest, typeId)
  const q = routeQuote(db, icao, origin, dest)
  if (!q.scheduled) throw new Error('В один из аэропортов регулярные рейсы не летают')
  if (q.km < 150) throw new Error('Слишком близко для рейса')
  const t = q.types.find((x) => x.id === typeId)
  if (!t) throw new Error('Выберите самолёт из своего флота')
  if (t.reason) throw new Error(t.name + ': ' + t.reason)
  const existing = s.routes.find((r) => (r.hub === origin && r.dest === dest) || (r.hub === dest && r.dest === origin))
  if (existing?.freq) throw new Error('Такой рейс уже есть')
  const route = existing ?? { hub: origin, dest, freq: 0, lf: 0.6, fare: 0, profit: 0, badMonths: 0 }
  route.freq = Math.max(1, Math.min(maxFreq(route), Math.round(freq)))
  route.badMonths = 0
  const prevType = route.type
  route.type = typeId
  if (!existing) s.routes.push(route)
  const undo = () => {
    if (existing) {
      existing.freq = 0
      if (prevType) existing.type = prevType
      else delete existing.type
    } else s.routes.splice(s.routes.indexOf(route), 1)
  }
  const plan = planBlockHours(s)
  if (plan.routes.get(route)?.type?.id !== typeId) {
    undo()
    throw new Error('Этот самолёт не долетит или не сядет на эту ВПП')
  }
  try {
    requireCapacity(s)
  } catch (e) {
    undo()
    throw e
  }
  commit(db, s)
}

/** Свободный номер рейса: после всех занятых номеров компании. */
function nextFreeNumber(s: AirlineState): number {
  const al = withState(airlines.get(s.icao)!, s)
  let top = 100
  for (const [key, num] of routeNumbers(al)) {
    const r = s.routes.find((x) => `${x.hub}-${x.dest}` === key)
    top = Math.max(top, num + (r?.freq ?? 1) * 2)
  }
  for (const l of s.legs ?? []) top = Math.max(top, l.num + 2)
  return top + (top % 2)
}

/**
 * Рейс в одну сторону: самолёт улетает ближайшим рейсом и остаётся в аэропорту прилёта, пока
 * игрок (или заместитель) не создаст обратный рейс. Всё это время самолёт не летает по расписанию.
 */
function openOneWay(db: Db, s: AirlineState, origin: string, dest: string, typeId: string): void {
  const q = routeQuote(db, s.icao, origin, dest)
  if (!q.scheduled) throw new Error('В один из аэропортов регулярные рейсы не летают')
  if (q.km < 150) throw new Error('Слишком близко для рейса')
  const t = q.types.find((x) => x.id === typeId)
  if (!t) throw new Error('Выберите самолёт из своего флота')
  if (t.reason) throw new Error(t.name + ': ' + t.reason)
  if (q.exists || s.legs?.some((l) => samePair({ hub: l.hub, dest: l.dest } as RouteState, origin, dest)))
    throw new Error('Такой рейс уже есть')
  const busy = new Set((s.legs ?? []).map((l) => l.reg))
  const reg = [...(s.regs?.[typeId] ?? [])].reverse().find((r) => !busy.has(r))
  if (!reg) throw new Error('Все самолёты этого типа уже стоят после рейсов в одну сторону')
  // Вылет — через пару часов, ровно в начале пятиминутки.
  const depAt = Math.ceil((worldNow(db) + 2 * 3_600_000) / 300_000) * 300_000
  s.legs = [...(s.legs ?? []), { hub: origin, dest, type: typeId, depAt, num: nextFreeNumber(s), reg }]
  try {
    requireCapacity(s)
  } catch (e) {
    s.legs.pop()
    throw new Error(`Если этот самолёт улетит в одну сторону, остальным не хватит часов. ${errText(e)}`)
  }
  commit(db, s)
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Обратный рейс к рейсу в одну сторону: маршрут становится обычным «туда-обратно», самолёт возвращается в расписание. */
export function createReturn(db: Db, icao: string, hub: string, dest: string, freq: number): void {
  const s = requireControl(db, icao)
  requireManual(s, 'routes')
  returnLeg(s, hub, dest, freq)
  commit(db, s)
}

function returnLeg(s: AirlineState, hub: string, dest: string, freq: number): void {
  const leg = s.legs?.find((l) => l.hub === hub && l.dest === dest)
  if (!leg) throw new Error('Рейс не найден')
  const legs = s.legs!
  s.legs = legs.filter((l) => l !== leg)
  const route: RouteState = { hub, dest, freq: 0, lf: 0.6, fare: 0, profit: 0, badMonths: 0, type: leg.type, num: leg.num }
  route.freq = Math.max(1, Math.min(maxFreq(route), Math.round(freq)))
  const existing = s.routes.find((r) => r.hub === hub && r.dest === dest)
  if (existing) Object.assign(existing, route)
  else s.routes.push(route)
  try {
    requireCapacity(s)
  } catch (e) {
    s.legs = legs
    if (existing) existing.freq = 0
    else s.routes.pop()
    throw e
  }
}

/** Перегнать самолёт без пассажиров обратно в аэропорт вылета: рейс в одну сторону отменяется. */
export function ferryBack(db: Db, icao: string, hub: string, dest: string): void {
  const s = requireControl(db, icao)
  const leg = s.legs?.find((l) => l.hub === hub && l.dest === dest)
  if (!leg) throw new Error('Рейс не найден')
  const t = aircraftTypes.get(leg.type)
  const h = airports.get(hub)!
  const d = airports.get(dest)!
  // Перегон: топливо и сборы за пустой рейс.
  const cost = Math.round((t ? (distanceKm(h.lat, h.lon, d.lat, d.lon) / 800) * t.fuelBurnKgH * 1.1 : 20_000) + 5_000)
  s.cash -= cost * cpi(db)
  s.legs = s.legs!.filter((l) => l !== leg)
  commit(db, s)
}

/** Сменить номер рейса: номер первого рейса «туда»; следующие частоты +2, обратные +1. */
export function setRouteNumber(db: Db, icao: string, hub: string, dest: string, num: number): void {
  const s = requireControl(db, icao)
  const r = s.routes.find((x) => x.hub === hub && x.dest === dest && x.freq > 0)
  const leg = s.legs?.find((l) => l.hub === hub && l.dest === dest)
  if (!r && !leg) throw new Error('Маршрут не найден')
  const n = Math.round(num)
  const span = (r?.freq ?? 1) * 2
  if (!(n >= 1) || n + span - 1 > 9999) throw new Error('Номер рейса — от 1 до 9999')
  const al = withState(airlines.get(icao)!, s)
  const taken: [number, number][] = []
  for (const [key, base] of routeNumbers(al)) {
    if (key === `${hub}-${dest}`) continue
    const other = s.routes.find((x) => `${x.hub}-${x.dest}` === key)
    taken.push([base, base + (other?.freq ?? 1) * 2 - 1])
  }
  for (const l of s.legs ?? []) if (l !== leg) taken.push([l.num, l.num])
  const clash = taken.find(([a, b]) => n <= b && n + span - 1 >= a)
  if (clash) throw new Error(`Номера ${al.iata}${n}–${al.iata}${n + span - 1} пересекаются с рейсом ${al.iata}${clash[0]}`)
  if (r) r.num = n
  if (leg) leg.num = n
  commit(db, s)
}

/** Сменить регистрацию борта. Номер должен быть свободен во всём мире. */
export function setRegistration(db: Db, icao: string, oldReg: string, newReg: string): void {
  const s = requireControl(db, icao)
  const reg = normalizeRegistration(newReg)
  const entry = Object.entries(s.regs ?? {}).find(([, list]) => list.includes(oldReg))
  if (!entry) throw new Error('Борт не найден')
  for (const x of loadStates(db).values())
    if (Object.values(x.regs ?? {}).some((list) => list.includes(reg))) throw new Error(`Регистрация ${reg} уже занята`)
  const list = entry[1]
  list[list.indexOf(oldReg)] = reg
  for (const l of s.legs ?? []) if (l.reg === oldReg) l.reg = reg
  commit(db, s)
}

/** Борта компании: где каждый сейчас. */
export function fleetTails(db: Db, icao: string): TailPosition[] {
  requireControl(db, icao)
  return fleetPositions(db, icao, worldNow(db))
}

// ——— советник по маршрутам ———

/** Сколько новых направлений предлагает советник. */
const ADVICE_SUGGESTIONS = 8

/**
 * Советник: разбирает каждый рейс (оставить, добавить или убрать частоту, сменить самолёт, закрыть)
 * и предлагает самые выгодные новые направления из баз на самолётах флота. Прибыль — операционная, без лизинга и офиса.
 */
export function routeAdvice(db: Db, icao: string): RouteAdvice {
  const s = requireControl(db, icao)
  const plan = planBlockHours(s)
  const hasData = !!s.last
  const spare = new Map([...plan.byType].map(([t, h]) => [t, h.available - h.needed]))
  const existing: RouteAdvice['existing'] = []
  for (const [r, p] of plan.routes) {
    if (r.freq <= 0 || !p.type) continue
    const cur = hasData ? { profit: r.profit, lf: r.lf } : (estimateRoute(db, icao, r.hub, r.dest, p.type.id, r.freq) ?? { profit: 0, lf: 0 })
    const alts = servingTypes(s, r.hub, r.dest, p.km)
      .filter((t) => t.id !== p.type!.id)
      .map((t) => ({ t, e: estimateRoute(db, icao, r.hub, r.dest, t.id, r.freq) }))
      .filter((x): x is { t: AircraftType; e: NonNullable<typeof x.e> } => !!x.e)
      .sort((a, b) => b.e.profit - a.e.profit)
    const best = alts[0]
    const base = { hub: r.hub, dest: r.dest, freq: r.freq, typeName: p.type.name, profit: Math.round(cur.profit), lf: cur.lf }
    const money = (n: number) => `$${Math.round(n).toLocaleString('ru-RU')}`
    if (cur.profit < 0 && best && best.e.profit > 0)
      existing.push({ ...base, verdict: 'replace', typeId: best.t.id, reason: `На ${best.t.name} рейс выйдет в плюс: около ${money(best.e.profit)} в месяц` })
    else if (cur.profit < 0 && r.freq > 1 && cur.lf < 0.7)
      existing.push({ ...base, verdict: 'less', reason: 'Убыточен при полупустых рейсах — меньше частот поднимет загрузку' })
    else if (cur.profit < 0)
      existing.push({ ...base, verdict: 'close', reason: `Убыток около ${money(-cur.profit)} в месяц, замены в флоте нет` })
    else if (cur.lf > 0.88 && r.freq < maxFreq(r) && p.blockHours / r.freq <= (spare.get(p.type.id) ?? 0))
      existing.push({ ...base, verdict: 'more', reason: `Загрузка ${Math.round(cur.lf * 100)}% — пассажиров хватит ещё на рейс` })
    else if (cur.lf > 0.88 && r.freq < maxFreq(r))
      existing.push({
        ...base,
        verdict: 'keep',
        reason: `Загрузка ${Math.round(cur.lf * 100)}%: можно добавить рейс, но у ${p.type.name} нет свободных часов — нужен ещё самолёт`
      })
    else if (cur.lf < 0.55 && r.freq > 1)
      existing.push({ ...base, verdict: 'less', reason: `Загрузка всего ${Math.round(cur.lf * 100)}% — частот больше, чем спроса` })
    else if (best && best.e.profit > cur.profit * 1.3 + 20_000)
      existing.push({ ...base, verdict: 'replace', typeId: best.t.id, reason: `${best.t.name} даст больше: около ${money(best.e.profit)} в месяц` })
    else existing.push({ ...base, verdict: 'keep', reason: hasData ? 'Приносит прибыль' : 'По прогнозу в плюсе' })
  }

  const seen = new Set<string>()
  const suggestions: RouteAdvice['suggestions'] = []
  for (const typeId of Object.keys(s.fleet).filter((t) => (s.fleet[t] ?? 0) > 0)) {
    const type = aircraftTypes.get(typeId)!
    for (const c of routeCandidates(db, s, typeId, 12)) {
      const e = estimateRoute(db, icao, c.hub, c.dest, typeId, 1)
      if (!e || e.profit <= 0) continue
      const hours = (blockMinutes(type, c.km) / 60) * 2 * 30
      suggestions.push({
        hub: c.hub,
        dest: c.dest,
        km: Math.round(c.km),
        typeId,
        typeName: type.name,
        lf: e.lf,
        fare: e.fare,
        profit: e.profit,
        competitors: e.competitors,
        fits: hours <= (spare.get(typeId) ?? 0)
      })
    }
  }
  suggestions.sort((a, b) => b.profit - a.profit)
  const top = suggestions.filter((x) => {
    const k = [x.hub, x.dest].sort().join('-')
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const order = { close: 0, replace: 1, less: 2, more: 3, keep: 4 }
  return {
    existing: existing.sort((a, b) => order[a.verdict] - order[b.verdict] || a.profit - b.profit),
    suggestions: top.slice(0, ADVICE_SUGGESTIONS),
    spare: [...spare].map(([typeId, hours]) => ({ typeId, name: aircraftTypes.get(typeId)?.name ?? typeId, hours: Math.round(hours) }))
  }
}

// ——— флот ———

/** Маршрутами управляет заместитель — у своей компании он сразу ставит новые самолёты на рейсы. */
function deputyRoutes(db: Db, s: AirlineState): void {
  if (autopilotOf(s).routes && playerAirlineIds.has(s.icao)) fillSchedule(s, servedPairs(loadStates(db)))
}

/** Самолёт входит в строй сразу: ждать перегона в игре скучно. */
function addAircraft(s: AirlineState, type: string, count: number, owned: boolean): void {
  s.fleet[type] = (s.fleet[type] ?? 0) + count
  if (owned) s.owned = { ...s.owned, [type]: (s.owned?.[type] ?? 0) + count }
}

export function leaseAircraft(db: Db, icao: string, typeId: string, count: number): void {
  const s = requireControl(db, icao)
  requireManual(s, 'fleet')
  const t = aircraftType(s, typeId)
  const n = Math.max(1, Math.round(count))
  const deposit = Math.round(t.valueMusd * 1e6 * LEASE_RATE * cpi(db) * LEASE_DEPOSIT_MONTHS * n)
  if (s.cash < deposit) throw new Error(`Не хватает денег на залог: нужно $${deposit.toLocaleString('ru-RU')}`)
  s.cash -= deposit
  addAircraft(s, t.id, n, false)
  deputyRoutes(db, s)
  commit(db, s)
}

export function buyAircraft(db: Db, icao: string, typeId: string, count: number): void {
  const s = requireControl(db, icao)
  requireManual(s, 'fleet')
  const t = aircraftType(s, typeId)
  const n = Math.max(1, Math.round(count))
  const price = Math.round(t.valueMusd * 1e6 * cpi(db) * n)
  if (s.cash < price) throw new Error(`Не хватает денег: нужно $${price.toLocaleString('ru-RU')}`)
  s.cash -= price
  addAircraft(s, t.id, n, true)
  deputyRoutes(db, s)
  commit(db, s)
}

/** Убрать самолёт из флота: вернуть лизингодателю или продать свой. */
function removeAircraft(db: Db, icao: string, typeId: string, owned: boolean): number {
  const s = requireControl(db, icao)
  requireManual(s, 'fleet')
  const t = aircraftTypes.get(typeId)
  const count = s.fleet[typeId] ?? 0
  const own = Math.min(count, s.owned?.[typeId] ?? 0)
  if (!t || (owned ? own : count - own) <= 0) throw new Error(owned ? 'Своих самолётов этого типа нет' : 'Самолётов этого типа в лизинге нет')
  if (fleetCount(s) <= 1) throw new Error('Нельзя остаться без самолётов')
  s.fleet[typeId] = count - 1
  if (owned) s.owned = { ...s.owned, [typeId]: own - 1 }
  // Если маршрутами управляет игрок, расписание должно поместиться в оставшийся флот.
  if (!autopilotOf(s).routes) {
    try {
      requireCapacity(s)
    } catch {
      s.fleet[typeId] = count
      if (owned) s.owned = { ...s.owned, [typeId]: own }
      throw new Error('Сначала сократите рейсы: без этого самолёта расписание не выполнить')
    }
  }
  const level = cpi(db)
  const money = Math.round(t.valueMusd * 1e6 * level * (owned ? RESALE : LEASE_RATE * LEASE_REFUND_MONTHS))
  s.cash += money
  commit(db, s)
  return money
}

export const returnLease = (db: Db, icao: string, typeId: string): number => removeAircraft(db, icao, typeId, false)
export const sellAircraft = (db: Db, icao: string, typeId: string): number => removeAircraft(db, icao, typeId, true)

/** Ежедневно: пришедшие самолёты входят в строй. */
export function airlinesDaily(db: Db, now: number): void {
  const states = loadStates(db)
  let changed = false
  for (const s of states.values()) {
    if (!s.deliveries?.length) continue
    const arrived = s.deliveries.filter((d) => d.arriveAt <= now)
    if (!arrived.length) continue
    for (const d of arrived) {
      s.fleet[d.type] = (s.fleet[d.type] ?? 0) + d.count
      if (d.owned) s.owned = { ...s.owned, [d.type]: (s.owned?.[d.type] ?? 0) + d.count }
    }
    s.deliveries = s.deliveries.filter((d) => d.arriveAt > now)
    s.version++
    changed = true
  }
  // Заместитель по маршрутам сам ставит обратные рейсы к рейсам в одну сторону.
  for (const s of states.values()) {
    if (!s.legs?.length || !autopilotOf(s).routes) continue
    for (const l of [...s.legs]) {
      try {
        returnLeg(s, l.hub, l.dest, 1)
      } catch {
        // Не хватает самолётов — перегоняем борт обратно.
        s.legs = s.legs!.filter((x) => x !== l)
      }
    }
    s.version++
    changed = true
  }
  // Новички закончили переподготовку и выходят в рейсы.
  for (const s of states.values()) {
    const ready = s.staff?.training.filter((x) => x.readyAt <= now)
    if (!ready?.length) continue
    for (const x of ready) {
      s.staff!.pilots += x.pilots
      s.staff!.cabin += x.cabin
    }
    s.staff!.training = s.staff!.training.filter((x) => x.readyAt > now)
    changed = true
  }
  if (changed) saveStates(db, states)
}

// ——— персонал ———

/** Найм с переподготовкой на тип; люди выходят в рейсы сразу. */
const HIRE_COST = { pilots: 12_000, cabin: 2_500 }
/** Выходное пособие при сокращении — две зарплаты. */
const SEVERANCE_MONTHS = 2

function staffInfo(db: Db, s: AirlineState): StaffInfo | null {
  if (!staffManaged(s)) return null
  const st = s.staff!
  const need = staffNeeds(s)
  const level = cpi(db)
  const sal = crewSalaries(s, need.avgPilotRate, level)
  return {
    ...st,
    pilotsNeeded: need.pilots,
    cabinNeeded: need.cabin,
    pilotSalary: sal.pilot,
    cabinSalary: sal.cabin,
    payroll: st.pilots * sal.pilot + st.cabin * sal.cabin,
    hireCostPilot: Math.round(HIRE_COST.pilots * level),
    hireCostCabin: Math.round(HIRE_COST.cabin * level),
    attritionPct: +(attritionRate(st.payLevel) * 100).toFixed(1)
  }
}

function requireStaff(db: Db, icao: string): AirlineState & { staff: Staff } {
  const s = requireControl(db, icao)
  requireManual(s, 'staff')
  if (!s.staff) s.staff = initialStaff(s)
  return s as AirlineState & { staff: Staff }
}

export function hireStaff(db: Db, icao: string, role: 'pilots' | 'cabin', count: number): void {
  const s = requireStaff(db, icao)
  const n = Math.max(1, Math.round(count))
  const cost = Math.round(HIRE_COST[role] * cpi(db) * n)
  if (s.cash < cost) throw new Error(`Не хватает денег на найм и переподготовку: нужно $${cost.toLocaleString('ru-RU')}`)
  s.cash -= cost
  s.staff[role] += n
  commit(db, s)
}

export function fireStaff(db: Db, icao: string, role: 'pilots' | 'cabin', count: number): void {
  const s = requireStaff(db, icao)
  const n = Math.min(s.staff[role], Math.max(1, Math.round(count)))
  if (!n) throw new Error('Сокращать некого')
  const sal = crewSalaries(s, staffNeeds(s).avgPilotRate, cpi(db))
  const severance = Math.round((role === 'pilots' ? sal.pilot : sal.cabin) * SEVERANCE_MONTHS * n)
  if (s.cash < severance) throw new Error(`Не хватает денег на выходные пособия: нужно $${severance.toLocaleString('ru-RU')}`)
  s.cash -= severance
  s.staff[role] -= n
  commit(db, s)
}

const clampLevel = (v: number) => Math.round(Math.min(STAFF_LEVEL_MAX, Math.max(STAFF_LEVEL_MIN, v)) * 20) / 20

export function setPayLevel(db: Db, icao: string, level: number): void {
  const s = requireStaff(db, icao)
  s.staff.payLevel = clampLevel(level)
  commit(db, s)
}

export function setService(db: Db, icao: string, level: number): void {
  const s = requireStaff(db, icao)
  s.staff.service = clampLevel(level)
  commit(db, s)
}

// ——— деньги ———

/** Банк начинает банкротство, когда долг больше восьми месячных выручек (как в sim.ts). */
const BANKRUPTCY_REVENUE_MONTHS = 8

/** Порог банкротства; у новой компании без итогов — по прогнозу месяца. */
function bankruptcyDebt(db: Db, s: AirlineState): number {
  const fin = s.last ?? projectAirline(db, s.icao)?.last ?? null
  return Math.round(Math.max(fin?.revenue ?? 0, (fin?.costs ?? 0) * 0.5) * BANKRUPTCY_REVENUE_MONTHS)
}
/** Комиссия банков-организаторов выпуска акций. */
const IPO_FEE = 0.07
/** Больше этой доли выставленных акций за месяц не раскупают. */
const OFFERING_MAX_APPETITE = 0.6
/** До IPO компания должна поработать и выйти в прибыль. */
const IPO_MIN_MONTHS = 3

/** Вложить личные деньги в компанию — например, чтобы спасти её от банкротства. */
export function injectCapital(db: Db, icao: string, amount: number): void {
  const s = requireControl(db, icao)
  const a = Math.round(amount)
  if (!(a > 0)) throw new Error('Укажите сумму')
  if (pilotRow(db).cash < a) throw new Error('У вас нет столько денег')
  transaction(db, () => {
    addTransaction(db, -a, `Вложение в капитал ${airlines.get(icao)?.name ?? icao}`)
    db.prepare('UPDATE stakes SET cost = cost + ? WHERE icao = ?').run(a, icao)
    s.cash += a
    commit(db, s)
  })
}

/** Капитализация: до выхода на биржу акции не торгуются — берём оценку. */
const marketCapOf = (s: AirlineState): number => (s.listed ? s.shares * 1e6 * s.sharePrice : Math.max(0, fairValue(s)))

/** Рост выручки за квартал: последняя месячная выручка к выручке три месяца назад. */
function revenueGrowth(db: Db, icao: string): number {
  const rows = db.prepare('SELECT revenue FROM airline_monthly WHERE icao = ? ORDER BY month DESC LIMIT 4').all(icao) as {
    revenue: number
  }[]
  if (rows.length < 2 || rows[rows.length - 1].revenue <= 0) return 0
  return rows[0].revenue / rows[rows.length - 1].revenue - 1
}

/**
 * Какую долю выставленных акций инвесторы раскупают за месяц. Им важны дивидендная доходность
 * (годовые дивиденды к капитализации), рост выручки и прибыль; кризис их отпугивает.
 */
export function investorAppetite(db: Db, s: AirlineState, payout = s.payout ?? 0): number {
  const cap = marketCapOf(s)
  const profit = s.last?.profit ?? 0
  const dividendYield = cap > 0 ? (Math.max(0, profit) * 12 * payout) / cap : 0
  const growth = Math.max(-0.3, Math.min(0.5, revenueGrowth(db, s.icao)))
  const a = 0.08 + dividendYield * 3 + growth * 0.6 + (profit > 0 ? 0.05 : -0.1) - (s.status === 'ok' ? 0 : 0.15)
  return Math.max(0.02, Math.min(OFFERING_MAX_APPETITE, a))
}

function ipoOffer(db: Db, s: AirlineState): IpoOffer | null {
  const stake = stakeOf(db, s.icao)
  if (!stake?.founded) return null
  const months = (db.prepare('SELECT COUNT(*) AS n FROM airline_monthly WHERE icao = ?').get(s.icao) as { n: number }).n
  const cap = Math.round(marketCapOf(s))
  const maxPct = Math.max(0, Math.floor((stake.pct - CONTROL_PCT) * 10) / 10)
  let blocked: string | null = null
  if (s.offering) blocked = 'Акции уже выставлены — дождитесь, пока их раскупят, или снимите остаток с продажи'
  else if (!s.listed && months < IPO_MIN_MONTHS) blocked = `Биржа ждёт отчётность хотя бы за ${IPO_MIN_MONTHS} месяца (сейчас ${months})`
  else if (!s.listed && (!s.last || s.last.profit <= 0)) blocked = 'Инвесторы не купят убыточную компанию: нужна прибыль за прошлый месяц'
  else if (s.status !== 'ok') blocked = 'Компания в долгах — сначала оздоровите финансы'
  else if (maxPct < 1) blocked = `Больше продавать нельзя: у вас должно остаться не меньше ${CONTROL_PCT}%`
  return {
    blocked,
    listed: !!s.listed,
    valuation: cap,
    maxPct,
    feePct: Math.round(IPO_FEE * 1000) / 10,
    appetitePct: Math.round(investorAppetite(db, s) * 1000) / 10,
    offering: s.offering ? { ...s.offering, pct: +s.offering.pct.toFixed(2), sold: +s.offering.sold.toFixed(2) } : null
  }
}

/**
 * Выпуск акций: игрок выставляет часть своей компании на биржу. Покупатели появляются постепенно,
 * каждый месяц (offeringsMonthly); деньги за проданное получает компания, контроль остаётся у игрока.
 */
export function goPublic(db: Db, icao: string, pct: number): void {
  const s = requireControl(db, icao)
  const offer = ipoOffer(db, s)
  if (!offer) throw new Error('Выпускать акции можно только в своей компании')
  if (offer.blocked) throw new Error(offer.blocked)
  const p = Math.round(pct * 10) / 10
  if (!(p >= 1) || p > offer.maxPct) throw new Error(`Можно выставить от 1 до ${offer.maxPct}%`)
  transaction(db, () => {
    if (!s.listed) {
      // Капитализация — по оценке; акции начинают торговаться с $10.
      s.listed = true
      s.sharePrice = s.prevSharePrice = 10
      s.shares = Math.max(0.01, offer.valuation / 10 / 1e6)
    }
    s.offering = { pct: p, sold: 0, proceeds: 0, startedAt: worldNow(db) }
    commit(db, s)
    db.prepare('INSERT INTO news (t, category, title, body) VALUES (?, ?, ?, ?)').run(
      worldNow(db),
      'airline',
      offer.listed ? `${airlines.get(icao)?.name} выпускает новые акции` : `${airlines.get(icao)?.name} выходит на биржу`,
      `На продажу выставлено ${p}% компании. Инвесторы будут покупать акции в ближайшие месяцы.`
    )
  })
}

/** Снять с продажи нераскупленный остаток. */
export function cancelOffering(db: Db, icao: string): void {
  const s = requireControl(db, icao)
  if (!s.offering) throw new Error('Акции не выставлены')
  delete s.offering
  commit(db, s)
}

/** Месячные покупки инвесторов по всем выставленным пакетам. Деньги — компании, доля игрока уменьшается. */
export function offeringsMonthly(db: Db, t: number): NewsDraft[] {
  const news: NewsDraft[] = []
  const states = loadStates(db)
  for (const s of states.values()) {
    const o = s.offering
    if (!o) continue
    const stake = stakeOf(db, s.icao)
    if (!stake || stake.pct < CONTROL_PCT) {
      delete s.offering
      continue
    }
    const left = o.pct - o.sold
    const sold = left <= 0.5 ? left : Math.min(left, Math.max(0.1, left * investorAppetite(db, s)))
    const proceeds = Math.round((sold / 100) * marketCapOf(s) * (1 - IPO_FEE))
    db.prepare('UPDATE stakes SET pct = pct - ? WHERE icao = ?').run(sold, s.icao)
    s.cash += proceeds
    o.sold += sold
    o.proceeds += proceeds
    if (o.pct - o.sold <= 1e-6) {
      const name = airlines.get(s.icao)?.name ?? s.icao
      news.push({
        t,
        category: 'airline',
        title: `Акции ${name} раскуплены`,
        body: `Инвесторы купили все ${o.pct}% компании. Компания получила $${Math.round(o.proceeds).toLocaleString('ru-RU')}.`
      })
      delete s.offering
    }
    s.version++
  }
  saveStates(db, states)
  return news
}

/** Резерв, который компания держит после дивидендов: два месяца расходов и три зарплаты CEO. */
const payoutReserve = (s: AirlineState): number => (s.last?.costs ?? 0) * 2 + (s.ceoSalary ?? 0) * 3

/**
 * Рекомендуемая доля дивидендов: такая, чтобы после квартальной выплаты у компании остался резерв.
 * null — квартал убыточный, дивиденды не выплатятся при любой доле.
 */
function recommendedPayout(s: AirlineState): number | null {
  const q = s.recentProfit.length >= 3 ? s.recentProfit.reduce((a, b) => a + b, 0) : (s.last?.profit ?? 0) * 3
  if (q <= 0) return null
  const free = s.cash - payoutReserve(s)
  return Math.max(0, Math.min(100, Math.floor((free / q) * 100)))
}

export function borrow(db: Db, icao: string, amount: number): void {
  const s = requireControl(db, icao)
  const a = Math.round(amount)
  if (!(a > 0)) throw new Error('Укажите сумму')
  if (a > borrowLimit(db, s)) throw new Error('Банк столько не даст')
  s.debt += a
  s.cash += a
  commit(db, s)
}

export function repay(db: Db, icao: string, amount: number): void {
  const s = requireControl(db, icao)
  const a = Math.min(Math.round(amount), Math.round(s.debt))
  if (!(a > 0)) throw new Error('Долга нет')
  if (a > s.cash) throw new Error('На счёте компании нет столько денег')
  s.debt -= a
  s.cash -= a
  commit(db, s)
}

export function setCeoSalary(db: Db, icao: string, amount: number): void {
  const s = requireControl(db, icao)
  const cap = ceoSalaryCap(db, s)
  const a = Math.max(0, Math.round(amount))
  if (a > cap) throw new Error(`Совет директоров не утвердит больше $${cap.toLocaleString('ru-RU')} в месяц`)
  s.ceoSalary = a
  commit(db, s)
}

export function setPayout(db: Db, icao: string, pct: number): void {
  const s = requireControl(db, icao)
  s.payout = Math.max(0, Math.min(100, Math.round(pct))) / 100
  commit(db, s)
}
