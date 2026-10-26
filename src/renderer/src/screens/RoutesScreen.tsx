import { useEffect, useState } from 'react'
import { ActionIcon, Anchor, Badge, Button, Card, Checkbox, Group, NumberInput, Popover, Select, Slider, Stack, Table, Text } from '@mantine/core'
import { FARE_MULT_MAX, FARE_MULT_MIN, type ManagedRoute, type ManageState, type RouteQuote } from '@shared/airlines'
import { formatNum } from '../format'
import { airportFilter, placeLabel, usePlaces } from '../lib'
import { bigMoney } from '../components/StakePanel'
import { AutopilotSwitch, ManagedPage, useManaged, type Managed } from '../components/Managed'
import { Capacity } from './Fleet'
import { RouteMarket } from '../components/RouteMarket'
import { RouteAdvisor } from '../components/RouteAdvisor'

/** «Авто» в выборе самолёта: тип выбирается по флоту. */
const AUTO = 'auto'

export function RoutesScreen() {
  const m = useManaged()
  return <ManagedPage title="Маршруты" m={m}>{(st) => <RoutesBody m={m!} st={st} />}</ManagedPage>
}

function RoutesBody({ m, st }: { m: Managed; st: ManageState }) {
  const manual = !st.autopilot.routes
  const places = usePlaces([...st.origins, ...st.routes.flatMap((r) => [r.hub, r.dest]), ...st.legs.flatMap((l) => [l.hub, l.dest])])
  const freq = (hub: string, dest: string, n: number) => m.act((icao) => window.api.manage.setFrequency(icao, hub, dest, n))
  const [opened, setOpened] = useState<string | null>(null)
  const [advisor, setAdvisor] = useState(false)
  const openedRoute = st.routes.find((r) => `${r.hub}-${r.dest}` === opened)
  const routeTitle = (r: ManagedRoute) => `${placeLabel(places[r.hub], r.hub)} — ${placeLabel(places[r.dest], r.dest)}`
  return (
    <>
      {openedRoute && <RouteMarket m={m} st={st} route={openedRoute} title={routeTitle(openedRoute)} onClose={() => setOpened(null)} />}
      <Card withBorder>
        <Stack>
          <AutopilotSwitch m={m} part="routes" />
          <Capacity st={st} />
        </Stack>
      </Card>

      <FareCard m={m} st={st} />

      {st.legs.length > 0 && <OneWayCard m={m} st={st} places={places} manual={manual} />}

      {advisor && <RouteAdvisor m={m} st={st} onClose={() => setAdvisor(false)} />}
      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Рейсы</Text>
          <Button size="xs" variant="light" onClick={() => setAdvisor(true)}>
            Советник по маршрутам
          </Button>
        </Group>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Рейс</Table.Th>
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
            {st.routes.map((r) => [
              <Table.Tr key={`${r.hub}-${r.dest}`} style={{ borderBottom: 'none' }}>
                <Table.Td>
                  <FlightNumber m={m} iata={st.iata} hub={r.hub} dest={r.dest} num={r.flightNum} freq={r.freq} />
                </Table.Td>
                <Table.Td>
                  <Anchor size="sm" onClick={() => setOpened(`${r.hub}-${r.dest}`)}>
                    {placeLabel(places[r.hub], r.hub)} → {placeLabel(places[r.dest], r.dest)}
                  </Anchor>
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
                <Table.Td ta="right">
                  {r.fare ? bigMoney(r.fare) : '—'}
                  {r.fareMult !== undefined && (
                    <Text span size="xs" c="dimmed">
                      {' '}
                      ({r.fareMult >= 1 ? '+' : '−'}
                      {Math.abs(Math.round((r.fareMult - 1) * 100))}%)
                    </Text>
                  )}
                </Table.Td>
                <Table.Td ta="right" c={r.profit >= 0 ? 'green' : 'red'} rowSpan={2}>
                  {st.last ? bigMoney(r.profit) : '—'}
                  <Text size="xs" c="dimmed">
                    туда и обратно
                  </Text>
                </Table.Td>
                <Table.Td rowSpan={2}>
                  <Button size="xs" variant="subtle" color="red" disabled={!manual} onClick={() => freq(r.hub, r.dest, 0)}>
                    Закрыть
                  </Button>
                </Table.Td>
              </Table.Tr>,
              // Обратный рейс: номера на единицу больше, тот же самолёт и частота.
              <Table.Tr key={`${r.hub}-${r.dest}-back`} style={{ background: 'rgba(255,255,255,0.025)' }}>
                <Table.Td>
                  <Text size="sm" className="mono" c="dimmed">
                    {flightList(st.iata, r.flightNum + 1, r.freq)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    ↳ {placeLabel(places[r.dest], r.dest)} → {placeLabel(places[r.hub], r.hub)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {r.typeName ?? '—'}
                  </Text>
                </Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {formatNum(r.km)} км
                </Table.Td>
                <Table.Td ta="center" c="dimmed" className="mono">
                  {r.freq}
                </Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {st.last ? `${Math.round(r.lf * 100)}%` : '—'}
                </Table.Td>
                <Table.Td ta="right" c="dimmed">
                  {r.fare ? bigMoney(r.fare) : '—'}
                </Table.Td>
              </Table.Tr>
            ])}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">
          Под каждым рейсом — обратный: тот же самолёт и частота, номера на единицу больше. Загрузка, тариф и прибыль — за прошлый
          месяц, прибыль — за оба направления. Нажмите на маршрут, чтобы увидеть конкурентов и задать наценку.
        </Text>
      </Card>

      {manual && <OpenRouteCard m={m} st={st} />}
    </>
  )
}

/** Номера рейсов одного направления: частоты идут через 2 — «SU100», «SU100, SU102», «SU100 … SU104». */
const flightList = (iata: string, first: number, freq: number): string => {
  const n = Math.max(1, Math.round(freq))
  if (n === 1) return `${iata}${first}`
  if (n === 2) return `${iata}${first}, ${iata}${first + 2}`
  return `${iata}${first} … ${iata}${first + (n - 1) * 2}`
}

/** Номера рейсов «туда». Клик — сменить номер первого рейса. */
function FlightNumber({ m, iata, hub, dest, num, freq }: { m: Managed; iata: string; hub: string; dest: string; num: number; freq: number }) {
  const [value, setValue] = useState(num)
  const [open, setOpen] = useState(false)
  useEffect(() => setValue(num), [num])
  const save = async () => {
    if (await m.act((icao) => window.api.manage.setRouteNumber(icao, hub, dest, value))) setOpen(false)
  }
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withArrow>
      <Popover.Target>
        <Anchor size="sm" className="mono" onClick={() => setOpen((o) => !o)}>
          {flightList(iata, num, freq)}
        </Anchor>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <NumberInput label="Номер первого рейса" min={1} max={9999} value={value} onChange={(v) => setValue(Number(v) || 1)} w={200} />
          <Text size="xs" c="dimmed" maw={220}>
            Рейсы «туда» — {iata}
            {value}, {iata}
            {value + 2}…, обратные — на единицу больше.
          </Text>
          <Button size="xs" onClick={save} disabled={value === num}>
            Сохранить
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

/** Рейсы в одну сторону: самолёт стоит в аэропорту прилёта, пока нет обратного рейса. */
function OneWayCard({ m, st, places, manual }: { m: Managed; st: ManageState; places: ReturnType<typeof usePlaces>; manual: boolean }) {
  const [freq, setFreq] = useState<Record<string, number>>({})
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Рейсы в одну сторону
      </Text>
      <Text size="sm" c="dimmed" mb="sm">
        Самолёт улетел и остался в аэропорту прилёта: без обратного рейса он не летает по расписанию, но лизинг за него идёт.
      </Text>
      <Table>
        <Table.Tbody>
          {st.legs.map((l) => {
            const key = `${l.hub}-${l.dest}`
            return (
              <Table.Tr key={key}>
                <Table.Td>
                  <FlightNumber m={m} iata={st.iata} hub={l.hub} dest={l.dest} num={l.num} freq={0.5} />
                </Table.Td>
                <Table.Td>
                  {placeLabel(places[l.hub], l.hub)} → {placeLabel(places[l.dest], l.dest)}
                </Table.Td>
                <Table.Td>
                  {l.typeName} · <span className="mono">{l.reg}</span>
                </Table.Td>
                <Table.Td>
                  <Badge color={l.landed ? 'orange' : 'blue'} variant="light">
                    {l.landed ? `Стоит в ${l.dest}` : 'Ждёт вылета или в пути'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <NumberInput
                      size="xs"
                      w={70}
                      min={1}
                      max={12}
                      value={freq[key] ?? 1}
                      onChange={(v) => setFreq({ ...freq, [key]: Number(v) || 1 })}
                      disabled={!manual}
                    />
                    <Button
                      size="xs"
                      disabled={!manual}
                      onClick={() => m.act((icao) => window.api.manage.createReturn(icao, l.hub, l.dest, freq[key] ?? 1))}
                    >
                      Создать обратный рейс
                    </Button>
                    <Button size="xs" variant="subtle" onClick={() => m.act((icao) => window.api.manage.ferryBack(icao, l.hub, l.dest))}>
                      Перегнать обратно
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            )
          })}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="xs">
        «Создать обратный рейс» делает маршрут регулярным «туда-обратно» с выбранной частотой. «Перегнать обратно» — пустой
        перегон за счёт компании. Если маршрутами управляет заместитель, обратные рейсы он ставит сам.
      </Text>
    </Card>
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
        Дешевле — больше пассажиров и доля рынка у конкурентов, дороже — больше денег с каждого, но рейсы полупустые. Это общая
        наценка; на отдельный рейс её можно задать в его карточке.
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
  const [withReturn, setWithReturn] = useState(true)

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
    if (await m.act((icao) => window.api.manage.openRoute(icao, origin, dest, freq, typeId, withReturn))) setDest(null)
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
        <NumberInput
          label="Рейсов в день"
          min={1}
          max={12}
          w={130}
          value={freq}
          onChange={(v) => setFreq(Number(v) || 1)}
          disabled={!withReturn}
        />
        <Checkbox
          label="С обратным рейсом"
          checked={withReturn}
          onChange={(e) => setWithReturn(e.currentTarget.checked)}
          mb={8}
        />
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
        или не сядут на ВПП, недоступны. Без обратного рейса самолёт улетит один раз и останется в аэропорту прилёта.
      </Text>
    </Card>
  )
}
