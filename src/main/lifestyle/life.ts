import type { Asset, AssetKind, BudgetLine, Family, Investment, InvestmentKind, LifeState, Loan, LoanKind, PricedCatalog } from '@shared/lifestyle'
import { transaction, type Db } from '../db'
import { airlines, airports } from '../world'
import { sharePrice } from '../airlines/economy'
import { listStakes } from '../airlines/stakes'
import { macroState, priceLevel } from '../economy/state'
import { addTransaction, ceoOf, pilotRow } from '../career/career'
import { getSettings } from '../settings'
import { monthlySalary } from '@shared/career'
import {
  CARS,
  COLLECTIBLES,
  COURSES,
  GA_AIRCRAFT,
  HOUSING,
  MEDICAL_BASE,
  REST,
  SUBSCRIPTIONS,
  annuity,
  carMonthly,
  carPrice,
  countryParams,
  familyLivingFactor,
  familyTripFactor,
  housingPrice,
  housingRent,
  pricedCatalog,
  rates,
  roomsNeeded,
  serviceFactor
} from './catalog'
import { assetPrestige, assetRows, fitToFly, listIds, medicalUntil, prestige, type AssetRow } from './perks'

const YEAR_MS = 365 * 86_400_000
/** Комиссия при продаже: риелтор, дилер, брокер. */
const SELL_FEE: Record<AssetKind, number> = { home: 0.03, car: 0, aircraft: 0.05, collectible: 0.1 }
/** Доля от аренды, которую реально получаешь при сдаче (простой, налоги, управление). */
const RENT_OUT_YIELD = 0.8

// ——— общее ———

/** Страна, по ценам и налогам которой живёт пилот: страна базы, иначе текущего аэропорта. */
export function lifeCountry(db: Db): string | null {
  const p = pilotRow(db)
  const icao = p.base ?? p.location
  return icao ? (airports.get(icao)?.country ?? null) : null
}

export function getFamily(db: Db): Family {
  const r = db.prepare('SELECT partner, children FROM profile WHERE id = 1').get() as { partner: number; children: number }
  return { partner: !!r.partner, children: r.children }
}

export function setFamily(db: Db, f: Family): void {
  const children = Math.max(0, Math.min(6, Math.round(f.children)))
  db.prepare('UPDATE profile SET partner = ?, children = ? WHERE id = 1').run(f.partner ? 1 : 0, children)
}

export function catalogFor(db: Db): PricedCatalog {
  const f = getFamily(db)
  return pricedCatalog(lifeCountry(db), priceLevel(db), macroState(db).cycle, f.partner, f.children)
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

export function adjustPilot(db: Db, d: { fatigue?: number; health?: number; satisfaction?: number }): void {
  const p = pilotRow(db)
  db.prepare('UPDATE pilot SET fatigue = ?, health = ?, satisfaction = ? WHERE id = 1').run(
    clamp(p.fatigue + (d.fatigue ?? 0)),
    clamp(p.health + (d.health ?? 0)),
    clamp(p.satisfaction + (d.satisfaction ?? 0))
  )
}

// ——— имущество ———

function assetMonthly(r: AssetRow, level: number): number {
  if (r.kind === 'home') {
    const h = HOUSING.find((x) => x.id === r.item_id)!
    if (r.ownership === 'rent') return housingRent(h, r.country, level)
    // Содержание своего дома: налог на имущество, коммуналка, ремонт ≈ 0,1% стоимости в месяц.
    return Math.round(r.value * 0.001)
  }
  if (r.kind === 'car') return carMonthly(CARS.find((c) => c.id === r.item_id)!, r.country, level)
  if (r.kind === 'aircraft') return Math.round(GA_AIRCRAFT.find((a) => a.id === r.item_id)!.monthly * level)
  return 0
}

function loanRows(db: Db) {
  return db.prepare('SELECT * FROM loans ORDER BY id').all() as unknown as {
    id: number
    kind: LoanKind
    asset_id: number | null
    principal: number
    balance: number
    rate: number
    payment: number
    months_left: number
    overdue: number
  }[]
}

export function listAssets(db: Db): Asset[] {
  const level = priceLevel(db)
  const loans = loanRows(db)
  return assetRows(db).map((r) => ({
    id: r.id,
    kind: r.kind,
    itemId: r.item_id,
    name: r.name,
    ownership: r.ownership,
    country: r.country,
    airport: r.airport,
    value: Math.round(r.value),
    purchasePrice: Math.round(r.purchase_price),
    residence: !!r.residence,
    rentedOut: !!r.rented_out,
    boughtAt: r.bought_at,
    monthly: assetMonthly(r, level),
    prestige: assetPrestige(r),
    loanId: loans.find((l) => l.asset_id === r.id)?.id ?? null
  }))
}

export function listLoans(db: Db): Loan[] {
  const assets = assetRows(db)
  return loanRows(db).map((l) => ({
    id: l.id,
    kind: l.kind,
    assetId: l.asset_id,
    assetName: assets.find((a) => a.id === l.asset_id)?.name ?? null,
    principal: Math.round(l.principal),
    balance: Math.round(l.balance),
    rate: l.rate,
    payment: Math.round(l.payment),
    monthsLeft: l.months_left,
    overdue: l.overdue
  }))
}

export function listInvestments(db: Db): Investment[] {
  return (db.prepare('SELECT * FROM investments ORDER BY id').all() as unknown as {
    id: number
    kind: InvestmentKind
    principal: number
    value: number
    rate: number
    opened_at: number
    icao: string | null
    quantity: number | null
  }[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    principal: Math.round(r.principal),
    // Акции оцениваем по текущей цене на бирже.
    value: Math.round(r.kind === 'shares' && r.icao ? (r.quantity ?? 0) * sharePrice(db, r.icao) : r.value),
    rate: r.rate,
    openedAt: r.opened_at,
    icao: r.icao,
    quantity: r.quantity
  }))
}

