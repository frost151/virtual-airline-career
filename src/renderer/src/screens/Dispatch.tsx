import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Checkbox, Group, Loader, SimpleGrid, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type { Booking, CareerOutcome, CharterOffer, DispatchFlight, OfpSummary, PilotState, Settings } from '@shared/types'
import { STATUS_COLOR } from '../format'
import { formatClock, formatDuration, formatNum, formatUtc } from '../format'
import { errMsg, notifyCareerChanged, placeLabel, useCareerVersion, usePilot, usePlaces } from '../lib'
import { useSimStatus, useWorldNow } from '../hooks'
import { StartFlight } from '../components/StartFlight'
import { SortableTh, compareBy, type SortState } from '../components/SortableTh'
import { Stat } from '../components/FlightParts'
import { DelayReasonForm, OutcomeAlert } from '../components/DelayReason'

const BOOKING_STATUS = {
  booked: { label: 'Забронирован', color: 'blue' },
  awaiting_delay: { label: 'Нужна причина задержки', color: 'orange' },
  completed: { label: 'Выполнен', color: STATUS_COLOR.completed },
  cancelled: { label: 'Отменён', color: 'gray' },
  missed: { label: 'Сорван', color: 'red' }
} as const

const CLIENT_KIND = {
  government: { label: 'Госзаказ', color: 'red' },
  corporate: { label: 'Корпоративный', color: 'blue' },
  private: { label: 'Частное лицо', color: 'grape' },
  special: { label: 'Срочный', color: 'orange' }
} as const

