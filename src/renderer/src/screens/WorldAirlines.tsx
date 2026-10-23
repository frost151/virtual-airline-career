import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, Drawer, Group, Loader, SegmentedControl, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core'
import type { AirlineSummary } from '@shared/types'
import type { AirlineDetailEconomy, AirlineMarketRow } from '@shared/airlines'
import type { AirlineArchetype } from '@shared/world'
import { ARCHETYPE_LABEL, countryName, formatNum } from '../format'
import { SortableTh, compareBy, type SortState } from '../components/SortableTh'
import { AirlineLogo } from '../components/AirlineLogo'
import { LineChart } from '../components/LineChart'
import { Stat } from '../components/FlightParts'
import { placeLabel, usePlaces } from '../lib'

type SortKey = 'name' | 'country' | 'fleet' | 'lf' | 'revenue' | 'margin' | 'share' | 'reputation'

interface Row extends AirlineSummary {
  m: AirlineMarketRow | undefined
}

const margin = (r: Row) => (r.m?.last?.revenue ? r.m.last.profit / r.m.last.revenue : -1)

const SORT_GETTERS: Record<SortKey, (a: Row) => string | number> = {
  name: (a) => a.name,
  country: (a) => countryName(a.country),
  fleet: (a) => a.m?.fleetSize ?? a.fleetSize,
  lf: (a) => a.m?.last?.lf ?? 0,
  revenue: (a) => a.m?.last?.revenue ?? 0,
  margin,
  share: (a) => a.m?.shareChange ?? 0,
  reputation: (a) => a.m?.reputation ?? a.reputation
}

const ARCHETYPE_COLOR: Record<AirlineArchetype, string> = {
  legacy: 'blue',
  lowcost: 'orange',
  regional: 'teal',
  leisure: 'pink',
  cargo: 'grape'
}

const money = (n: number) => `${n < 0 ? '−' : ''}$${formatNum(Math.abs(n))}`
const millions = (n: number) => `${n < 0 ? '−' : ''}$${formatNum(Math.abs(n) / 1e6)} млн`

