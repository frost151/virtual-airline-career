import { useEffect, useMemo, useState } from 'react'
import { Badge, Card, Checkbox, Drawer, Group, Loader, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import type { FlightRecord, FlightStatus } from '@shared/sim'
import { STATUS_COLOR, STATUS_LABEL, formatClock, formatDuration, formatNum, formatUtc } from '../format'
import { SortableTh, compareBy, type SortState } from '../components/SortableTh'
import { AltitudeProfile, EventList, LandingCard, Stat, landingColor } from '../components/FlightParts'

type SortKey = 'date' | 'block' | 'distance' | 'landing' | 'score'

const blockTime = (f: FlightRecord) => (f.blockOffAt && f.blockOnAt ? f.blockOnAt - f.blockOffAt : null)

const SORT_GETTERS: Record<SortKey, (f: FlightRecord) => number> = {
  date: (f) => f.id,
  block: (f) => blockTime(f) ?? -1,
  distance: (f) => f.distanceKm,
  // Без посадки — в конец при сортировке по убыванию.
  landing: (f) => f.landing?.vsFpm ?? -10000,
  score: (f) => f.score
}

export function Logbook() {
  const [flights, setFlights] = useState<FlightRecord[] | null>(null)
  const [status, setStatus] = useState<'all' | FlightStatus>('all')
  const [showDemo, setShowDemo] = useState(true)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'date', dir: 'desc' })
  const [selected, setSelected] = useState<FlightRecord | null>(null)

  useEffect(() => {
    window.api.logbook.list().then(setFlights)
    return window.api.tracker.onFinished(() => window.api.logbook.list().then(setFlights))
  }, [])

  const rows = useMemo(
    () =>
      (flights ?? [])
        .filter((f) => status === 'all' || f.status === status)
        .filter((f) => showDemo || f.source !== 'demo')
        .sort(compareBy(SORT_GETTERS[sort.key], sort.dir)),
    [flights, status, showDemo, sort]
  )

  if (!flights) return <Loader />

  const th = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <SortableTh sortKey={key} sort={sort} onSort={setSort} firstDir="desc" align={align}>
      {label}
    </SortableTh>
  )

  const completed = flights.filter((f) => f.status === 'completed' && f.source !== 'demo')
  const totalBlock = completed.reduce((s, f) => s + (blockTime(f) ?? 0), 0)

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Бортжурнал</Title>
        <Text c="dimmed" size="sm">
          Налёт: {formatDuration(totalBlock)} · полётов: {completed.length}
        </Text>
      </Group>

      <Group>
        <SegmentedControl
          value={status}
          onChange={(v) => setStatus(v as typeof status)}
          data={[
            { value: 'all', label: 'Все' },
            { value: 'completed', label: 'Завершённые' },
            { value: 'aborted', label: 'Прерванные' },
            { value: 'crashed', label: 'Катастрофы' }
          ]}
        />
        <Checkbox label="Показывать демо-полёты" checked={showDemo} onChange={(e) => setShowDemo(e.currentTarget.checked)} />
      </Group>

      {rows.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          {flights.length ? 'Ничего не найдено — измените фильтры' : 'Полётов пока нет. Начните с раздела «Активный полёт».'}
        </Text>
      ) : (
        <Table highlightOnHover striped>
          <Table.Thead>
            <Table.Tr>
              {th('date', 'Дата', 'left')}
              <Table.Th>Маршрут</Table.Th>
              <Table.Th>Самолёт</Table.Th>
              {th('block', 'Блок-время')}
              {th('distance', 'Дистанция')}
              <Table.Th ta="right">Топливо</Table.Th>
              {th('landing', 'Посадка')}
              {th('score', 'Оценка')}
              <Table.Th>Статус</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((f) => (
              <Table.Tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => window.api.logbook.get(f.id).then(setSelected)}>
                <Table.Td>{formatUtc(f.blockOffAt ?? f.createdAt)}</Table.Td>
                <Table.Td className="mono">
                  {f.departure ?? '????'} → {f.arrival ?? '????'}
                  {f.source === 'demo' && (
                    <Badge ml="xs" size="xs" color="grape" variant="light">
                      демо
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{f.aircraftType ?? f.aircraftTitle}</Table.Td>
                <Table.Td ta="right">{formatDuration(blockTime(f))}</Table.Td>
                <Table.Td ta="right">{formatNum(f.distanceKm)} км</Table.Td>
                <Table.Td ta="right">{formatNum(f.fuelUsedKg)} кг</Table.Td>
                <Table.Td ta="right">
                  {f.landing ? (
                    <Text span c={landingColor(f.landing.vsFpm)} className="mono">
                      {f.landing.vsFpm} fpm
                    </Text>
                  ) : (
                    '—'
                  )}
                </Table.Td>
                <Table.Td ta="right" fw={600}>
                  {f.score}
                </Table.Td>
                <Table.Td>
                  <Badge color={STATUS_COLOR[f.status]} variant="light">
                    {STATUS_LABEL[f.status]}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Drawer
        opened={!!selected}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
        title={selected ? `${selected.departure ?? '????'} → ${selected.arrival ?? '????'}` : ''}
      >
        {selected && <FlightCard flight={selected} />}
      </Drawer>
    </Stack>
  )
}

function FlightCard({ flight: f }: { flight: FlightRecord }) {
  return (
    <Stack>
      <Group>
        <Badge color={STATUS_COLOR[f.status]}>{STATUS_LABEL[f.status]}</Badge>
        {f.source === 'demo' && <Badge color="grape">Демо-полёт</Badge>}
        <Text c="dimmed">{f.aircraftTitle}</Text>
      </Group>

      <Card withBorder>
        <SimpleGrid cols={4}>
          <Stat label="Оценка" value={String(f.score)} color={f.score >= 90 ? 'green' : f.score >= 70 ? 'yellow' : 'red'} />
          <Stat label="Блок-время" value={formatDuration(blockTime(f))} />
          <Stat label="Время в воздухе" value={formatDuration(f.takeoffAt && f.landingAt ? f.landingAt - f.takeoffAt : null)} />
          <Stat label="Дистанция" value={`${formatNum(f.distanceKm)} км`} />
          <Stat label="Топливо" value={`${formatNum(f.fuelUsedKg)} кг`} />
          <Stat label="Макс. высота" value={`${formatNum(f.maxAltFt)} ft`} />
          <Stat label="Off block / Взлёт" value={`${formatClock(f.blockOffAt)} / ${formatClock(f.takeoffAt)}`} />
          <Stat label="Посадка / On block" value={`${formatClock(f.landingAt)} / ${formatClock(f.blockOnAt)}`} />
        </SimpleGrid>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Профиль высоты
        </Text>
        <AltitudeProfile track={f.track} />
      </Card>

      {f.landing && <LandingCard landing={f.landing} />}

      <Card withBorder>
        <Text fw={600} mb="xs">
          Журнал полёта
        </Text>
        <EventList events={f.events} />
      </Card>
    </Stack>
  )
}