export function Dispatch() {
  const [pilot] = usePilot()
  const version = useCareerVersion()
  const [booking, setBooking] = useState<Booking | null | undefined>(undefined)

  useEffect(() => {
    window.api.dispatch.open().then(setBooking)
  }, [version])

  if (!pilot || booking === undefined) return <Loader />
  if (!pilot.employerId) return <Text c="dimmed">Сначала устройтесь на работу — это делается на главной.</Text>

  const charter = pilot.employerKind === 'charter'
  return (
    <Stack>
      <Title order={3}>Диспетчерская</Title>
      {booking && <BookingCard booking={booking} />}
      <Tabs defaultValue="main" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="main">{charter ? 'Чартерные заказы' : 'Расписание'}</Tabs.Tab>
          <Tabs.Tab value="history">История броней</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="main" pt="md">
          {charter ? <CharterOffers pilot={pilot} hasBooking={!!booking} /> : <Schedule pilot={pilot} hasBooking={!!booking} />}
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <History />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

// ——— текущая бронь ———

function BookingCard({ booking: b }: { booking: Booking }) {
  const navigate = useNavigate()
  const simStatus = useSimStatus()
  const places = usePlaces([b.dep, b.arr])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [ofp, setOfp] = useState<OfpSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<CareerOutcome | null>(null)
  const [loadingOfp, setLoadingOfp] = useState(false)
  const now = useWorldNow()

  useEffect(() => {
    window.api.settings.get().then(setSettings)
  }, [])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  const loadOfp = () =>
    act(async () => {
      setLoadingOfp(true)
      try {
        setOfp(await window.api.dispatch.fetchOfp())
      } finally {
        setLoadingOfp(false)
      }
    })

  const ofpMismatch = ofp && (ofp.origin !== b.dep || ofp.destination !== b.arr)
  const minutesToDep = Math.round((b.depAt - now) / 60_000)

  return (
    <Card withBorder padding="lg">
      <Stack>
        <Group justify="space-between">
          <Group gap="sm">
            <Text fw={700} size="lg">
              {b.flightNo}
            </Text>
            <Text size="lg">
              {placeLabel(places[b.dep], b.dep)} → {placeLabel(places[b.arr], b.arr)}
            </Text>
          </Group>
          <Badge color={BOOKING_STATUS[b.status].color} size="lg">
            {BOOKING_STATUS[b.status].label}
          </Badge>
        </Group>

        {b.charter && (
          <Alert color={CLIENT_KIND[b.charter.clientKind].color} variant="light" title={`${b.charter.clientName} — ${b.charter.clientTitle}`}>
            {b.charter.story}
          </Alert>
        )}

        <SimpleGrid cols={{ base: 3, md: b.avgFare ? 8 : 6 }}>
          <Stat label="Вылет (UTC)" value={`${formatClock(b.depAt)}${minutesToDep > 0 ? ` · через ${formatDuration(minutesToDep * 60_000)}` : ''}`} />
          <Stat label="Прибытие (UTC)" value={formatClock(b.arrAt)} />
          <Stat label="Блок-время" value={formatDuration(b.blockMin * 60_000)} />
          <Stat label="Самолёт" value={b.typeId} />
          <Stat label="Пассажиры" value={String(b.pax)} />
          {b.avgFare && b.pax > 0 && (
            <>
              <Stat label="Средний тариф" value={`$${formatNum(b.avgFare)}`} />
              <Stat label="Выручка рейса ≈" value={`$${formatNum(b.avgFare * b.pax)}`} />
            </>
          )}
          <Stat label={b.charter ? 'Крайний вылет' : 'Груз'} value={b.charter ? formatClock(b.charter.deadline) : `${formatNum(b.cargoKg)} кг`} />
        </SimpleGrid>

        {error && <Alert color="red">{error}</Alert>}
        {outcome && <OutcomeAlert outcome={outcome} />}

        {b.status === 'awaiting_delay' ? (
          <DelayReasonForm bookingId={b.id} delayMin={b.delayMin} onDone={setOutcome} />
        ) : (
          <>
            <Group>
              <Button variant="light" onClick={() => act(async () => window.api.openExternal(await window.api.dispatch.simbriefUrl(b.id)))}>
                Спланировать в SimBrief
              </Button>
              <Button variant="light" loading={loadingOfp} onClick={loadOfp}>
                Загрузить OFP
              </Button>
              <Button
                variant="subtle"
                color="red"
                onClick={() =>
                  act(async () => {
                    await window.api.dispatch.cancel(b.id)
                    notifyCareerChanged()
                  })
                }
              >
                Отменить бронь
              </Button>
            </Group>
            <StartFlight booking={b} simConnected={simStatus === 'connected'} onError={setError} onStarted={() => navigate('/flight')} />
            <Text size="xs" c="dimmed">
              Бесплатная отмена — больше чем за 2 часа до вылета.
              {settings && !settings.demoCountsForCareer && ' Демо-полёты в карьеру не засчитываются — включается в настройках.'}
            </Text>
          </>
        )}

        {ofp && (
          <Card withBorder bg="var(--mantine-color-dark-6)">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={600}>
                  OFP SimBrief: {ofp.origin} → {ofp.destination}
                  {ofp.alternate ? ` (запасной ${ofp.alternate})` : ''}
                </Text>
                {ofpMismatch && <Badge color="red">не совпадает с бронью</Badge>}
              </Group>
              <SimpleGrid cols={{ base: 3, md: 6 }}>
                <Stat label="Эшелон" value={`FL${Math.round(ofp.cruiseAlt / 100)}`} />
                <Stat label="Топливо на борт" value={`${formatNum(ofp.rampFuelKg)} кг`} />
                <Stat label="Топливо на рейс" value={`${formatNum(ofp.tripFuelKg)} кг`} />
                <Stat label="ZFW / TOW" value={`${formatNum(ofp.zfwKg / 1000)} / ${formatNum(ofp.towKg / 1000)} т`} />
                <Stat label="Пассажиры" value={String(ofp.pax)} />
                <Stat label="В пути" value={formatDuration(ofp.enrouteMin * 60_000)} />
              </SimpleGrid>
              <Text size="sm" className="mono" style={{ userSelect: 'text' }}>
                {ofp.route}
              </Text>
            </Stack>
          </Card>
        )}
      </Stack>
    </Card>
  )
}

// ——— расписание ———

type SortKey = 'dep' | 'arr' | 'distance' | 'block' | 'pay'
const GETTERS: Record<SortKey, (f: DispatchFlight) => string | number> = {
  dep: (f) => f.depAt,
  pay: (f) => f.estPay,
  arr: (f) => f.arr,
  distance: (f) => f.distanceKm,
  block: (f) => f.blockMin
}

function Schedule({ pilot, hasBooking }: { pilot: PilotState; hasBooking: boolean }) {
  const now = useWorldNow()
  const [flights, setFlights] = useState<DispatchFlight[] | null>(null)
  const [onlyBookable, setOnlyBookable] = useState(true)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'dep', dir: 'asc' })
  const [error, setError] = useState<string | null>(null)
  const places = usePlaces([pilot.location, ...(flights ?? []).map((f) => f.arr)])

  useEffect(() => {
    window.api.dispatch.schedule().then(setFlights).catch((e) => setError(errMsg(e)))
  }, [pilot])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (flights ?? [])
      .filter((f) => !onlyBookable || f.bookable)
      .filter((f) => !q || f.arr.toLowerCase().includes(q) || (places[f.arr]?.city ?? '').toLowerCase().includes(q) || f.flightNo.toLowerCase().includes(q))
      .sort(compareBy(GETTERS[sort.key], sort.dir))
  }, [flights, onlyBookable, query, sort, places])

  const book = async (id: string) => {
    setError(null)
    try {
      await window.api.dispatch.book(id)
      notifyCareerChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (!flights) return error ? <Alert color="red">{error}</Alert> : <Loader />

  return (
    <Stack>
      <Group justify="space-between">
        <Text>
          Вылеты из {placeLabel(places[pilot.location!], pilot.location ?? '—')} на ближайшие 24 часа
        </Text>
        <Group>
          <TextInput placeholder="Куда / номер рейса" value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={220} />
          <Checkbox label="Только доступные мне" checked={onlyBookable} onChange={(e) => setOnlyBookable(e.currentTarget.checked)} />
        </Group>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {rows.length === 0 ? (
        <Text c="dimmed" ta="center" py="lg">
          Подходящих рейсов нет. {pilot.location !== pilot.base && 'Попробуйте вернуться на базу (на главной) или '}
          купите допуск на другой тип в разделе «Карьера».
        </Text>
      ) : (
        <Table highlightOnHover striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Рейс</Table.Th>
              <SortableTh sortKey="dep" sort={sort} onSort={setSort}>
                Вылет UTC
              </SortableTh>
              <SortableTh sortKey="arr" sort={sort} onSort={setSort}>
                Куда
              </SortableTh>
              <Table.Th>Самолёт</Table.Th>
              <SortableTh sortKey="block" sort={sort} onSort={setSort} align="right" firstDir="desc">
                Блок-время
              </SortableTh>
              <SortableTh sortKey="distance" sort={sort} onSort={setSort} align="right" firstDir="desc">
                Дистанция
              </SortableTh>
              <Table.Th ta="right">Загрузка</Table.Th>
              <Table.Th ta="right">Тариф ≈</Table.Th>
              <SortableTh sortKey="pay" sort={sort} onSort={setSort} align="right" firstDir="desc">
                Оплата ≈
              </SortableTh>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((f) => (
              <Table.Tr key={f.id}>
                <Table.Td className="mono" fw={600}>
                  {f.flightNo}
                </Table.Td>
                <Table.Td className="mono">
                  {formatClock(f.depAt)}
                  {new Date(f.depAt).getUTCDate() !== new Date(now).getUTCDate() && (
                    <Text span size="xs" c="dimmed">
                      {' '}
                      завтра
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{placeLabel(places[f.arr], f.arr)}</Table.Td>
                <Table.Td>{f.typeName}</Table.Td>
                <Table.Td ta="right">{formatDuration(f.blockMin * 60_000)}</Table.Td>
                <Table.Td ta="right">{formatNum(f.distanceKm)} км</Table.Td>
                <Table.Td ta="right">{f.pax ? `${f.pax} пасс.` : `${formatNum(f.cargoKg / 1000)} т груза`}</Table.Td>
                <Table.Td ta="right">{f.avgFare && f.pax ? `$${formatNum(f.avgFare)}` : '—'}</Table.Td>
                <Table.Td ta="right" c="green">
                  ${formatNum(f.estPay)}
                </Table.Td>
                <Table.Td ta="right">
                  {f.bookable ? (
                    <Button size="xs" disabled={hasBooking} onClick={() => book(f.id)}>
                      Взять рейс
                    </Button>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {f.blockedReason}
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  )
}

// ——— чартеры ———

function CharterOffers({ pilot, hasBooking }: { pilot: PilotState; hasBooking: boolean }) {
  const [offers, setOffers] = useState<CharterOffer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const places = usePlaces([pilot.location, ...(offers ?? []).map((o) => o.arr)])

  useEffect(() => {
    window.api.dispatch.charterOffers().then(setOffers).catch((e) => setError(errMsg(e)))
  }, [pilot])

  const accept = async (id: string) => {
    setError(null)
    try {
      await window.api.dispatch.acceptCharter(id)
      notifyCareerChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (!offers) return error ? <Alert color="red">{error}</Alert> : <Loader />
  return (
    <Stack>
      <Text c="dimmed">
        Заказы из {placeLabel(places[pilot.location!], pilot.location ?? '—')}. Новые поступают каждые 4 часа.
      </Text>
      {error && <Alert color="red">{error}</Alert>}
      {offers.length === 0 && <Text c="dimmed">Заказов пока нет.</Text>}
      {offers.map((o) => (
        <Card key={o.id} withBorder>
          <Stack gap="xs">
            <Group justify="space-between">
              <Group gap="xs">
                <Badge color={CLIENT_KIND[o.client.kind].color}>{CLIENT_KIND[o.client.kind].label}</Badge>
                <Text fw={600}>
                  {o.client.name} — {o.client.title}
                </Text>
                {o.client.relationship > 0 && (
                  <Badge variant="light" color="green">
                    постоянный клиент
                  </Badge>
                )}
              </Group>
              <Text fw={700}>→ {placeLabel(places[o.arr], o.arr)}</Text>
            </Group>
            <Text>{o.story}</Text>
            <Group justify="space-between">
              <Group gap="lg">
                <Stat label="Вылет UTC" value={`${formatClock(o.depAt)}, ${formatUtc(o.depAt).slice(0, 5)}`} />
                <Stat label="Крайний срок" value={formatClock(o.deadline)} />
                <Stat label="Самолёт" value={o.typeId} />
                <Stat label="Пассажиры" value={String(o.pax)} />
                <Stat label="В пути" value={formatDuration(o.blockMin * 60_000)} />
                <Stat label="Контракт" value={`$${formatNum(o.contractUsd)}`} />
                <Stat label="Вам" value={`$${formatNum(o.pilotPay)}`} color="green" />
              </Group>
              <Button disabled={hasBooking} onClick={() => accept(o.id)}>
                Принять заказ
              </Button>
            </Group>
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}

// ——— история ———

function History() {
  const [list, setList] = useState<Booking[] | null>(null)
  const version = useCareerVersion()
  const places = usePlaces((list ?? []).flatMap((b) => [b.dep, b.arr]))
  useEffect(() => {
    window.api.dispatch.bookings().then(setList)
  }, [version])
  if (!list) return <Loader />
  if (!list.length) return <Text c="dimmed">Броней ещё не было.</Text>
  return (
    <Table striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Дата</Table.Th>
          <Table.Th>Рейс</Table.Th>
          <Table.Th>Маршрут</Table.Th>
          <Table.Th>Статус</Table.Th>
          <Table.Th ta="right">Задержка</Table.Th>
          <Table.Th ta="right">Оплата</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {list.map((b) => (
          <Table.Tr key={b.id}>
            <Table.Td>{formatUtc(b.depAt)}</Table.Td>
            <Table.Td className="mono">{b.flightNo}</Table.Td>
            <Table.Td>
              {placeLabel(places[b.dep], b.dep)} → {placeLabel(places[b.arr], b.arr)}
            </Table.Td>
            <Table.Td>
              <Badge color={BOOKING_STATUS[b.status].color} variant="light">
                {BOOKING_STATUS[b.status].label}
              </Badge>
            </Table.Td>
            <Table.Td ta="right">
              {b.delayMin && b.delayMin > 0 ? `${b.delayMin} мин${b.delayCode ? ` (${b.delayCode})` : ''}` : '—'}
            </Table.Td>
            <Table.Td ta="right">{b.pay !== null ? `$${formatNum(b.pay)}` : '—'}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
