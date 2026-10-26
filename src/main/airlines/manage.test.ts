import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase, type Db } from '../db'
import { setWorld, macroState } from '../economy/state'
import { advanceWorld } from '../economy/clock'
import { pilotRow } from '../career/career'
import { FLAG_CARRIERS, loadStates } from './state'
import { airlinesMonthly } from './economy'
import { buyStake, sellStake } from './stakes'
import { destinationOptions, foundAirline, registerPlayerAirlines } from './player'
import * as m from './manage'
import { effectiveAirline } from './state'
import { airlineDaySchedule, utcDayStart } from '../career/schedule'

const START = Date.UTC(2026, 9, 23, 12)
const ICAO = 'NVQ'

function newDb(): Db {
  const db = openDatabase(':memory:')
  const iso = new Date(START).toISOString()
  db.prepare(
    `INSERT INTO profile (id, name, pilot_name, mode, world_start_utc, last_simulated_utc, created_at)
     VALUES (1, 't', 'Пилот', 'owner', ?, ?, ?)`
  ).run(iso, iso, iso)
  setWorld(db, 'seed', 'manage-test')
  advanceWorld(db, START)
  pilotRow(db)
  db.prepare('UPDATE pilot SET cash = 1e13 WHERE id = 1').run()
  registerPlayerAirlines(db)
  const dests = destinationOptions(db, 'UUWW', 'A320')
    .slice(0, 2)
    .map((d) => d.icao)
  foundAirline(db, {
    name: 'Neva Air',
    icao: ICAO,
    iata: 'Q7',
    callsign: 'NEVA',
    archetype: 'lowcost',
    hub: 'UUWW',
    typeId: 'A320',
    destinations: dests,
    contribution: 2e7,
    loan: 0,
    guaranteed: false,
    logo: null
  })
  return db
}

const month = (db: Db) => airlinesMonthly(db, macroState(db), 'manage-test')

afterEach(() => registerPlayerAirlines(null))