function cashOf(db: Db): number {
  return pilotRow(db).cash
}

function requireCash(db: Db, amount: number): void {
  if (cashOf(db) < amount) throw new Error(`Недостаточно денег: нужно $${Math.round(amount).toLocaleString('ru-RU')}`)
}

function insertAsset(db: Db, a: Omit<AssetRow, 'id'>): number {
  const res = db
    .prepare(
      `INSERT INTO assets (kind, item_id, name, ownership, country, airport, value, purchase_price, residence, rented_out, bought_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(a.kind, a.item_id, a.name, a.ownership, a.country, a.airport, a.value, a.purchase_price, a.residence, a.rented_out, a.bought_at)
  return Number(res.lastInsertRowid)
}

/** Покупка с кредитом: первый взнос из кармана, остаток — в кредит на years лет. */
function financeAsset(db: Db, assetId: number, price: number, downPct: number, years: number, kind: LoanKind, rate: number, label: string): void {
  const down = Math.round((price * downPct) / 100)
  requireCash(db, down)
  addTransaction(db, -down, years ? `${label}: первый взнос ${downPct}%` : label)
  if (years && down < price) {
    const principal = price - down
    const months = years * 12
    db.prepare(
      'INSERT INTO loans (kind, asset_id, principal, balance, rate, payment, months_left, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(kind, assetId, principal, principal, rate, annuity(principal, rate, months), months, Date.now())
  }
}

function checkFinancing(downPct: number, years: number, allowedYears: number[]): void {
  if (!allowedYears.includes(years)) throw new Error('Недопустимый срок кредита')
  if (years === 0 && downPct !== 100) throw new Error('Без кредита нужно платить всю сумму')
  if (years > 0 && (downPct < 20 || downPct > 90)) throw new Error('Первый взнос — от 20% до 90%')
}

function endRentedResidence(db: Db): void {
  db.prepare("DELETE FROM assets WHERE kind = 'home' AND ownership = 'rent'").run()
  db.prepare("UPDATE assets SET residence = 0 WHERE kind = 'home'").run()
}

export function rentHome(db: Db, itemId: string): void {
  const h = HOUSING.find((x) => x.id === itemId)
  const p = pilotRow(db)
  if (!h) throw new Error('Нет такого варианта жилья')
  const airport = p.base ?? p.location
  if (!airport) throw new Error('Сначала устройтесь на работу — жильё снимается в городе базы')
  const country = airports.get(airport)!.country
  const rent = housingRent(h, country, priceLevel(db))
  // Депозит за первый месяц.
  requireCash(db, rent)
  transaction(db, () => {
    endRentedResidence(db)
    addTransaction(db, -rent, `Аренда: ${h.name} — депозит за первый месяц`)
    insertAsset(db, {
      kind: 'home', item_id: h.id, name: h.name, ownership: 'rent', country, airport, value: 0, purchase_price: 0,
      residence: 1, rented_out: 0, bought_at: Date.now()
    })
  })
}

export function buyHome(db: Db, itemId: string, downPct: number, years: number): void {
  const h = HOUSING.find((x) => x.id === itemId)
  const p = pilotRow(db)
  if (!h || !h.price) throw new Error('Этот вариант жилья нельзя купить')
  const airport = p.base ?? p.location
  if (!airport) throw new Error('Сначала устройтесь на работу — жильё покупается в городе базы')
  checkFinancing(downPct, years, [0, 10, 15, 20, 25])
  const country = airports.get(airport)!.country
  const price = housingPrice(h, country, priceLevel(db))
  transaction(db, () => {
    endRentedResidence(db)
    const id = insertAsset(db, {
      kind: 'home', item_id: h.id, name: h.name, ownership: 'own', country, airport, value: price, purchase_price: price,
      residence: 1, rented_out: 0, bought_at: Date.now()
    })
    financeAsset(db, id, price, downPct, years, 'mortgage', rates(country, macroState(db).cycle).mortgage, `Покупка жилья: ${h.name}`)
  })
}

/** Сделать своё жильё основным (например, после переезда базы обратно). */
export function setResidence(db: Db, assetId: number): void {
  const a = assetRows(db).find((r) => r.id === assetId && r.kind === 'home' && r.ownership === 'own')
  if (!a) throw new Error('Можно жить только в своём жилье')
  transaction(db, () => {
    endRentedResidence(db)
    db.prepare('UPDATE assets SET residence = 1, rented_out = 0 WHERE id = ?').run(assetId)
  })
}

export function setRentedOut(db: Db, assetId: number, rentedOut: boolean): void {
  const a = assetRows(db).find((r) => r.id === assetId && r.kind === 'home' && r.ownership === 'own')
  if (!a) throw new Error('Сдавать можно только своё жильё')
  if (a.residence && rentedOut) throw new Error('Нельзя сдать жильё, в котором живёте')
  db.prepare('UPDATE assets SET rented_out = ? WHERE id = ?').run(rentedOut ? 1 : 0, assetId)
}

export function buyCar(db: Db, itemId: string, downPct: number, years: number): void {
  const car = CARS.find((c) => c.id === itemId)
  if (!car) throw new Error('Нет такой машины')
  checkFinancing(downPct, years, [0, 3, 5])
  const country = lifeCountry(db) ?? car.origin
  const price = carPrice(car, country, priceLevel(db))
  transaction(db, () => {
    const id = insertAsset(db, {
      kind: 'car', item_id: car.id, name: `${car.brand} ${car.model}`, ownership: 'own', country, airport: null, value: price,
      purchase_price: price, residence: 0, rented_out: 0, bought_at: Date.now()
    })
    financeAsset(db, id, price, downPct, years, 'auto', rates(country, macroState(db).cycle).auto, `Покупка: ${car.brand} ${car.model}`)
  })
}

export function buyAircraft(db: Db, itemId: string, downPct: number, years: number): void {
  const a = GA_AIRCRAFT.find((x) => x.id === itemId)
  if (!a) throw new Error('Нет такого самолёта')
  if (assetRows(db).some((r) => r.kind === 'aircraft' && r.item_id === itemId)) throw new Error('Такой уже есть')
  const country = lifeCountry(db) ?? 'US'
  const price = Math.round(a.price * priceLevel(db))
  if (!a.price) {
    // Аэроклуб — членство, а не покупка.
    insertAsset(db, {
      kind: 'aircraft', item_id: a.id, name: a.name, ownership: 'rent', country, airport: pilotRow(db).base, value: 0,
      purchase_price: 0, residence: 0, rented_out: 0, bought_at: Date.now()
    })
    return
  }
  checkFinancing(downPct, years, [0, 5, 10])
  transaction(db, () => {
    const id = insertAsset(db, {
      kind: 'aircraft', item_id: a.id, name: a.name, ownership: 'own', country, airport: pilotRow(db).base, value: price,
      purchase_price: price, residence: 0, rented_out: 0, bought_at: Date.now()
    })
    financeAsset(db, id, price, downPct, years, 'aircraft', rates(country, macroState(db).cycle).aircraft, `Покупка самолёта: ${a.name}`)
  })
}

export function buyCollectible(db: Db, itemId: string): void {
  const c = COLLECTIBLES.find((x) => x.id === itemId)
  if (!c) throw new Error('Нет такого предмета')
  const price = Math.round(c.price * priceLevel(db))
  requireCash(db, price)
  transaction(db, () => {
    addTransaction(db, -price, `Покупка: ${c.name}`)
    insertAsset(db, {
      kind: 'collectible', item_id: c.id, name: c.name, ownership: 'own', country: lifeCountry(db) ?? 'US', airport: null,
      value: price, purchase_price: price, residence: 0, rented_out: 0, bought_at: Date.now()
    })
  })
}

/** Продажа: комиссия, погашение кредита, остаток — на счёт. Аренду и членство — просто прекращаем. */
export function sellAsset(db: Db, assetId: number): number {
  const a = assetRows(db).find((r) => r.id === assetId)
  if (!a) throw new Error('Имущество не найдено')
  return transaction(db, () => {
    if (a.ownership === 'rent') {
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
      return 0
    }
    const gross = Math.round(a.value * (1 - SELL_FEE[a.kind]))
    const loan = loanRows(db).find((l) => l.asset_id === assetId)
    const net = gross - Math.round(loan?.balance ?? 0)
    if (net < 0) requireCash(db, -net)
    if (loan) db.prepare('DELETE FROM loans WHERE id = ?').run(loan.id)
    db.prepare('DELETE FROM assets WHERE id = ?').run(assetId)
    addTransaction(db, net, `Продажа: ${a.name}${loan ? ' (кредит погашен)' : ''}`)
    return net
  })
}

export function repayLoan(db: Db, loanId: number): void {
  const l = loanRows(db).find((x) => x.id === loanId)
  if (!l) throw new Error('Кредит не найден')
  requireCash(db, l.balance)
  transaction(db, () => {
    addTransaction(db, -Math.round(l.balance), 'Досрочное погашение кредита')
    db.prepare('DELETE FROM loans WHERE id = ?').run(loanId)
  })
}

// ——— отдых, клубы, учёба, здоровье ———

export function takeRest(db: Db, restId: string): void {
  const r = REST.find((x) => x.id === restId)
  if (!r) throw new Error('Нет такого варианта отдыха')
  const country = lifeCountry(db)
  const f = getFamily(db)
  const price = Math.round(r.price * serviceFactor(countryParams(country)) * priceLevel(db) * (r.family ? familyTripFactor(f.partner, f.children) : 1))
  requireCash(db, price)
  transaction(db, () => {
    addTransaction(db, -price, `Отдых: ${r.name}`)
    adjustPilot(db, { fatigue: -r.fatigue, satisfaction: r.satisfaction + (r.family && (f.partner || f.children) ? 3 : 0), health: r.health })
  })
}

export function subscribe(db: Db, id: string, on: boolean): void {
  const s = SUBSCRIPTIONS.find((x) => x.id === id)
  if (!s) throw new Error('Нет такого клуба')
  if (on) db.prepare('INSERT OR IGNORE INTO subscriptions (id, started_at) VALUES (?, ?)').run(id, Date.now())
  else db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id)
}

export function enroll(db: Db, courseId: string): void {
  const c = COURSES.find((x) => x.id === courseId)
  if (!c) throw new Error('Нет такого курса')
  const have = listIds(db, 'education')
  if (have.includes(c.id)) throw new Error('Курс уже пройден')
  if (c.requires && !have.includes(c.requires)) {
    throw new Error(`Сначала пройдите: ${COURSES.find((x) => x.id === c.requires)!.name}`)
  }
  const price = Math.round(c.price * priceLevel(db))
  requireCash(db, price)
  transaction(db, () => {
    addTransaction(db, -price, `Обучение: ${c.name}`)
    db.prepare('INSERT INTO education (id, obtained_at) VALUES (?, ?)').run(c.id, Date.now())
  })
}

export function renewMedical(db: Db, now = Date.now()): void {
  const p = pilotRow(db)
  if (p.health < 50) throw new Error('Врачи не допускают: здоровье ниже 50. Подлечитесь — санаторий или спорт.')
  const price = Math.round(MEDICAL_BASE * serviceFactor(countryParams(lifeCountry(db))) * priceLevel(db))
  requireCash(db, price)
  transaction(db, () => {
    addTransaction(db, -price, 'Медкомиссия (ВЛЭК) — продление на год')
    db.prepare('UPDATE pilot SET medical_until = ? WHERE id = 1').run(Math.max(now, medicalUntil(db)) + YEAR_MS)
  })
}

// ——— инвестиции ———

export function invest(db: Db, kind: InvestmentKind, amount: number, icao: string | null = null): void {
  if (!(amount >= 100)) throw new Error('Минимум $100')
  requireCash(db, amount)
  if (kind === 'shares') {
    const price = icao ? sharePrice(db, icao) : 0
    if (!price) throw new Error('Выберите авиакомпанию')
    // Комиссия брокера 0,3%.
    const quantity = (amount * 0.997) / price
    transaction(db, () => {
      addTransaction(db, -amount, `Покупка акций ${airlines.get(icao!)?.name ?? icao}`)
      db.prepare('INSERT INTO investments (kind, principal, value, rate, opened_at, icao, quantity) VALUES (?, ?, ?, 0, ?, ?, ?)').run(
        kind, amount, amount, Date.now(), icao, quantity
      )
    })
    return
  }
  const r = rates(lifeCountry(db), macroState(db).cycle)
  const rate = kind === 'deposit' ? r.deposit : kind === 'bonds' ? r.bonds : 0
  transaction(db, () => {
    addTransaction(db, -amount, `Инвестиции: ${kind === 'deposit' ? 'вклад' : kind === 'bonds' ? 'облигации' : 'индексный фонд'}`)
    db.prepare('INSERT INTO investments (kind, principal, value, rate, opened_at) VALUES (?, ?, ?, ?, ?)').run(kind, amount, amount, rate, Date.now())
  })
}

export function withdraw(db: Db, id: number): number {
  const inv = listInvestments(db).find((x) => x.id === id)
  if (!inv) throw new Error('Вложение не найдено')
  // Облигации до погашения продаются с дисконтом 1%, акции — с комиссией брокера 0,3%.
  const amount = Math.round(inv.value * (inv.kind === 'bonds' ? 0.99 : inv.kind === 'shares' ? 0.997 : 1))
  transaction(db, () => {
    db.prepare('DELETE FROM investments WHERE id = ?').run(id)
    addTransaction(db, amount, 'Вывод инвестиций')
  })
  return amount
}

// ——— сводка ———

export function monthlyBudget(db: Db): BudgetLine[] {
  const level = priceLevel(db)
  const country = lifeCountry(db)
  const p = countryParams(country)
  const f = getFamily(db)
  const rows = assetRows(db)
  const pilot = pilotRow(db)
  const lines: BudgetLine[] = [
    // У CEO оклада пилота нет: он получает зарплату CEO и долю с рейсов.
    ...(pilot.employer_id && !ceoOf(db)
      ? [{ label: `Оклад после налога (${p.tax}%)`, amount: Math.round(monthlySalary(pilot.rank) * level * getSettings(db).payMultiplier * (1 - p.tax / 100)) }]
      : []),
    { label: f.partner || f.children ? 'Жизнь семьи (еда, связь, быт)' : 'Жизнь (еда, связь, быт)', amount: -Math.round(p.col * familyLivingFactor(f.partner, f.children) * level) }
  ]
  const homes = rows.filter((r) => r.kind === 'home')
  const homeCost = homes.reduce((s, r) => s + assetMonthly(r, level), 0)
  if (homeCost) lines.push({ label: 'Жильё: аренда и содержание', amount: -homeCost })
  const rentIncome = homes.filter((r) => r.rented_out).reduce((s, r) => s + housingRent(HOUSING.find((h) => h.id === r.item_id)!, r.country, level) * RENT_OUT_YIELD, 0)
  if (rentIncome) lines.push({ label: 'Доход от сдачи жилья', amount: Math.round(rentIncome) })
  const cars = rows.filter((r) => r.kind === 'car').reduce((s, r) => s + assetMonthly(r, level), 0)
  if (cars) lines.push({ label: 'Машины: страховка, ТО, топливо', amount: -cars })
  const planes = rows.filter((r) => r.kind === 'aircraft').reduce((s, r) => s + assetMonthly(r, level), 0)
  if (planes) lines.push({ label: 'Авиация: ангар, страховка, ТО', amount: -planes })
  const subs = listIds(db, 'subscriptions').reduce((s, id) => s + (SUBSCRIPTIONS.find((x) => x.id === id)?.monthly ?? 0), 0)
  if (subs) lines.push({ label: 'Клубы и абонементы', amount: -Math.round(subs * serviceFactor(p) * level) })
  const loans = loanRows(db).reduce((s, l) => s + l.payment, 0)
  if (loans) lines.push({ label: 'Платежи по кредитам', amount: -Math.round(loans) })
  return lines
}

export function lifeState(db: Db): LifeState {
  const p = pilotRow(db)
  const country = lifeCountry(db)
  const f = getFamily(db)
  return {
    fatigue: Math.round(p.fatigue),
    health: Math.round(p.health),
    satisfaction: Math.round(p.satisfaction),
    prestige: prestige(db),
    medicalUntil: medicalUntil(db),
    family: f,
    country,
    params: countryParams(country),
    priceLevel: priceLevel(db),
    budget: monthlyBudget(db),
    assets: listAssets(db),
    loans: listLoans(db),
    investments: listInvestments(db),
    stakesValue: listStakes(db).reduce((s, x) => s + x.value, 0),
    subscriptions: listIds(db, 'subscriptions'),
    education: listIds(db, 'education'),
    fitToFly: fitToFly(db),
    roomsNeeded: roomsNeeded(f.children)
  }
}

export { loanRows, assetMonthly, RENT_OUT_YIELD }
