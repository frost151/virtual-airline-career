import { randomUUID } from 'crypto'
import type { CatchUpReport, CompanyMonth, MacroOverview, MacroPoint, NewsItem } from '@shared/economy'
import { seededRng } from '@shared/random'
import { transaction, type Db } from '../db'
import { expireBookings } from '../career/career'
import { isFirstOfMonth, jetFuelUsdPerKg, stepDay, stepMonth, type NewsDraft } from './macro'
import { dayOf, getWorld, insertMacroPoint, macroState, setWorld } from './state'
import { lifeDaily, lifeMonthly } from '../lifestyle/ticks'
import { airlinesMonthly, controlledMonth, ensureAirlines } from '../airlines/economy'
import { airlinesDaily } from '../airlines/manage'

/**
 * Часы мира. Время мира = реальное UTC. Всё, что произошло, пока программа была закрыта,
 * досчитывается при следующем запуске: по дням (нефть, спрос) и по месяцам (инфляция, цикл).
 */

/** Зерно мира: у каждого профиля своя, но воспроизводимая история. */
function worldSeed(db: Db): string {
  let seed = getWorld(db, 'seed')
  if (!seed) {
    seed = randomUUID()
    setWorld(db, 'seed', seed)
  }
  return seed
}

function insertNews(db: Db, n: NewsDraft): void {
  db.prepare('INSERT INTO news (t, category, title, body) VALUES (?, ?, ?, ?)').run(n.t, n.category, n.title, n.body)
}

/**
 * Продвигает мир до момента now. Возвращает сводку, если прошли хотя бы одни сутки.
 * Повторный вызов в те же сутки ничего не делает — досчёт идемпотентен.
 */
export function advanceWorld(db: Db, now: number): CatchUpReport | null {
  const seed = worldSeed(db)
  const start = macroState(db)
  ensureAirlines(db, start, seed)
  const target = dayOf(now)
  const fromMs = Date.parse((db.prepare('SELECT last_simulated_utc AS v FROM profile WHERE id = 1').get() as { v: string }).v)

  let state = start
  const companies: CompanyMonth[] = []
  const firstNewsId = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM news').get() as { m: number }).m
  if (target > start.day) {
    transaction(db, () => {
      while (state.day < target) {
        const d = stepDay(state, seededRng(`${seed}|day|${state.day + 1}`))
        state = d.state
        d.news.forEach((n) => insertNews(db, n))
        lifeDaily(db)
        airlinesDaily(db, state.day * 86_400_000)
        if (isFirstOfMonth(state.day)) {
          const prevCpi = state.cpi
          const m = stepMonth(state, seededRng(`${seed}|month|${state.day}`))
          state = m.state
          m.news.forEach((n) => insertNews(db, n))
          // Личная жизнь видит уже новый уровень цен; состояние сохраняем, чтобы она его прочла.
          setWorld(db, 'macro', JSON.stringify(state))
          airlinesMonthly(db, state, seed).forEach((n) => insertNews(db, n))
          companies.push(...controlledMonth(db, state.day))
          const t = state.day * 86_400_000 + 11 * 3_600_000
          lifeMonthly(db, state, prevCpi, t, seededRng(`${seed}|life|${state.day}`)).forEach((n) => insertNews(db, n))
        }
        insertMacroPoint(db, state)
      }
      setWorld(db, 'macro', JSON.stringify(state))
    })
  }

  const missed = expireBookings(db, now)
  db.prepare('UPDATE profile SET last_simulated_utc = ? WHERE id = 1').run(new Date(now).toISOString())
  if (target === start.day && !missed) return null

  const news = db.prepare('SELECT * FROM news WHERE id > ? ORDER BY t').all(firstNewsId) as unknown as NewsItem[]
  return {
    from: fromMs,
    to: now,
    news,
    brentFrom: start.brent,
    brentTo: state.brent,
    cpiFrom: start.cpi,
    cpiTo: state.cpi,
    cycle: state.cycle,
    missedBookings: missed,
    ...(companies.length ? { companies } : {})
  }
}

export function macroOverview(db: Db, days = 365): MacroOverview {
  const s = macroState(db)
  const rows = db
    .prepare('SELECT day, brent, jet_usd_kg AS jetUsdKg, cpi, cycle, demand FROM macro_daily WHERE day > ? ORDER BY day')
    .all(s.day - days) as unknown as MacroPoint[]
  const news = db.prepare('SELECT * FROM news ORDER BY t DESC, id DESC LIMIT 100').all() as unknown as NewsItem[]
  return {
    current: { day: s.day, brent: s.brent, jetUsdKg: jetFuelUsdPerKg(s.brent), cpi: s.cpi, cycle: s.cycle, demand: s.demandIndex },
    history: rows,
    news
  }
}
