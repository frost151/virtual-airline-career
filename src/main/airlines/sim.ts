import type { RouteState } from '@shared/airlines'
import type { MacroState } from '@shared/economy'
import type { AircraftType, Airline, Airport } from '@shared/world'
import { between, seededRng } from '@shared/random'
import type { Db } from '../db'
import type { NewsDraft } from '../economy/macro'
import { SEASONALITY, jetFuelUsdPerKg } from '../economy/macro'
import { aircraftTypes, airlines, airports, playerAirlineIds } from '../world'
import { distanceKm } from '../tracker/geo'
import { blockMinutes, frequency, pickType } from '../career/schedule'
import { serviceFactor, countryParams } from '../lifestyle/catalog'
import { COST_PROFILE, PRICE_APPEAL, averageFare, cargoRatePerKg, dailyDemand } from './demand'
import { FLAG_CARRIERS, loadStates, saveStates, withState, type AirlineState } from './state'

/**
 * Месячная экономика всех авиакомпаний: рынок по маршрутам, выручка и расходы,
 * решения AI, банкротства, биржа. Мягкая конкуренция: никто не играет против пилота,
 * ценовых войн ниже себестоимости нет.
 */

const DAYS = 30
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

interface RouteCalc {
  state: AirlineState
  route: RouteState
  al: Airline
  type: AircraftType
  km: number
  blockH: number
}

const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`)

function routeType(al: Airline, r: RouteState, km: number): AircraftType | null {
  return pickType(al, km, r.hub, r.dest, seededRng(`${al.icao}|${r.hub}|${r.dest}|0`))
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
    for (const c of list) {
      const r = c.route
      const flights = r.freq * 2 * DAYS
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
      const costFlight = Object.values(fc).reduce((a, b) => a + b, 0)
      for (const [k, v] of Object.entries(fc)) cost[k] += v * flights
      r.profit = Math.round((revFlight - costFlight) * flights)
      revenue += revFlight * flights
      pax += paxFlight * flights
      lfWeighted += r.lf * flights
      flightsTotal += flights
      blockHours += c.blockH * flights
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
      costBreakdown: Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, Math.round(v)]))
    }
  }
  return calcs
}

/** Расписание и флот в блок-часах за месяц — чтобы игрок не поставил рейсов больше, чем могут самолёты. */
export function planBlockHours(s: AirlineState): {
  needed: number
  available: number
  routes: Map<RouteState, { type: AircraftType | null; km: number; blockHours: number }>
} {
  const al = withState(airlines.get(s.icao)!, s)
  const routes = new Map<RouteState, { type: AircraftType | null; km: number; blockHours: number }>()
  let needed = 0
  for (const r of s.routes) {
    const h = airports.get(r.hub)
    const d = airports.get(r.dest)
    if (!h || !d) continue
    const km = distanceKm(h.lat, h.lon, d.lat, d.lon)
    const type = r.freq > 0 ? routeType(al, r, km) : null
    const blockHours = type ? (blockMinutes(type, km) / 60) * r.freq * 2 * DAYS : 0
    routes.set(r, { type, km, blockHours })
    needed += blockHours
  }
  const fleetCount = Object.values(s.fleet).reduce((a, b) => a + b, 0)
  return { needed, available: fleetCount * BLOCK_HOURS_PER_DAY * DAYS, routes }
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
function fairValue(s: AirlineState): number {
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
  const quarter = [0, 3, 6, 9].includes(new Date(monthStart).getUTCMonth())

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
      news.push(...decide(s, al, macro, rng, t))
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
  return { news, restarted, dividends, ceoPay }
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
function decide(s: AirlineState, al: Airline, macro: MacroState, rng: () => number, t: number): NewsDraft[] {
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

  // 4. Больше рейсов на полные маршруты и новые направления, если есть деньги.
  if (aiRoutes && s.status === 'ok' && fin.profit > 0 && fin.utilization < 0.95) {
    s.routes
      .filter((r) => r.freq > 0 && r.lf > 0.88 && r.profit > 0)
      .sort((a, b) => b.lf - a.lf)
      .slice(0, 2)
      .forEach((r) => (r.freq = Math.min(maxFreq(r), r.freq + 1)))
  }
  if (aiRoutes && s.status === 'ok' && s.cash > fin.costs * 2 && fin.utilization < 0.9 && rng() < 0.3) {
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
