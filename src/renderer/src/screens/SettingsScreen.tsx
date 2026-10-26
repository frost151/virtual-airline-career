import { useEffect, useState } from 'react'
import { Alert, Button, Card, Checkbox, Group, Loader, NumberInput, SegmentedControl, Stack, Switch, Text, TextInput, Title } from '@mantine/core'
import type { PayMultiplier, Settings } from '@shared/types'
import type { Family } from '@shared/lifestyle'
import { errMsg, notifyCareerChanged } from '../lib'
import { CheatPanel } from '../components/CheatPanel'
import { UpdateCard } from '../components/Update'
import { ChangelogCard } from '../components/Changelog'

export function SettingsScreen() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    window.api.settings.get().then((s) => {
      setSettings(s)
      setUsername(s.simbriefUsername)
    })
  }, [])

  const save = async (patch: Partial<Settings>) => {
    setSettings(await window.api.settings.set(patch))
  }

  const check = async () => {
    setMessage(null)
    try {
      await save({ simbriefUsername: username.trim() })
      const ofp = await window.api.dispatch.fetchOfp()
      setMessage({ ok: true, text: `Работает. Последний OFP: ${ofp.origin} → ${ofp.destination}` })
    } catch (e) {
      setMessage({ ok: false, text: errMsg(e) })
    }
  }

  if (!settings) return <Loader />
  return (
    <Stack maw={640}>
      <Title order={3}>Настройки</Title>
      <Card withBorder>
        <Stack>
          <Text fw={600}>SimBrief</Text>
          <Text size="sm" c="dimmed">
            Имя пользователя SimBrief (Navigraph) — чтобы загружать OFP в диспетчерской. Используется только для запроса к SimBrief.
          </Text>
          <Group align="flex-end">
            <TextInput label="Имя пользователя" value={username} onChange={(e) => setUsername(e.currentTarget.value)} w={260} />
            <Button variant="light" onClick={() => save({ simbriefUsername: username.trim() })}>
              Сохранить
            </Button>
            <Button variant="subtle" onClick={check} disabled={!username.trim()}>
              Проверить
            </Button>
          </Group>
          {message && <Alert color={message.ok ? 'green' : 'red'}>{message.text}</Alert>}
        </Stack>
      </Card>
      <FamilyCard />
      <UpdateCard />
      <ChangelogCard />
      <Card withBorder>
        <Stack gap="xs">
          <Text fw={600}>Игровой множитель заработка</Text>
          <Text size="sm" c="dimmed">
            Ускоряет карьеру: зарплата и оплата чартеров умножаются, а цены (допуски, переезды, расходы) остаются прежними. ×1 —
            реалистичные деньги.
          </Text>
          <SegmentedControl
            value={String(settings.payMultiplier)}
            onChange={(v) => save({ payMultiplier: Number(v) as PayMultiplier })}
            data={[
              { value: '1', label: '×1 реализм' },
              { value: '2', label: '×2' },
              { value: '5', label: '×5' },
              { value: '10', label: '×10' }
            ]}
            w={420}
          />
        </Stack>
      </Card>
      <Card withBorder>
        <Stack>
          <Text fw={600}>Тестирование</Text>
          <Switch
            checked={settings.demoCountsForCareer}
            onChange={(e) => save({ demoCountsForCareer: e.currentTarget.checked })}
            label="Засчитывать демо-полёты в карьеру"
            description="Для проверки карьеры без симулятора: демо-полёт по брони даст зарплату и налёт. В обычной игре лучше выключить."
          />
          <Switch
            checked={settings.cheatMode}
            color="red"
            onChange={async (e) => {
              await save({ cheatMode: e.currentTarget.checked })
              notifyCareerChanged()
            }}
            label="Режим читера"
            description="Деньги, налёт, снятие усталости и прочее одной кнопкой. Пока режим включён, в шапке видна метка «ЧИТ»."
          />
        </Stack>
      </Card>
      {settings.cheatMode && <CheatPanel />}
    </Stack>
  )
}

function FamilyCard() {
  const [family, setFamily] = useState<Family | null>(null)
  useEffect(() => {
    window.api.life.state().then((s) => setFamily(s.family))
  }, [])
  if (!family) return null
  const save = async (f: Family) => setFamily((await window.api.life.setFamily(f)).family)
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Text fw={600}>Семья</Text>
        <Text size="sm" c="dimmed">
          Расходы на жизнь и поездки растут, нужно больше комнат, но семья добавляет удовлетворённости.
        </Text>
        <Group align="flex-end">
          <Checkbox label="Супруг(а) / партнёр" checked={family.partner} onChange={(e) => save({ ...family, partner: e.currentTarget.checked })} />
          <NumberInput label="Дети" min={0} max={6} value={family.children} onChange={(v) => save({ ...family, children: Number(v) || 0 })} w={100} />
        </Group>
      </Stack>
    </Card>
  )
}