import { useEffect, useState } from 'react'
import { Alert, Button, Group, Modal, ScrollArea, SimpleGrid, Stack, Text } from '@mantine/core'
import type { CatchUpReport } from '@shared/economy'
import { CYCLE_LABEL } from '@shared/economy'
import { Stat } from './FlightParts'
import { NewsList } from '../screens/Economy'

function awayText(ms: number): string {
  const h = Math.floor(ms / 3_600_000)
  const d = Math.floor(h / 24)
  if (d >= 1) return `${d} дн. ${h % 24} ч`
  return `${h} ч`
}

/** Сводка о прошедшем времени: «Пока вас не было» после открытия профиля или после перемотки. */
export function CatchUpModal() {
  const [report, setReport] = useState<CatchUpReport | null>(null)
  useEffect(() => {
    const load = () =>
      window.api.world.report().then((r) => {
        if (r) setReport(r)
      })
    void load()
    return window.api.world.onReport(load)
  }, [])
  if (!report) return null

  const oil = (report.brentTo / report.brentFrom - 1) * 100
  const prices = (report.cpiTo / report.cpiFrom - 1) * 100
  return (
    <Modal opened onClose={() => setReport(null)} title={report.skipped ? 'Время перемотано' : 'Пока вас не было'} size="lg" centered>
      <Stack>
        <Text c="dimmed">
          Прошло {awayText(report.to - report.from)}. {report.skipped ? 'За это время:' : 'Мир жил своей жизнью:'}
        </Text>
        <SimpleGrid cols={3}>
          <Stat label="Нефть Brent" value={`$${report.brentTo.toFixed(1)} (${oil >= 0 ? '+' : ''}${oil.toFixed(1)}%)`} />
          <Stat label="Цены выросли" value={`${prices >= 0 ? '+' : ''}${prices.toFixed(2)}%`} />
          <Stat label="Экономика" value={CYCLE_LABEL[report.cycle]} />
        </SimpleGrid>
        {report.missedBookings > 0 && (
          <Alert color="red">Сорвано броней: {report.missedBookings}. Репутация у работодателя снизилась.</Alert>
        )}
        {report.news.length > 0 && (
          <ScrollArea.Autosize mah={360}>
            <NewsList news={[...report.news].reverse()} />
          </ScrollArea.Autosize>
        )}
        <Group justify="flex-end">
          <Button onClick={() => setReport(null)}>Продолжить</Button>
        </Group>
      </Stack>
    </Modal>
  )
}
