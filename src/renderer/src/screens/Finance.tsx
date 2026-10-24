import { useEffect, useState } from 'react'
import { Button, Card, Group, NumberInput, Progress, SimpleGrid, Slider, Table, Text } from '@mantine/core'
import type { ManageState } from '@shared/airlines'
import { COST_LABEL, formatNum } from '../format'
import { Stat } from '../components/FlightParts'
import { LineChart } from '../components/LineChart'
import { bigMoney } from '../components/StakePanel'
import { ManagedPage, useManaged, type Managed } from '../components/Managed'

const monthLabel = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { month: 'short', year: '2-digit', timeZone: 'UTC' })

export function Finance() {
  const m = useManaged()
  return <ManagedPage title="Финансы" m={m}>{(st) => <FinanceBody m={m!} st={st} />}</ManagedPage>
}

function FinanceBody({ m, st }: { m: Managed; st: ManageState }) {
  const f = st.last
  return (
    <>
      <DebtRisk st={st} />
      <Card withBorder>
        <SimpleGrid cols={4}>
          <Stat label="Деньги компании" value={bigMoney(st.cash)} />
          <Stat label="Долг" value={bigMoney(st.debt)} />
          <Stat label="Ставка" value={`${st.debtRatePct}% в месяц`} />
          <Stat label="Проценты в месяц" value={bigMoney((st.debt * st.debtRatePct) / 100)} />
          {f && (
            <>
              <Stat label="Выручка за месяц" value={bigMoney(f.revenue)} />
              <Stat label="Расходы" value={bigMoney(f.costs)} />
              <Stat label="Прибыль" value={bigMoney(f.profit)} color={f.profit >= 0 ? 'green' : 'red'} />
              <Stat label="Маржа" value={f.revenue ? `${((f.profit / f.revenue) * 100).toFixed(1)}%` : '—'} />
            </>
          )}
        </SimpleGrid>
        {!f && (
          <Text size="sm" c="dimmed" mt="sm">
            Первые итоги — 1-го числа следующего месяца.
          </Text>
        )}
      </Card>

      {st.history.length >= 2 && (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Card withBorder>
            <Text fw={600} size="sm" mb="xs">
              Прибыль по месяцам
            </Text>
            <LineChart
              label="Прибыль по месяцам"
              points={st.history.map((h) => ({ x: h.month, y: h.profit }))}
              formatY={bigMoney}
              formatTick={(y) => formatNum(y / 1e6)}
              formatX={monthLabel}
              height={150}
            />
          </Card>
          <Card withBorder>
            <Text fw={600} size="sm" mb="xs">
              Деньги на счёте
            </Text>
            <LineChart
              label="Деньги на счёте по месяцам"
              points={st.history.map((h) => ({ x: h.month, y: h.cash }))}
              formatY={bigMoney}
              formatTick={(y) => formatNum(y / 1e6)}
              formatX={monthLabel}
              height={150}
            />
          </Card>
        </SimpleGrid>
      )}

      {f && (
        <Card withBorder>
          <Text fw={600} mb="xs">
            Расходы за месяц
          </Text>
          <Table>
            <Table.Tbody>
              {Object.entries(f.costBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{COST_LABEL[k] ?? k}</Table.Td>
                    <Table.Td ta="right">{bigMoney(v)}</Table.Td>
                    <Table.Td ta="right" c="dimmed" w={70}>
                      {f.costs ? `${Math.round((v / f.costs) * 100)}%` : ''}
                    </Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
        <LoanCard m={m} st={st} />
        <InjectCard m={m} />
        <SalaryCard m={m} st={st} />
        <PayoutCard m={m} st={st} />
      </SimpleGrid>

      {st.ipo && <IpoCard m={m} st={st} />}
    </>
  )
}

/** Насколько компания близка к банкротству. */
function DebtRisk({ st }: { st: ManageState }) {
  if (!st.debt && st.status === 'ok') return null
  const pct = st.bankruptcyDebt ? (st.debt / st.bankruptcyDebt) * 100 : 0
  const color = st.status === 'distress' || pct > 60 ? 'red' : pct > 35 ? 'yellow' : 'green'
  return (
    <Card withBorder style={st.status === 'distress' ? { borderColor: 'var(--mantine-color-red-7)' } : undefined}>
      <Group justify="space-between" mb={4}>
        <Text fw={600} c={st.status === 'distress' ? 'red' : undefined}>
          {st.status === 'distress' ? 'Компания в долгах — банк грозит банкротством' : 'Долговая нагрузка'}
        </Text>
        <Text size="sm" className="mono">
          {bigMoney(st.debt)} из {bigMoney(st.bankruptcyDebt)}
        </Text>
      </Group>
      <Progress value={Math.min(100, pct)} color={color} />
      <Text size="xs" c="dimmed" mt={4}>
        Банк начнёт банкротство, если долг превысит восемь месячных выручек. Тогда кредиторы заберут компанию, ваша доля сгорит,
        а вы перестанете быть CEO.
        {st.founded &&
          (st.guaranteed
            ? ' По кредиту есть ваше личное поручительство: банк взыщет с вас 60% долга.'
            : ' Личного поручительства нет — ваши личные деньги не пострадают.')}
      </Text>
    </Card>
  )
}

function InjectCard({ m }: { m: Managed }) {
  const [amount, setAmount] = useState(500_000)
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Вложить свои деньги
      </Text>
      <NumberInput
        label="Сумма из вашего кошелька"
        min={0}
        step={100_000}
        thousandSeparator=" "
        prefix="$"
        value={amount}
        onChange={(v) => setAmount(Number(v) || 0)}
      />
      <Button size="xs" mt="sm" disabled={!amount} onClick={() => m.act((icao) => window.api.manage.inject(icao, amount))}>
        Вложить
      </Button>
      <Text size="xs" c="dimmed" mt="xs">
        Деньги уходят на счёт компании и в стоимость вашей доли. Помогает пережить кризис без новых долгов.
      </Text>
    </Card>
  )
}

function IpoCard({ m, st }: { m: Managed; st: ManageState }) {
  const ipo = st.ipo!
  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Выход на биржу (IPO)</Text>
        <Text size="sm" c="dimmed">
          Оценка компании: <b>{bigMoney(ipo.valuation)}</b>
        </Text>
      </Group>
      <Text size="sm" mb="sm">
        Инвесторы покупают часть компании, деньги получает компания (банки-организаторы берут 7%). Вы остаётесь CEO с
        контрольным пакетом и получаете дивиденды по своей доле. Выйти на биржу можно один раз.
      </Text>
      {ipo.blocked && (
        <Text size="sm" c="orange" mb="sm">
          {ipo.blocked}
        </Text>
      )}
      <Group>
        {ipo.options.map((o) => (
          <Button key={o.pct} variant="light" disabled={!!ipo.blocked} onClick={() => m.act((icao) => window.api.manage.ipo(icao, o.pct))}>
            Продать {o.pct}% — компании {bigMoney(o.proceeds)}
          </Button>
        ))}
      </Group>
    </Card>
  )
}

function LoanCard({ m, st }: { m: Managed; st: ManageState }) {
  const [amount, setAmount] = useState(1_000_000)
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Кредит
      </Text>
      <NumberInput
        label="Сумма"
        description={`Банк даст ещё до ${bigMoney(st.borrowLimit)}`}
        min={0}
        step={500_000}
        thousandSeparator=" "
        prefix="$"
        value={amount}
        onChange={(v) => setAmount(Number(v) || 0)}
      />
      <Group mt="sm">
        <Button size="xs" disabled={!amount || amount > st.borrowLimit} onClick={() => m.act((icao) => window.api.manage.borrow(icao, amount))}>
          Взять
        </Button>
        <Button size="xs" variant="light" disabled={!amount || !st.debt} onClick={() => m.act((icao) => window.api.manage.repay(icao, amount))}>
          Погасить
        </Button>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        Лимит — полугодовая выручка плюс 60% стоимости своих самолётов. Свободные деньги сверх трёх месяцев расходов компания
        сама направляет на погашение долга.
      </Text>
    </Card>
  )
}

function SalaryCard({ m, st }: { m: Managed; st: ManageState }) {
  const [amount, setAmount] = useState(st.ceoSalary)
  useEffect(() => setAmount(st.ceoSalary), [st.ceoSalary])
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Зарплата CEO
      </Text>
      <NumberInput
        label="В месяц, до налога"
        description={`Совет директоров утвердит до ${bigMoney(st.ceoSalaryCap)}`}
        min={0}
        max={st.ceoSalaryCap}
        step={1000}
        thousandSeparator=" "
        prefix="$"
        value={amount}
        onChange={(v) => setAmount(Number(v) || 0)}
      />
      <Button size="xs" mt="sm" disabled={amount === st.ceoSalary} onClick={() => m.act((icao) => window.api.manage.setCeoSalary(icao, amount))}>
        Утвердить
      </Button>
      <Text size="xs" c="dimmed" mt="xs">
        Платится 1-го числа из денег компании в ваш кошелёк, налог — по стране базы. Если денег у компании нет, зарплату не
        платят.
      </Text>
    </Card>
  )
}

function PayoutCard({ m, st }: { m: Managed; st: ManageState }) {
  const [value, setValue] = useState(st.payoutPct)
  useEffect(() => setValue(st.payoutPct), [st.payoutPct])
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Дивиденды
      </Text>
      <Text size="sm" mb="md">
        {value ? `${value}% квартальной прибыли — акционерам` : 'Вся прибыль остаётся в компании'}
      </Text>
      <Slider
        min={0}
        max={100}
        step={10}
        value={value}
        onChange={setValue}
        onChangeEnd={(v) => m.act((icao) => window.api.manage.setPayout(icao, v))}
        label={(v) => `${v}%`}
        marks={[
          { value: 0, label: '0%' },
          { value: 50, label: '50%' },
          { value: 100, label: '100%' }
        ]}
        mb="lg"
      />
      <Text size="xs" c="dimmed">
        Выплачиваются в январе, апреле, июле и октябре, если квартал прибыльный и долг не слишком велик. Вы получаете их по
        своей доле.
      </Text>
    </Card>
  )
}
