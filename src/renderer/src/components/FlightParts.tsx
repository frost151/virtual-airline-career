import { Badge, Card, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core'
import type { EventSeverity, LandingReport, TrackerEvent } from '@shared/sim'
import { PHASE_LABEL } from '@shared/sim'
import { formatClock } from '../format'

const SEVERITY: Record<EventSeverity, { color: string; label: string }> = {
  info: { color: 'gray', label: 'Инфо' },
  warning: { color: 'yellow', label: 'Замечание' },
  violation: { color: 'orange', label: 'Нарушение' },
  critical: { color: 'red', label: 'Грубое' }
}

export function EventList({ events }: { events: TrackerEvent[] }) {
  if (!events.length) return <Text c="dimmed">Замечаний нет</Text>
  return (
    <Table>
      <Table.Tbody>
        {[...events].reverse().map((e, i) => (
          <Table.Tr key={`${e.t}-${e.code}-${i}`}>
            <Table.Td className="mono" w={60}>
              {formatClock(e.t)}
            </Table.Td>
            <Table.Td w={110}>
              <Badge color={SEVERITY[e.severity].color} variant="light">
                {SEVERITY[e.severity].label}
              </Badge>
            </Table.Td>
            <Table.Td>{e.message}</Table.Td>
            <Table.Td c="dimmed">{PHASE_LABEL[e.phase]}</Table.Td>
            <Table.Td ta="right" w={60} c={e.penalty ? 'red' : 'dimmed'}>
              {e.penalty ? `−${e.penalty}` : ''}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  )
}

export function landingColor(vs: number): string {
  if (vs >= -300) return 'green'
  if (vs >= -450) return 'yellow'
  if (vs >= -600) return 'orange'
  return 'red'
}

export function LandingCard({ landing }: { landing: LandingReport }) {
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>Посадка</Text>
          <Badge color={landingColor(landing.vsFpm)} size="lg">
            {landing.grade}
          </Badge>
        </Group>
        <SimpleGrid cols={5}>
          <Stat label="Верт. скорость" value={`${landing.vsFpm} fpm`} />
          <Stat label="Перегрузка" value={`${landing.gForce.toFixed(2)} g`} />
          <Stat label="Скорость" value={`${landing.iasKt} kt`} />
          <Stat label="Тангаж / крен" value={`${landing.pitchDeg}° / ${landing.bankDeg}°`} />
          <Stat label="Штраф" value={landing.penalty ? `−${landing.penalty}` : '0'} />
        </SimpleGrid>
      </Stack>
    </Card>
  )
}

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600} className="mono" c={color}>
        {value}
      </Text>
    </Stack>
  )
}

/** Профиль высоты по треку — простая SVG-линия без библиотек. */
export function AltitudeProfile({ track }: { track: [number, number, number, number][] }) {
  if (track.length < 2) return null
  const w = 600
  const h = 120
  const t0 = track[0][0]
  const t1 = track[track.length - 1][0]
  const maxAlt = Math.max(1000, ...track.map((p) => p[3]))
  const points = track.map((p) => `${((p[0] - t0) / (t1 - t0 || 1)) * w},${h - (p[3] / maxAlt) * (h - 8)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke="var(--mantine-color-blue-5)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
