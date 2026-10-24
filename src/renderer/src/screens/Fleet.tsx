import { useEffect, useState } from 'react'
import { Button, Card, Group, NumberInput, Progress, Select, SimpleGrid, Stack, Table, Text } from '@mantine/core'
import type { ManageState } from '@shared/airlines'
import { formatNum } from '../format'
import { Stat } from '../components/FlightParts'
import { bigMoney } from '../components/StakePanel'
import { AutopilotSwitch, ManagedPage, useManaged, type Managed } from '../components/Managed'

/** Залог за лизинг — 3 месяца (как в main/airlines/manage.ts). */
const LEASE_DEPOSIT_MONTHS = 3

/** Блок-часы расписания против возможностей флота. */
export function Capacity({ st }: { st: ManageState }) {
  const pct = st.blockHoursAvailable ? (st.blockHoursNeeded / st.blockHoursAvailable) * 100 : 0
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Text size="sm">Загрузка флота расписанием</Text>
        <Text size="sm" className="mono">
          {formatNum(st.blockHoursNeeded)} из {formatNum(st.blockHoursAvailable)} блок-ч в месяц · {Math.round(pct)}%
        </Text>
      </Group>
      <Progress value={Math.min(100, pct)} color={pct > 100 ? 'red' : pct > 85 ? 'green' : 'yellow'} />
      {st.typeHours.length > 1 &&
        st.typeHours.map((h) => {
          const p = h.available ? (h.needed / h.available) * 100 : 0
          return (
            <Group key={h.typeId} gap="sm" wrap="nowrap">
              <Text size="xs" w={170} truncate>
                {h.name}
              </Text>
              <Progress style={{ flex: 1 }} size="sm" value={Math.min(100, p)} color={p > 100 ? 'red' : p > 85 ? 'green' : 'yellow'} />
              <Text size="xs" className="mono" w={150} ta="right">
                {formatNum(h.needed)} / {formatNum(h.available)} ч
              </Text>
            </Group>
          )
        })}
      {st.typeHours.some((h) => h.needed > h.available) && (
        <Text size="sm" c="red">
          Одному из типов назначено больше рейсов, чем он успевает: часть его рейсов будет отменяться. Перераспределите
          самолёты на «Маршрутах» или закажите ещё.
        </Text>
      )}
      {st.staff && (st.staff.pilots < st.staff.pilotsNeeded || st.staff.cabin < st.staff.cabinNeeded) && (
        <Text size="sm" c="red">
          Экипажей на это расписание не хватит: пилотов {st.staff.pilots} из {st.staff.pilotsNeeded}, бортпроводников{' '}
          {st.staff.cabin} из {st.staff.cabinNeeded}. Наймите людей в разделе «Персонал», иначе рейсы будут отменяться.
        </Text>
      )}
      <Text size="xs" c="dimmed">
        Самолёт летает до 13 часов в сутки. Если расписание занимает флот меньше чем на 85%, самолёты простаивают и
        лизинг тратится зря.
      </Text>
    </Stack>
  )
}

export function Fleet() {
  const m = useManaged()
  return <ManagedPage title="Флот" m={m}>{(st) => <FleetBody m={m!} st={st} />}</ManagedPage>
}