describe('управление своей компанией', () => {
  it('своя компания по умолчанию без заместителей, ИИ не трогает флот и сеть', () => {
    const db = newDb()
    const st = m.manageState(db, ICAO)
    expect(st.autopilot).toEqual({ fleet: false, routes: false, fares: false, staff: false })
    const fleet = { ...loadStates(db).get(ICAO)!.fleet }
    const routes = st.routes.map((r) => `${r.dest}:${r.freq}`)
    for (let i = 0; i < 3; i++) month(db)
    expect(loadStates(db).get(ICAO)!.fleet).toEqual(fleet)
    expect(m.manageState(db, ICAO).routes.map((r) => `${r.dest}:${r.freq}`).sort()).toEqual(routes.sort())
  })

  it('частоты не превышают возможностей флота', () => {
    const db = newDb()
    const st = m.manageState(db, ICAO)
    const r = st.routes[0]
    expect(st.blockHoursNeeded).toBeLessThanOrEqual(st.blockHoursAvailable)
    expect(() => m.setFrequency(db, ICAO, r.hub, r.dest, 6)).toThrow(/не хватит/)
    m.setFrequency(db, ICAO, r.hub, r.dest, r.freq - 1)
    expect(m.manageState(db, ICAO).routes.find((x) => x.dest === r.dest)!.freq).toBe(r.freq - 1)
  })

  it('новый самолёт сразу в строю, на нём можно открыть рейс', () => {
    const db = newDb()
    const cash0 = m.manageState(db, ICAO).cash
    const served = new Set(m.manageState(db, ICAO).routes.map((r) => r.dest))
    const dest = destinationOptions(db, 'UUWW', 'A320').find((d) => !served.has(d.icao))!.icao
    expect(() => m.openRoute(db, ICAO, 'UUWW', dest, 3, 'A320')).toThrow(/не хватит/)
    m.leaseAircraft(db, ICAO, 'A320', 1)
    expect(m.manageState(db, ICAO).cash).toBeLessThan(cash0)
    expect(loadStates(db).get(ICAO)!.fleet.A320).toBe(2)
    m.openRoute(db, ICAO, 'UUWW', dest, 2, 'A320')
    expect(m.manageState(db, ICAO).routes.some((r) => r.dest === dest && r.freq === 2)).toBe(true)
  })

  it('свой самолёт не платит лизинг', () => {
    const db = newDb()
    month(db)
    const leased = loadStates(db).get(ICAO)!.last!.costBreakdown.fleet
    expect(leased).toBeGreaterThan(0)
    loadStates(db).get(ICAO)!.cash = 1e8
    m.buyAircraft(db, ICAO, 'A320', 1)
    m.returnLease(db, ICAO, 'A320')
    month(db)
    expect(loadStates(db).get(ICAO)!.last!.costBreakdown.fleet).toBe(0)
    expect(m.manageState(db, ICAO).fleet[0]).toMatchObject({ count: 1, owned: 1, leased: 0 })
  })

  it('тариф дороже — дороже билет', () => {
    const db = newDb()
    month(db)
    const fare = m.manageState(db, ICAO).routes[0].fare
    m.setFareMult(db, ICAO, 1.3)
    month(db)
    expect(m.manageState(db, ICAO).routes[0].fare).toBeGreaterThan(fare * 1.2)
    m.setAutopilot(db, ICAO, { fares: true })
    expect(m.manageState(db, ICAO).fareMult).toBe(1)
    expect(() => m.setFareMult(db, ICAO, 0.8)).toThrow(/заместитель/)
  })

  it('зарплата CEO приходит игроку после налога, в пределах лимита', () => {
    const db = newDb()
    month(db)
    const cap = m.manageState(db, ICAO).ceoSalaryCap
    expect(() => m.setCeoSalary(db, ICAO, cap + 1)).toThrow(/совет/i)
    m.setCeoSalary(db, ICAO, cap)
    const before = pilotRow(db).cash
    month(db)
    const got = pilotRow(db).cash - before
    expect(got).toBeGreaterThan(0)
    expect(got).toBeLessThan(cap)
  })

  it('кредит в пределах лимита и погашение', () => {
    const db = newDb()
    const st = m.manageState(db, ICAO)
    expect(() => m.borrow(db, ICAO, st.borrowLimit + 1)).toThrow()
    m.borrow(db, ICAO, 1e6)
    expect(m.manageState(db, ICAO).debt).toBe(1e6)
    m.repay(db, ICAO, 4e5)
    expect(m.manageState(db, ICAO).debt).toBe(6e5)
  })

  it('купленный контроль: заместители по умолчанию, при продаже доли управление уходит', () => {
    const db = newDb()
    const icao = [...loadStates(db).values()].find((s) => !FLAG_CARRIERS.has(s.icao) && s.status === 'ok' && s.icao !== ICAO)!.icao
    expect(() => m.manageState(db, icao)).toThrow(/контроля/)
    buyStake(db, icao, 51)
    expect(m.manageState(db, icao).autopilot).toEqual({ fleet: true, routes: true, fares: true, staff: true })
    m.setAutopilot(db, icao, { fares: false })
    m.setFareMult(db, icao, 0.9)
    m.setCeoSalary(db, icao, 10_000)
    sellStake(db, icao)
    const s = loadStates(db).get(icao)!
    expect(s.autopilot).toBeUndefined()
    expect(s.fareMult).toBeUndefined()
    expect(s.ceoSalary).toBeUndefined()
  })
})

