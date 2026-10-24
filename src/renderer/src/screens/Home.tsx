import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type { Booking, HireOption, PilotState, ProfileSummary } from '@shared/types'
import type { PlayerAirline } from '@shared/airlines'
import type { FlightRecord } from '@shared/sim'
import { ARCHETYPE_LABEL, countryName, formatClock, formatNum, formatUtc } from '../format'
import { errMsg, notifyCareerChanged, placeLabel, usePilot, usePlaces } from '../lib'
import { SortableTh, compareBy, type SortState } from '../components/SortableTh'
import { Stat } from '../components/FlightParts'
import { AirlineLogo } from '../components/AirlineLogo'

export function Home({ profile }: { profile: ProfileSummary }) {
  const [pilot] = usePilot()
  const [companies, setCompanies] = useState<PlayerAirline[] | null>(null)
  useEffect(() => {
    window.api.owner.companies().then(setCompanies)
  }, [pilot])
  if (!pilot || !companies) return <Loader />
  if (companies.length) return <CeoHome company={companies[0]} />
  return (
    <Stack>
      {profile.mode === 'owner' && <OwnerStart />}
      {pilot.employerId ? <Dashboard pilot={pilot} /> : <Hiring pilot={pilot} />}
    </Stack>
  )
}

// ——— владелец ———

