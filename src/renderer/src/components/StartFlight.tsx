import { useState } from 'react'
import { Button, Group, SegmentedControl, Stack, Text } from '@mantine/core'
import { PREP_MINUTES } from '@shared/career'
import type { Booking } from '@shared/types'
import { formatClock, formatDuration } from '../format'
import { errMsg } from '../lib'
import { useWorldNow } from '../hooks'

const prepLabel = (m: number) => (m < 60 ? `${m} мин` : `${m / 60} ч`)

interface Props {
  booking: Booking
  simConnected: boolean
  onStarted?(): void
  onError(message: string | null): void
}

/**
 * «Начать полёт» по брони. Игрок не ждёт реального часа вылета: он выбирает, сколько ему нужно
 * на подготовку, и мир перематывается так, чтобы вылет был ровно через это время.
 */
export function StartFlight({ booking: b, simConnected, onStarted, onError }: Props) {
  const [prep, setPrep] = useState('30')
  const now = useWorldNow()
  const prepMs = Number(prep) * 60_000
  const jump = b.depAt - prepMs - now

  const start = async (source: 'msfs' | 'demo') => {
    onError(null)
    try {
      await window.api.tracker.start(source, b.id, Number(prep))
      onStarted?.()
    } catch (e) {
      onError(errMsg(e))
    }
  }

  return (
    <Stack gap="xs">
      <Group align="flex-end">
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Время до вылета
          </Text>
          <SegmentedControl
            value={prep}
            onChange={setPrep}
            data={PREP_MINUTES.map((m) => ({ value: String(m), label: prepLabel(m) }))}
          />
        </Stack>
        <Button disabled={!simConnected} onClick={() => start('msfs')}>
          Начать полёт в MSFS
        </Button>
        <Button variant="light" color="grape" onClick={() => start('demo')}>
          Демо по брони
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {jump > 60_000
          ? `Мир перемотается на ${formatDuration(jump)}: вылет в ${formatClock(b.depAt)} UTC будет через ${prepLabel(Number(prep))}.`
          : jump < -60_000
            ? `Вылет перенесётся на ${formatClock(now + prepMs)} UTC — через ${prepLabel(Number(prep))}.`
            : `Вылет в ${formatClock(b.depAt)} UTC — через ${prepLabel(Number(prep))}.`}{' '}
        Опоздание больше {b.charter ? 'крайнего срока' : '15 минут'} от этого времени потребует указать причину задержки.
      </Text>
    </Stack>
  )
}