describe('персонал своей компании', () => {
  it('при полном штате экипажи стоят примерно как у заместителя, рейсы не отменяются', () => {
    const own = newDb()
    const ai = newDb()
    expect(m.manageState(own, ICAO).staff).not.toBeNull()
    m.setAutopilot(ai, ICAO, { staff: true })
    expect(m.manageState(ai, ICAO).staff).toBeNull()
    month(own)
    month(ai)
    const a = loadStates(own).get(ICAO)!.last!
    const b = loadStates(ai).get(ICAO)!.last!
    expect(a.cancelled).toBe(0)
    // Штат с запасом 10% и округлением — чуть дороже оплаты по налёту.
    expect(a.costBreakdown.crew / b.costBreakdown.crew).toBeGreaterThan(1)
    expect(a.costBreakdown.crew / b.costBreakdown.crew).toBeLessThan(1.35)
  })

  it('нехватка пилотов отменяет рейсы и бьёт по репутации', () => {
    const db = newDb()
    const st = m.manageState(db, ICAO).staff!
    const rep0 = loadStates(db).get(ICAO)!.reputation
    m.fireStaff(db, ICAO, 'pilots', Math.ceil(st.pilots / 2))
    const news = month(db)
    const s = loadStates(db).get(ICAO)!
    expect(s.last!.cancelled!).toBeGreaterThan(0.3)
    expect(s.reputation).toBeLessThan(rep0 - 3)
    expect(news.some((n) => n.title.includes('отменяет рейсы'))).toBe(true)
  })

  it('нанятые сразу выходят в рейсы', () => {
    const db = newDb()
    const before = m.manageState(db, ICAO).staff!.pilots
    m.hireStaff(db, ICAO, 'pilots', 4)
    expect(m.manageState(db, ICAO).staff!.pilots).toBe(before + 4)
  })

  it('низкие зарплаты — больше уходит людей, высокий сервис дороже', () => {
    const db = newDb()
    m.hireStaff(db, ICAO, 'pilots', 40)
    m.setPayLevel(db, ICAO, 0.8)
    expect(m.manageState(db, ICAO).staff!.attritionPct).toBeGreaterThan(4)
    const pilots = m.manageState(db, ICAO).staff!.pilots
    month(db)
    expect(m.manageState(db, ICAO).staff!.pilots).toBeLessThanOrEqual(pilots - 2)

    const cheap = newDb()
    const lux = newDb()
    m.setService(lux, ICAO, 1.3)
    month(cheap)
    month(lux)
    expect(loadStates(lux).get(ICAO)!.last!.costBreakdown.handling).toBeGreaterThan(loadStates(cheap).get(ICAO)!.last!.costBreakdown.handling)
    expect(loadStates(lux).get(ICAO)!.reputation).toBeGreaterThan(loadStates(cheap).get(ICAO)!.reputation)
  })
})

describe('типы самолётов на маршрутах', () => {
  it('назначенный тип летает на маршруте — и в экономике, и в расписании', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'E195', 1)
    const r = m.manageState(db, ICAO).routes[0]
    expect(r.typeOptions.map((t) => t.id)).toEqual(expect.arrayContaining(['A320', 'E195']))
    m.setRouteType(db, ICAO, r.hub, r.dest, 'E195')
    const after = m.manageState(db, ICAO).routes.find((x) => x.dest === r.dest)!
    expect(after).toMatchObject({ typeId: 'E195', typeAssigned: true })
    expect(after.typeName).toMatch(/195/)

    const al = effectiveAirline(db, ICAO)
    const day = utcDayStart(Date.now())
    const flights = airlineDaySchedule(al, day).filter((f) => (f.dep === r.hub && f.arr === r.dest) || (f.dep === r.dest && f.arr === r.hub))
    expect(flights.length).toBeGreaterThan(0)
    expect(flights.every((f) => f.typeId === 'E195')).toBe(true)

    // «Авто» возвращает выбор по флоту.
    m.setRouteType(db, ICAO, r.hub, r.dest, null)
    expect(m.manageState(db, ICAO).routes.find((x) => x.dest === r.dest)!.typeAssigned).toBe(false)
  })

  it('каждому типу должно хватать своих самолётов', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'E195', 1)
    const [a] = m.manageState(db, ICAO).routes
    m.setRouteType(db, ICAO, a.hub, a.dest, 'E195')
    // Флота в целом хватает (A320 освободился), но один E195 шесть рейсов в день не потянет.
    expect(() => m.setFrequency(db, ICAO, a.hub, a.dest, 6)).toThrow(/195/)
    const st = m.manageState(db, ICAO)
    expect(st.typeHours.find((h) => h.typeId === 'E195')!.needed).toBeLessThanOrEqual(st.typeHours.find((h) => h.typeId === 'E195')!.available)
  })

  it('перегруженный тип отменяет часть рейсов', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'E195', 1)
    // В обход проверок вешаем все рейсы на один E195.
    for (const r of loadStates(db).get(ICAO)!.routes) Object.assign(r, { type: 'E195', freq: 6 })
    month(db)
    expect(loadStates(db).get(ICAO)!.last!.cancelled!).toBeGreaterThan(0.2)
  })
})