export function WorldAirlines() {
  const [airlines, setAirlines] = useState<AirlineSummary[] | null>(null)
  const [market, setMarket] = useState<AirlineMarketRow[]>([])
  const [query, setQuery] = useState('')
  const [archetype, setArchetype] = useState<'all' | AirlineArchetype>('all')
  const [country, setCountry] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'revenue', dir: 'desc' })
  const [selected, setSelected] = useState<Row | null>(null)

  useEffect(() => {
    window.api.world.airlines().then(setAirlines)
    const load = () => window.api.market.rows().then(setMarket).catch(() => setMarket([]))
    load()
    return window.api.world.onChanged(load)
  }, [])

  const byIcao = useMemo(() => new Map(market.map((m) => [m.icao, m])), [market])

  const archetypeOptions = useMemo(() => {
    const present = new Set(airlines?.map((a) => a.archetype))
    return [
      { value: 'all', label: 'Все' },
      ...(Object.keys(ARCHETYPE_LABEL) as AirlineArchetype[]).filter((k) => present.has(k)).map((k) => ({ value: k, label: ARCHETYPE_LABEL[k] }))
    ]
  }, [airlines])

  const countryOptions = useMemo(() => {
    const codes = [...new Set(airlines?.map((a) => a.country))]
    return codes.map((c) => ({ value: c, label: countryName(c) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'))
  }, [airlines])

  const rows = useMemo(() => {
    if (!airlines) return []
    const q = query.trim().toLowerCase()
    return airlines
      .map((a): Row => ({ ...a, m: byIcao.get(a.icao) }))
      .filter((a) => archetype === 'all' || a.archetype === archetype)
      .filter((a) => !country || a.country === country)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || a.icao.toLowerCase().includes(q) || a.iata.toLowerCase().includes(q) || countryName(a.country).toLowerCase().includes(q))
      .sort(compareBy(SORT_GETTERS[sort.key], sort.dir))
  }, [airlines, byIcao, query, archetype, country, sort])

  if (!airlines) return <Loader />

  const th = (key: SortKey, label: string, numeric = false) => (
    <SortableTh sortKey={key} sort={sort} onSort={setSort} firstDir={numeric ? 'desc' : 'asc'} align={numeric ? 'right' : 'left'}>
      {label}
    </SortableTh>
  )

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Авиакомпании мира</Title>
        <Text c="dimmed" size="sm">
          Показано {rows.length} из {airlines.length} · финансы за прошлый месяц
        </Text>
      </Group>

      <Group gap="sm" align="flex-end">
        <SegmentedControl value={archetype} onChange={(v) => setArchetype(v as typeof archetype)} data={archetypeOptions} />
        <Select placeholder="Все страны" data={countryOptions} value={country} onChange={setCountry} searchable clearable w={220} nothingFoundMessage="Нет такой страны" />
        <TextInput placeholder="Поиск: название, код, страна" w={280} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      </Group>

      <Table highlightOnHover striped>
        <Table.Thead>
          <Table.Tr>
            {th('name', 'Авиакомпания')}
            {th('country', 'Страна')}
            <Table.Th>Тип</Table.Th>
            {th('fleet', 'Флот', true)}
            {th('lf', 'Загрузка', true)}
            {th('revenue', 'Выручка/мес', true)}
            {th('margin', 'Маржа', true)}
            {th('share', 'Акция', true)}
            {th('reputation', 'Репутация', true)}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((a) => {
            const mg = margin(a)
            return (
              <Table.Tr key={a.icao} style={{ cursor: 'pointer' }} onClick={() => setSelected(a)}>
                <Table.Td fw={500}>
                  <Group gap="sm" wrap="nowrap">
                    <AirlineLogo iata={a.iata} name={a.name} />
                    <Stack gap={0}>
                      <Text fw={500} size="sm">
                        {a.name}
                      </Text>
                      <Group gap={4}>
                        {a.m?.national && (
                          <Badge size="xs" variant="outline" color="gray">
                            нац. перевозчик
                          </Badge>
                        )}
                        {a.m?.status === 'distress' && (
                          <Badge size="xs" color="orange">
                            в долгах
                          </Badge>
                        )}
                        {a.m?.status === 'restarted' && (
                          <Badge size="xs" color="red">
                            после банкротства
                          </Badge>
                        )}
                      </Group>
                    </Stack>
                  </Group>
                </Table.Td>
                <Table.Td>{countryName(a.country)}</Table.Td>
                <Table.Td miw={120}>
                  <Badge variant="light" color={ARCHETYPE_COLOR[a.archetype]} style={{ overflow: 'visible' }}>
                    {ARCHETYPE_LABEL[a.archetype]}
                  </Badge>
                </Table.Td>
                <Table.Td ta="right">{a.m?.fleetSize ?? a.fleetSize}</Table.Td>
                <Table.Td ta="right">{a.m?.last ? `${Math.round(a.m.last.lf * 100)}%` : '—'}</Table.Td>
                <Table.Td ta="right">{a.m?.last ? millions(a.m.last.revenue) : '—'}</Table.Td>
                <Table.Td ta="right" c={a.m?.last ? (mg >= 0 ? 'green' : 'red') : undefined}>
                  {a.m?.last ? `${(mg * 100).toFixed(1)}%` : '—'}
                </Table.Td>
                <Table.Td ta="right" className="mono">
                  {a.m ? (
                    <>
                      ${a.m.sharePrice.toFixed(2)}{' '}
                      <Text span size="xs" c={a.m.shareChange >= 0 ? 'green' : 'red'}>
                        {a.m.shareChange >= 0 ? '▲' : '▼'}
                        {Math.abs(a.m.shareChange)}%
                      </Text>
                    </>
                  ) : (
                    '—'
                  )}
                </Table.Td>
                <Table.Td ta="right">{a.m?.reputation ?? a.reputation}</Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
      {rows.length === 0 && (
        <Text c="dimmed" ta="center">
          Ничего не найдено — измените фильтры
        </Text>
      )}

      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
        title={
          selected && (
            <Group gap="sm">
              <AirlineLogo iata={selected.iata} name={selected.name} h={32} />
              <Text fw={700}>{selected.name}</Text>
            </Group>
          )
        }
      >
        {selected && <AirlineCard airline={selected} />}
      </Drawer>
    </Stack>
  )
}

const COST_LABEL: Record<string, string> = {
  fuel: 'Топливо',
  crew: 'Экипажи',
  maintenance: 'Техобслуживание',
  airport: 'Аэропортовые сборы',
  navigation: 'Аэронавигация',
  handling: 'Наземное обслуживание',
  fleet: 'Лизинг флота',
  overhead: 'Персонал, продажи, офис'
}

const monthLabel = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' })

function AirlineCard({ airline }: { airline: Row }) {
  const [eco, setEco] = useState<AirlineDetailEconomy | null>(null)
  useEffect(() => {
    setEco(null)
    window.api.market.detail(airline.icao).then(setEco).catch(() => setEco(null))
  }, [airline.icao])
  const routes = eco?.routes.slice(0, 25) ?? []
  const places = usePlaces(routes.flatMap((r) => [r.hub, r.dest]))

  if (!eco) return <Loader />
  const r = eco.row
  const f = r.last
  return (
    <Stack>
      <Text c="dimmed">
        {airline.iata} / {airline.icao} · {countryName(airline.country)} · {ARCHETYPE_LABEL[airline.archetype]}
        {r.national ? ' · национальный перевозчик (государство не даст обанкротиться)' : ''}
      </Text>

      {f && (
        <Card withBorder>
          <SimpleGrid cols={4}>
            <Stat label="Выручка за месяц" value={millions(f.revenue)} />
            <Stat label="Прибыль" value={millions(f.profit)} color={f.profit >= 0 ? 'green' : 'red'} />
            <Stat label="Пассажиров" value={formatNum(f.pax)} />
            <Stat label="Загрузка" value={`${Math.round(f.lf * 100)}%`} />
            <Stat label="Деньги" value={millions(r.cash)} />
            <Stat label="Долг" value={millions(r.debt)} />
            <Stat label="Флот / маршрутов" value={`${r.fleetSize} / ${r.routes}`} />
            <Stat label="Акция" value={`$${r.sharePrice.toFixed(2)}`} />
          </SimpleGrid>
        </Card>
      )}

      {eco.history.length >= 2 ? (
        <SimpleGrid cols={2}>
          <Card withBorder>
            <Text fw={600} size="sm" mb="xs">
              Цена акции, $
            </Text>
            <LineChart
              label="Цена акции по месяцам"
              points={eco.history.map((h) => ({ x: h.month, y: h.sharePrice }))}
              formatY={(y) => `$${y.toFixed(2)}`}
              formatX={monthLabel}
              height={150}
            />
          </Card>
          <Card withBorder>
            <Text fw={600} size="sm" mb="xs">
              Выручка, $ млн в месяц
            </Text>
            <LineChart
              label="Выручка по месяцам"
              points={eco.history.map((h) => ({ x: h.month, y: h.revenue / 1e6 }))}
              formatY={(y) => `$${formatNum(y)} млн`}
              formatTick={(y) => formatNum(y)}
              formatX={monthLabel}
              height={150}
            />
          </Card>
        </SimpleGrid>
      ) : (
        <Text size="sm" c="dimmed">
          Графики котировок и выручки появятся после первых месяцев жизни мира.
        </Text>
      )}

      {f && (
        <Card withBorder>
          <Text fw={600} mb="xs">
            Расходы за месяц
          </Text>
          <Table>
            <Table.Tbody>
              {Object.entries(f.costBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{COST_LABEL[k] ?? k}</Table.Td>
                    <Table.Td ta="right">{millions(v)}</Table.Td>
                    <Table.Td ta="right" c="dimmed" w={70}>
                      {f.costs ? `${Math.round((v / f.costs) * 100)}%` : ''}
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Card withBorder>
        <Text fw={600} mb="xs">
          Маршруты (самые прибыльные сверху)
        </Text>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Маршрут</Table.Th>
              <Table.Th ta="right">Рейсов/день</Table.Th>
              <Table.Th ta="right">Загрузка</Table.Th>
              <Table.Th ta="right">Средний тариф</Table.Th>
              <Table.Th ta="right">Прибыль/мес</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {routes.map((rt) => (
              <Table.Tr key={`${rt.hub}-${rt.dest}`}>
                <Table.Td>
                  {placeLabel(places[rt.hub], rt.hub)} — {placeLabel(places[rt.dest], rt.dest)}
                </Table.Td>
                <Table.Td ta="right">{rt.freq}</Table.Td>
                <Table.Td ta="right">{Math.round(rt.lf * 100)}%</Table.Td>
                <Table.Td ta="right">{rt.fare ? money(rt.fare) : 'груз'}</Table.Td>
                <Table.Td ta="right" c={rt.profit >= 0 ? 'green' : 'red'}>
                  {money(rt.profit)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {eco.routes.length > routes.length && (
          <Text size="xs" c="dimmed" mt="xs">
            Показано {routes.length} из {eco.routes.length}
          </Text>
        )}
      </Card>
    </Stack>
  )
}
