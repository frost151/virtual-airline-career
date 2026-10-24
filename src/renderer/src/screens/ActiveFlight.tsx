import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Collapse, Group, Popover, SimpleGrid, Stack, Stepper, Table, Text, Title } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type { FlightPhase, LightsState, TrackerState } from '@shared/sim'
import { PHASE_LABEL } from '@shared/sim'
import { useSimStatus, useTrackerState } from '../hooks'
import type { Booking, CareerOutcome, FlightFinished } from '@shared/types'
import { formatClock, formatDuration, formatNum } from '../format'
import { EventList, LandingCard, Stat } from '../components/FlightParts'
import { DelayReasonForm, OutcomeAlert } from '../components/DelayReason'
import { errMsg, placeLabel, useCareerVersion, usePlaces } from '../lib'

const PHASES = Object.keys(PHASE_LABEL) as FlightPhase[]

export function ActiveFlight() {
  const state = useTrackerState()
  const simStatus = useSimStatus()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState<FlightFinished | null>(null)
  const [outcome, setOutcome] = useState<CareerOutcome | null>(null)
  const [booking, setBooking] = useState<Booking | null>(null)
  const version = useCareerVersion()
  const places = usePlaces([booking?.dep, booking?.arr])

  useEffect(
    () =>
      window.api.tracker.onFinished((r) => {
        setFinished(r)
        setOutcome(r.outcome)
      }),
    []
  )
  useEffect(() => {
    window.api.dispatch
      .open()
      .then(setBooking)
      .catch(() => setBooking(null))
  }, [version, state?.active])

  const start = async (source: 'msfs' | 'demo', bookingId: number | null = null) => {
    setError(null)
    setFinished(null)
    setOutcome(null)
    try {
      await window.api.tracker.start(source, bookingId)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (!state) return null
  const savedId = finished?.flightId

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Активный полёт</Title>
        {state.active && (
          <Badge size="lg" variant="light" color={state.source === 'demo' ? 'grape' : 'blue'}>
            {state.source === 'demo' ? 'Демо-полёт' : 'MSFS 2024'}
          </Badge>
        )}
      </Group>

      {error && <Alert color="red">{error}</Alert>}
      {outcome && !state.active && <OutcomeAlert outcome={outcome} />}
      {outcome?.status === 'awaiting_delay' && !state.active && (
        <DelayReasonForm bookingId={outcome.bookingId} delayMin={outcome.delayMin ?? null} onDone={setOutcome} />
      )}
      {finished && !state.active && (
        <Alert color={savedId ? 'green' : 'gray'}>
          {savedId ? (
            <Group justify="space-between">
              <Text>Полёт сохранён в бортжурнал.</Text>
              <Button size="xs" variant="light" onClick={() => navigate('/logbook')}>
                Открыть бортжурнал
              </Button>
            </Group>
          ) : (
            'Полёт не сохранён: самолёт не покидал стоянку.'
          )}
        </Alert>
      )}

      {state.active ? (
        <InFlight state={state} />
      ) : (
        <Card withBorder padding="lg">
          <Stack>
            {booking?.status === 'booked' && (
              <Alert color="blue" title={`Бронь: ${booking.flightNo}`}>
                <Group justify="space-between">
                  <Text>
                    {placeLabel(places[booking.dep], booking.dep)} → {placeLabel(places[booking.arr], booking.arr)} · вылет{' '}
                    {formatClock(booking.depAt)} UTC · {booking.typeId}
                  </Text>
                  <Group gap="xs">
                    <Button size="xs" disabled={simStatus !== 'connected'} onClick={() => start('msfs', booking.id)}>
                      Начать по брони в MSFS
                    </Button>
                    <Button size="xs" variant="light" color="grape" onClick={() => start('demo', booking.id)}>
                      Демо по брони
                    </Button>
                  </Group>
                </Group>
              </Alert>
            )}
            <Text>
              Начните полёт, когда самолёт стоит на стоянке. Трекер сам определит аэропорт вылета, фазы полёта, посадку
              и завершит полёт, когда вы выключите двигатели на стоянке.
            </Text>
            <Group>
              <Button variant={booking ? 'default' : 'filled'} disabled={simStatus !== 'connected'} onClick={() => start('msfs')}>
                {booking ? 'Свободный полёт в MSFS 2024' : 'Начать полёт в MSFS 2024'}
              </Button>
              <Button variant="light" color="grape" onClick={() => start('demo')}>
                Демо-полёт Пулково → Шереметьево
              </Button>
              <Button variant="subtle" onClick={() => navigate('/sim-check')}>
                Проверка симулятора
              </Button>
            </Group>
            {simStatus !== 'connected' && (
              <Text size="sm" c="dimmed">
                MSFS 2024 не запущен — приложение подключится автоматически, когда симулятор загрузится. Демо-полёт
                проигрывается в 30 раз быстрее реального времени.
              </Text>
            )}
            {state.aircraft && (
              <Text size="sm">
                В симуляторе: <b>{state.aircraft.title}</b>
                {state.aircraft.typeName ? ` — ${state.aircraft.typeName}` : ' — тип не опознан'}
              </Text>
            )}
          </Stack>
        </Card>
      )}

      {state.sample?.raw && <Diagnostics state={state} />}
    </Stack>
  )
}

function InFlight({ state }: { state: TrackerState }) {
  const s = state.sample
  const now = s?.t ?? 0
  const [confirm, setConfirm] = useState(false)

  return (
    <Stack>
      <Card withBorder>
        <Stepper active={PHASES.indexOf(state.phase)} size="xs" iconSize={22}>
          {PHASES.map((p) => (
            <Stepper.Step key={p} label={PHASE_LABEL[p]} />
          ))}
        </Stepper>
      </Card>

      <Card withBorder>
        <Stack>
          <Group justify="space-between">
            <Text fw={600}>
              {state.departure ?? '????'} → … · {state.aircraft?.typeName ?? state.aircraft?.title ?? 'Самолёт не опознан'}
            </Text>
            <Group gap="xs">
              <Text c="dimmed">Оценка</Text>
              <Badge size="xl" color={state.score >= 90 ? 'green' : state.score >= 70 ? 'yellow' : 'red'}>
                {state.score}
              </Badge>
            </Group>
          </Group>
          {s && (
            <SimpleGrid cols={{ base: 3, md: 6 }}>
              <Stat label="Высота" value={`${formatNum(s.altFt)} ft`} />
              <Stat label="Приборная" value={`${Math.round(s.iasKt)} kt`} />
              <Stat label="Путевая" value={`${Math.round(s.gsKt)} kt`} />
              <Stat label="Вертикальная" value={`${Math.round(s.vsFpm)} fpm`} />
              <Stat label="Курс" value={`${Math.round(s.headingDeg)}°`} />
              <Stat label="Перегрузка" value={`${s.gForce.toFixed(2)} g`} />
              <Stat label="Топливо" value={`${formatNum(s.fuelKg)} кг`} />
              <Stat label="Израсходовано" value={`${formatNum(state.fuelUsedKg)} кг`} />
              <Stat label="Вес" value={`${formatNum(s.weightKg / 1000)} т`} />
              <Stat label="Пройдено" value={`${formatNum(state.distanceKm)} км`} />
              <Stat label="В пути" value={formatDuration(state.blockOffAt ? now - state.blockOffAt : null)} />
              <Stat label="Двигатели" value={`${s.enginesRunning} работает`} />
            </SimpleGrid>
          )}
          {s && <Lights lights={s.lights} />}
        </Stack>
      </Card>

      {state.landing && <LandingCard landing={state.landing} />}

      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Журнал полёта</Text>
          <EventList events={state.events} />
        </Stack>
      </Card>

      <Group justify="flex-end">
        <Popover opened={confirm} onChange={setConfirm} position="top-end" withArrow>
          <Popover.Target>
            <Button color="red" variant="light" onClick={() => setConfirm((v) => !v)}>
              Завершить полёт
            </Button>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="xs" maw={280}>
              <Text size="sm">
                Полёт завершится досрочно и попадёт в бортжурнал как прерванный (если самолёт уже покинул стоянку).
              </Text>
              <Group justify="flex-end">
                <Button size="xs" variant="subtle" onClick={() => setConfirm(false)}>
                  Отмена
                </Button>
                <Button size="xs" color="red" onClick={() => window.api.tracker.finish()}>
                  Завершить
                </Button>
              </Group>
            </Stack>
          </Popover.Dropdown>
        </Popover>
      </Group>
    </Stack>
  )
}

const LIGHT_LABEL: Record<keyof LightsState, string> = {
  beacon: 'Маяк',
  strobe: 'Стробы',
  landing: 'Посадочные',
  nav: 'Навигационные',
  taxi: 'Рулёжные'
}

function Lights({ lights }: { lights: LightsState }) {
  return (
    <Group gap="xs">
      <Text size="sm" c="dimmed">
        Свет:
      </Text>
      {(Object.keys(LIGHT_LABEL) as (keyof LightsState)[]).map((k) => (
        <Badge key={k} variant={lights[k] ? 'filled' : 'outline'} color={lights[k] === null ? 'gray' : lights[k] ? 'yellow' : 'gray'}>
          {LIGHT_LABEL[k]}
          {lights[k] === null ? ' ?' : ''}
        </Badge>
      ))}
    </Group>
  )
}

/** Сырые значения переменных — по ним проверяем профили аддонов на реальном симуляторе. */
function Diagnostics({ state }: { state: TrackerState }) {
  const [open, setOpen] = useState(false)
  const raw = state.sample?.raw ?? {}
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Text fw={600}>Диагностика переменных</Text>
        <Button size="xs" variant="subtle" onClick={() => setOpen((v) => !v)}>
          {open ? 'Скрыть' : 'Показать'}
        </Button>
      </Group>
      <Collapse in={open}>
        <Stack gap="xs" mt="sm">
          <Text size="sm" c="dimmed">
            Профиль: {state.aircraft?.profileName ?? 'не опознан (стандартные переменные)'}
            {state.aircraft?.profileId && !state.aircraft.profileVerified && ' — не проверен, проверка света отключена'}
          </Text>
          <Table>
            <Table.Tbody>
              {Object.entries(raw).map(([k, v]) => (
                <Table.Tr key={k}>
                  <Table.Td className="mono">{k}</Table.Td>
                  <Table.Td className="mono" ta="right">
                    {v}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      </Collapse>
    </Card>
  )
}