describe('открытие рейса: откуда, куда, тип', () => {
  it('рейс между любыми аэропортами на самолёте, который долетает', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'A320', 1)
    // Пулково — не база компании, Анталья — вне списка самых востребованных: всё равно можно.
    const q = m.routeQuote(db, ICAO, 'ULLI', 'LTAI')
    expect(q.types.find((t) => t.id === 'A320')!.reason).toBeNull()
    m.openRoute(db, ICAO, 'ULLI', 'LTAI', 1, 'A320')
    expect(m.manageState(db, ICAO).routes.find((r) => r.hub === 'ULLI' && r.dest === 'LTAI')).toMatchObject({ typeId: 'A320', typeAssigned: true })

    // До Нью-Йорка A320 не долетит.
    const far = m.routeQuote(db, ICAO, 'ULLI', 'KJFK')
    expect(far.types.find((t) => t.id === 'A320')!.reason).toMatch(/не долетит/)
    expect(() => m.openRoute(db, ICAO, 'ULLI', 'KJFK', 1, 'A320')).toThrow(/не долетит/)
  })
})

describe('заместитель по маршрутам', () => {
  it('сам открывает рейсы и занимает новые самолёты работой', () => {
    const db = newDb()
    m.setAutopilot(db, ICAO, { routes: true, staff: true })
    const routes0 = m.manageState(db, ICAO).routes.length
    const t0 = Date.now()
    m.leaseAircraft(db, ICAO, 'A320', 2)
    const ms = Date.now() - t0
    const st = m.manageState(db, ICAO)
    const a320 = st.typeHours.find((h) => h.typeId === 'A320')!
    // Три самолёта заняты почти на 90% их часов, но не больше.
    expect(a320.needed / a320.available).toBeGreaterThan(0.75)
    expect(a320.needed).toBeLessThanOrEqual(a320.available * 0.9 + 1)
    expect(st.routes.length).toBeGreaterThan(routes0)
    // На всё — быстро: это происходит прямо при заказе самолёта.
    expect(ms).toBeLessThan(3000)
  })

  it('каждый месяц доставляет рейсы, если самолёты простаивают', () => {
    const db = newDb()
    m.setAutopilot(db, ICAO, { fleet: true, routes: true, staff: true })
    const s = loadStates(db).get(ICAO)!
    s.fleet.A320 = 3
    month(db)
    const st = m.manageState(db, ICAO)
    const a320 = st.typeHours.find((h) => h.typeId === 'A320')!
    expect(a320.needed / a320.available).toBeGreaterThan(0.75)
  })
})

describe('цены на рейсе, конкуренты, советник', () => {
  it('наценка на отдельный рейс: дешевле — выше прогноз загрузки, видны конкуренты', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'A320', 1)
    // Направление, где компании ещё нет, а конкуренты есть.
    const served = new Set(m.manageState(db, ICAO).routes.map((r) => r.dest))
    const dest = destinationOptions(db, 'UUWW', 'A320').find((d) => !served.has(d.icao) && m.routeQuote(db, ICAO, 'UUWW', d.icao).competitors > 0)!.icao
    m.openRoute(db, ICAO, 'UUWW', dest, 1, 'A320')
    const p = m.farePreview(db, ICAO, 'UUWW', dest)
    expect(p.competitors.length).toBeGreaterThan(0)
    expect(p.competitors.every((c) => c.fare > 0)).toBe(true)
    const cheap = p.curve.find((x) => x.mult === 0.8)!
    const dear = p.curve.find((x) => x.mult === 1.2)!
    // Загрузка не растёт с ценой (может упираться в потолок 97%, если спроса больше, чем мест).
    for (let i = 1; i < p.curve.length; i++) expect(p.curve[i].lf).toBeLessThanOrEqual(p.curve[i - 1].lf)
    expect(cheap.lf).toBeGreaterThanOrEqual(dear.lf)
    expect(cheap.fare).toBeLessThan(dear.fare)

    // Наценка на рейс поднимает его тариф в экономике месяца.
    month(db)
    const before = loadStates(db).get(ICAO)!.routes.find((x) => x.dest === dest)!.fare
    m.setRouteFare(db, ICAO, 'UUWW', dest, 1.2)
    expect(loadStates(db).get(ICAO)!.routes.find((x) => x.dest === dest)!.fareMult).toBe(1.2)
    month(db)
    const after = loadStates(db).get(ICAO)!.routes.find((x) => x.dest === dest)!
    expect(after.fare).toBeGreaterThan(before)
    m.setRouteFare(db, ICAO, 'UUWW', dest, null)
    expect(loadStates(db).get(ICAO)!.routes.find((x) => x.dest === dest)!.fareMult).toBeUndefined()
  })

  it('советник разбирает рейсы и предлагает новые направления', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'A320', 2)
    const a = m.routeAdvice(db, ICAO)
    expect(a.existing.length).toBe(m.manageState(db, ICAO).routes.length)
    expect(a.suggestions.length).toBeGreaterThan(0)
    expect(a.suggestions.every((s) => s.profit > 0)).toBe(true)
    expect(a.suggestions.some((s) => s.fits)).toBe(true)
  })
})

