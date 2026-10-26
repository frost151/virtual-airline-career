import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Group, Progress, Stack, Text } from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type { UpdateStatus } from '@shared/types'
import { errMsg } from '../lib'
import { formatUtc } from '../format'

export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    window.api.update.status().then(setStatus)
    return window.api.update.onStatus(setStatus)
  }, [])
  return status
}

/** Есть ли что показать игроку: обновление скачивается, готово или (у портативной версии) доступно. */
const hasNews = (s: UpdateStatus | null): s is UpdateStatus =>
  !!s && (s.state === 'available' || s.state === 'downloading' || s.state === 'ready')

/** Метка в шапке; клик ведёт в настройки. */
export function UpdateBadge() {
  const status = useUpdateStatus()
  const navigate = useNavigate()
  if (!hasNews(status)) return null
  const label =
    status.state === 'downloading' ? `Скачивается ${status.version} · ${status.percent ?? 0}%` : `Обновление ${status.version}`
  return (
    <Badge
      color="cyan"
      variant={status.state === 'downloading' ? 'light' : 'filled'}
      style={{ cursor: 'pointer' }}
      onClick={() => navigate('/settings')}
    >
      {label}
    </Badge>
  )
}

/** Уведомление на экране выбора профиля. */
export function UpdateNotice() {
  const status = useUpdateStatus()
  if (!hasNews(status) || status.state === 'downloading') return null
  return (
    <Alert color="cyan" title={`Доступна версия ${status.version}`}>
      <UpdateActions status={status} showCheck={false} />
    </Alert>
  )
}

/** Карточка «Обновления» в настройках. */
export function UpdateCard() {
  const status = useUpdateStatus()
  if (!status) return null
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={600}>Обновления</Text>
          <Text size="sm" c="dimmed">
            Установлена версия {status.current}
            {status.portable ? ' (портативная)' : ''}
          </Text>
        </Group>
        <StatusLine status={status} />
        {status.state === 'downloading' && <Progress value={status.percent ?? 0} animated />}
        {hasNews(status) && status.notes && (
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
            {status.notes}
          </Text>
        )}
        <UpdateActions status={status} />
      </Stack>
    </Card>
  )
}

function StatusLine({ status }: { status: UpdateStatus }) {
  const checked = status.checkedAt ? ` Проверено: ${formatUtc(status.checkedAt)}.` : ''
  switch (status.state) {
    case 'disabled':
      return (
        <Text size="sm" c="dimmed">
          {status.error}
        </Text>
      )
    case 'idle':
    case 'checking':
      return (
        <Text size="sm" c="dimmed">
          Проверяем обновления…
        </Text>
      )
    case 'none':
      return (
        <Text size="sm" c="dimmed">
          У вас последняя версия.{checked}
        </Text>
      )
    case 'downloading':
      return <Text size="sm">Скачивается версия {status.version}…</Text>
    case 'ready':
      return <Text size="sm">Версия {status.version} скачана и встанет после перезапуска. Сохранения не затрагиваются.</Text>
    case 'available':
      return (
        <Text size="sm">
          Вышла версия {status.version}. Портативная версия не обновляется сама: скачайте новый exe и запускайте его вместо
          старого.
        </Text>
      )
    case 'error':
      return <Alert color="red">Не удалось проверить обновления: {status.error}</Alert>
  }
}

function UpdateActions({ status, showCheck = true }: { status: UpdateStatus; showCheck?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const install = async () => {
    setError(null)
    try {
      await window.api.update.install()
    } catch (e) {
      setError(errMsg(e))
    }
  }
  const canCheck = status.state === 'none' || status.state === 'error' || status.state === 'available'
  return (
    <Stack gap="xs">
      <Group>
        {status.state === 'ready' && <Button onClick={install}>Перезапустить и обновить</Button>}
        {status.state === 'available' && status.url && (
          <Button onClick={() => window.api.openExternal(status.url!)}>Скачать {status.version}</Button>
        )}
        {showCheck && status.state !== 'disabled' && (
          <Button
            variant="subtle"
            loading={status.state === 'checking'}
            disabled={!canCheck}
            onClick={() => window.api.update.check()}
          >
            Проверить сейчас
          </Button>
        )}
      </Group>
      {error && <Alert color="red">{error}</Alert>}
    </Stack>
  )
}