function FleetBody({ m, st }: { m: Managed; st: ManageState }) {
  const manual = !st.autopilot.fleet
  const total = st.fleet.reduce((s, f) => s + f.count, 0)
  const leaseMonth = st.fleet.reduce((s, f) => s + f.leased * f.monthlyLease, 0)
  return (
    <>
      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <AutopilotSwitch m={m} part="fleet" />
          <Text size="sm" c="dimmed">
            На счёте компании: <b>{bigMoney(st.cash)}</b>
          </Text>
        </Group>
        <SimpleGrid cols={4} mb="md">
          <Stat label="Самолётов" value={String(total)} />
          <Stat label="В пути" value={String(st.deliveries.reduce((s, d) => s + d.count, 0))} />
          <Stat label="Своих" value={String(st.fleet.reduce((s, f) => s + f.owned, 0))} />
          <Stat label="Лизинг в месяц" value={bigMoney(leaseMonth)} />
        </SimpleGrid>
        <Capacity st={st} />
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Самолёты
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Тип</Table.Th>
              <Table.Th ta="right">Всего</Table.Th>
              <Table.Th ta="right">Своих</Table.Th>
              <Table.Th ta="right">В лизинге</Table.Th>
              <Table.Th ta="right">Лизинг/мес за борт</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {st.fleet.map((f) => (
              <Table.Tr key={f.typeId}>
                <Table.Td>{f.name}</Table.Td>
                <Table.Td ta="right">{f.count}</Table.Td>
                <Table.Td ta="right">{f.owned}</Table.Td>
                <Table.Td ta="right">{f.leased}</Table.Td>
                <Table.Td ta="right">{bigMoney(f.monthlyLease)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <Button
                      size="xs"
                      variant="light"
                      disabled={!manual || !f.leased}
                      title="Залог за 2 месяца вернут"
                      onClick={() => m.act((icao) => window.api.manage.returnLease(icao, f.typeId))}
                    >
                      Вернуть из лизинга
                    </Button>
                    <Button
                      size="xs"
                      variant="light"
                      color="orange"
                      disabled={!manual || !f.owned}
                      onClick={() => m.act((icao) => window.api.manage.sell(icao, f.typeId))}
                    >
                      Продать за {bigMoney(f.salePrice)}
                    </Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {st.deliveries.length > 0 && (
          <Stack gap={2} mt="sm">
            <Text size="sm" fw={500}>
              В пути
            </Text>
            {st.deliveries.map((d, i) => (
              <Text key={i} size="sm" c="dimmed">
                {d.count} × {d.name} ({d.owned ? 'покупка' : 'лизинг'}) — в строю с{' '}
                {new Date(d.arriveAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
              </Text>
            ))}
          </Stack>
        )}
      </Card>

      {manual && <OrderCard m={m} st={st} />}
    </>
  )
}

function OrderCard({ m, st }: { m: Managed; st: ManageState }) {
  const [typeId, setTypeId] = useState<string | null>(st.fleet[0]?.typeId ?? st.types[0]?.id ?? null)
  const [count, setCount] = useState(1)
  useEffect(() => {
    if (typeId && !st.types.some((t) => t.id === typeId)) setTypeId(st.types[0]?.id ?? null)
  }, [st.types])
  const t = st.types.find((x) => x.id === typeId)
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Заказать самолёты
      </Text>
      <Group align="flex-end">
        <Select
          label="Тип"
          w={320}
          data={st.types.map((x) => ({
            value: x.id,
            label: `${x.name} · ${x.seats ? `${x.seats} кр.` : `${formatNum(x.cargoKg / 1000)} т`} · ${formatNum(x.rangeKm)} км`
          }))}
          value={typeId}
          onChange={setTypeId}
          searchable
          allowDeselect={false}
        />
        <NumberInput label="Сколько" min={1} max={10} w={100} value={count} onChange={(v) => setCount(Number(v) || 1)} />
      </Group>
      {t && (
        <Group mt="sm">
          <Button onClick={() => m.act((icao) => window.api.manage.lease(icao, t.id, count))}>
            В лизинг: залог {bigMoney(t.monthlyLease * LEASE_DEPOSIT_MONTHS * count)}, далее {bigMoney(t.monthlyLease * count)}/мес
          </Button>
          <Button variant="light" onClick={() => m.act((icao) => window.api.manage.buy(icao, t.id, count))}>
            Купить за {bigMoney(t.price * count)}
          </Button>
        </Group>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Самолёт сразу входит в строй. Свой самолёт не платит лизинг и при продаже вернёт 85% цены. Лизинговый
        можно вернуть: из залога отдадут два месяца.
      </Text>
    </Card>
  )
}
