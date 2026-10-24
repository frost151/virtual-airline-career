import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Group, Popover, SimpleGrid, Stack, Table, Text } from '@mantine/core'
import type { Stake, StakeOffer } from '@shared/airlines'
import { formatNum } from '../format'
import { errMsg, notifyCareerChanged } from '../lib'
import { Stat } from './FlightParts'

/** Крупные суммы — в миллионах, мелкие — целиком. */
export const bigMoney = (n: number): string =>
  Math.abs(n) >= 1e6 ? `${n < 0 ? '−' : ''}$${formatNum(Math.abs(n) / 1e6)} млн` : `${n < 0 ? '−' : ''}$${formatNum(Math.abs(n))}`

/** Блок «Доля в компании» в карточке авиакомпании: покупка пакета 10/25/51% и продажа. */
export function StakeCard({ icao, onChanged }: { icao: string; onChanged(): void }) {
  const [offer, setOffer] = useState<StakeOffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmSell, setConfirmSell] = useState(false)

  const load = () =>
    window.api.market
      .stakeOffer(icao)
      .then(setOffer)
      .catch(() => setOffer(null))
  useEffect(() => {
    void load()
  }, [icao])

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      notifyCareerChanged()
      onChanged()
      await load()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (!offer) return null
  const s = offer.stake
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Доля в компании</Text>
        {s?.control && <Badge color="green">Контрольный пакет</Badge>}
      </Group>

      {error && (
        <Alert color="red" mb="xs">
          {error}
        </Alert>
      )}

      {s && (
        <>
          <SimpleGrid cols={4} mb="sm">
            <Stat label="Ваша доля" value={`${s.pct}%`} />
            <Stat label="Стоит сейчас" value={bigMoney(s.value)} />
            <Stat label="Вложено" value={bigMoney(s.cost)} />
            <Stat label="Получено дивидендов" value={bigMoney(s.dividends)} />
          </SimpleGrid>
          {s.founded && (
            <Text size="sm" c="dimmed">
              Это ваша компания. До выхода на биржу её акции не продаются.
            </Text>
          )}
          {s.control && !s.founded && (
            <Text size="sm" c="dimmed" mb="sm">
              У вас контроль над компанией: она появилась в разделах «Флот», «Маршруты» и «Финансы». Пока решения принимают заместители (ИИ), их можно снять.
            </Text>
          )}
        </>
      )}

      {!s?.founded && (
        <>
          <Text size="sm" mb="xs">
            10 и 25% — дивиденды и место в совете директоров. 51% — контроль над компанией. Пакет покупается у крупных акционеров
            дороже рынка: на 10%, а контрольный — на 30%. Капитализация: {bigMoney(offer.marketCap)}.
          </Text>
          <Group>
            {offer.quotes
              .filter((q) => !s || q.pct > s.pct)
              .map((q) => (
                <Stack key={q.pct} gap={2}>
                  <Button disabled={!!q.blocked} onClick={() => run(() => window.api.market.buyStake(icao, q.pct))}>
                    {s ? `Докупить до ${q.pct}%` : `Купить ${q.pct}%`} — {bigMoney(q.price)}
                  </Button>
                  {q.blocked && (
                    <Text size="xs" c="dimmed" maw={260}>
                      {q.blocked}
                    </Text>
                  )}
                </Stack>
              ))}
            {s && (
              <Popover opened={confirmSell} onChange={setConfirmSell} withArrow>
                <Popover.Target>
                  <Button variant="light" color="red" onClick={() => setConfirmSell((v) => !v)}>
                    Продать долю — {bigMoney(offer.saleValue)}
                  </Button>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="xs" maw={280}>
                    <Text size="sm">
                      Доля {s.pct}% будет продана целиком за {bigMoney(offer.saleValue)} (по рынку
                      {s.control ? ' с надбавкой за контроль' : ''}, минус 2% комиссии банка).
                    </Text>
                    <Group justify="flex-end">
                      <Button size="xs" variant="subtle" onClick={() => setConfirmSell(false)}>
                        Отмена
                      </Button>
                      <Button
                        size="xs"
                        color="red"
                        onClick={() => {
                          setConfirmSell(false)
                          void run(() => window.api.market.sellStake(icao))
                        }}
                      >
                        Продать
                      </Button>
                    </Group>
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            )}
          </Group>
        </>
      )}
    </Card>
  )
}

/** Сводка долей игрока на «Рынке». */
export function MyStakes({ stakes, onSelect }: { stakes: Stake[]; onSelect(icao: string): void }) {
  if (!stakes.length) return null
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Ваши доли
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Компания</Table.Th>
            <Table.Th ta="right">Доля</Table.Th>
            <Table.Th ta="right">Стоит</Table.Th>
            <Table.Th ta="right">Вложено</Table.Th>
            <Table.Th ta="right">Дивиденды</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {stakes.map((s) => (
            <Table.Tr key={s.icao} style={{ cursor: 'pointer' }} onClick={() => onSelect(s.icao)}>
              <Table.Td>
                {s.name}{' '}
                {s.control && (
                  <Badge size="xs" color="green">
                    контроль
                  </Badge>
                )}
              </Table.Td>
              <Table.Td ta="right">{s.pct}%</Table.Td>
              <Table.Td ta="right" c={s.value >= s.cost ? 'green' : 'red'}>
                {bigMoney(s.value)}
              </Table.Td>
              <Table.Td ta="right">{bigMoney(s.cost)}</Table.Td>
              <Table.Td ta="right">{bigMoney(s.dividends)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  )
}