describe('борта, номера рейсов, рейсы в одну сторону', () => {
  it('регистрации у всех бортов, сменить можно только на свободную', () => {
    const db = newDb()
    const tails = m.fleetTails(db, ICAO)
    expect(tails.length).toBe(1)
    expect(tails[0].reg).toMatch(/^RA-/)
    m.setRegistration(db, ICAO, tails[0].reg, 'ra-73999')
    expect(m.fleetTails(db, ICAO)[0].reg).toBe('RA-73999')
    const taken = Object.values(loadStates(db).get('AFL')!.regs!).flat()[0]
    expect(() => m.setRegistration(db, ICAO, 'RA-73999', taken)).toThrow(/занята/)
    expect(() => m.setRegistration(db, ICAO, 'RA-73999', 'плохо')).toThrow(/латинские/)
  })

  it('номер рейса меняется и попадает в расписание; пересечения запрещены', () => {
    const db = newDb()
    const [r1, r2] = m.manageState(db, ICAO).routes
    m.setRouteNumber(db, ICAO, r1.hub, r1.dest, 700)
    const day = utcDayStart(START) + 86_400_000
    const flights = airlineDaySchedule(effectiveAirline(db, ICAO), day)
    expect(flights.some((f) => f.flightNo === 'Q7700' && f.dep === r1.hub)).toBe(true)
    expect(flights.some((f) => f.flightNo === 'Q7701' && f.dep === r1.dest)).toBe(true)
    expect(() => m.setRouteNumber(db, ICAO, r2.hub, r2.dest, 700)).toThrow(/пересекаются/)
  })

  it('рейс в одну сторону: самолёт остаётся в аэропорту прилёта, обратный рейс возвращает его в расписание', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'A320', 1)
    m.openRoute(db, ICAO, 'UUWW', 'LTAI', 1, 'A320', false)
    const st = m.manageState(db, ICAO)
    expect(st.legs).toHaveLength(1)
    const leg = st.legs[0]
    // Один из двух A320 стоит: расписание остальных — только на один самолёт.
    expect(st.typeHours.find((h) => h.typeId === 'A320')!.available).toBeLessThan(2 * 13 * 30)
    const day = utcDayStart(leg.depAt)
    const flights = airlineDaySchedule(effectiveAirline(db, ICAO), day).filter((f) => f.oneWay)
    expect(flights).toHaveLength(1)
    expect(flights[0]).toMatchObject({ dep: 'UUWW', arr: 'LTAI' })
    expect(flights.some((f) => f.dep === 'LTAI')).toBe(false)

    m.createReturn(db, ICAO, 'UUWW', 'LTAI', 1)
    const after = m.manageState(db, ICAO)
    expect(after.legs).toHaveLength(0)
    expect(after.routes.some((r) => r.hub === 'UUWW' && r.dest === 'LTAI' && r.freq === 1)).toBe(true)
  })

  it('заместитель по маршрутам сам ставит обратный рейс', () => {
    const db = newDb()
    m.leaseAircraft(db, ICAO, 'A320', 1)
    m.openRoute(db, ICAO, 'UUWW', 'LTAI', 1, 'A320', false)
    m.setAutopilot(db, ICAO, { routes: true })
    m.airlinesDaily(db, START + 86_400_000)
    expect(m.manageState(db, ICAO).legs).toHaveLength(0)
  })
})
