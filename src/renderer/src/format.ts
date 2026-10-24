const dateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

export const formatUtc = (iso: string | number): string => `${dateTime.format(new Date(iso))} UTC`

/** «14:05» по UTC. */
export const formatClock = (ms: number | null): string => (ms === null ? '—' : new Date(ms).toISOString().slice(11, 16))

/** «1 ч 05 мин» */
export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—'
  const min = Math.round(ms / 60000)
  const h = Math.floor(min / 60)
  return h ? `${h} ч ${String(min % 60).padStart(2, '0')} мин` : `${min} мин`
}

const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
export const formatNum = (n: number): string => num.format(n)

export const STATUS_LABEL = { completed: 'Завершён', aborted: 'Прерван', crashed: 'Катастрофа' } as const
export const STATUS_COLOR = { completed: 'green', aborted: 'yellow', crashed: 'red' } as const

export const MODE_LABEL = { pilot: 'Пилот', owner: 'Владелец' } as const

export const ARCHETYPE_LABEL = {
  legacy: 'Сетевая',
  lowcost: 'Лоукостер',
  regional: 'Региональная',
  leisure: 'Чартерная',
  cargo: 'Грузовая'
} as const

const regionNames = new Intl.DisplayNames(['ru'], { type: 'region' })
export const countryName = (iso: string): string => {
  try {
    return regionNames.of(iso) ?? iso
  } catch {
    return iso
  }
}

/** Статьи расходов авиакомпании. */
export const COST_LABEL: Record<string, string> = {
  fuel: 'Топливо',
  crew: 'Экипажи',
  maintenance: 'Техобслуживание',
  airport: 'Аэропортовые сборы',
  navigation: 'Аэронавигация',
  handling: 'Наземное обслуживание',
  fleet: 'Лизинг флота',
  overhead: 'Персонал, продажи, офис'
}
