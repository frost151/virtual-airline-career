import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Center,
  Image,
  Modal,
  Card,
  Group,
  Loader,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import type { Asset, InvestmentKind, LifeState, PricedCatalog } from '@shared/lifestyle'
import type { WikiImage } from '@shared/types'
import type { AirlineMarketRow } from '@shared/airlines'
import { CAR_CLASS_LABEL, FATIGUE_LIMIT, INVESTMENT_LABEL, LOAN_LABEL } from '@shared/lifestyle'
import { countryName, formatNum, formatUtc } from '../format'
import { errMsg, notifyCareerChanged, useCareerVersion, usePilot } from '../lib'
import { SortableTh, compareBy, type SortState } from '../components/SortableTh'
import { Stat } from '../components/FlightParts'
import { FinanceModal } from '../components/FinanceModal'
import { useWorldNow } from '../hooks'

const money = (n: number) => `${n < 0 ? '−' : ''}$${formatNum(Math.abs(n))}`

interface Ctx {
  life: LifeState
  catalog: PricedCatalog
  cash: number
  run(fn: () => Promise<LifeState>): Promise<void>
}

export function Life() {
  const [pilot] = usePilot()
  const version = useCareerVersion()
  const [life, setLife] = useState<LifeState | null>(null)
  const [catalog, setCatalog] = useState<PricedCatalog | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    window.api.life.state().then(setLife)
    window.api.life.catalog().then(setCatalog)
  }, [])
  useEffect(load, [load, version])
  useEffect(() => window.api.world.onChanged(load), [load])

  const run = async (fn: () => Promise<LifeState>) => {
    setError(null)
    try {
      setLife(await fn())
      window.api.life.catalog().then(setCatalog)
      notifyCareerChanged()
    } catch (e) {
      setError(errMsg(e))
    }
  }

  if (!life || !catalog || !pilot) return <Loader />
  const ctx: Ctx = { life, catalog, cash: pilot.cash, run }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Личная жизнь</Title>
        <Text c="dimmed">
          {life.country ? `Цены и налоги: ${countryName(life.country)}` : 'Устройтесь на работу — жизнь считается по стране базы'} · на счёте{' '}
          <b>{money(pilot.cash)}</b>
        </Text>
      </Group>
      {error && (
        <Alert color="red" withCloseButton onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview">Обзор</Tabs.Tab>
          <Tabs.Tab value="home">Жильё</Tabs.Tab>
          <Tabs.Tab value="cars">Транспорт</Tabs.Tab>
          <Tabs.Tab value="aviation">Своя авиация</Tabs.Tab>
          <Tabs.Tab value="rest">Отдых и клубы</Tabs.Tab>
          <Tabs.Tab value="money">Инвестиции и кредиты</Tabs.Tab>
          <Tabs.Tab value="edu">Образование</Tabs.Tab>
          <Tabs.Tab value="collect">Коллекции</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview" pt="md">
          <Overview {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="home" pt="md">
          <Housing {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="cars" pt="md">
          <Cars {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="aviation" pt="md">
          <Aviation {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="rest" pt="md">
          <Rest {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="money" pt="md">
          <Money {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="edu" pt="md">
          <Education {...ctx} />
        </Tabs.Panel>
        <Tabs.Panel value="collect" pt="md">
          <Collect {...ctx} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

// ——— обзор ———

function Gauge({ label, value, invert = false, hint }: { label: string; value: number; invert?: boolean; hint?: string }) {
  // invert — «чем больше, тем хуже» (усталость).
  const good = invert ? value < 50 : value >= 60
  const bad = invert ? value >= 70 : value < 35
  return (
    <Card withBorder>
      <Stack gap={6}>
        <Group justify="space-between">
          <Text size="sm">{label}</Text>
          <Text fw={700} className="mono">
            {value}
          </Text>
        </Group>
        <Progress value={value} color={bad ? 'red' : good ? 'green' : 'yellow'} />
        {hint && (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        )}
      </Stack>
    </Card>
  )
}

function Overview({ life, catalog, cash, run }: Ctx) {
  const total = life.budget.reduce((s, l) => s + l.amount, 0)
  const assets = life.assets.reduce((s, a) => s + a.value, 0)
  const invest = life.investments.reduce((s, i) => s + i.value, 0) + life.stakesValue
  const debt = life.loans.reduce((s, l) => s + l.balance, 0)
  const now = useWorldNow()
  const medicalDays = Math.floor((life.medicalUntil - now) / 86_400_000)
  return (
    <Stack>
      {!life.fitToFly.ok && <Alert color="red">{life.fitToFly.reason}</Alert>}
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Gauge label="Усталость" value={life.fatigue} invert hint={`Рейсы недоступны от ${FATIGUE_LIMIT}. Снимается отдыхом.`} />
        <Gauge label="Здоровье" value={life.health} hint="Ниже 50 — медкомиссию не пройти" />
        <Gauge label="Удовлетворённость" value={life.satisfaction} hint="Влияет на репутацию у работодателя" />
        <Gauge label="Престиж" value={life.prestige} hint="Бонус к оплате VIP-чартеров" />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Text fw={600} mb="xs">
            Ежемесячный бюджет
          </Text>
          <Table>
            <Table.Tbody>
              {life.budget.map((l) => (
                <Table.Tr key={l.label}>
                  <Table.Td>{l.label}</Table.Td>
                  <Table.Td ta="right" c={l.amount >= 0 ? 'green' : undefined} className="mono">
                    {money(l.amount)}
                  </Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr>
                <Table.Td fw={700}>Итого в месяц</Table.Td>
                <Table.Td ta="right" fw={700} c={total >= 0 ? 'green' : 'red'} className="mono">
                  {money(total)}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt="xs">
            Списывается 1-го числа каждого месяца. Налог на зарплату ({life.params.tax}%) удерживается сразу при оплате рейса.
          </Text>
        </Card>
        <Stack>
          <Card withBorder>
            <Text fw={600} mb="xs">
              Капитал
            </Text>
            <SimpleGrid cols={2}>
              <Stat label="Деньги" value={money(cash)} />
              <Stat label="Имущество" value={money(assets)} />
              <Stat label={life.stakesValue ? 'Инвестиции и доли' : 'Инвестиции'} value={money(invest)} />
              <Stat label="Долги" value={money(-debt)} />
            </SimpleGrid>
            <Text mt="sm">
              Чистый капитал: <b>{money(cash + assets + invest - debt)}</b>
            </Text>
          </Card>
          <Card withBorder>
            <Group justify="space-between">
              <Stack gap={2}>
                <Text fw={600}>Медкомиссия (ВЛЭК)</Text>
                <Text size="sm" c={medicalDays < 30 ? 'orange' : 'dimmed'}>
                  {medicalDays >= 0 ? `Действует до ${formatUtc(life.medicalUntil).slice(0, 10)} (${medicalDays} дн.)` : 'Просрочена'}
                </Text>
              </Stack>
              <Button size="xs" variant="light" onClick={() => run(() => window.api.life.renewMedical())}>
                Пройти за {money(catalog.medicalCost)}
              </Button>
            </Group>
          </Card>
          <Card withBorder>
            <Text fw={600}>Семья</Text>
            <Text size="sm" c="dimmed">
              {life.family.partner ? 'Супруг(а)' : 'Без партнёра'}
              {life.family.children ? `, детей: ${life.family.children}` : ''} · нужно комнат: {life.roomsNeeded}. Изменить — в настройках.
            </Text>
          </Card>
        </Stack>
      </SimpleGrid>
    </Stack>
  )
}

// ——— имущество (общее) ———

function OwnedList({ assets, kind, run, extra }: { assets: Asset[]; kind: Asset['kind']; run: Ctx['run']; extra?: (a: Asset) => React.ReactNode }) {
  const list = assets.filter((a) => a.kind === kind)
  if (!list.length) return null
  return (
    <Card withBorder>
      <Text fw={600} mb="xs">
        Ваше
      </Text>
      <Table>
        <Table.Tbody>
          {list.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>
                <b>{a.name}</b>
                {a.airport && (
                  <Text span size="xs" c="dimmed">
                    {' '}
                    · {a.airport}
                  </Text>
                )}
                {a.residence && (
                  <Badge ml="xs" size="xs">
                    живёте здесь
                  </Badge>
                )}
                {a.rentedOut && (
                  <Badge ml="xs" size="xs" color="green">
                    сдаётся
                  </Badge>
                )}
                {a.loanId && (
                  <Badge ml="xs" size="xs" color="orange">
                    в кредите
                  </Badge>
                )}
              </Table.Td>
              <Table.Td ta="right">{a.ownership === 'rent' ? 'аренда' : `стоит ${money(a.value)}`}</Table.Td>
              <Table.Td ta="right">{a.monthly ? `${money(a.monthly)}/мес` : ''}</Table.Td>
              <Table.Td ta="right">
                <Group gap="xs" justify="flex-end">
                  {extra?.(a)}
                  <Button size="xs" variant="subtle" color="red" onClick={() => run(() => window.api.life.sell(a.id))}>
                    {a.ownership === 'rent' ? 'Отказаться' : 'Продать'}
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  )
}

// ——— жильё ———

function Housing({ life, catalog, cash, run }: Ctx) {
  const [buying, setBuying] = useState<PricedCatalog['housing'][number] | null>(null)
  const residence = life.assets.find((a) => a.kind === 'home' && a.residence)
  return (
    <Stack>
      {!residence && <Alert color="orange">У вас нет жилья: усталость почти не проходит, удовлетворённость падает. Снимите хотя бы комнату.</Alert>}
      <OwnedList
        assets={life.assets}
        kind="home"
        run={run}
        extra={(a) =>
          a.ownership === 'own' && (
            <>
              {!a.residence && (
                <Button size="xs" variant="light" onClick={() => run(() => window.api.life.setResidence(a.id))}>
                  Жить здесь
                </Button>
              )}
              {!a.residence && (
                <Switch size="xs" label="Сдавать" checked={a.rentedOut} onChange={(e) => run(() => window.api.life.setRentedOut(a.id, e.currentTarget.checked))} />
              )}
            </>
          )
        }
      />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Вариант</Table.Th>
            <Table.Th ta="right">Комнат</Table.Th>
            <Table.Th ta="right">Аренда в месяц</Table.Th>
            <Table.Th ta="right">Купить</Table.Th>
            <Table.Th ta="right">Комфорт / престиж</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {catalog.housing.map((h) => (
            <Table.Tr key={h.id}>
              <Table.Td fw={500}>
                {h.name}
                {h.rooms < life.roomsNeeded && (
                  <Text span size="xs" c="orange">
                    {' '}
                    · тесно для семьи
                  </Text>
                )}
              </Table.Td>
              <Table.Td ta="right">{h.rooms}</Table.Td>
              <Table.Td ta="right">{money(h.localRent)}</Table.Td>
              <Table.Td ta="right">{h.localPrice ? money(h.localPrice) : '—'}</Table.Td>
              <Table.Td ta="right">
                +{h.comfort} / {h.prestige}
              </Table.Td>
              <Table.Td ta="right">
                <Group gap="xs" justify="flex-end">
                  <Button size="xs" variant="light" onClick={() => run(() => window.api.life.rentHome(h.id))}>
                    Снять
                  </Button>
                  {h.localPrice > 0 && (
                    <Button size="xs" onClick={() => setBuying(h)}>
                      Купить
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        Жильё снимается и покупается в городе базы. Ипотека — {catalog.rates.mortgage}% годовых. Купленное жильё дорожает вместе с
        инфляцией, его можно сдавать.
      </Text>
      {buying && (
        <FinanceModal
          title={buying.name}
          price={buying.localPrice}
          years={[0, 10, 15, 20, 25]}
          rate={catalog.rates.mortgage}
          cash={cash}
          onClose={() => setBuying(null)}
          onConfirm={(down, years) => {
            setBuying(null)
            run(() => window.api.life.buyHome(buying.id, down, years))
          }}
        />
      )}
    </Stack>
  )
}

// ——— транспорт ———

type CarSort = SortState<'brand' | 'price' | 'monthly' | 'prestige'>
const ORIGIN_LABEL: Record<string, string> = { RU: 'Россия' }

function Cars({ life, catalog, cash, run }: Ctx) {
  const [cls, setCls] = useState<string | null>(null)
  const [origin, setOrigin] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<CarSort>({ key: 'price', dir: 'asc' })
  const [buying, setBuying] = useState<PricedCatalog['cars'][number] | null>(null)
  const [shown, setShown] = useState<PricedCatalog['cars'][number] | null>(null)

  const origins = useMemo(
    () =>
      [...new Set(catalog.cars.map((c) => c.origin))]
        .map((o) => ({ value: o, label: ORIGIN_LABEL[o] ?? countryName(o) }))
        .sort((a, b) => (a.value === 'RU' ? -1 : b.value === 'RU' ? 1 : a.label.localeCompare(b.label, 'ru'))),
    [catalog]
  )
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const get = {
      brand: (c: PricedCatalog['cars'][number]) => `${c.brand} ${c.model}`,
      price: (c: PricedCatalog['cars'][number]) => c.localPrice,
      monthly: (c: PricedCatalog['cars'][number]) => c.monthly,
      prestige: (c: PricedCatalog['cars'][number]) => c.prestige
    }[sort.key]
    return catalog.cars
      .filter((c) => !cls || c.class === cls)
      .filter((c) => !origin || c.origin === origin)
      .filter((c) => !q || `${c.brand} ${c.model}`.toLowerCase().includes(q))
      .sort(compareBy(get, sort.dir))
  }, [catalog, cls, origin, query, sort])

  return (
    <Stack>
      <OwnedList assets={life.assets} kind="car" run={run} />
      <Group>
        <Select
          placeholder="Все классы"
          data={Object.entries(CAR_CLASS_LABEL).map(([value, label]) => ({ value, label }))}
          value={cls}
          onChange={setCls}
          clearable
          w={180}
        />
        <Select placeholder="Все страны" data={origins} value={origin} onChange={setOrigin} clearable searchable w={180} />
        <TextInput placeholder="Марка или модель" value={query} onChange={(e) => setQuery(e.currentTarget.value)} w={220} />
        <Text size="sm" c="dimmed">
          {rows.length} из {catalog.cars.length}
        </Text>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <SortableTh sortKey="brand" sort={sort} onSort={setSort}>
              Машина
            </SortableTh>
            <Table.Th>Класс</Table.Th>
            <Table.Th>Страна</Table.Th>
            <SortableTh sortKey="price" sort={sort} onSort={setSort} align="right">
              Цена
            </SortableTh>
            <SortableTh sortKey="monthly" sort={sort} onSort={setSort} align="right">
              Содержание в месяц
            </SortableTh>
            <SortableTh sortKey="prestige" sort={sort} onSort={setSort} align="right" firstDir="desc">
              Престиж
            </SortableTh>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((c) => (
            <Table.Tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setShown(c)}>
              <Table.Td fw={500}>
                {c.brand} {c.model}
                {c.electric && (
                  <Badge ml="xs" size="xs" variant="light" color="teal">
                    электро
                  </Badge>
                )}
              </Table.Td>
              <Table.Td>{CAR_CLASS_LABEL[c.class]}</Table.Td>
              <Table.Td>
                {ORIGIN_LABEL[c.origin] ?? countryName(c.origin)}
                {c.imported && catalog.country && catalog.country !== c.origin && (
                  <Text span size="xs" c="dimmed">
                    {' '}
                    · импорт
                  </Text>
                )}
              </Table.Td>
              <Table.Td ta="right">{money(c.localPrice)}</Table.Td>
              <Table.Td ta="right">{money(c.monthly)}</Table.Td>
              <Table.Td ta="right">{c.prestige}</Table.Td>
              <Table.Td ta="right">
                <Button
                  size="xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    setBuying(c)
                  }}
                >
                  Купить
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {shown && (
        <CarCard
          car={shown}
          country={catalog.country}
          onClose={() => setShown(null)}
          onBuy={() => {
            setBuying(shown)
            setShown(null)
          }}
        />
      )}
      {buying && (
        <FinanceModal
          title={`${buying.brand} ${buying.model}`}
          price={buying.localPrice}
          years={[0, 3, 5]}
          rate={catalog.rates.auto}
          cash={cash}
          onClose={() => setBuying(null)}
          onConfirm={(down, years) => {
            setBuying(null)
            run(() => window.api.life.buyCar(buying.id, down, years))
          }}
        />
      )}
    </Stack>
  )
}

function CarCard({
  car,
  country,
  onClose,
  onBuy
}: {
  car: PricedCatalog['cars'][number]
  country: string | null
  onClose(): void
  onBuy(): void
}) {
  const [img, setImg] = useState<WikiImage | null | undefined>(undefined)
  useEffect(() => {
    window.api.life.carImage(car.id).then(setImg).catch(() => setImg(null))
  }, [car.id])
  const duty = car.imported && country && car.localPrice > car.price * 1.05
  return (
    <Modal opened onClose={onClose} title={`${car.brand} ${car.model}`} size="lg" centered>
      <Stack>
        <Box h={300} style={{ borderRadius: 8, overflow: 'hidden', background: 'var(--mantine-color-dark-6)' }}>
          {img === undefined ? (
            <Center h="100%">
              <Loader />
            </Center>
          ) : img ? (
            <Image src={img.image} alt={`${car.brand} ${car.model}`} h={300} fit="contain" />
          ) : (
            <Center h="100%">
              <Text c="dimmed">Фото недоступно — нужен интернет</Text>
            </Center>
          )}
        </Box>
        {img && (
          <Text size="xs" c="dimmed">
            Фото:{' '}
            <Anchor size="xs" onClick={() => window.api.openExternal(img.page)}>
              Википедия — {img.title}
            </Anchor>
          </Text>
        )}
        <Group gap="xs">
          <Badge variant="light">{CAR_CLASS_LABEL[car.class]}</Badge>
          <Badge variant="light" color="gray">
            {ORIGIN_LABEL[car.origin] ?? countryName(car.origin)}
          </Badge>
          {car.electric && (
            <Badge variant="light" color="teal">
              электромобиль
            </Badge>
          )}
        </Group>
        <SimpleGrid cols={3}>
          <Stat label="Цена" value={money(car.localPrice)} />
          <Stat label="Содержание в месяц" value={money(car.monthly)} />
          <Stat label="Престиж" value={String(car.prestige)} />
        </SimpleGrid>
        {duty && (
          <Text size="sm" c="dimmed">
            Импорт: базовая цена {money(car.price)}, с пошлинами и сборами страны — {money(car.localPrice)}.
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Закрыть
          </Button>
          <Button onClick={onBuy}>Купить</Button>
        </Group>
      </Stack>
    </Modal>
  )
}

// ——— своя авиация ———

function Aviation({ life, catalog, cash, run }: Ctx) {
  const [buying, setBuying] = useState<PricedCatalog['aircraft'][number] | null>(null)
  const owned = new Set(life.assets.filter((a) => a.kind === 'aircraft').map((a) => a.itemId))
  return (
    <Stack>
      <Text c="dimmed">
        Свой самолёт для души: Cessna 172, Cirrus SR22, TBM, PC-12 и CJ4 есть в MSFS 2024. Позже такой самолёт сможет стать первым бортом
        вашей авиакомпании.
      </Text>
      <OwnedList assets={life.assets} kind="aircraft" run={run} />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Самолёт</Table.Th>
            <Table.Th ta="right">Цена</Table.Th>
            <Table.Th ta="right">Ангар, страховка, ТО в месяц</Table.Th>
            <Table.Th ta="right">Престиж</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {catalog.aircraft.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td fw={500}>{a.name}</Table.Td>
              <Table.Td ta="right">{a.localPrice ? money(a.localPrice) : 'членство'}</Table.Td>
              <Table.Td ta="right">{money(a.localMonthly)}</Table.Td>
              <Table.Td ta="right">{a.prestige}</Table.Td>
              <Table.Td ta="right">
                <Button
                  size="xs"
                  disabled={owned.has(a.id)}
                  onClick={() => (a.localPrice ? setBuying(a) : run(() => window.api.life.buyAircraft(a.id, 100, 0)))}
                >
                  {owned.has(a.id) ? 'Есть' : a.localPrice ? 'Купить' : 'Вступить'}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {buying && (
        <FinanceModal
          title={buying.name}
          price={buying.localPrice}
          years={[0, 5, 10]}
          rate={catalog.rates.aircraft}
          cash={cash}
          onClose={() => setBuying(null)}
          onConfirm={(down, years) => {
            setBuying(null)
            run(() => window.api.life.buyAircraft(buying.id, down, years))
          }}
        />
      )}
    </Stack>
  )
}

// ——— отдых ———

const restDuration = (h: number): string => (h < 24 ? `${h} ч` : h % 168 === 0 ? `${h / 168} нед.` : `${h / 24} сут.`)

function Rest({ life, catalog, cash, run }: Ctx) {
  return (
    <Stack>
      <Text c="dimmed">
        Усталость сейчас: <b>{life.fatigue}</b>. После каждого рейса она растёт; дома проходит совсем медленно — чтобы снова летать, нужен
        отдых. На время отдыха мир перематывается.
        {(life.family.partner || life.family.children > 0) && ' Поездки — на всю семью.'}
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }}>
        {catalog.rest.map((r) => (
          <Card key={r.id} withBorder>
            <Stack gap="xs">
              <Text fw={600}>{r.name}</Text>
              <Text size="sm" c="dimmed">
                {restDuration(r.hours)} · усталость −{r.fatigue} · настроение +{r.satisfaction}
                {r.health ? ` · здоровье +${r.health}` : ''}
              </Text>
              <Button variant="light" disabled={cash < r.localPrice} onClick={() => run(() => window.api.life.rest(r.id))}>
                {money(r.localPrice)}
              </Button>
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <Card withBorder>
        <Text fw={600} mb="xs">
          Клубы и абонементы
        </Text>
        <Table>
          <Table.Tbody>
            {catalog.subscriptions.map((s) => (
              <Table.Tr key={s.id}>
                <Table.Td fw={500}>{s.name}</Table.Td>
                <Table.Td c="dimmed">
                  здоровье +{s.health}/мес · усталость −{s.fatigueDaily}/день{s.prestige ? ` · престиж +${s.prestige}` : ''}
                </Table.Td>
                <Table.Td ta="right">{money(s.localMonthly)}/мес</Table.Td>
                <Table.Td ta="right">
                  <Switch
                    checked={life.subscriptions.includes(s.id)}
                    onChange={(e) => run(() => window.api.life.subscribe(s.id, e.currentTarget.checked))}
                  />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}

// ——— деньги ———

function Money({ life, catalog, cash, run }: Ctx) {
  const [kind, setKind] = useState<InvestmentKind>('deposit')
  const [amount, setAmount] = useState<number>(1000)
  const [stock, setStock] = useState<string | null>(null)
  const [market, setMarket] = useState<AirlineMarketRow[]>([])
  useEffect(() => {
    window.api.market.rows().then(setMarket)
  }, [])
  const names = useMemo(() => new Map(market.map((m) => [m.icao, m.name])), [market])
  const stockOptions = useMemo(
    () =>
      [...market]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((m) => ({
          value: m.icao,
          label: `${m.name} — $${m.sharePrice.toFixed(2)} (${m.shareChange >= 0 ? '+' : ''}${m.shareChange}% за месяц)`
        })),
    [market]
  )
  const rateText = {
    deposit: `${catalog.rates.deposit}% годовых`,
    bonds: `${catalog.rates.bonds}% годовых, фиксировано`,
    index: 'рынок: может и расти, и падать',
    shares: 'цена зависит от прибыли компании; прибыльные платят дивиденды раз в квартал, комиссия брокера 0,3%'
  }
  return (
    <Stack>
      <Card withBorder>
        <Stack>
          <Text fw={600}>Вложить деньги</Text>
          <Group align="flex-end">
            <SegmentedControl
              value={kind}
              onChange={(v) => setKind(v as InvestmentKind)}
              data={(Object.keys(INVESTMENT_LABEL) as InvestmentKind[]).map((k) => ({ value: k, label: INVESTMENT_LABEL[k] }))}
            />
            {kind === 'shares' && (
              <Select label="Авиакомпания" data={stockOptions} value={stock} onChange={setStock} searchable w={380} placeholder="Выберите компанию" />
            )}
            <NumberInput label="Сумма, $" value={amount} onChange={(v) => setAmount(Number(v) || 0)} min={100} max={Math.max(100, cash)} step={500} w={160} thousandSeparator=" " />
            <Button
              disabled={amount < 100 || amount > cash || (kind === 'shares' && !stock)}
              onClick={() => run(() => window.api.life.invest(kind, amount, kind === 'shares' ? stock : null))}
            >
              Вложить
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            {INVESTMENT_LABEL[kind]}: {rateText[kind]}.{kind !== 'shares' && ' Ставки зависят от страны и фазы экономики.'}
          </Text>
        </Stack>
      </Card>
      {life.investments.length > 0 && (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Вложение</Table.Th>
              <Table.Th ta="right">Вложено</Table.Th>
              <Table.Th ta="right">Стоит сейчас</Table.Th>
              <Table.Th ta="right">Доходность</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {life.investments.map((i) => {
              const ret = (i.value / i.principal - 1) * 100
              return (
                <Table.Tr key={i.id}>
                  <Table.Td>
                    {i.kind === 'shares' && i.icao
                      ? `Акции ${names.get(i.icao) ?? i.icao} · ${formatNum(i.quantity ?? 0)} шт.`
                      : INVESTMENT_LABEL[i.kind]}
                    {i.rate ? ` · ${i.rate}%` : ''}
                  </Table.Td>
                  <Table.Td ta="right">{money(i.principal)}</Table.Td>
                  <Table.Td ta="right">{money(i.value)}</Table.Td>
                  <Table.Td ta="right" c={ret >= 0 ? 'green' : 'red'}>
                    {ret >= 0 ? '+' : ''}
                    {ret.toFixed(1)}%
                  </Table.Td>
                  <Table.Td ta="right">
                    <Button size="xs" variant="subtle" onClick={() => run(() => window.api.life.withdraw(i.id))}>
                      Забрать
                    </Button>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      )}
      <Card withBorder>
        <Text fw={600} mb="xs">
          Кредиты
        </Text>
        {life.loans.length === 0 ? (
          <Text c="dimmed">Кредитов нет.</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Кредит</Table.Th>
                <Table.Th ta="right">Ставка</Table.Th>
                <Table.Th ta="right">Платёж</Table.Th>
                <Table.Th ta="right">Осталось</Table.Th>
                <Table.Th ta="right">Долг</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {life.loans.map((l) => (
                <Table.Tr key={l.id}>
                  <Table.Td>
                    {LOAN_LABEL[l.kind]}: {l.assetName}
                    {l.overdue > 0 && (
                      <Badge ml="xs" color="red" size="xs">
                        просрочек: {l.overdue}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{l.rate}%</Table.Td>
                  <Table.Td ta="right">{money(l.payment)}/мес</Table.Td>
                  <Table.Td ta="right">{l.monthsLeft} мес.</Table.Td>
                  <Table.Td ta="right">{money(l.balance)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="xs" variant="light" disabled={cash < l.balance} onClick={() => run(() => window.api.life.repayLoan(l.id))}>
                      Погасить
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Text size="xs" c="dimmed" mt="xs">
          Если на платёж не хватит денег три месяца подряд, банк изымет имущество и продаст его за 70% стоимости.
        </Text>
      </Card>
    </Stack>
  )
}

// ——— образование ———

function Education({ life, catalog, cash, run }: Ctx) {
  return (
    <Table striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Курс</Table.Th>
          <Table.Th>Что даёт</Table.Th>
          <Table.Th ta="right">Стоимость</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {catalog.education.map((c) => {
          const done = life.education.includes(c.id)
          const blocked = c.requires && !life.education.includes(c.requires)
          return (
            <Table.Tr key={c.id}>
              <Table.Td fw={500}>{c.name}</Table.Td>
              <Table.Td c="dimmed">{c.effect}</Table.Td>
              <Table.Td ta="right">{money(c.localPrice)}</Table.Td>
              <Table.Td ta="right">
                {done ? (
                  <Badge color="green">пройден</Badge>
                ) : (
                  <Button size="xs" disabled={!!blocked || cash < c.localPrice} onClick={() => run(() => window.api.life.enroll(c.id))}>
                    {blocked ? 'Сначала предыдущий' : 'Пройти'}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          )
        })}
      </Table.Tbody>
    </Table>
  )
}

// ——— коллекции ———

function Collect({ life, catalog, cash, run }: Ctx) {
  return (
    <Stack>
      <OwnedList assets={life.assets} kind="collectible" run={run} />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Предмет</Table.Th>
            <Table.Th ta="right">Цена</Table.Th>
            <Table.Th ta="right">Престиж</Table.Th>
            <Table.Th ta="right">Рост цены</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {catalog.collectibles.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td fw={500}>{c.name}</Table.Td>
              <Table.Td ta="right">{money(c.localPrice)}</Table.Td>
              <Table.Td ta="right">{c.prestige}</Table.Td>
              <Table.Td ta="right">{c.growth ? `~${Math.round(c.growth * 100)}% в год` : '—'}</Table.Td>
              <Table.Td ta="right">
                <Button size="xs" disabled={cash < c.localPrice} onClick={() => run(() => window.api.life.buyCollectible(c.id))}>
                  Купить
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  )
}
