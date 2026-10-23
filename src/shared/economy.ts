/** Макроэкономика мира: общие типы для main и интерфейса. */

export type EconomicCycle = 'boom' | 'normal' | 'recession'

export interface MacroState {
  /** Номер UTC-суток (мс / 86 400 000), до которых мир просчитан. */
  day: number
  /** Нефть Brent, $/баррель. */
  brent: number
  /** Индекс цен: 1.0 в момент создания мира. */
  cpi: number
  cycle: EconomicCycle
  cycleSinceDay: number
  /** Индекс спроса на перелёты (1.0 — норма). */
  demandIndex: number
  lastOilNewsDay: number
  /** Цены нефти за последние 8 дней — для новостей о недельных движениях. */
  brentWeekAgo: number[]
}

export interface MacroPoint {
  day: number
  brent: number
  jetUsdKg: number
  cpi: number
  cycle: EconomicCycle
  demand: number
}

export interface NewsItem {
  id: number
  t: number
  category: 'oil' | 'economy' | 'month' | 'career' | 'life' | 'airline'
  title: string
  body: string
}

export interface MacroOverview {
  current: MacroPoint
  history: MacroPoint[]
  news: NewsItem[]
}

/** Сводка «Пока вас не было». */
export interface CatchUpReport {
  from: number
  to: number
  news: NewsItem[]
  brentFrom: number
  brentTo: number
  cpiFrom: number
  cpiTo: number
  cycle: EconomicCycle
  missedBookings: number
}

export const CYCLE_LABEL: Record<EconomicCycle, string> = {
  boom: 'Подъём',
  normal: 'Стабильность',
  recession: 'Рецессия'
}
