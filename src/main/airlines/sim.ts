import type { RouteState, Staff } from '@shared/airlines'
import type { MacroState } from '@shared/economy'
import type { AircraftType, Airline, Airport } from '@shared/world'
import { between, seededRng } from '@shared/random'
import type { Db } from '../db'
import type { NewsDraft } from '../economy/macro'
import { SEASONALITY, jetFuelUsdPerKg } from '../economy/macro'
import { aircraftTypes, airlines, airports, playerAirlineIds } from '../world'
import { distanceKm } from '../tracker/geo'
import { assignedType, blockMinutes, frequency, pickType, typeServes } from '../career/schedule'
import { serviceFactor, countryParams } from '../lifestyle/catalog'
import { COST_PROFILE, PRICE_APPEAL, averageFare, cargoRatePerKg, dailyDemand } from './demand'
import { FLAG_CARRIERS, loadStates, saveStates, withState, type AirlineState } from './state'
import { macroState } from '../economy/state'

/**
 * Месячная экономика всех авиакомпаний: рынок по маршрутам, выручка и расходы,
 * решения AI, банкротства, биржа. Мягкая конкуренция: никто не играет против пилота,
 * ценовых войн ниже себестоимости нет.
 */

export const DAYS = 30
/** Блок-часов в сутки, которые реально выжимают из самолёта. */
const BLOCK_HOURS_PER_DAY = 13
/** Ставка лизинга в месяц от стоимости самолёта. */
export const LEASE_RATE = 0.0085
/** Насколько цена билета сдвигает долю рынка и собственный спрос компании. */
const FARE_SHARE_ELASTICITY = 1.5
const FARE_DEMAND_ELASTICITY = 0.8
const fareMultOf = (s: AirlineState): number => s.fareMult ?? 1

/** Потолок частот: челночные маршруты между крупными аэропортами — до 12 рейсов в день. */
export function maxFreq(r: RouteState): number {
  const h = airports.get(r.hub)
  const d = airports.get(r.dest)
  if (!h || !d) return 6
  return h.type === 'large' && d.type === 'large' && distanceKm(h.lat, h.lon, d.lat, d.lon) < 2500 ? 12 : 6
}

/** Средняя ставка пилота в расходах авиакомпании, $/ч (по экипажам в целом; не зависит от зарплаты игрока). */
const AIRLINE_PILOT_RATE: Record<AircraftType['category'], number> = {
  turboprop: 65,
  regional: 79,
  narrowbody: 101,
  widebody: 137,
  freighter: 122,
  bizjet: 115
}

// ——— персонал ———

/** Блок-часов в месяц на одного члена экипажа — верхняя российская норма по соглашению с работником (решение пользователя). */
export const CREW_HOURS_PER_MONTH = 90
/** Надбавка к ставке экипажа: налоги, соцпакет, гостиницы, командировочные (как в flightCost). */
export const CREW_OVERHEAD = 2.6
const CABIN_RATE = 35
/** Сервис на борту: питание, наборы, обучение — $ на пассажира за каждую единицу уровня. */
const SERVICE_COST_PER_PAX = 8
/** Текучка экипажей в месяц при рыночной зарплате. */
const BASE_ATTRITION = 0.015

export const cabinPerFlight = (t: AircraftType): number => Math.ceil(t.seats / 50)
export const pilotRate = (t: AircraftType): number => AIRLINE_PILOT_RATE[t.category]

/** Экипажами управляет игрок (иначе расходы считаются по налёту, как у всех компаний). */
export const staffManaged = (s: AirlineState): boolean => !!s.staff && s.autopilot?.staff === false

/** Зарплата в месяц на одного с налогами и соцпакетом, $. */
export function crewSalaries(s: AirlineState, avgPilotRate: number, level: number): { pilot: number; cabin: number } {
  const k = CREW_HOURS_PER_MONTH * CREW_OVERHEAD * level * (s.staff?.payLevel ?? 1) * COST_PROFILE[airlines.get(s.icao)!.archetype].ops
  return { pilot: Math.round(avgPilotRate * k), cabin: Math.round(CABIN_RATE * k) }
}

/** Уходит в месяц: ниже рынка — больше, выше — меньше. */
export function attritionRate(payLevel: number): number {
  return BASE_ATTRITION * (payLevel < 1 ? 1 + (1 - payLevel) * 10 : Math.max(0.3, 1 - (payLevel - 1) * 3))
}

/** Сколько экипажей нужно расписанию и средняя ставка пилота по типам флота. */
export function staffNeeds(s: AirlineState): { pilots: number; cabin: number; avgPilotRate: number } {
  let pilotH = 0
  let cabinH = 0
  let rateH = 0
  for (const [, p] of planBlockHours(s).routes) {
    if (!p.type) continue
    pilotH += p.blockHours * 2
    cabinH += p.blockHours * cabinPerFlight(p.type)
    rateH += p.blockHours * pilotRate(p.type)
  }
  const bh = pilotH / 2
  return {
    pilots: Math.ceil(pilotH / CREW_HOURS_PER_MONTH),
    cabin: Math.ceil(cabinH / CREW_HOURS_PER_MONTH),
    avgPilotRate: bh ? rateH / bh : AIRLINE_PILOT_RATE.narrowbody
  }
}

