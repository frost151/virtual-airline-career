import { useCallback, useEffect, useState } from 'react'
import { Alert, Group, Loader, Select, Stack, Switch, Text, Title } from '@mantine/core'
import type { Autopilot, ManageState, Stake } from '@shared/airlines'
import { errMsg, notifyCareerChanged } from '../lib'

export interface Managed {
  /** Компании, где у игрока контрольный пакет. */
  controlled: Stake[]
  icao: string | null
  setIcao(icao: string): void
  state: ManageState | null
  error: string | null
  /** Выполнить действие управления: ошибку показываем, сводку обновляем. */
  act(fn: (icao: string) => Promise<ManageState>): Promise<boolean>
}

/** Компании под контролем игрока и сводка по выбранной. Своя компания — первой. */
export function useManaged(): Managed | null {
  const [controlled, setControlled] = useState<Stake[] | null>(null)
  const [icao, setIcao] = useState<string | null>(null)
  const [state, setState] = useState<ManageState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.market.stakes().then((list) => {
      const c = list.filter((s) => s.control).sort((a, b) => Number(b.founded) - Number(a.founded))
      setControlled(c)
      setIcao((cur) => (cur && c.some((s) => s.icao === cur) ? cur : (c[0]?.icao ?? null)))
    })
  }, [])

  const load = useCallback(() => {
    if (icao) window.api.manage.state(icao).then(setState)
  }, [icao])
  useEffect(load, [load])
  useEffect(() => window.api.world.onChanged(load), [load])

  const act = async (fn: (icao: string) => Promise<ManageState>) => {
    if (!icao) return false
    setError(null)
    try {
      setState(await fn(icao))
      notifyCareerChanged()
      return true
    } catch (e) {
      setError(errMsg(e))
      return false
    }
  }

  if (!controlled) return null
  return { controlled, icao, setIcao, state, error, act }
}

const PART_LABEL: Record<keyof Autopilot, string> = {
  fleet: 'Флотом управляет заместитель (ИИ)',
  routes: 'Маршрутами управляет заместитель (ИИ)',
  fares: 'Тарифами управляет заместитель (ИИ)'
}

/** Переключатель «заместителя» для раздела. */
export function AutopilotSwitch({ m, part }: { m: Managed; part: keyof Autopilot }) {
  if (!m.state) return null
  return (
    <Switch
      label={PART_LABEL[part]}
      checked={m.state.autopilot[part]}
      onChange={(e) => {
        const on = e.currentTarget.checked
        void m.act((icao) => window.api.manage.setAutopilot(icao, { [part]: on }))
      }}
    />
  )
}

/** Шапка экрана управления: заголовок, выбор компании, ошибка. Без контроля — подсказка. */
export function ManagedPage({ title, m, children }: { title: string; m: Managed | null; children(state: ManageState): React.ReactNode }) {
  if (!m) return <Loader />
  if (!m.controlled.length) {
    return (
      <Stack>
        <Title order={3}>{title}</Title>
        <Text c="dimmed">Раздел доступен, когда у вас есть своя компания или контрольный пакет (51%) в чужой.</Text>
      </Stack>
    )
  }
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>
          {title}
          {m.state ? ` · ${m.state.name}` : ''}
        </Title>
        {m.controlled.length > 1 && (
          <Select
            w={260}
            data={m.controlled.map((s) => ({ value: s.icao, label: `${s.name} (${s.pct}%)` }))}
            value={m.icao}
            onChange={(v) => v && m.setIcao(v)}
            allowDeselect={false}
          />
        )}
      </Group>
      {m.error && (
        <Alert color="red" withCloseButton={false}>
          {m.error}
        </Alert>
      )}
      {m.state ? children(m.state) : <Loader />}
    </Stack>
  )
}
