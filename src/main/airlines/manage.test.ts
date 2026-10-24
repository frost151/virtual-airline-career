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
    const dest = m.routeOptions(db, ICAO, 'UUWW')[0].icao
    expect(() => m.openRoute(db, ICAO, 'UUWW', dest, 3)).toThrow(/не хватит/)
    m.leaseAircraft(db, ICAO, 'A320', 1)
    expect(m.manageState(db, ICAO).cash).toBeLessThan(cash0)
    expect(loadStates(db).get(ICAO)!.fleet.A320).toBe(2)
    m.openRoute(db, ICAO, 'UUWW', dest, 2)
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
