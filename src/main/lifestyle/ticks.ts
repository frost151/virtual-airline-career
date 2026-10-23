import type { MacroState } from '@shared/economy'
import type { NewsDraft } from '../economy/macro'
import { between, pick } from '@shared/random'
import type { Db } from '../db'
import { addTransaction, changeReputation, pilotRow } from '../career/career'
import { getSettings } from '../settings'
import { monthlySalary } from '@shared/career'
import { CARS, COLLECTIBLES, GA_AIRCRAFT, HOUSING, SUBSCRIPTIONS, countryParams, familyLivingFactor, housingRent, roomsNeeded, serviceFactor } from './catalog'
import { assetRows, hasEducation, listIds } from './perks'
import { RENT_OUT_YIELD, adjustPilot, assetMonthly, getFamily, lifeCountry, loanRows } from './life'

/**
 * Жизнь идёт и без программы: каждый день понемногу проходит усталость,
 * раз в месяц списываются расходы, платятся кредиты, растут или падают активы.
 */

/** Ежедневное восстановление: дом даёт немного, клубы — ещё чуть-чуть. Основное — платный отдых. */
export function lifeDaily(db: Db): void {
  const p = pilotRow(db)
  const home = assetRows(db).find((r) => r.kind === 'home' && r.residence)
  let recovery = 0.2
  if (home) {
    const h = HOUSING.find((x) => x.id === home.item_id)!
    // Дом далеко от базы — дорога съедает отдых.
    recovery = h.recovery * 0.15 * (home.airport === p.base || !p.base ? 1 : 0.4)
  }
  for (const id of listIds(db, 'subscriptions')) recovery += SUBSCRIPTIONS.find((s) => s.id === id)?.fatigueDaily ?? 0
  adjustPilot(db, { fatigue: -recovery })
}

const CAR_DEPRECIATION: Record<string, number> = { super: 0.006, hyper: 0.004, luxury: 0.011 }
const HOUSING_DRIFT = { boom: 0.004, normal: 0.001, recession: -0.005 } as const
const INDEX_DRIFT = { boom: 0.012, normal: 0.006, recession: -0.008 } as const
const INDEX_VOL = { boom: 0.03, normal: 0.035, recession: 0.05 } as const
const REPOSSESS_AFTER = 3
/** Овердрафт: если денег не хватило на обязательные расходы. */
const OVERDRAFT_MONTHLY = 0.02

function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

interface LifeEvent {
  title: string
  body: string
  amount: number
  when(ctx: { hasCar: boolean; ownsHome: boolean; renting: boolean; partner: boolean; children: number }): boolean
  satisfaction?: number
}

const EVENTS: LifeEvent[] = [
  { title: 'Прорвало трубу', body: 'Пришлось срочно менять стояк и ремонтировать потолок соседям.', amount: -900, when: (c) => c.ownsHome },
  { title: 'Штраф за превышение скорости', body: 'Камера на трассе по дороге в аэропорт.', amount: -150, when: (c) => c.hasCar },
  { title: 'Кража из машины', body: 'Разбили стекло и унесли сумку с лётной формой.', amount: -500, when: (c) => c.hasCar, satisfaction: -3 },
  { title: 'Наследство', body: 'Дальний родственник оставил вам небольшое наследство.', amount: 5000, when: () => true, satisfaction: 3 },
  { title: 'Налоговый вычет', body: 'Вернули часть налога за обучение и лечение.', amount: 1200, when: () => true },
  { title: 'Поход к стоматологу', body: 'Коронка — удовольствие не из дешёвых.', amount: -350, when: () => true },
  { title: 'Выигрыш в лотерею', body: 'Билет, купленный в дьюти-фри, оказался счастливым.', amount: 2000, when: () => true, satisfaction: 4 },
  { title: 'Репетитор для ребёнка', body: 'Перед экзаменами без него никак.', amount: -400, when: (c) => c.children > 0 },
  { title: 'Годовщина свадьбы', body: 'Ужин, цветы и подарок — семья оценила.', amount: -600, when: (c) => c.partner, satisfaction: 5 },
  { title: 'Хозяин поднял аренду', body: 'Разовая доплата за продление договора.', amount: -700, when: (c) => c.renting, satisfaction: -2 },
  { title: 'Подработка: лекция в лётном училище', body: 'Вас пригласили рассказать курсантам о работе в авиакомпании.', amount: 800, when: () => true, satisfaction: 2 }
]

