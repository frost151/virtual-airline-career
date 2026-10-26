import { useEffect, useState } from 'react'
import { ActionIcon, Badge, Button, Card, Group, Popover, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core'
import type { ManageState, TailPosition } from '@shared/airlines'
import { formatClock } from '../format'
import { errMsg } from '../lib'
import type { Managed } from './Managed'

/** Борта компании: регистрация, где сейчас и куда дальше. Регистрацию можно сменить. */
export function TailsCard({ m, st }: { m: Managed; st: ManageState }) {
  const [tails, setTails] = useState<TailPosition[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const load = () =>
      window.api.manage
        .tails(st.icao)
        .then(setTails)
        .catch((e) => setError(errMsg(e)))
    void load()
    const timer = setInterval(load, 30_000)
    const off = window.api.world.onChanged(load)
    return () => {
      clearInterval(timer)
      off()
    }
  }, [st.icao, st])

  if (error) return <Text c="red">{error}</Text>
  if (!tails) return null
  const air = tails.filter((t) => t.status === 'air').length
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Борта</Text>
        <Text size="sm" c="dimmed">
          В воздухе {air} из {tails.length}
        </Text>
      </Group>
      <ScrollArea.Autosize mah={480}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Регистрация</Table.Th>
              <Table.Th>Тип</Table.Th>
              <Table.Th>Сейчас</Table.Th>
              <Table.Th>Следующий рейс</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tails.map((t) => (
              <Table.Tr key={t.reg}>
                <Table.Td>
                  <RegEdit m={m} reg={t.reg} />
                </Table.Td>
                <Table.Td>{t.typeName}</Table.Td>
                <Table.Td>
                  {t.flight ? (
                    <Badge variant="light" color="blue">
                      {t.flight.flightNo} {t.flight.dep} → {t.flight.arr}
                    </Badge>
                  ) : t.at ? (
                    <Badge variant="light" color={t.stranded ? 'orange' : 'gray'}>
                      {t.stranded ? `Стоит в ${t.at} без обратного рейса` : `На земле в ${t.at}`}
                    </Badge>
                  ) : (
                    <Text size="sm" c="dimmed">
                      без рейсов
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>
                  {t.next ? (
                    <Text size="sm" className="mono">
                      {t.next.flightNo} {t.next.dep} → {t.next.arr} в {formatClock(t.next.depAt)} UTC
                    </Text>
                  ) : (
                    '—'
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </ScrollArea.Autosize>
      <Text size="xs" c="dimmed" mt="xs">
        Положение — по расписанию и часам мира: при перемотке самолёты сдвигаются вместе с миром. Нажмите на регистрацию,
        чтобы её сменить.
      </Text>
    </Card>
  )
}

function RegEdit({ m, reg }: { m: Managed; reg: string }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(reg)
  useEffect(() => setValue(reg), [reg])
  const save = async () => {
    if (await m.act((icao) => window.api.manage.setRegistration(icao, reg, value))) setOpen(false)
  }
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withArrow>
      <Popover.Target>
        <Group gap={4} wrap="nowrap">
          <Text size="sm" className="mono" fw={600}>
            {reg}
          </Text>
          <ActionIcon size="xs" variant="subtle" onClick={() => setOpen((o) => !o)} aria-label="Сменить регистрацию">
            ✎
          </ActionIcon>
        </Group>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <TextInput label="Новая регистрация" value={value} onChange={(e) => setValue(e.currentTarget.value.toUpperCase())} w={200} />
          <Button size="xs" onClick={save} disabled={!value.trim() || value === reg}>
            Сохранить
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
