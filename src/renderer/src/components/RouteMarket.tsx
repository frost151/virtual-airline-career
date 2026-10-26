import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Modal, SimpleGrid, Slider, Stack, Table, Text } from '@mantine/core'
import { FARE_MULT_MAX, FARE_MULT_MIN, type FarePreview, type ManagedRoute, type ManageState } from '@shared/airlines'
import { ARCHETYPE_LABEL, formatNum } from '../format'
import { errMsg } from '../lib'
import { Stat } from './FlightParts'
import { AirlineLogo } from './AirlineLogo'
import { bigMoney } from './StakePanel'
import type { Managed } from './Managed'

const markup = (m: number) => (Math.abs(m - 1) < 0.005 ? 'рынок' : `${m > 1 ? '+' : '−'}${Math.abs(Math.round((m - 1) * 100))}%`)

/** Карточка рейса: конкуренты на паре аэропортов, их цены и прогноз загрузки при своей наценке. */
export function RouteMarket({
  m,
  st,
  route,
  title,
  onClose
}: {
  m: Managed
  st: ManageState
  route: ManagedRoute
  title: string
  onClose(): void
}) {
  const [preview, setPreview] = useState<FarePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mult, setMult] = useState(1)
  const manual = !st.autopilot.fares

  useEffect(() => {
    setPreview(null)
    window.api.manage
      .farePreview(st.icao, route.hub, route.dest)
      .then((p) => {
        setPreview(p)
        setMult(p.current)
      })
      .catch((e) => setError(errMsg(e)))
  }, [st.icao, route.hub, route.dest, st.fareMult, route.fareMult])

  const point = useMemo(() => {
    if (!preview) return null
    return preview.curve.reduce((best, p) => (Math.abs(p.mult - mult) < Math.abs(best.mult - mult) ? p : best), preview.curve[0])
  }, [preview, mult])
  const best = useMemo(() => preview?.curve.reduce((a, b) => (b.profit > a.profit ? b : a), preview.curve[0]), [preview])

  const save = async (value: number | null) => {
    if (await m.act((icao) => window.api.manage.setRouteFare(icao, route.hub, route.dest, value))) onClose()
  }

  return (
    <Modal opened onClose={onClose} title={title} size="xl" centered>
      {error && <Alert color="red">{error}</Alert>}
      {!preview || !point ? (
        !error && <Loader />
      ) : (
        <Stack>
          <Text size="sm" c="dimmed">
            Спрос на паре — около {formatNum(preview.demand)} пассажиров в сутки в одну сторону. Пассажиры в основном выбирают
            рейсы дешевле; репутация и частота тоже помогают.
          </Text>

          <Text fw={600}>Конкуренты ({preview.competitors.length})</Text>
          {preview.competitors.length ? (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Компания</Table.Th>
                  <Table.Th>Самолёт</Table.Th>
                  <Table.Th ta="center">Рейсов/день</Table.Th>
                  <Table.Th ta="right">Загрузка</Table.Th>
                  <Table.Th ta="right">Средний тариф</Table.Th>
                  <Table.Th ta="right">Репутация</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {preview.competitors.map((c) => (
                  <Table.Tr key={c.icao}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <AirlineLogo iata={c.iata} name={c.name} h={20} />
                        <Text size="sm">{c.name}</Text>
                        <Badge size="xs" variant="light">
                          {ARCHETYPE_LABEL[c.archetype]}
                        </Badge>
                      </Group>
                    </Table.Td>
                    <Table.Td>{c.typeName}</Table.Td>
                    <Table.Td ta="center">{c.freq}</Table.Td>
                    <Table.Td ta="right">{Math.round(c.lf * 100)}%</Table.Td>
                    <Table.Td ta="right" c={point.fare > c.fare ? 'red' : 'green'}>
                      {c.fare ? bigMoney(c.fare) : '—'}
                    </Table.Td>
                    <Table.Td ta="right">{c.reputation}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm">На этой паре вы летаете одни — цену диктуете вы, но спрос от неё всё равно зависит.</Text>
          )}

          <Group justify="space-between">
            <Text fw={600}>Наценка на этот рейс</Text>
            <Text size="sm" c="dimmed">
              {preview.own ? 'своя у рейса' : 'сейчас — общая по компании'}
            </Text>
          </Group>
          <Slider
            mx="md"
            min={FARE_MULT_MIN}
            max={FARE_MULT_MAX}
            step={0.01}
            value={mult}
            onChange={setMult}
            label={markup}
            marks={[
              { value: FARE_MULT_MIN, label: markup(FARE_MULT_MIN) },
              { value: 1, label: 'рынок' },
              { value: FARE_MULT_MAX, label: markup(FARE_MULT_MAX) }
            ]}
            mb="lg"
          />
          <SimpleGrid cols={{ base: 2, sm: 5 }}>
            <Stat label="Ожидаемая загрузка" value={`${Math.round(point.lf * 100)}%`} color={point.lf < 0.6 ? 'orange' : undefined} />
            <Stat label="Средний тариф" value={bigMoney(point.fare)} />
            <Stat label="Пассажиров в сутки" value={formatNum(point.paxPerDay)} />
            <Stat label="Выручка в месяц" value={bigMoney(point.revenue)} />
            <Stat label="Прибыль рейса в месяц" value={bigMoney(point.profit)} color={point.profit >= 0 ? 'green' : 'red'} />
          </SimpleGrid>
          <Text size="xs" c="dimmed">
            Прогноз на текущий месяц при нынешних ценах конкурентов, без накладных расходов компании и лизинга. Самая прибыльная
            наценка сейчас — {best ? markup(best.mult) : '—'}.
          </Text>
          {manual ? (
            <Group justify="flex-end">
              {preview.own && (
                <Button variant="subtle" onClick={() => save(null)}>
                  Как у компании
                </Button>
              )}
              <Button onClick={() => save(mult)}>Применить {markup(mult)}</Button>
            </Group>
          ) : (
            <Text size="sm" c="orange">
              Тарифами управляет заместитель: прогноз можно посмотреть, а чтобы применить наценку — возьмите раздел «Тарифы» на
              себя.
            </Text>
          )}
        </Stack>
      )}
    </Modal>
  )
}
