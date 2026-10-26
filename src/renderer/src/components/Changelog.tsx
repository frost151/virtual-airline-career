import { useEffect, useState } from 'react'
import { Badge, Button, Card, Collapse, Group, List, Modal, ScrollArea, Stack, Text } from '@mantine/core'
import { CHANGELOG, type ChangelogEntry } from '@shared/changelog'

const SEEN_KEY = 'changelog-seen'

function Entry({ e }: { e: ChangelogEntry }) {
  return (
    <Stack gap={6}>
      <Group gap="xs">
        <Badge variant="light">{e.version}</Badge>
        <Text fw={600}>{e.title}</Text>
        <Text size="xs" c="dimmed">
          {new Date(e.date).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}
        </Text>
      </Group>
      {e.sections.map((s) => (
        <Stack key={s.name} gap={2}>
          <Text size="sm" fw={600} c="dimmed">
            {s.name}
          </Text>
          <List size="sm" spacing={2} pr="lg" style={{ overflowWrap: 'anywhere' }}>
            {s.items.map((i) => (
              <List.Item key={i}>{i}</List.Item>
            ))}
          </List>
        </Stack>
      ))}
    </Stack>
  )
}

/** Карточка «Что нового» в настройках: последняя версия раскрыта, остальные — по кнопке. */
export function ChangelogCard() {
  const [all, setAll] = useState(false)
  const [latest, ...older] = CHANGELOG
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Что нового
      </Text>
      <Entry e={latest} />
      <Collapse in={all}>
        <Stack mt="md" gap="md">
          {older.map((e) => (
            <Entry key={e.version} e={e} />
          ))}
        </Stack>
      </Collapse>
      <Button variant="subtle" size="xs" mt="xs" onClick={() => setAll((a) => !a)}>
        {all ? 'Скрыть старые версии' : 'Все версии'}
      </Button>
    </Card>
  )
}

/** После обновления (и при первом запуске) один раз показываем, что изменилось в версии. */
export function ChangelogOnUpdate() {
  const [show, setShow] = useState<ChangelogEntry | null>(null)
  useEffect(() => {
    let seen: string | null = null
    try {
      seen = localStorage.getItem(SEEN_KEY)
    } catch {
      return
    }
    const latest = CHANGELOG[0]
    if (seen === latest.version) return
    try {
      localStorage.setItem(SEEN_KEY, latest.version)
    } catch {
      // Хранилище недоступно — покажем ещё раз в следующий запуск.
    }
    setShow(latest)
  }, [])
  if (!show) return null
  return (
    <Modal opened onClose={() => setShow(null)} title={`Обновление ${show.version}`} size="lg" centered>
      <ScrollArea.Autosize mah={520}>
        <Entry e={show} />
      </ScrollArea.Autosize>
      <Group justify="flex-end" mt="md">
        <Button onClick={() => setShow(null)}>Понятно</Button>
      </Group>
    </Modal>
  )
}
