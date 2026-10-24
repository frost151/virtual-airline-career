import { useEffect, useState } from 'react'
import { ActionIcon, Button, Card, Group, NumberInput, Select, Slider, Stack, Table, Text } from '@mantine/core'
import { FARE_MULT_MAX, FARE_MULT_MIN, type ManageState, type RouteQuote } from '@shared/airlines'
import { formatNum } from '../format'
import { airportFilter, placeLabel, usePlaces } from '../lib'
import { bigMoney } from '../components/StakePanel'
import { AutopilotSwitch, ManagedPage, useManaged, type Managed } from '../components/Managed'
import { Capacity } from './Fleet'

/** «Авто» в выборе самолёта: тип выбирается по флоту. */
const AUTO = 'auto'

export function RoutesScreen() {
  const m = useManaged()
  return <ManagedPage title="Маршруты" m={m}>{(st) => <RoutesBody m={m!} st={st} />}</ManagedPage>
}

function RoutesBody({ m, st }: { m: Managed; st: ManageState }) {
  const manual = !st.autopilot.routes
  const places = usePlaces([...st.origins, ...st.routes.flatMap((r) => [r.hub, r.dest])])
  const freq = (hub: string, dest: string, n: number) => m.act((icao) => window.api.manage.setFrequency(icao, hub, dest, n))
  return (
    <>
      <Card withBorder>
        <Stack>
          <AutopilotSwitch m={m} part="routes" />
          <Capacity st={st} />
        </Stack>
      </Card>

      <FareCard m={m} st={st} />

      <Card withBorder>
        <Text fw={600} mb="xs">
          Рейсы
        </Text>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Маршрут</Table.Th>
              <Table.Th>Самолёт</Table.Th>
              <Table.Th ta="right">Расстояние</Table.Th>
              <Table.Th ta="center">Рейсов/день</Table.Th>
              <Table.Th ta="right">Загрузка</Table.Th>
              <Table.Th ta="right">Тариф</Table.Th>
              <Table.Th ta="right">Прибыль/мес</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {st.routes.map((r) => (
              <Table.Tr key={`${r.hub}-${r.dest}`}>
                <Table.Td>
                  {placeLabel(places[r.hub], r.hub)} — {placeLabel(places[r.dest], r.dest)}
                </Table.Td>
                <Table.Td miw={200}>
                  {manual ? (
                    <Select
                      size="xs"
                      allowDeselect={false}
                      data={[
                        { value: AUTO, label: r.typeAssigned ? 'Авто' : `Авто · ${r.typeName ?? '—'}` },
                        ...r.typeOptions.map((t) => ({ value: t.id, label: t.name }))
                      ]}
                      value={r.typeAssigned ? r.typeId : AUTO}
                      onChange={(v) =>
                        m.act((icao) => window.api.manage.setRouteType(icao, r.hub, r.dest, !v || v === AUTO ? null : v))
                      }
                    />
                  ) : (
                    (r.typeName ?? '—')
                  )}
                </Table.Td>
                <Table.Td ta="right">{formatNum(r.km)} км</Table.Td>
                <Table.Td>
                  <Group gap={4} justify="center" wrap="nowrap">
                    <ActionIcon variant="light" size="sm" disabled={!manual || r.freq <= 1} onClick={() => freq(r.hub, r.dest, r.freq - 1)}>
                      −
                    </ActionIcon>
                    <Text w={24} ta="center" className="mono">
                      {r.freq}
                    </Text>
                    <ActionIcon variant="light" size="sm" disabled={!manual} onClick={() => freq(r.hub, r.dest, r.freq + 1)}>
                      +
                    </ActionIcon>
                  </Group>
                </Table.Td>
                <Table.Td ta="right">{st.last ? `${Math.round(r.lf * 100)}%` : '—'}</Table.Td>
                <Table.Td ta="right">{r.fare ? bigMoney(r.fare) : '—'}</Table.Td>
                <Table.Td ta="right" c={r.profit >= 0 ? 'green' : 'red'}>
                  {st.last ? bigMoney(r.profit) : '—'}
                </Table.Td>
                <Table.Td>
                  <Button size="xs" variant="subtle" color="red" disabled={!manual} onClick={() => freq(r.hub, r.dest, 0)}>
                    Закрыть
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">
          Загрузка, тариф и прибыль — за прошлый месяц. Новые рейсы и частоты начнут приносить деньги в следующем.
        </Text>
      </Card>

      {manual && <OpenRouteCard m={m} st={st} />}
    </>
  )
}

function FareCard({ m, st }: { m: Managed; st: ManageState }) {
  const [value, setValue] = useState(st.fareMult)
  useEffect(() => setValue(st.fareMult), [st.fareMult])
  const manual = !st.autopilot.fares
  const pct = Math.round((value - 1) * 100)
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Тарифы</Text>
        <AutopilotSwitch m={m} part="fares" />
      </Group>
      <Text size="sm" mb="md">
        {pct === 0 ? 'Цены на уровне рынка.' : pct < 0 ? `Билеты на ${-pct}% дешевле рынка.` : `Билеты на ${pct}% дороже рынка.`}{' '}
        Дешевле — больше пассажиров и доля рынка у конкурентов, дороже — больше денег с каждого, но рейсы полупустые.
      </Text>
      <Slider
        disabled={!manual}
        min={FARE_MULT_MIN}
        max={FARE_MULT_MAX}
        step={0.05}
        value={value}
        onChange={setValue}
        onChangeEnd={(v) => m.act((icao) => window.api.manage.setFareMult(icao, v))}
        label={(v) => `${v >= 1 ? '+' : '−'}${Math.abs(Math.round((v - 1) * 100))}%`}
        marks={[
          { value: 0.7, label: '−30%' },
          { value: 1, label: 'рынок' },
          { value: 1.3, label: '+30%' }
        ]}
        mb="lg"
      />
    </Card>
  )
}

function OpenRouteCard({ m, st }: { m: Managed; st: ManageState }) {
  const [airportList, setAirportList] = useState<{ value: string; label: string }[]>([])
  const [origin, setOrigin] = useState<string | null>(st.origins[0] ?? null)
  const [dest, setDest] = useState<string | null>(null)
  const [quote, setQuote] = useState<RouteQuote | null>(null)
  const [typeId, setTypeId] = useState<string | null>(null)
  const [freq, setFreq] = useState(1)

  useEffect(() => {
    window.api.owner.hubOptions().then(setAirportList)
  }, [])

  // Расстояние, спрос и какие самолёты флота выполнят рейс — при каждой смене аэропортов или флота.
  useEffect(() => {
    setQuote(null)
    if (!origin || !dest || origin === dest || !m.icao) return
    window.api.manage
      .routeQuote(m.icao, origin, dest)
      .then((q) => {
        setQuote(q)
        setTypeId((cur) => (q.types.some((t) => t.id === cur && !t.reason) ? cur : (q.types.find((t) => !t.reason)?.id ?? null)))
      })
      .catch(() => setQuote(null))
  }, [origin, dest, m.icao, st.fleet.length])

  const open = async () => {
    if (!origin || !dest || !typeId) return
    if (await m.act((icao) => window.api.manage.openRoute(icao, origin, dest, freq, typeId))) setDest(null)
  }

  const noType = !!quote && !quote.types.some((t) => !t.reason)
  const longest = quote ? Math.ceil((quote.km * 1.05) / 100) * 100 : 0

  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Открыть рейс
      </Text>
      <Group align="flex-end">
        <Select
          label="Откуда"
          w={320}
          placeholder="Код ICAO, IATA или город"
          data={airportList}
          value={origin}
          onChange={setOrigin}
          searchable
          limit={50}
          filter={airportFilter}
          nothingFoundMessage="Не найдено"
        />
        <Select
          label="Куда"
          w={320}
          placeholder="Код ICAO, IATA или город"
          data={airportList}
          value={dest}
          onChange={setDest}
          searchable
          limit={50}
          filter={airportFilter}
          nothingFoundMessage="Не найдено"
        />
        <Select
          label="Самолёт"
          w={300}
          placeholder={quote ? 'Нет подходящих' : 'Сначала выберите аэропорты'}
          data={(quote?.types ?? []).map((t) => ({
            value: t.id,
            label: t.reason ? `${t.name} — ${t.reason}` : t.name,
            disabled: !!t.reason
          }))}
          value={typeId}
          onChange={setTypeId}
          allowDeselect={false}
        />
        <NumberInput label="Рейсов в день" min={1} max={12} w={130} value={freq} onChange={(v) => setFreq(Number(v) || 1)} />
        <Button disabled={!quote || quote.exists || !typeId} onClick={open}>
          Открыть
        </Button>
      </Group>
      {quote && (
        <Stack gap={2} mt="xs">
          <Text size="sm">
            {formatNum(quote.km)} км · спрос {formatNum(quote.demand)} пасс./сут · {quote.competitors ? `конкурентов ${quote.competitors}` : 'конкурентов нет'}
          </Text>
          {quote.exists && (
            <Text size="sm" c="orange">
              Такой рейс у вас уже есть — частоту меняйте в таблице выше.
            </Text>
          )}
          {!quote.scheduled && (
            <Text size="sm" c="orange">
              В один из аэропортов регулярные рейсы не летают.
            </Text>
          )}
          {noType && (
            <Text size="sm" c="orange">
              Ни один самолёт вашего флота сюда не долетит: нужен тип с дальностью от {formatNum(longest)} км. Возьмите его во «Флоте».
            </Text>
          )}
        </Stack>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Вылет и прилёт — любые аэропорты с регулярными рейсами. Рейс выполняет выбранный тип; самолёты, которые не долетят
        или не сядут на ВПП, недоступны.
      </Text>
    </Card>
  )
}
