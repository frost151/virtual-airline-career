/** Экономика авиакомпаний: общие типы для main и интерфейса. */

export interface RouteState {
  hub: string
  dest: string
  /** Рейсов в день в одну сторону. */
  freq: number
  /** Загрузка за прошлый месяц, 0–1. */
  lf: number
  /** Средний тариф в одну сторону, $. */
  fare: number
  /** Прибыль маршрута за прошлый месяц, $. */
  profit: number
  /** Месяцев подряд в убытке — для решения о закрытии. */
  badMonths: number
}

export type AirlineStatus = 'ok' | 'distress' | 'restarted'

export interface AirlineFinance {
  revenue: number
  costs: number
  profit: number
  pax: number
  /** Средняя загрузка по сети. */
  lf: number
  /** Использование флота: блок-часы, нужные расписанию, к доступным. */
  utilization: number
  costBreakdown: Record<string, number>
}

export interface AirlineMarketRow {
  icao: string
  iata: string
  name: string
  country: string
  national: boolean
  status: AirlineStatus
  reputation: number
  fleetSize: number
  routes: number
  cash: number
  debt: number
  sharePrice: number
  /** Изменение цены акции за месяц, %. */
  shareChange: number
  last: AirlineFinance | null
}

export interface AirlineHistoryPoint {
  month: number
  revenue: number
  profit: number
  lf: number
  sharePrice: number
  cash: number
}

export interface AirlineDetailEconomy {
  row: AirlineMarketRow
  history: AirlineHistoryPoint[]
  routes: RouteState[]
}
