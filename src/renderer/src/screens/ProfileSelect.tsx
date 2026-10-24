import { useEffect, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  NumberInput,
  Group,
  Popover,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import type { CreateProfileInput, GameMode, OwnerStart, ProfileSummary } from '@shared/types'
import { OWNER_CAPITAL_OPTIONS } from '@shared/airlines'
import { MODE_LABEL, formatUtc } from '../format'

interface Props {
  onOpened(profile: ProfileSummary): void
}

export function ProfileSelect({ onOpened }: Props) {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.profiles.list().then((list) => {
      setProfiles(list)
      setCreating(list.length === 0)
    })
  }, [])

  const run = async (action: () => Promise<ProfileSummary>) => {
    setError(null)
    try {
      onOpened(await action())
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  const remove = async (id: string) => {
    setError(null)
    try {
      await window.api.profiles.delete(id)
      const list = await window.api.profiles.list()
      setProfiles(list)
      setCreating(list.length === 0)
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  return (
    <Center h="100%" p="xl">
      <Stack w={520} gap="lg">
        <Stack gap={4}>
          <Title order={2}>Virtual Airline Career</Title>
          <Text c="dimmed">Соло-карьера в виртуальной авиации · MSFS 2024</Text>
        </Stack>

        {error && <Alert color="red">{error}</Alert>}

        {creating ? (
          <CreateForm
            canCancel={profiles.length > 0}
            onCancel={() => setCreating(false)}
            onSubmit={(input) => run(() => window.api.profiles.create(input))}
          />
        ) : (
          <Stack gap="sm">
            {profiles.map((p) => (
              <Card key={p.id} withBorder padding="md">
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Text fw={600}>{p.name}</Text>
                      <Badge variant="light">{MODE_LABEL[p.mode]}</Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {p.pilotName} · мир с {formatUtc(p.worldStartUtc)}
                    </Text>
                  </Stack>
                  <Group gap="xs" wrap="nowrap">
                    <Button onClick={() => run(() => window.api.profiles.open(p.id))}>Продолжить</Button>
                    <DeleteButton profile={p} onDeleted={remove} />
                  </Group>
                </Group>
              </Card>
            ))}
            <Button variant="default" onClick={() => setCreating(true)}>
              Новая карьера
            </Button>
          </Stack>
        )}
      </Stack>
    </Center>
  )
}

/** Удаление с подтверждением: профиль не восстановить. */
function DeleteButton({ profile, onDeleted }: { profile: ProfileSummary; onDeleted(id: string): void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow>
      <Popover.Target>
        <Button variant="subtle" color="red" onClick={() => setOpen((v) => !v)}>
          Удалить
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" maw={280}>
          <Text size="sm">
            Профиль «{profile.name}» будет удалён безвозвратно: мир, карьера, бортжурнал и все деньги.
          </Text>
          <Group justify="flex-end">
            <Button size="xs" variant="subtle" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              size="xs"
              color="red"
              onClick={() => {
                setOpen(false)
                onDeleted(profile.id)
              }}
            >
              Удалить навсегда
            </Button>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

interface CreateFormProps {
  canCancel: boolean
  onCancel(): void
  onSubmit(input: CreateProfileInput): void
}

function CreateForm({ canCancel, onCancel, onSubmit }: CreateFormProps) {
  const [name, setName] = useState('')
  const [pilotName, setPilotName] = useState('')
  const [mode, setMode] = useState<GameMode>('pilot')
  const [ownerStart, setOwnerStart] = useState<OwnerStart>('new')
  const [capital, setCapital] = useState('5')
  const [partner, setPartner] = useState(false)
  const [children, setChildren] = useState(0)

  return (
    <Card withBorder padding="lg">
      <Stack>
        <Title order={4}>Новая карьера</Title>
        <TextInput label="Название профиля" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Имя пилота" value={pilotName} onChange={(e) => setPilotName(e.currentTarget.value)} />
        <Stack gap={4}>
          <Text size="sm" fw={500}>
            Режим
          </Text>
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as GameMode)}
            data={[
              { value: 'pilot', label: 'Пилот' },
              { value: 'owner', label: 'Владелец' }
            ]}
          />
        </Stack>
        {mode === 'owner' && (
          <SegmentedControl
            value={ownerStart}
            onChange={(v) => setOwnerStart(v as OwnerStart)}
            data={[
              { value: 'new', label: 'Своя авиакомпания' },
              { value: 'existing', label: 'Существующая авиакомпания' }
            ]}
          />
        )}
        {mode === 'owner' && (
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Стартовый капитал
            </Text>
            <SegmentedControl
              value={capital}
              onChange={setCapital}
              data={OWNER_CAPITAL_OPTIONS.map((m) => ({ value: String(m), label: `$${m} млн` }))}
            />
            <Text size="xs" c="dimmed">
              $2 млн хватит на маленькую региональную компанию с кредитом, $100 млн — на долю в небольшой существующей.
            </Text>
          </Stack>
        )}
        <Group align="flex-end">
          <Checkbox label="Супруг(а) / партнёр" checked={partner} onChange={(e) => setPartner(e.currentTarget.checked)} />
          <NumberInput label="Дети" min={0} max={6} value={children} onChange={(v) => setChildren(Number(v) || 0)} w={100} />
        </Group>
        <Text size="xs" c="dimmed">
          Семья увеличивает расходы и требования к жилью, но добавляет удовлетворённости жизнью. Изменить можно позже в
          настройках. Мир начнётся с текущего момента по UTC и будет жить в реальном времени.
        </Text>
        <Group justify="flex-end">
          {canCancel && (
            <Button variant="subtle" onClick={onCancel}>
              Отмена
            </Button>
          )}
          <Button
            disabled={!name.trim() || !pilotName.trim()}
            onClick={() => onSubmit({ name, pilotName, mode, ownerStart: mode === 'owner' ? ownerStart : undefined, startCapitalMusd: Number(capital), partner, children })}
          >
            Начать
          </Button>
        </Group>
      </Stack>
    </Card>
  )
}