/** Штат на старте: под расписание с запасом 10%. */
export function initialStaff(s: AirlineState): Staff {
  const need = staffNeeds(s)
  return { pilots: Math.ceil(need.pilots * 1.1), cabin: Math.ceil(need.cabin * 1.1), payLevel: 1, service: 1, training: [] }
}

interface RouteCalc {
  state: AirlineState
  route: RouteState
  al: Airline
  type: AircraftType
  km: number
  blockH: number
}

const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`)

/** Тип самолёта на маршруте: назначенный владельцем, иначе — выбранный по флоту (как в расписании). */
function routeType(al: Airline, r: RouteState, km: number): AircraftType | null {
  // В сети withState уже лежит назначенный тип или «Авто» компании игрока.
  const typeId = al.network.find((n) => n.hub === r.hub)?.type?.[r.dest] ?? r.type
  return assignedType(al, typeId, km, r.hub, r.dest) ?? pickType(al, km, r.hub, r.dest, seededRng(`${al.icao}|${r.hub}|${r.dest}|0`))
}

/** Расходы на один рейс в одну сторону, $. */
function flightCost(t: AircraftType, km: number, blockH: number, pax: number, dest: string, jet: number, level: number) {
  const local = serviceFactor(countryParams(airports.get(dest)?.country ?? null))
  const pilotRate = AIRLINE_PILOT_RATE[t.category]
  const cabin = Math.ceil(t.seats / 50) * 35
  const mtowT = t.mtowKg / 1000
  return {
    fuel: t.fuelBurnKgH * blockH * jet,
    // ×2.6: налоги, соцпакет, гостиницы и командировочные, резервные экипажи.
    crew: blockH * (2 * pilotRate + cabin) * 2.6 * level,
    maintenance: t.maintUsdPerHour * blockH * level,
    airport: (mtowT * 9 + pax * 14 + 150) * local * level,
    navigation: 0.6 * km * Math.sqrt(mtowT / 50) * level,
    handling: (pax * 4 + 350) * local * level
  }
}

export interface MonthContext {
  macro: MacroState
  monthStart: number
  rng: () => number
  /** false — только посчитать загрузку и финансы, не принимая решений (старт мира). */
  apply: boolean
}

/** Рынок и финансы за месяц. Возвращает расчёт по маршрутам. */
function computeMonth(states: Map<string, AirlineState>, ctx: MonthContext): Map<string, RouteCalc[]> {
  const month = new Date(ctx.monthStart).getUTCMonth()
  const season = SEASONALITY[month]
  const level = ctx.macro.cpi
  const jet = jetFuelUsdPerKg(ctx.macro.brent) * level
  const calcs = new Map<string, RouteCalc[]>()
  const markets = new Map<string, RouteCalc[]>()

  for (const s of states.values()) {
    const al = withState(airlines.get(s.icao)!, s)
    const list: RouteCalc[] = []
    for (const r of s.routes) {
      const h = airports.get(r.hub)
      const d = airports.get(r.dest)
      if (!h || !d || r.freq <= 0) continue
      const km = distanceKm(h.lat, h.lon, d.lat, d.lon)
      const type = routeType(al, r, km)
      if (!type) {
        r.freq = 0
        continue
      }
      const c: RouteCalc = { state: s, route: r, al, type, km, blockH: blockMinutes(type, km) / 60 }
      list.push(c)
      if (type.category !== 'freighter') {
        const k = pairKey(r.hub, r.dest)
        markets.set(k, [...(markets.get(k) ?? []), c])
      }
    }
    calcs.set(s.icao, list)
  }

  // Рынок: пассажиры делятся по вместимости, репутации и цене.
  for (const list of markets.values()) {
    const first = list[0]
    const demand = dailyDemand(first.route.hub, first.route.dest, first.km, season, ctx.macro.demandIndex)
    const weights = list.map(
      (c) =>
        Math.pow(c.route.freq * c.type.seats, 0.8) *
        Math.pow(c.state.reputation / 60, 1.5) *
        PRICE_APPEAL[c.al.archetype] *
        Math.pow(fareMultOf(c.state), -FARE_SHARE_ELASTICITY)
    )
    const total = weights.reduce((a, b) => a + b, 0) || 1
    list.forEach((c, i) => {
      const seats = c.route.freq * c.type.seats
      // Дешёвый билет ещё и создаёт спрос: летят те, кто иначе остался бы дома.
      const own = Math.pow(fareMultOf(c.state), -FARE_DEMAND_ELASTICITY)
      const pax = Math.min(seats * 0.97, (demand * weights[i] * own) / total)
      c.route.lf = seats ? pax / seats : 0
    })
  }

  // Финансы.
  for (const s of states.values()) {
    const list = calcs.get(s.icao)!
    const cost: Record<string, number> = { fuel: 0, crew: 0, maintenance: 0, airport: 0, navigation: 0, handling: 0, fleet: 0, overhead: 0 }
    let revenue = 0
    let pax = 0
    let lfWeighted = 0
    let flightsTotal = 0
    let blockHours = 0
    // Экипажи игрока: если людей меньше, чем требует расписание, часть рейсов отменяется.
    const managed = staffManaged(s)
    let staffFactor = 1
    let pilotH = 0
    let rateH = 0
    if (managed) {
      let cabinH = 0
      for (const c of list) {
        const bh = c.blockH * c.route.freq * 2 * DAYS
        pilotH += bh * 2
        cabinH += bh * cabinPerFlight(c.type)
        rateH += bh * pilotRate(c.type)
      }
      const st = s.staff!
      staffFactor = Math.min(
        1,
        pilotH ? (st.pilots * CREW_HOURS_PER_MONTH) / pilotH : 1,
        cabinH ? (st.cabin * CREW_HOURS_PER_MONTH) / cabinH : 1
      )
    }
    // У компании игрока вся сеть в модели: если на тип повешено больше рейсов, чем он успевает, часть отменяется.
    const typeFactor = new Map<string, number>()
    if (playerAirlineIds.has(s.icao)) {
      const need = new Map<string, number>()
      for (const c of list) need.set(c.type.id, (need.get(c.type.id) ?? 0) + c.blockH * c.route.freq * 2 * DAYS)
      for (const [t, h] of need) typeFactor.set(t, Math.min(1, ((s.fleet[t] ?? 0) * BLOCK_HOURS_PER_DAY * DAYS) / h))
    }
    let plannedFlights = 0
    const flown = new Map<RouteCalc, number>()
    for (const c of list) {
      const r = c.route
      const planned = r.freq * 2 * DAYS
      const flights = planned * Math.min(staffFactor, typeFactor.get(c.type.id) ?? 1)
      plannedFlights += planned
      flown.set(c, flights)
      let revFlight: number
      let paxFlight = 0
      if (c.type.category === 'freighter') {
        r.lf = Math.min(0.95, Math.max(0.35, 0.74 * ctx.macro.demandIndex * between(ctx.rng, 0.9, 1.1)))
        revFlight = c.type.cargoKg * r.lf * cargoRatePerKg(c.km, level)
        r.fare = 0
      } else {
        paxFlight = c.type.seats * r.lf
        r.fare = Math.round(averageFare(c.km, c.al.archetype, r.lf, level) * fareMultOf(s))
        revFlight = paxFlight * r.fare + c.type.cargoKg * 0.45 * cargoRatePerKg(c.km, level)
      }
      const fc = flightCost(c.type, c.km, c.blockH, paxFlight, r.dest, jet, level)
      // Экипаж, сборы и обслуживание у лоукостеров дешевле.
      const ops = COST_PROFILE[c.al.archetype].ops
      fc.crew *= ops
      fc.airport *= ops
      fc.handling *= ops
      if (managed) {
        // Экипаж игрока на окладе — считаем после цикла по штату, а не по налёту.
        fc.crew = 0
        fc.handling += paxFlight * SERVICE_COST_PER_PAX * level * (s.staff!.service - 1)
      }
      const costFlight = Object.values(fc).reduce((a, b) => a + b, 0)
      for (const [k, v] of Object.entries(fc)) cost[k] += v * flights
      r.profit = Math.round((revFlight - costFlight) * flights)
      revenue += revFlight * flights
      pax += paxFlight * flights
      lfWeighted += r.lf * flights
      flightsTotal += flights
      blockHours += c.blockH * flights
    }
    if (managed) {
      // Оклады платим всему штату, даже если людей больше, чем нужно; делим по маршрутам по блок-часам.
      const sal = crewSalaries(s, pilotH ? rateH / (pilotH / 2) : AIRLINE_PILOT_RATE.narrowbody, level)
      cost.crew = s.staff!.pilots * sal.pilot + s.staff!.cabin * sal.cabin
      for (const c of list) r_share(c.route, (c.blockH * flown.get(c)!) / (blockHours || 1), cost.crew)
    }
    const fleetCount = Object.values(s.fleet).reduce((a, b) => a + b, 0)
    // В данных у компании только часть реальной сети: остальные самолёты летают по маршрутам, которых
    // в модели нет, и окупают себя сами. Поэтому платим только за нужные сети самолёты + 10% резерва.
    const needed = blockHours / (BLOCK_HOURS_PER_DAY * DAYS)
    // У компании игрока вся сеть в модели — она платит за каждый свой самолёт.
    const activeShare = playerAirlineIds.has(s.icao) ? 1 : fleetCount ? Math.min(1, (needed * 1.1) / fleetCount) : 0
    cost.fleet =
      Object.entries(s.fleet).reduce(
        (sum, [t, n]) => sum + (aircraftTypes.get(t)?.valueMusd ?? 30) * 1e6 * LEASE_RATE * Math.max(0, n - (s.owned?.[t] ?? 0)) * level,
        0
      ) * activeShare
    // Наземный персонал, продажи, IT, офис — по реальным авиакомпаниям это от десятой до пятой части выручки.
    cost.overhead = revenue * COST_PROFILE[airlines.get(s.icao)!.archetype].overhead + fleetCount * activeShare * 60_000 * level
    const costs = Object.values(cost).reduce((a, b) => a + b, 0)
    s.last = {
      revenue: Math.round(revenue),
      costs: Math.round(costs),
      profit: Math.round(revenue - costs),
      pax: Math.round(pax),
      lf: flightsTotal ? +(lfWeighted / flightsTotal).toFixed(3) : 0,
      utilization: fleetCount ? +(blockHours / (fleetCount * BLOCK_HOURS_PER_DAY * DAYS)).toFixed(3) : 0,
      costBreakdown: Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.round(v)])),
      ...(managed || typeFactor.size ? { cancelled: plannedFlights ? +(1 - flightsTotal / plannedFlights).toFixed(3) : 0 } : {})
    }
  }
  return calcs
}

/** Расписание и флот в блок-часах за месяц — чтобы игрок не поставил рейсов больше, чем могут самолёты. */
export function planBlockHours(s: AirlineState): {
  needed: number
  available: number
  routes: Map<RouteState, { type: AircraftType | null; km: number; blockHours: number }>
  /** То же по типам самолётов: каждый тип летает только своими самолётами. */
  byType: Map<string, { needed: number; available: number }>
} {
  const al = withState(airlines.get(s.icao)!, s)
  const routes = new Map<RouteState, { type: AircraftType | null; km: number; blockHours: number }>()
  const byType = new Map<string, { needed: number; available: number }>()
  for (const [t, n] of Object.entries(s.fleet)) if (n > 0) byType.set(t, { needed: 0, available: n * BLOCK_HOURS_PER_DAY * DAYS })
  let needed = 0
  for (const r of s.routes) {
    const h = airports.get(r.hub)
    const d = airports.get(r.dest)
    if (!h || !d) continue
    const km = distanceKm(h.lat, h.lon, d.lat, d.lon)
    const type = r.freq > 0 ? routeType(al, r, km) : null
    const blockHours = type ? (blockMinutes(type, km) / 60) * r.freq * 2 * DAYS : 0
    routes.set(r, { type, km, blockHours })
    if (type) byType.get(type.id)!.needed += blockHours
    needed += blockHours
  }
  const fleetCount = Object.values(s.fleet).reduce((a, b) => a + b, 0)
  return { needed, available: fleetCount * BLOCK_HOURS_PER_DAY * DAYS, routes, byType }
}

/** Доля расходов на экипаж — в прибыль маршрута. */
function r_share(r: RouteState, share: number, crew: number): void {
  r.profit = Math.round(r.profit - crew * share)
}

/**
 * Прогноз месяца для одной компании, не меняя мира: рынок считается на копии состояний.
 * Нужен для маршрутов без итогов — новой компании или только что открытого рейса.
 */
export function projectAirline(db: Db, icao: string): AirlineState | null {
  const macro = macroState(db)
  const day = new Date(macro.day * 86_400_000)
  const clone = new Map([...loadStates(db)].map(([k, v]) => [k, structuredClone(v)]))
  computeMonth(clone, {
    macro,
    monthStart: Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1),
    rng: seededRng(`project|${icao}|${macro.day}`),
    apply: false
  })
  return clone.get(icao) ?? null
}

// ——— старт мира ———

/** Начальное состояние: сеть из статичных данных, частоты подогнаны под флот. */
export function initAirlineStates(db: Db, macro: MacroState, monthStart: number, seed: string): void {
  const states = new Map<string, AirlineState>()
  for (const al of airlines.values()) {
    const routes: RouteState[] = []
    for (const n of al.network) {
      for (const dest of n.destinations) {
        const h = airports.get(n.hub)
        const d = airports.get(dest)
        if (!h || !d) continue
        const km = distanceKm(h.lat, h.lon, d.lat, d.lon)
        routes.push({ hub: n.hub, dest, freq: frequency(al, km, dest), lf: 0.75, fare: 0, profit: 0, badMonths: 0 })
      }
    }
    states.set(al.icao, {
      icao: al.icao,
      cash: 0,
      debt: 0,
      reputation: al.reputation,
      fleet: Object.fromEntries(al.fleet.map((f) => [f.type, f.count])),
      routes,
      shares: 1,
      sharePrice: 10,
      prevSharePrice: 10,
      status: 'ok',
      restarts: 0,
      last: null,
      recentProfit: [],
      version: 1
    })
  }
  const ctx: MonthContext = { macro, monthStart, rng: seededRng(`${seed}|airlines-init`), apply: false }
  // Подгоняем частоты под флот: расписание должно помещаться в самолёты.
  for (let pass = 0; pass < 6; pass++) {
    computeMonth(states, ctx)
    for (const s of states.values()) fitFrequencies(s)
  }
  computeMonth(states, ctx)
  computeMonth(states, ctx)

  const rng = seededRng(`${seed}|shares`)
  for (const s of states.values()) {
    const rev = s.last!.revenue
    s.cash = rev * between(rng, 1.5, 3)
    s.debt = rev * between(rng, 1, 3)
    s.sharePrice = s.prevSharePrice = +between(rng, 4, 80).toFixed(2)
    s.shares = Math.max(1, fairValue(s) / s.sharePrice / 1e6)
  }
  saveStates(db, states)
}

/** Частоты под флот: перегруз — режем слабые маршруты, недогруз — добавляем рейсы на самые востребованные. */
function fitFrequencies(s: AirlineState): void {
  const u = s.last?.utilization ?? 1
  const routes = [...s.routes].filter((r) => r.freq > 0)
  if (u > 1.0) {
    routes.sort((a, b) => a.lf - b.lf)
    const cut = Math.ceil(routes.length * Math.min(0.5, u - 0.95))
    for (const r of routes.slice(0, cut)) r.freq = Math.max(1, r.freq - 1)
  }
}

/** Оценка компании: выручка, прибыль и деньги за вычетом долгов. */
export function fairValue(s: AirlineState): number {
  const rev = (s.last?.revenue ?? 0) * 12
  const profit = (s.last?.profit ?? 0) * 12
  return Math.max(rev * 0.05, rev * 0.12 + Math.max(-rev * 0.08, profit) * 8 + (s.cash - s.debt) * 0.6)
}

// ——— ежемесячный шаг ———

export interface MonthResult {
  news: NewsDraft[]
  /** Компании, начавшие заново после банкротства (для увольнения пилота). */
  restarted: string[]
  /** Дивиденды на акцию за этот месяц, $. */
  dividends: Record<string, number>
  /** Зарплата CEO-игроку по компаниям, $ до налога. */
  ceoPay: Record<string, number>
  /** Долг обанкротившихся компаний в момент банкротства, $ (для поручительства игрока). */
  bankruptDebt: Record<string, number>
}

export function simulateAirlinesMonth(db: Db, macro: MacroState, monthStart: number, seed: string): MonthResult {
  const states = loadStates(db)
  const rng = seededRng(`${seed}|airlines|${monthStart}`)
  const ctx: MonthContext = { macro, monthStart, rng, apply: true }
  computeMonth(states, ctx)
  const t = monthStart + 12 * 3_600_000
  const news: NewsDraft[] = []
  const restarted: string[] = []
  const dividends: Record<string, number> = {}
  const ceoPay: Record<string, number> = {}
  const bankruptDebt: Record<string, number> = {}
  const quarter = [0, 3, 6, 9].includes(new Date(monthStart).getUTCMonth())
  const pairs = servedPairs(states)

  for (const s of states.values()) {
    const al = airlines.get(s.icao)!
    const fin = s.last!
    const level = macro.cpi
    const monthlyCosts = Math.max(1, fin.costs)

    // Деньги и долги. Зарплату CEO-игроку платим, только пока у компании есть деньги.
    s.cash += fin.profit
    if (s.ceoSalary && s.cash > s.ceoSalary) {
      s.cash -= s.ceoSalary
      ceoPay[s.icao] = s.ceoSalary
    }
    s.cash -= s.debt * (s.debtRate ?? 0.007)
    if (s.cash < 0) {
      s.debt += -s.cash + monthlyCosts * 0.5
      s.cash = monthlyCosts * 0.5
    } else if (s.debt > 0 && s.cash > monthlyCosts * 3) {
      // Излишек денег идёт на погашение долга.
      const repay = Math.min(s.debt, s.cash - monthlyCosts * 3)
      s.debt -= repay
      s.cash -= repay
    }
    s.recentProfit = [...s.recentProfit, fin.profit].slice(-3)
    s.reputation = Math.max(10, Math.min(95, s.reputation + (fin.profit > 0 && fin.lf > 0.75 ? 0.3 : fin.profit < 0 ? -0.3 : 0)))
    if (staffManaged(s)) staffMonth(s)
    if (fin.cancelled) news.push(...cancellationsMonth(s, al, fin.cancelled, t))
    const revenueBase = Math.max(fin.revenue, monthlyCosts * 0.5)
    s.status = s.debt > revenueBase * 4 ? 'distress' : s.status === 'restarted' && s.debt < revenueBase ? 'ok' : s.status === 'distress' ? 'ok' : s.status

    // Банкротство: национальных спасает государство, частные начинают заново с одного самолёта.
    if (s.debt > revenueBase * 8) {
      if (FLAG_CARRIERS.has(s.icao)) {
        s.debt *= 0.4
        s.cash = monthlyCosts * 2
        s.reputation = Math.max(10, s.reputation - 5)
        s.status = 'distress'
        news.push({
          t,
          category: 'airline',
          title: `Государство спасает ${al.name}`,
          body: `Правительство списало часть долгов национального перевозчика и влило деньги в капитал. Компания продолжает работу.`
        })
      } else {
        bankruptDebt[s.icao] = Math.round(s.debt)
        restartAirline(s, al, level)
        restarted.push(s.icao)
        news.push({
          t,
          category: 'airline',
          title: `${al.name} обанкротилась`,
          body: `Кредиторы забрали флот. Компания начинает заново с одного самолёта и одного маршрута, престиж упал до ${Math.round(s.reputation)}.`
        })
      }
    } else {
      news.push(...decide(s, al, macro, rng, t, pairs))
    }

    // Биржа.
    const fair = fairValue(s) / (s.shares * 1e6)
    s.prevSharePrice = s.sharePrice
    const noise = 1 + 0.04 * (rng() * 2 - 1) * (macro.cycle === 'recession' ? 1.6 : 1)
    // Цена плавно тянется к оценке (15% разрыва в месяц) — крупные компании не скачут на десятки процентов.
    s.sharePrice = Math.max(0.05, +((s.sharePrice + (fair - s.sharePrice) * 0.15) * noise).toFixed(2))

    // Дивиденды раз в квартал: 30% прибыли (у компаний игрока — сколько он решил), если компания здорова.
    const qProfit = s.recentProfit.reduce((a, b) => a + b, 0)
    const payout = s.payout ?? 0.3
    if (quarter && payout > 0 && qProfit > 0 && s.cash > s.debt * 0.3 && s.status === 'ok') {
      const total = qProfit * payout
      s.cash -= total
      dividends[s.icao] = +(total / (s.shares * 1e6)).toFixed(4)
    }

    s.version++
    db.prepare(
      'INSERT OR REPLACE INTO airline_monthly (icao, month, revenue, profit, lf, share_price, cash) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(s.icao, monthStart, fin.revenue, fin.profit, fin.lf, s.sharePrice, Math.round(s.cash))
  }
  saveStates(db, states)
  return { news, restarted, dividends, ceoPay, bankruptDebt }
}

/** Месяц для экипажей игрока: текучка, репутация от сервиса и зарплат. */
function staffMonth(s: AirlineState): void {
  const st = s.staff!
  const rate = attritionRate(st.payLevel)
  st.pilots = Math.max(0, st.pilots - Math.round(st.pilots * rate))
  st.cabin = Math.max(0, st.cabin - Math.round(st.cabin * rate))
  // Хороший сервис понемногу поднимает репутацию, зарплаты ниже рынка — понемногу роняют.
  const delta = (st.service - 1) * 4 - (st.payLevel < 0.9 ? 0.5 : 0)
  s.reputation = Math.max(10, Math.min(95, s.reputation + delta))
}

/** Отменённые рейсы (не хватило экипажей или самолётов нужного типа) сильно бьют по репутации. */
function cancellationsMonth(s: AirlineState, al: Airline, cancelled: number, t: number): NewsDraft[] {
  s.reputation = Math.max(10, Math.min(95, s.reputation - cancelled * 15))
  if (cancelled < 0.05) return []
  return [
    {
      t,
      category: 'airline',
      title: `${al.name} отменяет рейсы`,
      body: `Компании не хватает самолётов или экипажей: за месяц отменено ${Math.round(cancelled * 100)}% рейсов. Пассажиры недовольны.`
    }
  ]
}

function restartAirline(s: AirlineState, al: Airline, level: number): void {
  // Самый маленький пассажирский (или грузовой) самолёт флота и лучший маршрут из главного хаба.
  const types = Object.keys(s.fleet)
    .map((id) => aircraftTypes.get(id)!)
    .filter((t) => (al.archetype === 'cargo') === (t.category === 'freighter'))
    .sort((a, b) => a.valueMusd - b.valueMusd)
  const type = types[0] ?? aircraftTypes.get(Object.keys(s.fleet)[0])!
  const hub = al.network[0].hub
  const best = s.routes.filter((r) => r.hub === hub && r.freq > 0).sort((a, b) => b.profit - a.profit)[0] ?? s.routes[0]
  s.fleet = { [type.id]: 1 }
  // Кредиторы забирают и свои самолёты, и ещё не пришедшие.
  s.owned = {}
  s.deliveries = []
  s.routes = s.routes.map((r) => ({ ...r, freq: r === best ? 1 : 0, badMonths: 0 }))
  s.debt = 0
  s.cash = type.valueMusd * 1e6 * LEASE_RATE * 6 * level
  s.reputation = Math.max(20, s.reputation * 0.5)
  s.shares *= 10
  s.sharePrice = Math.max(0.05, s.sharePrice * 0.05)
  s.status = 'restarted'
  s.restarts++
}

/** Решения AI раз в месяц. Новости — только о заметных событиях, не больше двух на компанию. */
function decide(
  s: AirlineState,
  al: Airline,
  macro: MacroState,
  rng: () => number,
  t: number,
  pairs: Map<string, number>
): NewsDraft[] {
  const news: NewsDraft[] = []
  const fin = s.last!
  const city = (icao: string) => airports.get(icao)?.city ?? icao
  // Разделы, которые игрок взял на себя, ИИ не трогает.
  const aiFleet = s.autopilot?.fleet ?? true
  const aiRoutes = s.autopilot?.routes ?? true

  // 1. Маршруты в затяжном убытке — сокращаем, потом закрываем.
  for (const r of aiRoutes ? s.routes : []) {
    if (r.freq <= 0) continue
    r.badMonths = r.profit < 0 && r.lf < 0.6 ? r.badMonths + 1 : 0
    if (r.badMonths >= 3) {
      r.freq--
      r.badMonths = 0
      if (r.freq === 0 && news.length < 2 && s.routes.filter((x) => x.freq > 0).length > 1) {
        news.push({ t, category: 'airline', title: `${al.name} закрывает рейс ${city(r.hub)} — ${city(r.dest)}`, body: 'Маршрут несколько месяцев приносил убытки при низкой загрузке.' })
      } else if (r.freq === 0) r.freq = 1
    }
  }

  // 2. Флот под расписание.
  const fleetCount = Object.values(s.fleet).reduce((a, b) => a + b, 0)
  const used = mostUsedType(s, al)
  if (fin.utilization > 1.02 && used && (aiFleet || aiRoutes)) {
    const need = Math.min(5, Math.ceil((fin.utilization - 0.92) * fleetCount))
    const deposit = used.valueMusd * 1e6 * LEASE_RATE * 3 * macro.cpi * need
    if (aiFleet && s.cash > deposit && s.status === 'ok') {
      s.fleet[used.id] = (s.fleet[used.id] ?? 0) + need
      s.cash -= deposit
      if (need >= 3 && news.length < 2) {
        news.push({ t, category: 'airline', title: `${al.name} пополняет флот`, body: `В лизинг взяты ещё ${need} ${used.name} — расписанию не хватало самолётов.` })
      }
    } else if (aiRoutes) fitFrequencies(s)
  }

  // 3. Рост: прибыльная компания с занятым флотом и полными рейсами берёт ещё самолёты.
  const margin = fin.revenue ? fin.profit / fin.revenue : 0
  if (aiFleet && s.status === 'ok' && used && fin.utilization >= 0.95 && fin.lf > 0.85 && margin > 0.1) {
    const add = Math.min(5, Math.max(1, Math.round(fleetCount * 0.03)))
    const deposit = used.valueMusd * 1e6 * LEASE_RATE * 3 * macro.cpi * add
    if (s.cash > deposit + fin.costs) {
      s.fleet[used.id] = (s.fleet[used.id] ?? 0) + add
      s.cash -= deposit
      if (add >= 3 && news.length < 2) {
        news.push({ t, category: 'airline', title: `${al.name} расширяет флот`, body: `Спрос растёт: компания берёт в лизинг ещё ${add} ${used.name}.` })
      }
    }
  }

  // 4. Компания игрока: заместитель занимает самолёты работой и открывает рейсы сам.
  if (aiRoutes && playerAirlineIds.has(s.icao)) {
    const opened = fillSchedule(s, pairs)
    if (opened.length && news.length < 2) {
      news.push({
        t,
        category: 'airline',
        title: `${al.name} открывает новые рейсы`,
        body: `Новые направления: ${opened.map((r) => `${city(r.hub)} — ${city(r.dest)}`).join(', ')}.`
      })
    }
  }
  // Компании мира: больше рейсов на полные маршруты и новые направления, если есть деньги.
  else if (aiRoutes && s.status === 'ok' && fin.profit > 0 && fin.utilization < 0.95) {
    s.routes
      .filter((r) => r.freq > 0 && r.lf > 0.88 && r.profit > 0)
      .sort((a, b) => b.lf - a.lf)
      .slice(0, 2)
      .forEach((r) => (r.freq = Math.min(maxFreq(r), r.freq + 1)))
  }
  if (aiRoutes && !playerAirlineIds.has(s.icao) && s.status === 'ok' && s.cash > fin.costs * 2 && fin.utilization < 0.9 && rng() < 0.3) {
    const opened = openRoute(s, al, rng)
    if (opened && news.length < 2) {
      news.push({
        t,
        category: 'airline',
        title: `${al.name} открывает рейс ${city(opened.hub)} — ${city(opened.dest)}`,
        body: `Новое направление: ${opened.freq} рейс(а) в день.`
      })
    }
  }
  s.routes = s.routes.filter((r) => r.freq > 0 || r.lf > 0 || r.badMonths > 0)
  return news
}

// ——— заместитель по маршрутам у компании игрока ———

/** До какой доли часов заместитель занимает самолёты: остальное — запас на задержки и ТО. */
const FILL_TARGET = 0.9
/** Меньше этого запаса часов у типа — новых рейсов на нём уже не ищем. */
const FILL_MIN_SPARE_H = 20

/** Сколько компаний летает по каждой паре аэропортов. */
export function servedPairs(states: Map<string, AirlineState>): Map<string, number> {
  const pairs = new Map<string, number>()
  for (const s of states.values())
    for (const r of s.routes) if (r.freq > 0) pairs.set(pairKey(r.hub, r.dest), (pairs.get(pairKey(r.hub, r.dest)) ?? 0) + 1)
  return pairs
}

/** Направления из базы для типа: долетает, садится, лучшие по спросу и меньшей конкуренции — первыми. */
function newRouteCandidates(al: Airline, type: AircraftType, hub: string, pairs: Map<string, number>) {
  const h = airports.get(hub)
  if (!h) return []
  const out: { dest: string; km: number; score: number }[] = []
  for (const a of airports.values()) {
    if (a.icao === hub || !a.scheduled || a.type === 'small') continue
    const km = distanceKm(h.lat, h.lon, a.lat, a.lon)
    if (km < 300 || !typeServes(al, type, km, hub, a.icao)) continue
    out.push({ dest: a.icao, km, score: dailyDemand(hub, a.icao, km, 1, 1) / (1 + (pairs.get(pairKey(hub, a.icao)) ?? 0)) })
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Заместитель по маршрутам у компании игрока: занимает самолёты работой примерно на 90% их часов.
 * Сначала добавляет рейсы на полные прибыльные маршруты, потом открывает новые из баз — где спрос выше,
 * а конкурентов меньше. Экипажей игрока не перегружает. Возвращает открытые маршруты.
 */
export function fillSchedule(s: AirlineState, pairs: Map<string, number>): RouteState[] {
  const al = withState(airlines.get(s.icao)!, s)
  const hubs = [...new Set([...s.routes.filter((r) => r.freq > 0).map((r) => r.hub), ...airlines.get(s.icao)!.network.map((n) => n.hub)])]
  const crewHours = staffManaged(s) ? (s.staff!.pilots * CREW_HOURS_PER_MONTH) / 2 : Infinity
  const candidates = new Map<string, { hub: string; dest: string; km: number; score: number }[]>()
  const exhausted = new Set<string>()
  const opened: RouteState[] = []

  for (let guard = 0; guard < 80; guard++) {
    const plan = planBlockHours(s)
    if (plan.needed >= crewHours * FILL_TARGET) break
    const spareOf = (h: { needed: number; available: number }) => h.available * FILL_TARGET - h.needed
    const next = [...plan.byType]
      .filter(([id, h]) => !exhausted.has(id) && spareOf(h) >= FILL_MIN_SPARE_H)
      .sort((a, b) => spareOf(b[1]) - spareOf(a[1]))[0]
    if (!next) break
    const [typeId, hours] = next
    const spare = Math.min(spareOf(hours), crewHours * FILL_TARGET - plan.needed)
    const type = aircraftTypes.get(typeId)!

    // 1. Ещё рейс туда, где этот тип летает полным и в плюс.
    const full = [...plan.routes]
      .filter(([r, p]) => r.freq > 0 && p.type?.id === typeId && r.freq < maxFreq(r) && r.lf > 0.85 && r.profit >= 0)
      .filter(([r, p]) => p.blockHours / r.freq <= spare)
      .sort((a, b) => b[0].lf - a[0].lf)[0]
    if (full) {
      full[0].freq++
      continue
    }

    // 2. Новый маршрут из базы на этом типе.
    if (!candidates.has(typeId))
      candidates.set(
        typeId,
        hubs.flatMap((hub) => newRouteCandidates(al, type, hub, pairs).map((c) => ({ ...c, hub }))).sort((a, b) => b.score - a.score)
      )
    const pick = candidates.get(typeId)!.find(
      (c) =>
        (blockMinutes(type, c.km) / 60) * 2 * DAYS <= spare &&
        !s.routes.some((r) => r.freq > 0 && ((r.hub === c.hub && r.dest === c.dest) || (r.hub === c.dest && r.dest === c.hub)))
    )
    if (!pick) {
      exhausted.add(typeId)
      continue
    }
    const existing = s.routes.find((r) => r.hub === pick.hub && r.dest === pick.dest)
    const route = existing ?? { hub: pick.hub, dest: pick.dest, freq: 0, lf: 0.6, fare: 0, profit: 0, badMonths: 0 }
    Object.assign(route, { freq: 1, badMonths: 0, type: typeId })
    if (!existing) s.routes.push(route)
    pairs.set(pairKey(pick.hub, pick.dest), (pairs.get(pairKey(pick.hub, pick.dest)) ?? 0) + 1)
    opened.push(route)
  }
  return opened
}

function mostUsedType(s: AirlineState, al: Airline): AircraftType | null {
  const ids = Object.entries(s.fleet).sort((a, b) => b[1] - a[1])
  for (const [id] of ids) {
    const t = aircraftTypes.get(id)
    if (t && (al.archetype === 'cargo') === (t.category === 'freighter')) return t
  }
  return null
}

/** Новое направление: крупный аэропорт в пределах дальности, где компании ещё нет; выбираем по спросу. */
function openRoute(s: AirlineState, al: Airline, rng: () => number): RouteState | null {
  const hub = al.network[Math.floor(rng() * al.network.length)].hub
  const h = airports.get(hub)!
  const maxRange = Math.max(...Object.keys(s.fleet).map((id) => aircraftTypes.get(id)?.rangeKm ?? 0)) * 0.9
  const served = new Set(s.routes.filter((r) => r.hub === hub && r.freq > 0).map((r) => r.dest))
  const sizeOk = (a: Airport) => a.type === 'large' || (a.type === 'medium' && a.scheduled && al.archetype !== 'legacy')
  const all = [...airports.values()].filter((a) => sizeOk(a) && a.icao !== hub && !served.has(a.icao))
  const domestic = all.filter((a) => a.country === h.country)
  // Половина попыток — внутри страны: так растут реальные сети.
  const pickFrom = () => (domestic.length && rng() < 0.5 ? domestic : all)
  let best: { icao: string; score: number } | null = null
  for (let i = 0; i < 40; i++) {
    const pool = pickFrom()
    if (!pool.length) break
    const a = pool[Math.floor(rng() * pool.length)]
    const km = distanceKm(h.lat, h.lon, a.lat, a.lon)
    if (km < 300 || km > maxRange) continue
    const score = dailyDemand(hub, a.icao, km, 1, 1) * (0.7 + rng() * 0.6)
    if (!best || score > best.score) best = { icao: a.icao, score }
  }
  if (!best) return null
  const existing = s.routes.find((r) => r.hub === hub && r.dest === best!.icao)
  const route = existing ?? { hub, dest: best.icao, freq: 0, lf: 0.6, fare: 0, profit: 0, badMonths: 0 }
  route.freq = 1
  if (!existing) s.routes.push(route)
  return route
}