/** Профиль «Владелец» без компании: основать свою или купить долю. */
function OwnerStart() {
  const navigate = useNavigate()
  return (
    <Card withBorder padding="lg">
      <Stack gap="xs">
        <Title order={4}>Станьте владельцем авиакомпании</Title>
        <Text c="dimmed">
          Основайте свою компанию на стартовый капитал или купите долю в существующей. Пока вы решаете, можно работать
          пилотом.
        </Text>
        <Group>
          <Button onClick={() => navigate('/company')}>Основать авиакомпанию</Button>
          <Button variant="light" onClick={() => navigate('/market')}>
            Купить долю на рынке
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}

/** Главная генерального директора своей компании. */
function CeoHome({ company }: { company: PlayerAirline }) {
  const navigate = useNavigate()
  return (
    <Stack>
      <Title order={3}>Главная</Title>
      <Card withBorder padding="lg">
        <Group justify="space-between">
          <Group>
            <AirlineLogo iata={company.iata} name={company.name} h={40} />
            <Stack gap={0}>
              <Text fw={700}>{company.name}</Text>
              <Text size="sm" c="dimmed">
                Вы — генеральный директор и владелец
              </Text>
            </Stack>
          </Group>
          <Button onClick={() => navigate('/company')}>Открыть компанию</Button>
        </Group>
      </Card>
      <Text size="sm" c="dimmed">
        Полёты рейсами своей компании появятся в одной из следующих частей этапа. Пока можно летать свободно в разделе
        «Активный полёт».
      </Text>
    </Stack>
  )
}

// ——— сводка ———

function Dashboard({ pilot }: { pilot: PilotState }) {
  const navigate = useNavigate()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [recent, setRecent] = useState<FlightRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const places = usePlaces([pilot.base, pilot.location, booking?.dep, booking?.arr])

  useEffect(() => {
    window.api.dispatch.open().then(setBooking)
    window.api.logbook.list().then((l) => setRecent(l.filter((f) => f.source !== 'demo').slice(0, 5)))
  }, [pilot])

  const returnToBase = async () => {
    setError(null)
    try {
      await window.api.career.returnToBase()
      notifyCareerChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>
          {pilot.rankName} {pilot.name}
        </Title>
        <Group gap="sm">
          <AirlineLogo iata={pilot.employerIata} name={pilot.employerName ?? ''} h={28} />
          <Text fw={600}>{pilot.employerName}</Text>
        </Group>
      </Group>
      {error && <Alert color="red">{error}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>Пилот</Text>
            <SimpleGrid cols={2}>
              <Stat label="Налёт в карьере" value={`${pilot.stats.hours} ч`} />
              <Stat label="Полётов" value={String(pilot.stats.flights)} />
              <Stat label="Средняя оценка" value={pilot.stats.flights ? String(pilot.stats.avgScore) : '—'} />
              <Stat label="Баланс" value={`$${formatNum(pilot.cash)}`} color="green" />
            </SimpleGrid>
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                Репутация у работодателя: {pilot.reputation}/100
              </Text>
              <Progress value={pilot.reputation} color={pilot.reputation >= 60 ? 'green' : pilot.reputation >= 35 ? 'yellow' : 'red'} />
            </Stack>
          </Stack>
        </Card>

        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>Где вы</Text>
            <Stat label="База" value={placeLabel(places[pilot.base!], pilot.base!)} />
            <Stat label="Сейчас в аэропорту" value={placeLabel(places[pilot.location!], pilot.location ?? '—')} />
            {pilot.location !== pilot.base && (
              <Button size="xs" variant="light" onClick={returnToBase}>
                Вернуться на базу пассажиром
              </Button>
            )}
            <Text size="xs" c="dimmed">
              Допуски: {pilot.ratings.map((r) => r.name).join(', ') || 'нет'}
            </Text>
          </Stack>
        </Card>

        <Card withBorder>
          <Stack gap="sm">
            <Text fw={600}>{pilot.nextRank ? `До звания «${pilot.nextRank.name}»` : 'Высшее звание'}</Text>
            {pilot.nextRank ? (
              <>
                <Req label="Налёт" have={pilot.stats.hours} need={pilot.nextRank.minHours} unit="ч" />
                {pilot.nextRank.needsTri && (
                  <Text size="sm" c="orange">
                    Нужен сертификат пилота-инструктора (TRI) — раздел «Личная жизнь» → «Образование».
                  </Text>
                )}
              </>
            ) : (
              <Text c="dimmed">Вы достигли вершины карьеры пилота.</Text>
            )}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Group justify="space-between">
          <Stack gap={2}>
            <Text fw={600}>Текущая бронь</Text>
            {booking ? (
              <Text>
                <b>{booking.flightNo}</b> {placeLabel(places[booking.dep], booking.dep)} → {placeLabel(places[booking.arr], booking.arr)} ·
                вылет {formatClock(booking.depAt)} UTC ({formatUtc(booking.depAt).slice(0, 10)})
                {booking.status === 'awaiting_delay' && (
                  <Badge ml="xs" color="orange">
                    нужна причина задержки
                  </Badge>
                )}
              </Text>
            ) : (
              <Text c="dimmed">Брони нет — выберите рейс в диспетчерской.</Text>
            )}
          </Stack>
          <Button onClick={() => navigate('/dispatch')}>В диспетчерскую</Button>
        </Group>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Последние полёты
        </Text>
        {recent.length ? (
          <Table>
            <Table.Tbody>
              {recent.map((f) => (
                <Table.Tr key={f.id}>
                  <Table.Td>{formatUtc(f.blockOffAt ?? f.createdAt)}</Table.Td>
                  <Table.Td className="mono">
                    {f.departure} → {f.arrival ?? '????'}
                  </Table.Td>
                  <Table.Td>{f.aircraftType ?? f.aircraftTitle}</Table.Td>
                  <Table.Td ta="right">{f.landing ? `${f.landing.vsFpm} fpm` : '—'}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {f.score}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text c="dimmed">Пока пусто.</Text>
        )}
      </Card>
    </Stack>
  )
}

function Req({ label, have, need, unit = '' }: { label: string; have: number; need: number; unit?: string }) {
  const pct = need ? Math.min(100, (have / need) * 100) : 100
  return (
    <Stack gap={2}>
      <Group justify="space-between">
        <Text size="sm">{label}</Text>
        <Text size="sm" className="mono" c={have >= need ? 'green' : undefined}>
          {have} / {need} {unit}
        </Text>
      </Group>
      <Progress value={pct} color={have >= need ? 'green' : 'blue'} size="sm" />
    </Stack>
  )
}

// ——— найм ———

type SortKey = 'name' | 'country' | 'reputation' | 'hours'
const GETTERS: Record<SortKey, (o: HireOption) => string | number> = {
  name: (o) => o.name,
  country: (o) => (o.country ? countryName(o.country) : ''),
  reputation: (o) => o.reputation,
  hours: (o) => o.requiredHours
}

function Hiring({ pilot }: { pilot: PilotState }) {
  const [options, setOptions] = useState<HireOption[] | null>(null)
  const [kind, setKind] = useState<'airline' | 'charter'>('airline')
  const [archetype, setArchetype] = useState('all')
  const [query, setQuery] = useState('')
  const [onlyEligible, setOnlyEligible] = useState(true)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'reputation', dir: 'desc' })
  const [selected, setSelected] = useState<HireOption | null>(null)

  useEffect(() => {
    window.api.career.hireOptions().then(setOptions)
  }, [])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (options ?? [])
      .filter((o) => o.kind === kind)
      // Фильтры по типу, доступности и поиск видны только для авиакомпаний — к VIP-операторам их не применяем.
      .filter((o) => kind !== 'airline' || archetype === 'all' || o.archetype === archetype)
      .filter((o) => kind !== 'airline' || !onlyEligible || o.eligible)
      .filter(
        (o) =>
          kind !== 'airline' ||
          !q ||
          o.name.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          (o.country && countryName(o.country).toLowerCase().includes(q))
      )
      .sort(compareBy(GETTERS[sort.key], sort.dir))
  }, [options, kind, archetype, query, onlyEligible, sort])

  if (!options) return <Loader />
  if (selected) return <HireForm option={selected} pilot={pilot} onBack={() => setSelected(null)} />

  return (
    <Stack>
      <Title order={3}>Поиск работы</Title>
      <Text c="dimmed">
        Выберите, где начать карьеру. Работодатель оплатит переучивание на один тип своего флота. Налёт в игре: {pilot.stats.hours} ч.
      </Text>
      <SegmentedControl
        value={kind}
        onChange={(v) => setKind(v as typeof kind)}
        data={[
          { value: 'airline', label: 'Авиакомпании' },
          { value: 'charter', label: 'Бизнес-авиация (VIP-чартеры)' }
        ]}
      />
      {kind === 'airline' && (
        <Group>
          <SegmentedControl
            value={archetype}
            onChange={setArchetype}
            data={[
              { value: 'all', label: 'Все' },
              { value: 'legacy', label: ARCHETYPE_LABEL.legacy },
              { value: 'lowcost', label: ARCHETYPE_LABEL.lowcost },
              { value: 'leisure', label: ARCHETYPE_LABEL.leisure },
              { value: 'cargo', label: ARCHETYPE_LABEL.cargo }
            ]}
          />
          <TextInput placeholder="Поиск" value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={240} />
          <SegmentedControl
            value={onlyEligible ? 'yes' : 'no'}
            onChange={(v) => setOnlyEligible(v === 'yes')}
            data={[
              { value: 'yes', label: 'Куда возьмут' },
              { value: 'no', label: 'Все вакансии' }
            ]}
          />
        </Group>
      )}
      <Table highlightOnHover striped>
        <Table.Thead>
          <Table.Tr>
            <SortableTh sortKey="name" sort={sort} onSort={setSort}>
              Работодатель
            </SortableTh>
            <SortableTh sortKey="country" sort={sort} onSort={setSort}>
              Страна
            </SortableTh>
            <Table.Th>Тип</Table.Th>
            <SortableTh sortKey="reputation" sort={sort} onSort={setSort} firstDir="desc" align="right">
              Престиж
            </SortableTh>
            <SortableTh sortKey="hours" sort={sort} onSort={setSort} align="right">
              Требуемый налёт
            </SortableTh>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((o) => (
            <Table.Tr key={o.id}>
              <Table.Td fw={500}>
                <Group gap="sm" wrap="nowrap">
                  <AirlineLogo iata={o.iata} name={o.name} />
                  {o.name}
                </Group>
              </Table.Td>
              <Table.Td>{o.country ? countryName(o.country) : 'Весь мир'}</Table.Td>
              <Table.Td>
                <Badge variant="light">{o.archetype === 'charter' ? 'Бизнес-авиация' : ARCHETYPE_LABEL[o.archetype]}</Badge>
              </Table.Td>
              <Table.Td ta="right">{o.reputation}</Table.Td>
              <Table.Td ta="right">{o.requiredHours ? `${o.requiredHours} ч` : 'без опыта'}</Table.Td>
              <Table.Td ta="right">
                <Button size="xs" disabled={!o.eligible} onClick={() => setSelected(o)}>
                  {o.eligible ? 'Выбрать' : 'Мало налёта'}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

function HireForm({ option, pilot, onBack }: { option: HireOption; pilot: PilotState; onBack(): void }) {
  const [base, setBase] = useState<string | null>(option.bases[0])
  const owned = new Set(pilot.ratings.map((r) => r.id))
  const [rating, setRating] = useState<string | null>(option.ratings.find((r) => owned.has(r.id))?.id ?? option.ratings[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const places = usePlaces(option.bases)

  const submit = async () => {
    if (!base || !rating) return
    setError(null)
    try {
      await window.api.career.hire({ kind: option.kind, employerId: option.id, base, ratingId: rating })
      notifyCareerChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Stack maw={560}>
      <Group gap="sm">
        <AirlineLogo iata={option.iata} name={option.name} h={32} />
        <Title order={3}>{option.name}</Title>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      <Card withBorder>
        <Stack>
          <Select
            label="База"
            description="Аэропорт, из которого вы будете летать. Сменить можно позже за плату."
            data={option.bases.map((b) => ({ value: b, label: placeLabel(places[b], b) }))}
            value={base}
            onChange={setBase}
            searchable
          />
          <Select
            label="Тип самолёта (переучивание за счёт работодателя)"
            data={option.ratings.map((r) => ({ value: r.id, label: owned.has(r.id) ? `${r.name} — допуск уже есть` : r.name }))}
            value={rating}
            onChange={setRating}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onBack}>
              Назад
            </Button>
            <Button onClick={submit} disabled={!base || !rating}>
              Устроиться на работу
            </Button>
          </Group>
        </Stack>
      </Card>
    </Stack>
  )
}
