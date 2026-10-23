import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Group, Loader, Popover, Select, Stack, Table, Tabs, Text, Title } from '@mantine/core'
import type { HireOption, Person, PilotState, RatingInfo, Transaction } from '@shared/types'
import { RANKS, hourlyRate, monthlySalary } from '@shared/career'
import { countryName, formatNum, formatUtc } from '../format'
import { errMsg, notifyCareerChanged, placeLabel, useCareerVersion, usePilot, usePlaces } from '../lib'
import { SortableTh, compareBy, type SortState } from '../components/SortableTh'

export function Career() {
  const [pilot] = usePilot()
  if (!pilot) return <Loader />
  return (
    <Stack>
      <Title order={3}>Карьера</Title>
      <Tabs defaultValue="ratings" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="ratings">Допуски</Tabs.Tab>
          <Tabs.Tab value="job">Работа</Tabs.Tab>
          <Tabs.Tab value="ranks">Звания</Tabs.Tab>
          <Tabs.Tab value="money">Финансы</Tabs.Tab>
          <Tabs.Tab value="clients">Клиенты</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="ratings" pt="md">
          <Ratings pilot={pilot} />
        </Tabs.Panel>
        <Tabs.Panel value="job" pt="md">
          <Job pilot={pilot} />
        </Tabs.Panel>
        <Tabs.Panel value="ranks" pt="md">
          <Ranks pilot={pilot} />
        </Tabs.Panel>
        <Tabs.Panel value="money" pt="md">
          <Money pilot={pilot} />
        </Tabs.Panel>
        <Tabs.Panel value="clients" pt="md">
          <Clients />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

function useAction(): [string | null, (fn: () => Promise<unknown>) => Promise<void>] {
  const [error, setError] = useState<string | null>(null)
  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      notifyCareerChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }
  return [error, run]
}

type RatingSort = SortState<'name' | 'price'>

function Ratings({ pilot }: { pilot: PilotState }) {
  const [all, setAll] = useState<RatingInfo[] | null>(null)
  const [employer, setEmployer] = useState<HireOption | null>(null)
  const [sort, setSort] = useState<RatingSort>({ key: 'price', dir: 'asc' })
  const [error, run] = useAction()

  useEffect(() => {
    window.api.career.allRatings().then(setAll)
    window.api.career.hireOptions().then((o) => setEmployer(o.find((x) => x.id === pilot.employerId) ?? null))
  }, [pilot.employerId])

  if (!all) return <Loader />
  const owned = new Map(pilot.ratings.map((r) => [r.id, r]))
  const usedByEmployer = new Set(employer?.ratings.map((r) => r.id))
  const rows = [...all].sort(
    (a, b) =>
      // Сначала типы работодателя, потом по выбранной сортировке.
      Number(usedByEmployer.has(b.id)) - Number(usedByEmployer.has(a.id)) ||
      compareBy<RatingInfo>(sort.key === 'name' ? (r) => r.name : (r) => r.price, sort.dir)(a, b)
  )

  return (
    <Stack>
      <Text c="dimmed">
        Переучивание оплачивается из личных денег. Баланс: <b>${formatNum(pilot.cash)}</b>
      </Text>
      {error && <Alert color="red">{error}</Alert>}
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <SortableTh sortKey="name" sort={sort} onSort={setSort}>
              Допуск
            </SortableTh>
            <Table.Th>У работодателя</Table.Th>
            <SortableTh sortKey="price" sort={sort} onSort={setSort} align="right">
              Стоимость
            </SortableTh>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td fw={500}>{r.name}</Table.Td>
              <Table.Td>{usedByEmployer.has(r.id) ? <Badge variant="light">есть во флоте</Badge> : ''}</Table.Td>
              <Table.Td ta="right">${formatNum(r.price)}</Table.Td>
              <Table.Td ta="right">
                {owned.has(r.id) ? (
                  <Badge color="green">получен {formatUtc(owned.get(r.id)!.obtainedAt!).slice(0, 10)}</Badge>
                ) : (
                  <Button size="xs" variant="light" disabled={pilot.cash < r.price} onClick={() => run(() => window.api.career.buyRating(r.id))}>
                    Пройти переучивание
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

function Job({ pilot }: { pilot: PilotState }) {
  const [employer, setEmployer] = useState<HireOption | null>(null)
  const [base, setBase] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [error, run] = useAction()
  const places = usePlaces(employer?.bases ?? [])

  useEffect(() => {
    window.api.career.hireOptions().then((o) => setEmployer(o.find((x) => x.id === pilot.employerId) ?? null))
  }, [pilot.employerId])

  if (!pilot.employerId) return <Text c="dimmed">Вы сейчас без работы — найти её можно на главной.</Text>
  return (
    <Stack maw={600}>
      {error && <Alert color="red">{error}</Alert>}
      <Card withBorder>
        <Stack>
          <Text>
            Работодатель: <b>{pilot.employerName}</b> · база {placeLabel(places[pilot.base!], pilot.base!)}
          </Text>
          {employer && employer.bases.length > 1 && (
            <Group align="flex-end">
              <Select
                label="Сменить базу ($1 500 на переезд)"
                data={employer.bases.filter((b) => b !== pilot.base).map((b) => ({ value: b, label: placeLabel(places[b], b) }))}
                value={base}
                onChange={setBase}
                searchable
                w={320}
              />
              <Button disabled={!base} onClick={() => base && run(() => window.api.career.changeBase(base))}>
                Переехать
              </Button>
            </Group>
          )}
        </Stack>
      </Card>
      <Card withBorder>
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Уволившись, вы сохраните звание, налёт и допуски. Активная бронь будет отменена.
          </Text>
          <Popover opened={confirm} onChange={setConfirm} withArrow>
            <Popover.Target>
              <Button color="red" variant="light" onClick={() => setConfirm((v) => !v)}>
                Уволиться
              </Button>
            </Popover.Target>
            <Popover.Dropdown>
              <Group>
                <Text size="sm">Точно уволиться?</Text>
                <Button size="xs" color="red" onClick={() => run(() => window.api.career.resign())}>
                  Да
                </Button>
              </Group>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Card>
    </Stack>
  )
}

function Ranks({ pilot }: { pilot: PilotState }) {
  return (
    <Table striped maw={760}>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Звание</Table.Th>
          <Table.Th ta="right">Налёт для звания</Table.Th>
          <Table.Th>Дополнительно</Table.Th>
          <Table.Th ta="right">Оклад в месяц</Table.Th>
          <Table.Th ta="right">За блок-час (A320/737)</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {RANKS.map((r) => (
          <Table.Tr key={r.id} fw={r.id === pilot.rank ? 700 : undefined}>
            <Table.Td>
              {r.name} {r.id === pilot.rank && <Badge ml="xs">вы здесь</Badge>}
            </Table.Td>
            <Table.Td ta="right">{r.minHours} ч</Table.Td>
            <Table.Td c="dimmed">{r.id === 'instructor' ? 'Сертификат TRI (раздел «Личная жизнь» → «Образование»)' : '—'}</Table.Td>
            <Table.Td ta="right">${formatNum(monthlySalary(r.id))}</Table.Td>
            <Table.Td ta="right">${formatNum(hourlyRate('narrowbody', r.id))}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

function Money({ pilot }: { pilot: PilotState }) {
  const [list, setList] = useState<Transaction[] | null>(null)
  const version = useCareerVersion()
  useEffect(() => {
    window.api.career.transactions().then(setList)
  }, [version])
  if (!list) return <Loader />
  return (
    <Stack>
      <Text>
        Баланс: <b>${formatNum(pilot.cash)}</b>. Накопленный капитал пригодится, чтобы основать свою авиакомпанию.
      </Text>
      <Table striped>
        <Table.Tbody>
          {list.map((t) => (
            <Table.Tr key={t.id}>
              <Table.Td w={180}>{formatUtc(t.t)}</Table.Td>
              <Table.Td>{t.description}</Table.Td>
              <Table.Td ta="right" c={t.amount >= 0 ? 'green' : 'red'} className="mono">
                {t.amount >= 0 ? '+' : '−'}${formatNum(Math.abs(t.amount))}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}

const KIND_LABEL = { government: 'Госзаказ', corporate: 'Корпоративный', private: 'Частное лицо', special: 'Срочный' } as const

function Clients() {
  const [list, setList] = useState<Person[] | null>(null)
  const [sort, setSort] = useState<SortState<'name' | 'relationship' | 'flights' | 'country'>>({ key: 'relationship', dir: 'desc' })
  const version = useCareerVersion()
  useEffect(() => {
    window.api.career.clients().then(setList)
  }, [version])
  if (!list) return <Loader />
  if (!list.length) return <Text c="dimmed">Записная книжка пуста — клиенты появятся после первых VIP-чартеров.</Text>
  const getters = {
    name: (p: Person) => p.name,
    relationship: (p: Person) => p.relationship,
    flights: (p: Person) => p.flights,
    country: (p: Person) => countryName(p.country)
  }
  return (
    <Table striped>
      <Table.Thead>
        <Table.Tr>
          <SortableTh sortKey="name" sort={sort} onSort={setSort}>
            Клиент
          </SortableTh>
          <Table.Th>Тип</Table.Th>
          <SortableTh sortKey="country" sort={sort} onSort={setSort}>
            Страна
          </SortableTh>
          <SortableTh sortKey="flights" sort={sort} onSort={setSort} align="right" firstDir="desc">
            Полётов
          </SortableTh>
          <SortableTh sortKey="relationship" sort={sort} onSort={setSort} align="right" firstDir="desc">
            Отношение
          </SortableTh>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {[...list].sort(compareBy(getters[sort.key], sort.dir)).map((p) => (
          <Table.Tr key={p.id}>
            <Table.Td>
              <b>{p.name}</b>
              <Text size="xs" c="dimmed">
                {p.title}
              </Text>
            </Table.Td>
            <Table.Td>{KIND_LABEL[p.kind]}</Table.Td>
            <Table.Td>{countryName(p.country)}</Table.Td>
            <Table.Td ta="right">{p.flights}</Table.Td>
            <Table.Td ta="right" c={p.relationship > 0 ? 'green' : p.relationship < 0 ? 'red' : undefined}>
              {p.relationship > 0 ? '+' : ''}
              {p.relationship}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}
