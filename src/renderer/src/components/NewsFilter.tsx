import { useEffect, useMemo, useState } from 'react'
import { Chip, Group, MultiSelect, Stack, Text } from '@mantine/core'
import type { NewsItem } from '@shared/economy'
import type { AirlineSummary, NewsFilter } from '@shared/types'

/** Темы новостей: по категории и по ключевым словам в заголовке. */
export const NEWS_TOPICS: { id: string; label: string; match(n: NewsItem): boolean }[] = [
  { id: 'oil', label: 'Нефть', match: (n) => n.category === 'oil' },
  { id: 'economy', label: 'Экономика и инфляция', match: (n) => n.category === 'economy' || n.category === 'month' },
  { id: 'career', label: 'Карьера', match: (n) => n.category === 'career' },
  { id: 'life', label: 'Личное', match: (n) => n.category === 'life' },
  { id: 'bankrupt', label: 'Банкротства и кризисы', match: (n) => /банкрот|спасает|долг/i.test(n.title) },
  { id: 'routes', label: 'Новые и закрытые рейсы', match: (n) => n.category === 'airline' && /рейс/i.test(n.title) && !/отменяет/i.test(n.title) },
  { id: 'fleet', label: 'Флот', match: (n) => /флот/i.test(n.title) },
  { id: 'stock', label: 'Акции и биржа', match: (n) => /акци|бирж/i.test(n.title) },
  { id: 'cancel', label: 'Отмены рейсов', match: (n) => /отменяет/i.test(n.title) }
]

export const EMPTY_FILTER: NewsFilter = { airlines: [], topics: [] }

/** Подходит ли новость под фильтр. Компании ограничивают только новости авиакомпаний. */
export function newsMatches(n: NewsItem, f: NewsFilter, names: Map<string, string>): boolean {
  if (f.topics.length && !NEWS_TOPICS.some((t) => f.topics.includes(t.id) && t.match(n))) return false
  if (f.airlines.length && n.category === 'airline') {
    const text = `${n.title} ${n.body}`
    if (!f.airlines.some((icao) => text.includes(names.get(icao) ?? icao))) return false
  }
  return true
}

/** Названия компаний по ICAO — чтобы узнавать их в тексте новостей. */
export function useAirlineNames(): { names: Map<string, string>; options: { value: string; label: string }[] } {
  const [list, setList] = useState<AirlineSummary[]>([])
  useEffect(() => {
    window.api.world.airlines().then(setList)
  }, [])
  return useMemo(
    () => ({
      names: new Map(list.map((a) => [a.icao, a.name])),
      options: list.map((a) => ({ value: a.icao, label: a.name })).sort((a, b) => a.label.localeCompare(b.label))
    }),
    [list]
  )
}

/** Фильтр из настроек профиля. */
export function useNewsFilter(): [NewsFilter, (f: NewsFilter) => void] {
  const [filter, setFilter] = useState<NewsFilter>(EMPTY_FILTER)
  useEffect(() => {
    window.api.settings.get().then((s) => setFilter(s.newsFilter))
  }, [])
  const save = (f: NewsFilter) => {
    setFilter(f)
    void window.api.settings.set({ newsFilter: f })
  }
  return [filter, save]
}

export function NewsFilterPanel({ filter, onChange, options }: { filter: NewsFilter; onChange(f: NewsFilter): void; options: { value: string; label: string }[] }) {
  return (
    <Stack gap="xs">
      <Chip.Group multiple value={filter.topics} onChange={(topics) => onChange({ ...filter, topics })}>
        <Group gap={6}>
          {NEWS_TOPICS.map((t) => (
            <Chip key={t.id} value={t.id} size="xs" variant="light">
              {t.label}
            </Chip>
          ))}
        </Group>
      </Chip.Group>
      <MultiSelect
        size="xs"
        placeholder={filter.airlines.length ? undefined : 'Новости всех авиакомпаний'}
        data={options}
        value={filter.airlines}
        onChange={(airlines) => onChange({ ...filter, airlines })}
        searchable
        clearable
        maw={640}
      />
      <Text size="xs" c="dimmed">
        Ничего не выбрано — показываются все новости. Выбранные компании ограничивают только новости авиакомпаний.
      </Text>
    </Stack>
  )
}
