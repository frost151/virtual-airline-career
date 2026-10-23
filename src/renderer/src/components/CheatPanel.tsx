import { useEffect, useState } from 'react'
import { Alert, Button, Card, Group, NumberInput, Select, Stack, Text, TextInput } from '@mantine/core'
import type { RatingInfo } from '@shared/types'
import { errMsg, notifyCareerChanged } from '../lib'

/** Панель режима читера: показывается в настройках, когда режим включён. */
export function CheatPanel() {
  const [money, setMoney] = useState<number>(10_000)
  const [hours, setHours] = useState<number>(10)
  const [ratings, setRatings] = useState<RatingInfo[]>([])
  const [rating, setRating] = useState<string | null>(null)
  const [icao, setIcao] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.career.allRatings().then(setRatings)
  }, [])

  const run = async (fn: () => Promise<void>, done: string) => {
    setMsg(null)
    try {
      await fn()
      notifyCareerChanged()
      setMsg({ ok: true, text: done })
    } catch (e) {
      setMsg({ ok: false, text: errMsg(e) })
    }
  }

  return (
    <Card withBorder style={{ borderColor: 'var(--mantine-color-red-8)' }}>
      <Stack>
        <Text fw={600} c="red">
          Панель читера
        </Text>
        {msg && <Alert color={msg.ok ? 'green' : 'red'}>{msg.text}</Alert>}

        <Group align="flex-end">
          <NumberInput label="Деньги, $" value={money} onChange={(v) => setMoney(Number(v) || 0)} step={10_000} thousandSeparator=" " w={180} />
          <Button onClick={() => run(() => window.api.cheat.addMoney(money), `Начислено $${money.toLocaleString('ru-RU')}`)}>Добавить</Button>
          {[100_000, 1_000_000, 10_000_000].map((v) => (
            <Button key={v} variant="light" onClick={() => run(() => window.api.cheat.addMoney(v), `Начислено $${v.toLocaleString('ru-RU')}`)}>
              +${v >= 1_000_000 ? `${v / 1_000_000} млн` : `${v / 1000} тыс`}
            </Button>
          ))}
        </Group>

        <Group align="flex-end">
          <NumberInput label="Налёт, часов" value={hours} onChange={(v) => setHours(Number(v) || 0)} min={1} w={180} />
          <Button onClick={() => run(() => window.api.cheat.addHours(hours), `Добавлено ${hours} ч налёта`)}>Добавить</Button>
          {[50, 200, 500].map((v) => (
            <Button key={v} variant="light" onClick={() => run(() => window.api.cheat.addHours(v), `Добавлено ${v} ч налёта`)}>
              +{v} ч
            </Button>
          ))}
        </Group>
        <Text size="xs" c="dimmed">
          После добавления налёта звания повышаются сразу. Для пилота-инструктора по-прежнему нужен сертификат TRI.
        </Text>

        <Group>
          <Button variant="light" onClick={() => run(() => window.api.cheat.rest(), 'Усталость снята')}>
            Снять усталость
          </Button>
          <Button variant="light" onClick={() => run(() => window.api.cheat.heal(), 'Здоровье и настроение — 100')}>
            Здоровье и настроение 100
          </Button>
          <Button variant="light" onClick={() => run(() => window.api.cheat.medical(), 'Медкомиссия продлена на год')}>
            Продлить медкомиссию
          </Button>
          <Button variant="light" onClick={() => run(() => window.api.cheat.reputation(), 'Репутация у работодателя — 100')}>
            Репутация 100
          </Button>
        </Group>

        <Group align="flex-end">
          <Select
            label="Выдать допуск"
            data={ratings.map((r) => ({ value: r.id, label: r.name }))}
            value={rating}
            onChange={setRating}
            searchable
            w={280}
          />
          <Button disabled={!rating} onClick={() => rating && run(() => window.api.cheat.rating(rating), 'Допуск выдан')}>
            Выдать
          </Button>
          <TextInput label="Перенестись в аэропорт (ICAO)" value={icao} onChange={(e) => setIcao(e.currentTarget.value)} w={200} />
          <Button disabled={!icao.trim()} onClick={() => run(() => window.api.cheat.teleport(icao), `Вы в ${icao.trim().toUpperCase()}`)}>
            Перенестись
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
