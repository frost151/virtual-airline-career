import type { EconomicCycle, MacroState } from '@shared/economy'
import { between, pick } from '@shared/random'

/**
 * Макроэкономика мира: нефть, инфляция, экономический цикл.
 * Чистые функции: состояние + детерминированный генератор → новое состояние и новости.
 */

export interface NewsDraft {
  t: number
  category: 'oil' | 'economy' | 'month' | 'life' | 'airline' | 'career'
  title: string
  body: string
}

const DAY_MS = 86_400_000
/** Баррель нефти ≈ 127 кг авиакеросина; керосин дороже нефти примерно на 28% (крэк-спред). */
const JET_PER_BRENT = 1.28 / 127

/** Долгосрочная цена нефти, к которой рынок тянется в каждой фазе цикла. */
const BRENT_MEAN: Record<EconomicCycle, number> = { boom: 92, normal: 80, recession: 64 }
/** Месячная инфляция по фазам. */
const INFLATION: Record<EconomicCycle, number> = { boom: 0.004, normal: 0.0025, recession: 0.001 }
/** Мультипликатор спроса на перелёты по фазам (к нему плавно тянется индекс спроса). */
const DEMAND: Record<EconomicCycle, number> = { boom: 1.07, normal: 1.0, recession: 0.88 }

/** Сезонность пассажирского спроса по месяцам (январь — 0). Для этапа экономики авиакомпаний. */
export const SEASONALITY = [0.86, 0.84, 0.93, 0.97, 1.02, 1.1, 1.18, 1.18, 1.04, 0.98, 0.9, 0.98]

export const jetFuelUsdPerKg = (brent: number): number => brent * JET_PER_BRENT

export function initialMacro(day: number): MacroState {
  return { day, brent: 82, cpi: 1, cycle: 'normal', cycleSinceDay: day, demandIndex: 1, lastOilNewsDay: -999, brentWeekAgo: [82] }
}

/** Нормальное распределение (Бокс — Мюллер). */
function normal(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

const OIL_UP = [
  'ОПЕК+ неожиданно сократила добычу',
  'перебои с поставками на Ближнем Востоке',
  'ураган остановил платформы в Мексиканском заливе',
  'запасы в США упали сильнее прогнозов'
]
const OIL_DOWN = [
  'ОПЕК+ договорилась нарастить добычу',
  'рынок испугался замедления мировой экономики',
  'запасы в США резко выросли',
  'крупные потребители сократили закупки'
]

export function stepDay(prev: MacroState, rng: () => number): { state: MacroState; news: NewsDraft[] } {
  const day = prev.day + 1
  const t = day * DAY_MS + 9 * 3_600_000
  const news: NewsDraft[] = []

  // Цена нефти: возврат к среднему фазы + шум + редкие шоки.
  const mean = BRENT_MEAN[prev.cycle]
  let logP = Math.log(prev.brent) + 0.012 * (Math.log(mean) - Math.log(prev.brent)) + 0.017 * normal(rng)
  if (rng() < 1 / 250) {
    const up = rng() < 0.5
    const size = between(rng, 0.08, 0.18)
    logP += up ? Math.log(1 + size) : Math.log(1 - size)
    news.push({
      t,
      category: 'oil',
      title: up ? `Нефть подскочила на ${Math.round(size * 100)}%` : `Нефть рухнула на ${Math.round(size * 100)}%`,
      body: `Причина — ${pick(rng, up ? OIL_UP : OIL_DOWN)}. Авиакеросин ${up ? 'дорожает' : 'дешевеет'} вслед за нефтью.`
    })
  }
  const brent = Math.min(200, Math.max(25, Math.exp(logP)))

  const history = [...prev.brentWeekAgo, brent].slice(-8)
  const weekChange = brent / history[0] - 1
  let lastOilNewsDay = prev.lastOilNewsDay
  if (!news.length && Math.abs(weekChange) > 0.1 && day - lastOilNewsDay > 10) {
    lastOilNewsDay = day
    news.push({
      t,
      category: 'oil',
      title: `Нефть ${weekChange > 0 ? 'подорожала' : 'подешевела'} на ${Math.abs(Math.round(weekChange * 100))}% за неделю`,
      body: `Brent — $${brent.toFixed(0)} за баррель, авиакеросин — $${jetFuelUsdPerKg(brent).toFixed(2)} за кг.`
    })
  } else if (news.length) lastOilNewsDay = day

  // Индекс спроса плавно догоняет уровень текущей фазы цикла.
  const demandIndex = prev.demandIndex + (DEMAND[prev.cycle] - prev.demandIndex) * 0.02

  return { state: { ...prev, day, brent, brentWeekAgo: history, lastOilNewsDay, demandIndex }, news }
}

const CYCLE_TEXT: Record<EconomicCycle, { title: string; body: string }> = {
  boom: { title: 'Экономический подъём', body: 'Растут доходы и деловая активность — авиакомпании ждут роста спроса, но и нефть дорожает.' },
  normal: { title: 'Экономика стабилизировалась', body: 'Рост умеренный, спрос на перелёты возвращается к обычному уровню.' },
  recession: { title: 'Мировая экономика входит в рецессию', body: 'Спрос на перелёты падает, особенно в бизнес-классе. Нефть дешевеет.' }
}

/** Ежемесячный шаг: инфляция и смена фаз цикла. Вызывается в первый день месяца. */
export function stepMonth(prev: MacroState, rng: () => number): { state: MacroState; news: NewsDraft[] } {
  const t = prev.day * DAY_MS + 10 * 3_600_000
  const news: NewsDraft[] = []
  const inflation = Math.max(-0.002, INFLATION[prev.cycle] + 0.001 * normal(rng))
  const cpi = prev.cpi * (1 + inflation)

  let cycle = prev.cycle
  const months = (prev.day - prev.cycleSinceDay) / 30
  const r = rng()
  if (months >= 6) {
    if (prev.cycle === 'normal') cycle = r < 0.04 ? 'boom' : r < 0.07 ? 'recession' : 'normal'
    else if (prev.cycle === 'boom') cycle = r < 0.1 ? 'normal' : 'boom'
    else cycle = r < 0.12 ? 'normal' : 'recession'
  }
  const state: MacroState = { ...prev, cpi, cycle, cycleSinceDay: cycle !== prev.cycle ? prev.day : prev.cycleSinceDay }
  if (cycle !== prev.cycle) news.push({ t, category: 'economy', ...CYCLE_TEXT[cycle] })

  const month = new Date(prev.day * DAY_MS).toLocaleString('ru-RU', { month: 'long', timeZone: 'UTC' })
  news.push({
    t,
    category: 'month',
    title: `Итоги месяца: инфляция ${(inflation * 100).toFixed(2)}%`,
    body: `Начался ${month}. Brent — $${prev.brent.toFixed(0)}, авиакеросин — $${jetFuelUsdPerKg(prev.brent).toFixed(2)}/кг. Цены с начала мира выросли на ${((cpi - 1) * 100).toFixed(1)}%.`
  })
  return { state, news }
}

export const isFirstOfMonth = (day: number): boolean => new Date(day * DAY_MS).getUTCDate() === 1
