import { useState } from 'react'
import { Button, Group, Modal, SegmentedControl, Slider, Stack, Text } from '@mantine/core'
import { formatNum } from '../format'

/** Ежемесячный аннуитетный платёж — та же формула, что в main. */
function annuity(principal: number, ratePct: number, months: number): number {
  const r = ratePct / 100 / 12
  return r === 0 ? principal / months : (principal * r) / (1 - (1 + r) ** -months)
}

interface Props {
  title: string
  price: number
  /** Допустимые сроки в годах; 0 — без кредита. */
  years: number[]
  rate: number
  cash: number
  onClose(): void
  onConfirm(downPct: number, years: number): void
}

/** Покупка за свои или в кредит: первый взнос, срок, ежемесячный платёж. */
export function FinanceModal({ title, price, years, rate, cash, onClose, onConfirm }: Props) {
  // Хватает денег — по умолчанию покупаем сразу, иначе предлагаем самый короткий кредит.
  const [term, setTerm] = useState(String(price <= cash ? 0 : (years.find((y) => y > 0) ?? 0)))
  const [down, setDown] = useState(30)
  const y = Number(term)
  const downPct = y === 0 ? 100 : down
  const downAmount = Math.round((price * downPct) / 100)
  const payment = y ? annuity(price - downAmount, rate, y * 12) : 0
  const overpay = y ? payment * y * 12 - (price - downAmount) : 0

  return (
    <Modal opened onClose={onClose} title={title} centered>
      <Stack>
        <Text>
          Цена: <b>${formatNum(price)}</b> · на счёте ${formatNum(cash)}
        </Text>
        <SegmentedControl
          value={term}
          onChange={setTerm}
          data={years.map((v) => ({ value: String(v), label: v === 0 ? 'Сразу' : `${v} лет` }))}
        />
        {y > 0 && (
          <Stack gap={4}>
            <Text size="sm">Первый взнос: {down}%</Text>
            <Slider min={20} max={90} step={5} value={down} onChange={setDown} />
            <Text size="sm" c="dimmed">
              Ставка {rate}% годовых · платёж ${formatNum(payment)} в месяц · переплата ${formatNum(overpay)}
            </Text>
          </Stack>
        )}
        <Text>
          Сейчас заплатить: <b>${formatNum(downAmount)}</b>
        </Text>
        {downAmount > cash && (
          <Text c="red" size="sm">
            Не хватает денег на {y ? 'первый взнос' : 'покупку'}.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={downAmount > cash} onClick={() => onConfirm(downPct, y)}>
            Купить
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
