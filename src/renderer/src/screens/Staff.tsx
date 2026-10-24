import { useEffect, useState } from 'react'
import { Alert, Button, Card, Group, NumberInput, Progress, SimpleGrid, Slider, Stack, Text } from '@mantine/core'
import { STAFF_LEVEL_MAX, STAFF_LEVEL_MIN, type ManageState, type StaffInfo } from '@shared/airlines'
import { formatNum } from '../format'
import { Stat } from '../components/FlightParts'
import { bigMoney } from '../components/StakePanel'
import { AutopilotSwitch, ManagedPage, useManaged, type Managed } from '../components/Managed'

type Role = 'pilots' | 'cabin'

export function Staff() {
  const m = useManaged()
  return <ManagedPage title="Персонал" m={m}>{(st) => <StaffBody m={m!} st={st} />}</ManagedPage>
}

function StaffBody({ m, st }: { m: Managed; st: ManageState }) {
  const staff = st.staff
  const cancelled = st.last?.cancelled ?? 0
  return (
    <>
      <Card withBorder>
        <AutopilotSwitch m={m} part="staff" />
        {!staff && (
          <Text size="sm" c="dimmed" mt="sm">
            Экипажи нанимает заместитель: людей всегда хватает, расходы считаются по налёту. Снимите заместителя, чтобы самому
            решать, сколько людей держать, сколько им платить и какой сервис давать на борту.
          </Text>
        )}
      </Card>

      {staff && (
        <>
          {cancelled > 0 && (
            <Alert color="red" title={`В прошлом месяце отменено ${Math.round(cancelled * 100)}% рейсов`}>
              Не хватило экипажей. Отмены сильно бьют по репутации — наймите людей.
            </Alert>
          )}
          <Card withBorder>
            <SimpleGrid cols={4}>
              <Stat label="Фонд оплаты труда в месяц" value={bigMoney(staff.payroll)} />
              <Stat label="Уходит людей в месяц" value={`${staff.attritionPct}%`} color={staff.attritionPct > 2 ? 'red' : undefined} />
              <Stat label="На счёте компании" value={bigMoney(st.cash)} />
              <Stat label="Отменено рейсов" value={st.last ? `${Math.round(cancelled * 100)}%` : '—'} />
            </SimpleGrid>
          </Card>

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <CrewCard m={m} staff={staff} role="pilots" />
            <CrewCard m={m} staff={staff} role="cabin" />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, md: 2 }}>
            <LevelCard
              title="Зарплаты"
              value={staff.payLevel}
              onSave={(v) => m.act((icao) => window.api.manage.setPayLevel(icao, v))}
              describe={(v) =>
                v < 1
                  ? `На ${Math.round((1 - v) * 100)}% ниже рынка: дешевле, но люди уходят чаще, а репутация страдает.`
                  : v > 1
                    ? `На ${Math.round((v - 1) * 100)}% выше рынка: дороже, зато почти никто не уходит.`
                    : 'На уровне рынка.'
              }
            />
            <LevelCard
              title="Сервис на борту"
              value={staff.service}
              onSave={(v) => m.act((icao) => window.api.manage.setService(icao, v))}
              describe={(v) =>
                v < 1
                  ? 'Скромнее рынка: экономия на питании и наборах, репутация понемногу падает.'
                  : v > 1
                    ? 'Лучше рынка: дороже на каждого пассажира, репутация растёт — пассажиры чаще выбирают вас.'
                    : 'Как у всех.'
              }
            />
          </SimpleGrid>
        </>
      )}
    </>
  )
}

const ROLE = {
  pilots: { title: 'Пилоты' },
  cabin: { title: 'Бортпроводники' }
} as const

function CrewCard({ m, staff, role }: { m: Managed; staff: StaffInfo; role: Role }) {
  const [count, setCount] = useState(2)
  const have = staff[role]
  const need = role === 'pilots' ? staff.pilotsNeeded : staff.cabinNeeded
  const salary = role === 'pilots' ? staff.pilotSalary : staff.cabinSalary
  const hireCost = role === 'pilots' ? staff.hireCostPilot : staff.hireCostCabin
  const training = staff.training.filter((t) => t[role] > 0)
  const pct = need ? (have / need) * 100 : 100
  return (
    <Card withBorder>
      <Text fw={600}>{ROLE[role].title}</Text>
      <Group align="baseline" gap="xs" mt="xs">
        <Text size="xl" fw={700} className="mono" c={have < need ? 'red' : undefined}>
          {formatNum(have)}
        </Text>
        <Text c="dimmed">из нужных {formatNum(need)}</Text>
      </Group>
      <Progress mt={4} value={Math.min(100, pct)} color={have < need ? 'red' : pct > 130 ? 'yellow' : 'green'} />
      <Text size="xs" c="dimmed" mt={4}>
        {have < need
          ? `Не хватает ${need - have}: часть рейсов будет отменена`
          : pct > 130
            ? 'Людей заметно больше, чем нужно: лишние оклады'
            : 'Хватает с запасом на отпуска и болезни'}
      </Text>
      {training.map((t, i) => (
        <Text key={i} size="sm" mt={4}>
          На обучении {t[role]} — выйдут в рейсы{' '}
          {new Date(t.readyAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
        </Text>
      ))}
      <Text size="sm" mt="sm">
        Зарплата с налогами: {bigMoney(salary)} в месяц на человека
      </Text>
      <Group align="flex-end" mt="sm">
        <NumberInput label="Сколько" min={1} max={500} w={100} value={count} onChange={(v) => setCount(Number(v) || 1)} />
        <Button onClick={() => m.act((icao) => window.api.manage.hire(icao, role, count))}>
          Нанять — {bigMoney(hireCost * count)}
        </Button>
        <Button variant="light" color="red" disabled={!have} onClick={() => m.act((icao) => window.api.manage.fire(icao, role, count))}>
          Сократить
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        Нанятые сразу выходят в рейсы, в цену входит переподготовка на тип. При сокращении — выходное пособие в две
        зарплаты.
      </Text>
    </Card>
  )
}

function LevelCard({
  title,
  value,
  onSave,
  describe
}: {
  title: string
  value: number
  onSave(v: number): void
  describe(v: number): string
}) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>{title}</Text>
        <Text size="sm">{describe(v)}</Text>
        <Slider
          min={STAFF_LEVEL_MIN}
          max={STAFF_LEVEL_MAX}
          step={0.05}
          value={v}
          onChange={setV}
          onChangeEnd={onSave}
          label={(x) => `${Math.round(x * 100)}%`}
          marks={[
            { value: 0.8, label: '80%' },
            { value: 1, label: 'рынок' },
            { value: 1.3, label: '130%' }
          ]}
          mb="lg"
        />
      </Stack>
    </Card>
  )
}
