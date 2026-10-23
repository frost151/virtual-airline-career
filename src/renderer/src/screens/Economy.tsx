import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, Group, Loader, SegmentedControl, SimpleGrid, Stack, Switch, Table, Text, Title } from '@mantine/core'
import type { MacroOverview, MacroPoint, NewsItem } from '@shared/economy'
import { CYCLE_LABEL } from '@shared/economy'
import { LineChart } from '../components/LineChart'
import { Stat } from '../components/FlightParts'
import { formatUtc } from '../format'

const DAY_MS = 86_400_000
const dateOf = (day: number) =>
  new Date(day * DAY_MS).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' })

const RANGES = [
  { value: '30', label: '30 дней' },
  { value: '90', label: '90 дней' },
  { value: '365', label: 'Год' }
]

export function Economy() {
  const [data, setData] = useState<MacroOverview | null>(null)
  const [range, setRange] = useState('365')
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    const load = () => window.api.world.macro().then(setData)
    load()
    return window.api.world.onChanged(load)
  }, [])

  const history = useMemo(() => {
    if (!data) return []
    const from = data.current.day - Number(range)
    return data.history.filter((p) => p.day > from)
  }, [data, range])

  if (!data) return <Loader />
  const c = data.current
  const first = history[0]
  const brentChange = first ? (c.brent / first.brent - 1) * 100 : 0

  return (
    <Stack>
      <Title order={3}>Экономика мира</Title>
      <Group>
        <SegmentedControl value={range} onChange={setRange} data={RANGES} />
        <Switch label="Таблицей" checked={asTable} onChange={(e) => setAsTable(e.currentTarget.checked)} />
      </Group>

      <SimpleGrid cols={{ base: 2, md: 5 }}>
        <Card withBorder>
          <Stat label="Нефть Brent" value={`$${c.brent.toFixed(1)}`} />
          <Text size="xs" c="dimmed">
            {brentChange >= 0 ? '▲' : '▼'} {Math.abs(brentChange).toFixed(1)}% за период
          </Text>
        </Card>
        <Card withBorder>
          <Stat label="Авиакеросин" value={`$${c.jetUsdKg.toFixed(2)} / кг`} />
        </Card>
        <Card withBorder>
          <Stat label="Цены с начала мира" value={`${c.cpi >= 1 ? '+' : ''}${((c.cpi - 1) * 100).toFixed(1)}%`} />
          <Text size="xs" c="dimmed">
            зарплаты и цены индексируются
          </Text>
        </Card>
        <Card withBorder>
          <Text size="xs" c="dimmed">
            Фаза экономики
          </Text>
          <Badge mt={4} size="lg" variant="light" color={c.cycle === 'boom' ? 'green' : c.cycle === 'recession' ? 'red' : 'gray'}>
            {c.cycle === 'boom' ? '▲ ' : c.cycle === 'recession' ? '▼ ' : '● '}
            {CYCLE_LABEL[c.cycle]}
          </Badge>
        </Card>
        <Card withBorder>
          <Stat label="Спрос на перелёты" value={`${Math.round(c.demand * 100)}% от нормы`} />
        </Card>
      </SimpleGrid>

      {asTable ? (
        <MacroTable points={history} />
      ) : (
        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Card withBorder>
            <Text fw={600} mb="xs">
              Нефть Brent, $ за баррель
            </Text>
            <LineChart
              label="Цена нефти Brent по дням"
              points={history.map((p) => ({ x: p.day, y: p.brent }))}
              formatY={(y) => `$${y.toFixed(y < 100 ? 1 : 0)}`}
              formatTick={(y) => `$${Math.round(y)}`}
              formatX={dateOf}
            />
          </Card>
          <Card withBorder>
            <Text fw={600} mb="xs">
              Уровень цен (старт мира = 100)
            </Text>
            <LineChart
              label="Индекс цен по дням"
              points={history.map((p) => ({ x: p.day, y: p.cpi * 100 }))}
              formatY={(y) => y.toFixed(1)}
              formatX={dateOf}
            />
          </Card>
        </SimpleGrid>
      )}

      <Card withBorder>
        <Text fw={600} mb="xs">
          Новости
        </Text>
        <NewsList news={data.news} />
      </Card>
    </Stack>
  )
}

function MacroTable({ points }: { points: MacroPoint[] }) {
  // Для таблицы — раз в неделю, иначе строк слишком много.
  const rows = points.filter((_, i) => i % 7 === (points.length - 1) % 7).reverse()
  return (
    <Table striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Дата</Table.Th>
          <Table.Th ta="right">Brent, $</Table.Th>
          <Table.Th ta="right">Керосин, $/кг</Table.Th>
          <Table.Th ta="right">Индекс цен</Table.Th>
          <Table.Th>Фаза</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((p) => (
          <Table.Tr key={p.day}>
            <Table.Td>{dateOf(p.day)}</Table.Td>
            <Table.Td ta="right">{p.brent.toFixed(1)}</Table.Td>
            <Table.Td ta="right">{p.jetUsdKg.toFixed(2)}</Table.Td>
            <Table.Td ta="right">{(p.cpi * 100).toFixed(1)}</Table.Td>
            <Table.Td>{CYCLE_LABEL[p.cycle]}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

const NEWS_LABEL = { oil: 'Нефть', economy: 'Экономика', month: 'Итоги месяца', career: 'Карьера', life: 'Личное', airline: 'Авиакомпании' } as const

export function NewsList({ news }: { news: NewsItem[] }) {
  if (!news.length) return <Text c="dimmed">Пока тихо. Новости появятся с первыми днями жизни мира.</Text>
  return (
    <Stack gap="sm">
      {news.map((n) => (
        <Stack key={n.id} gap={2}>
          <Group gap="xs">
            <Badge size="xs" variant="light">
              {NEWS_LABEL[n.category]}
            </Badge>
            <Text size="xs" c="dimmed">
              {formatUtc(n.t).slice(0, 10)}
            </Text>
          </Group>
          <Text fw={600}>{n.title}</Text>
          <Text size="sm" c="dimmed">
            {n.body}
          </Text>
        </Stack>
      ))}
    </Stack>
  )
}