/** Ежемесячный шаг личной жизни. Вызывается в первый день месяца после макроэкономики. */
export function lifeMonthly(db: Db, macro: MacroState, prevCpi: number, t: number, rng: () => number): NewsDraft[] {
  const news: NewsDraft[] = []
  const p = pilotRow(db)
  const level = macro.cpi
  const country = lifeCountry(db)
  const cp = countryParams(country)
  const fam = getFamily(db)
  const rows = assetRows(db)
  const charge = (amount: number, label: string) => amount && addTransaction(db, -Math.round(amount), label)

  // 1. Обязательные расходы.
  charge(cp.col * familyLivingFactor(fam.partner, fam.children) * level, 'Расходы на жизнь за месяц')
  for (const r of rows) {
    if (r.kind === 'collectible') continue
    const label = r.kind === 'home' ? (r.ownership === 'rent' ? `Аренда: ${r.name}` : `Содержание: ${r.name}`) : `Содержание: ${r.name}`
    charge(assetMonthly(r, level), label)
    if (r.kind === 'home' && r.rented_out) {
      const income = housingRent(HOUSING.find((h) => h.id === r.item_id)!, r.country, level) * RENT_OUT_YIELD
      addTransaction(db, Math.round(income), `Доход от сдачи: ${r.name}`)
    }
  }
  const subs = listIds(db, 'subscriptions')
  for (const id of subs) {
    const s = SUBSCRIPTIONS.find((x) => x.id === id)
    if (s) charge(s.monthly * serviceFactor(cp) * level, `Абонемент: ${s.name}`)
  }

  // 2. Кредиты: платим, если хватает денег; три просрочки подряд — банк забирает имущество.
  for (const l of loanRows(db)) {
    const cash = pilotRow(db).cash
    if (cash >= l.payment) {
      const interest = (l.balance * l.rate) / 1200
      const balance = Math.max(0, l.balance - (l.payment - interest))
      addTransaction(db, -Math.round(l.payment), 'Платёж по кредиту')
      if (l.months_left <= 1 || balance < 1) {
        db.prepare('DELETE FROM loans WHERE id = ?').run(l.id)
        news.push({ t, category: 'life', title: 'Кредит погашен', body: 'Последний платёж внесён — имущество полностью ваше.' })
      } else db.prepare('UPDATE loans SET balance = ?, months_left = ?, overdue = 0 WHERE id = ?').run(balance, l.months_left - 1, l.id)
      continue
    }
    const overdue = l.overdue + 1
    // Пени 5% от платежа добавляются к долгу.
    db.prepare('UPDATE loans SET overdue = ?, balance = balance + ? WHERE id = ?').run(overdue, l.payment * 0.05, l.id)
    if (overdue < REPOSSESS_AFTER) {
      news.push({ t, category: 'life', title: 'Просрочка по кредиту', body: `Не хватило денег на платёж. Просрочек подряд: ${overdue} из ${REPOSSESS_AFTER}.` })
      continue
    }
    const asset = rows.find((r) => r.id === l.asset_id)
    const recovered = asset ? asset.value * 0.7 : 0
    db.prepare('DELETE FROM loans WHERE id = ?').run(l.id)
    if (asset) db.prepare('DELETE FROM assets WHERE id = ?').run(asset.id)
    addTransaction(db, Math.round(recovered - l.balance), `Банк изъял имущество: ${asset?.name ?? 'залог'}`)
    news.push({ t, category: 'life', title: 'Банк изъял имущество', body: `${asset?.name ?? 'Залог'} продан с торгов за 70% стоимости в счёт долга.` })
    adjustPilot(db, { satisfaction: -15 })
  }

  // 3. Инвестиции.
  const indexReturn = INDEX_DRIFT[macro.cycle] + INDEX_VOL[macro.cycle] * normal(rng)
  // Акции оцениваются по бирже авиакомпаний, здесь — только вклады, облигации и фонд.
  for (const inv of db.prepare("SELECT * FROM investments WHERE kind != 'shares'").all() as { id: number; kind: string; value: number; rate: number }[]) {
    const growth = inv.kind === 'index' ? Math.max(-0.5, indexReturn) : inv.rate / 1200
    db.prepare('UPDATE investments SET value = ? WHERE id = ?').run(inv.value * (1 + growth), inv.id)
  }

  // 4. Стоимость имущества.
  const inflation = level / prevCpi - 1
  for (const r of assetRows(db)) {
    if (r.ownership === 'rent') continue
    let k = 1
    if (r.kind === 'car') k = 1 - (CAR_DEPRECIATION[CARS.find((c) => c.id === r.item_id)!.class] ?? 0.013)
    else if (r.kind === 'home') k = 1 + inflation + HOUSING_DRIFT[macro.cycle]
    else if (r.kind === 'aircraft') k = 0.995 + inflation
    else k = 1 + (COLLECTIBLES.find((c) => c.id === r.item_id)!.growth / 12) + 0.01 * normal(rng)
    db.prepare('UPDATE assets SET value = ? WHERE id = ?').run(Math.max(0, r.value * k), r.id)
  }

  // 5. Оклад пилота в штате: фиксированная часть зарплаты, растёт со званием и инфляцией.
  if (p.employer_id) {
    const gross = monthlySalary(p.rank) * level * getSettings(db).payMultiplier
    const net = Math.round(gross * (1 - cp.tax / 100))
    addTransaction(db, net, `Оклад за месяц (налог ${cp.tax}%)`)
  }

  // 5а. Подработка инструктором — командирам с сертификатом TRI.
  if (hasEducation(db, 'tri') && ['captain', 'senior_captain', 'instructor'].includes(p.rank)) {
    const gross = 1200 * level * getSettings(db).payMultiplier
    const net = Math.round(gross * (1 - cp.tax / 100))
    addTransaction(db, net, `Подработка инструктором на тренажёре (налог ${cp.tax}%)`)
  }

  // 6. Здоровье и удовлетворённость.
  const now = pilotRow(db)
  const subHealth = subs.reduce((s, id) => s + (SUBSCRIPTIONS.find((x) => x.id === id)?.health ?? 0), 0)
  adjustPilot(db, { health: subHealth - (now.fatigue > 70 ? 3 : 0) - (now.satisfaction < 30 ? 1 : 0) })

  const all = assetRows(db)
  const home = all.find((r) => r.kind === 'home' && r.residence)
  const homeOpt = home ? HOUSING.find((h) => h.id === home.item_id)! : null
  const bestCar = Math.max(0, ...all.filter((r) => r.kind === 'car').map((r) => CARS.find((c) => c.id === r.item_id)!.price))
  const plane = all.filter((r) => r.kind === 'aircraft').map((r) => GA_AIRCRAFT.find((a) => a.id === r.item_id)!.comfort)
  const hasFamily = fam.partner || fam.children > 0
  let target = 45
  target += homeOpt ? homeOpt.comfort : -15
  target += bestCar ? Math.min(10, Math.log10(bestCar / 8000) * 5 + 3) : 0
  target += plane.length ? Math.max(...plane) : 0
  target += subs.reduce((s, id) => s + (SUBSCRIPTIONS.find((x) => x.id === id)?.satisfaction ?? 0), 0)
  if (hasFamily) target += 8
  if (hasFamily && homeOpt && homeOpt.rooms < roomsNeeded(fam.children)) target -= 15
  target -= now.fatigue / 4
  if (now.cash < 0) target -= 10
  adjustPilot(db, { satisfaction: (target - now.satisfaction) * 0.5 })

  const sat = pilotRow(db).satisfaction
  if (now.employer_id && sat < 30) changeReputation(db, -1)
  if (now.employer_id && sat > 75) changeReputation(db, 1)

  // 7. Овердрафт.
  const cash = pilotRow(db).cash
  if (cash < 0) {
    addTransaction(db, Math.round(cash * OVERDRAFT_MONTHLY), 'Проценты по овердрафту')
    news.push({ t, category: 'life', title: 'Вы в минусе', body: 'Денег не хватило на обязательные расходы — банк начисляет проценты по овердрафту.' })
  }

  // 8. Жизненное событие.
  if (rng() < 0.35) {
    const ctx = {
      hasCar: all.some((r) => r.kind === 'car'),
      ownsHome: all.some((r) => r.kind === 'home' && r.ownership === 'own'),
      renting: !!home && home.ownership === 'rent',
      partner: fam.partner,
      children: fam.children
    }
    const pool = EVENTS.filter((e) => e.when(ctx))
    const e = pick(rng, pool)
    const amount = Math.round(e.amount * level * (e.amount < 0 ? serviceFactor(cp) : 1) * between(rng, 0.8, 1.2))
    addTransaction(db, amount, e.title)
    if (e.satisfaction) adjustPilot(db, { satisfaction: e.satisfaction })
    news.push({ t, category: 'life', title: e.title, body: `${e.body} ${amount >= 0 ? '+' : '−'}$${Math.abs(amount).toLocaleString('ru-RU')}` })
  }
  return news
}
