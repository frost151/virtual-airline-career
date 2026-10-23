import { useState } from 'react'
import { Alert, Button, Group, Select, Stack, Text } from '@mantine/core'
import type { CareerOutcome } from '@shared/types'
import { DELAY_CODES } from '@shared/delayCodes'
import { errMsg, notifyCareerChanged } from '../lib'

const RESP_HINT = {
  airline: 'вина авиакомпании',
  external: 'внешняя причина',
  sim: 'без штрафа'
} as const

const groups = [...new Set(DELAY_CODES.map((d) => d.group))].map((g) => ({
  group: g,
  items: DELAY_CODES.filter((d) => d.group === g).map((d) => ({
    value: d.code,
    label: `${d.code} — ${d.title} (${RESP_HINT[d.responsibility]})`
  }))
}))

/** Выбор причины задержки по кодам IATA (+ «сбой симулятора»). */
export function DelayReasonForm({
  bookingId,
  delayMin,
  onDone
}: {
  bookingId: number
  delayMin: number | null
  onDone(outcome: CareerOutcome): void
}) {
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!code) return
    setError(null)
    try {
      const outcome = await window.api.dispatch.delayReason(bookingId, code)
      notifyCareerChanged()
      onDone(outcome)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Alert color="orange" title={`Задержка вылета${delayMin !== null ? `: ${delayMin} мин` : ''}`}>
      <Stack gap="xs">
        <Text size="sm">
          Как в реальной авиации, задержку нужно объяснить. Вина экипажа (коды 61, 63, 64) снижает репутацию, внешние причины и
          сбой симулятора — нет.
        </Text>
        {error && <Text c="red">{error}</Text>}
        <Group align="flex-end">
          <Select data={groups} value={code} onChange={setCode} placeholder="Причина задержки" searchable w={520} />
          <Button onClick={submit} disabled={!code}>
            Подтвердить
          </Button>
        </Group>
      </Stack>
    </Alert>
  )
}

/** Итог рейса для карьеры: оплата, репутация, повышение. */
export function OutcomeAlert({ outcome }: { outcome: CareerOutcome }) {
  const color = outcome.fired ? 'red' : outcome.status === 'completed' ? 'green' : outcome.status === 'cancelled' ? 'red' : 'gray'
  return (
    <Alert color={color} title={outcome.status === 'completed' ? 'Рейс засчитан' : 'Карьера'}>
      <Stack gap={4}>
        {outcome.pay !== undefined && (
          <Text>
            Оплата: <b>${outcome.pay}</b>
            {outcome.repDelta ? ` · репутация ${outcome.repDelta > 0 ? '+' : ''}${outcome.repDelta}` : ''}
          </Text>
        )}
        <Text size="sm">{outcome.message}</Text>
        {outcome.promotedTo && (
          <Text fw={700} c="green">
            Повышение! Новое звание: {outcome.promotedTo}
          </Text>
        )}
        {outcome.fired && (
          <Text fw={700} c="red">
            Репутация упала слишком низко — вы уволены. Найдите новую работу на главной.
          </Text>
        )}
      </Stack>
    </Alert>
  )
}
