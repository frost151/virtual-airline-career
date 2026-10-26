import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Group, Loader, Modal, Stack, Table, Text } from '@mantine/core'
import type { ManageState, RouteAdvice } from '@shared/airlines'
import { formatNum } from '../format'
import { errMsg, placeLabel, usePlaces } from '../lib'
import { bigMoney } from './StakePanel'
import type { Managed } from './Managed'

const VERDICT = {
  keep: { label: 'Оставить', color: 'green' },
  more: { label: 'Добавить рейс', color: 'teal' },
  less: { label: 'Сократить', color: 'yellow' },
  replace: { label: 'Сменить самолёт', color: 'orange' },
  close: { label: 'Убрать', color: 'red' }
} as const

/** Советник по маршрутам: по кнопке разбирает рейсы и предлагает новые направления. */
export function RouteAdvisor({ m, st, onClose }: { m: Managed; st: ManageState; onClose(): void }) {
  const [advice, setAdvice] = useState<RouteAdvice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const manual = !st.autopilot.routes
  const places = usePlaces(advice ? [...advice.existing, ...advice.suggestions].flatMap((r) => [r.hub, r.dest]) : [])

  // Пересчитываем совет после каждого применённого действия (st меняется).
  useEffect(() => {
    window.api.manage
      .advice(st.icao)
      .then(setAdvice)
      .catch((e) => setError(errMsg(e)))
  }, [st])

  const route = (hub: string, dest: string) => `${placeLabel(places[hub], hub)} — ${placeLabel(places[dest], dest)}`

  return (
    <Modal opened onClose={onClose} title="Советник по маршрутам" size="85%" centered>
      {error && <Alert color="red">{error}</Alert>}
      {!advice ? (
        !error && <Loader />
      ) : (
        <Stack>
          {!manual && (
            <Alert color="blue">
              Маршрутами сейчас управляет заместитель — советы можно применить, если взять раздел «Маршруты» на себя.
            </Alert>
          )}
          <Text fw={600}>Ваши рейсы</Text>
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Маршрут</Table.Th>
                <Table.Th>Самолёт</Table.Th>
                <Table.Th ta="right">Загрузка</Table.Th>
                <Table.Th ta="right">Прибыль/мес</Table.Th>
                <Table.Th>Совет</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {advice.existing.map((r) => {
                const v = VERDICT[r.verdict]
                return (
                  <Table.Tr key={`${r.hub}-${r.dest}`}>
                    <Table.Td>{route(r.hub, r.dest)}</Table.Td>
                    <Table.Td>
                      {r.typeName} · {r.freq}/день
                    </Table.Td>
                    <Table.Td ta="right">{Math.round(r.lf * 100)}%</Table.Td>
                    <Table.Td ta="right" c={r.profit >= 0 ? 'green' : 'red'}>
                      {bigMoney(r.profit)}
                    </Table.Td>
                    <Table.Td>
                      <Stack gap={2}>
                        <Badge color={v.color} variant="light">
                          {v.label}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {r.reason}
                        </Text>
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {r.verdict !== 'keep' && (
                        <Button
                          size="xs"
                          variant="light"
                          color={v.color}
                          disabled={!manual}
                          onClick={() =>
                            m.act((icao) =>
                              r.verdict === 'replace'
                                ? window.api.manage.setRouteType(icao, r.hub, r.dest, r.typeId!)
                                : window.api.manage.setFrequency(
                                    icao,
                                    r.hub,
                                    r.dest,
                                    r.verdict === 'close' ? 0 : r.verdict === 'more' ? r.freq + 1 : r.freq - 1
                                  )
                            )
                          }
                        >
                          Применить
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>

          <Group justify="space-between">
            <Text fw={600}>Новые направления</Text>
            <Text size="xs" c="dimmed">
              Свободно в месяц: {advice.spare.map((s) => `${s.name} — ${formatNum(Math.max(0, s.hours))} ч`).join(', ')}
            </Text>
          </Group>
          {advice.suggestions.length ? (
            <Table striped>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Маршрут</Table.Th>
                  <Table.Th>Самолёт</Table.Th>
                  <Table.Th ta="right">Расстояние</Table.Th>
                  <Table.Th ta="right">Конкурентов</Table.Th>
                  <Table.Th ta="right">Загрузка</Table.Th>
                  <Table.Th ta="right">Тариф</Table.Th>
                  <Table.Th ta="right">Прибыль/мес</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {advice.suggestions.map((r) => (
                  <Table.Tr key={`${r.hub}-${r.dest}-${r.typeId}`}>
                    <Table.Td>{route(r.hub, r.dest)}</Table.Td>
                    <Table.Td>{r.typeName}</Table.Td>
                    <Table.Td ta="right">{formatNum(r.km)} км</Table.Td>
                    <Table.Td ta="right">{r.competitors}</Table.Td>
                    <Table.Td ta="right">{Math.round(r.lf * 100)}%</Table.Td>
                    <Table.Td ta="right">{bigMoney(r.fare)}</Table.Td>
                    <Table.Td ta="right" c="green">
                      {bigMoney(r.profit)}
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={!manual || !r.fits}
                        title={r.fits ? undefined : 'Не хватает свободных часов этого типа — сначала возьмите ещё самолёт'}
                        onClick={() => m.act((icao) => window.api.manage.openRoute(icao, r.hub, r.dest, 1, r.typeId))}
                      >
                        {r.fits ? 'Открыть' : 'Нет часов'}
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          ) : (
            <Text size="sm" c="dimmed">
              Прибыльных новых направлений для нынешнего флота не нашлось.
            </Text>
          )}
          <Text size="xs" c="dimmed">
            Прибыль — операционная (билеты и груз минус топливо, экипажи, ТО, сборы), без лизинга и офиса. Новые направления —
            прогноз при одном рейсе в день и нынешних ценах конкурентов.
          </Text>
        </Stack>
      )}
    </Modal>
  )
}
