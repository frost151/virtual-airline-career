import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileButton,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title
} from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type {
  AirlineDetailEconomy,
  DestinationOption,
  FoundAirlineInput,
  FoundQuote,
  FoundTypeOption,
  PlayerAirline,
  Stake
} from '@shared/airlines'
import type { AirlineArchetype } from '@shared/world'
import { ARCHETYPE_LABEL, formatNum } from '../format'
import { errMsg, notifyCareerChanged, placeLabel, usePilot, usePlaces } from '../lib'
import { AirlineLogo, setCustomLogos } from '../components/AirlineLogo'
import { Stat } from '../components/FlightParts'
import { bigMoney } from '../components/StakePanel'

const MAX_DESTINATIONS = 3
const LOGO_W = 240
const LOGO_H = 80

const CATEGORY_LABEL: Record<string, string> = {
  turboprop: 'турбовинтовой',
  regional: 'региональный',
  narrowbody: 'узкофюзеляжный',
  widebody: 'широкофюзеляжный',
  freighter: 'грузовой'
}

/** Обновить логотипы компаний игрока в общем реестре. */
export async function refreshCustomLogos(): Promise<void> {
  const list = await window.api.owner.companies().catch(() => [])
  setCustomLogos(list)
}

/** Раздел «Моя компания»: основание своей авиакомпании или сводка по ней. */
export function Company() {
  const [companies, setCompanies] = useState<PlayerAirline[] | null>(null)
  const [stakes, setStakes] = useState<Stake[]>([])
  const load = () => {
    window.api.owner.companies().then(setCompanies)
    window.api.market.stakes().then(setStakes)
  }
  useEffect(load, [])
  useEffect(() => window.api.world.onChanged(load), [])

  if (!companies) return <Loader />
  const own = companies[0]
  return (
    <Stack>
      <Title order={3}>Моя компания</Title>
      {own ? (
        <Overview company={own} stake={stakes.find((s) => s.icao === own.icao) ?? null} />
      ) : (
        <FoundForm
          onFounded={() => {
            void refreshCustomLogos()
            notifyCareerChanged()
            load()
          }}
        />
      )}
    </Stack>
  )
}

// ——— сводка ———

function Overview({ company, stake }: { company: PlayerAirline; stake: Stake | null }) {
  const navigate = useNavigate()
  const [eco, setEco] = useState<AirlineDetailEconomy | null>(null)
  useEffect(() => {
    window.api.market.detail(company.icao).then(setEco)
    return window.api.world.onChanged(() => window.api.market.detail(company.icao).then(setEco))
  }, [company.icao])
  const places = usePlaces([company.hub, ...(eco?.routes.map((r) => r.dest) ?? [])])

  if (!eco) return <Loader />
  const r = eco.row
  const f = r.last
  return (
    <Stack>
      <Card withBorder padding="lg">
        <Group justify="space-between">
          <Group>
            <AirlineLogo iata={company.iata} name={company.name} h={48} />
            <Stack gap={0}>
              <Title order={4}>{company.name}</Title>
              <Text c="dimmed" size="sm">
                {company.iata} / {company.icao} · позывной {company.callsign} · {ARCHETYPE_LABEL[company.archetype]} · база{' '}
                {placeLabel(places[company.hub], company.hub)}
              </Text>
            </Stack>
          </Group>
          <Stack gap={4} align="flex-end">
            <Badge size="lg" color="green">
              CEO · {stake?.pct ?? 100}%
            </Badge>
            <Text size="xs" c="dimmed">
              основана {new Date(company.foundedAt).toLocaleDateString('ru-RU')}
            </Text>
          </Stack>
        </Group>
      </Card>

      <Group>
        <Button variant="light" onClick={() => navigate('/fleet')}>
          Флот
        </Button>
        <Button variant="light" onClick={() => navigate('/routes')}>
          Маршруты и тарифы
        </Button>
        <Button variant="light" onClick={() => navigate('/finance')}>
          Финансы
        </Button>
      </Group>

      <Card withBorder>
        <SimpleGrid cols={4}>
          <Stat label="Деньги компании" value={bigMoney(r.cash)} />
          <Stat label="Долг" value={bigMoney(r.debt)} />
          <Stat label="Флот / маршрутов" value={`${r.fleetSize} / ${r.routes}`} />
          <Stat label="Репутация" value={String(r.reputation)} />
          {f ? (
            <>
              <Stat label="Выручка за месяц" value={bigMoney(f.revenue)} />
              <Stat label="Прибыль" value={bigMoney(f.profit)} color={f.profit >= 0 ? 'green' : 'red'} />
              <Stat label="Пассажиров" value={formatNum(f.pax)} />
              <Stat label="Загрузка" value={`${Math.round(f.lf * 100)}%`} />
            </>
          ) : null}
        </SimpleGrid>
        {!f && (
          <Text size="sm" c="dimmed" mt="sm">
            Первые итоги — 1-го числа следующего месяца.
          </Text>
        )}
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Маршруты
        </Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Направление</Table.Th>
              <Table.Th ta="right">Рейсов/день</Table.Th>
              <Table.Th ta="right">Загрузка</Table.Th>
              <Table.Th ta="right">Средний тариф</Table.Th>
              <Table.Th ta="right">Прибыль/мес</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {eco.routes.map((rt) => (
              <Table.Tr key={`${rt.hub}-${rt.dest}`}>
                <Table.Td>
                  {placeLabel(places[rt.hub], rt.hub)} — {placeLabel(places[rt.dest], rt.dest)}
                </Table.Td>
                <Table.Td ta="right">{rt.freq}</Table.Td>
                <Table.Td ta="right">{f ? `${Math.round(rt.lf * 100)}%` : '—'}</Table.Td>
                <Table.Td ta="right">{rt.fare ? bigMoney(rt.fare) : '—'}</Table.Td>
                <Table.Td ta="right" c={rt.profit >= 0 ? 'green' : 'red'}>
                  {f ? bigMoney(rt.profit) : '—'}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}

// ——— основание ———

/** Уменьшает картинку до размера логотипа, чтобы не хранить в профиле мегабайты. */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, LOGO_W / img.width, LOGO_H / img.height)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * k))
      canvas.height = Math.max(1, Math.round(img.height * k))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Не удалось прочитать картинку'))
    img.src = URL.createObjectURL(file)
  })
}

function FoundForm({ onFounded }: { onFounded(): void }) {
  const navigate = useNavigate()
  const [pilot] = usePilot()
  const [hubs, setHubs] = useState<{ value: string; label: string }[]>([])
  const [types, setTypes] = useState<FoundTypeOption[]>([])
  const [dests, setDests] = useState<DestinationOption[]>([])
  const [quote, setQuote] = useState<FoundQuote | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState<FoundAirlineInput>({
    name: '',
    icao: '',
    iata: '',
    callsign: '',
    archetype: 'regional',
    hub: '',
    typeId: '',
    destinations: [],
    contribution: 0,
    loan: 0,
    guaranteed: false,
    logo: null
  })
  const set = (patch: Partial<FoundAirlineInput>) => setInput((v) => ({ ...v, ...patch }))

  useEffect(() => {
    window.api.owner.hubOptions().then(setHubs)
  }, [])
  // Вклад по умолчанию — все деньги игрока.
  useEffect(() => {
    if (pilot && !input.contribution) set({ contribution: Math.floor(pilot.cash) })
  }, [pilot])
  useEffect(() => {
    window.api.owner.typeOptions(input.archetype).then((list) => {
      setTypes(list)
      if (!list.some((t) => t.id === input.typeId)) set({ typeId: list[0]?.id ?? '', destinations: [] })
    })
  }, [input.archetype])
  useEffect(() => {
    if (!input.hub || !input.typeId) return setDests([])
    window.api.owner.destinations(input.hub, input.typeId).then((list) => {
      setDests(list)
      set({
        destinations: input.destinations.filter((d) => list.some((x) => x.icao === d))
      })
    })
  }, [input.hub, input.typeId])
  useEffect(() => {
    const id = setTimeout(() => window.api.owner.quote(input).then(setQuote), 200)
    return () => clearTimeout(id)
  }, [input])

  const type = useMemo(() => types.find((t) => t.id === input.typeId), [types, input.typeId])

  const toggleDest = (icao: string) =>
    set({
      destinations: input.destinations.includes(icao)
        ? input.destinations.filter((d) => d !== icao)
        : input.destinations.length < MAX_DESTINATIONS
          ? [...input.destinations, icao]
          : input.destinations
    })

  const submit = async () => {
    setError(null)
    setBusy(true)
    try {
      await window.api.owner.found(input)
      onFounded()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack>
      <Text c="dimmed">
        Основайте свою авиакомпанию или купите долю в существующей на{' '}
        <Text span c="blue" style={{ cursor: 'pointer' }} onClick={() => navigate('/market')}>
          «Рынке»
        </Text>
        . Основав компанию, вы уйдёте от работодателя и станете её генеральным директором.
      </Text>

      <Card withBorder>
        <Text fw={600} mb="sm">
          1. Компания
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <TextInput
            label="Название"
            placeholder="Например, Neva Air"
            value={input.name}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
          <TextInput
            label="Позывной"
            placeholder="NEVA"
            value={input.callsign}
            onChange={(e) => set({ callsign: e.currentTarget.value.toUpperCase() })}
          />
          <TextInput
            label="Код ICAO"
            description="Три латинские буквы"
            maxLength={3}
            value={input.icao}
            onChange={(e) =>
              set({
                icao: e.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, '')
              })
            }
          />
          <TextInput
            label="Код IATA"
            description="Две латинские буквы или буква и цифра"
            maxLength={2}
            value={input.iata}
            onChange={(e) =>
              set({
                iata: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '')
              })
            }
          />
        </SimpleGrid>
        <Select
          mt="sm"
          label="Тип компании"
          data={(Object.keys(ARCHETYPE_LABEL) as AirlineArchetype[]).map((k) => ({ value: k, label: ARCHETYPE_LABEL[k] }))}
          value={input.archetype}
          onChange={(v) => v && set({ archetype: v as AirlineArchetype })}
          allowDeselect={false}
        />
        <Group mt="sm">
          <AirlineLogo iata={null} name={input.name || '?'} h={40} />
          {input.logo && (
            <img
              src={input.logo}
              alt="Логотип"
              style={{
                maxHeight: 40,
                background: 'white',
                borderRadius: 4,
                padding: 2
              }}
            />
          )}
          <FileButton
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            onChange={(file) =>
              file &&
              readLogo(file)
                .then((logo) => set({ logo }))
                .catch((e) => setError(errMsg(e)))
            }
          >
            {(props) => (
              <Button variant="light" size="xs" {...props}>
                {input.logo ? 'Заменить логотип' : 'Загрузить логотип'}
              </Button>
            )}
          </FileButton>
          {input.logo && (
            <Button variant="subtle" size="xs" onClick={() => set({ logo: null })}>
              Убрать
            </Button>
          )}
          <Text size="xs" c="dimmed">
            Без картинки будет значок с буквами названия.
          </Text>
        </Group>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="sm">
          2. База и самолёт
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Select
            label="Базовый аэропорт"
            placeholder="Город, аэропорт или код"
            searchable
            limit={40}
            data={hubs}
            value={input.hub || null}
            onChange={(v) => set({ hub: v ?? '', destinations: [] })}
            nothingFoundMessage="Не найдено"
          />
          <Select
            label="Первый самолёт (в лизинг)"
            data={types.map((t) => ({
              value: t.id,
              label: `${t.name} — ${bigMoney(t.monthlyLease)}/мес`
            }))}
            value={input.typeId || null}
            onChange={(v) => v && set({ typeId: v })}
            allowDeselect={false}
          />
        </SimpleGrid>
        {type && (
          <Text size="sm" c="dimmed" mt="xs">
            {CATEGORY_LABEL[type.category] ?? type.category} ·{' '}
            {type.seats ? `${type.seats} кресел` : `${formatNum(type.cargoKg / 1000)} т груза`} · дальность{' '}
            {formatNum(type.rangeKm)} км
          </Text>
        )}
      </Card>

      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>3. Первые направления</Text>
          <Text size="sm" c="dimmed">
            выбрано {input.destinations.length} из {MAX_DESTINATIONS}
          </Text>
        </Group>
        {!input.hub ? (
          <Text size="sm" c="dimmed">
            Сначала выберите базу.
          </Text>
        ) : (
          <>
            <Text size="sm" c="dimmed" mb="xs">
              Самые востребованные сверху. Частоты рассчитаются так, чтобы самолёт был занят весь день.
            </Text>
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th />
                  <Table.Th>Направление</Table.Th>
                  <Table.Th ta="right">Расстояние</Table.Th>
                  <Table.Th ta="right">Спрос, пасс./сут</Table.Th>
                  <Table.Th ta="right">Конкурентов</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {dests.slice(0, 30).map((d) => (
                  <Table.Tr key={d.icao} style={{ cursor: 'pointer' }} onClick={() => toggleDest(d.icao)}>
                    <Table.Td>
                      <Checkbox checked={input.destinations.includes(d.icao)} onChange={() => toggleDest(d.icao)} />
                    </Table.Td>
                    <Table.Td>{d.label}</Table.Td>
                    <Table.Td ta="right">{formatNum(d.km)} км</Table.Td>
                    <Table.Td ta="right">{formatNum(d.demand)}</Table.Td>
                    <Table.Td ta="right">{d.competitors || '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Card>

      <Card withBorder>
        <Text fw={600} mb="sm">
          4. Деньги
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <NumberInput
            label="Свои деньги"
            description={pilot ? `У вас ${bigMoney(pilot.cash)}` : undefined}
            min={0}
            max={pilot ? Math.floor(pilot.cash) : undefined}
            step={100_000}
            thousandSeparator=" "
            prefix="$"
            value={input.contribution}
            onChange={(v) => set({ contribution: Number(v) || 0 })}
          />
          <NumberInput
            label="Кредит банка"
            description={quote ? `Не больше ${bigMoney(quote.maxLoan)} (×3 к своим деньгам)` : undefined}
            min={0}
            step={100_000}
            thousandSeparator=" "
            prefix="$"
            value={input.loan}
            onChange={(v) => set({ loan: Number(v) || 0 })}
          />
        </SimpleGrid>
        <Checkbox
          mt="sm"
          checked={input.guaranteed}
          onChange={(e) => set({ guaranteed: e.currentTarget.checked })}
          label="Личное поручительство по кредиту"
          description="Ставка ниже, но если компания обанкротится, долг перейдёт на вас лично."
        />
        {quote && (
          <Table mt="sm">
            <Table.Tbody>
              <Row label="Сертификат эксплуатанта, регистрация, офис" value={-quote.setupFee} />
              <Row label="Залог за лизинг (3 месяца)" value={-quote.deposit} />
              <Row label="Лизинг самолёта в месяц" value={-quote.monthlyLease} />
              <Row label="Ставка по кредиту" text={`${quote.loanRatePct.toFixed(1)}% в месяц`} />
              <Row label="На счёте компании в первый день" value={quote.cashAfter} bold />
              <Row label="Нужный минимум на счёте" value={quote.reserve} />
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {error && <Alert color="red">{error}</Alert>}
      {quote && quote.errors.length > 0 && (
        <Alert color="yellow" title="Чтобы основать компанию">
          <Stack gap={2}>
            {quote.errors.map((e) => (
              <Text key={e} size="sm">
                • {e}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
      <Group justify="flex-end">
        <Button size="md" disabled={!quote || quote.errors.length > 0} loading={busy} onClick={submit}>
          Основать авиакомпанию
        </Button>
      </Group>
    </Stack>
  )
}

function Row({ label, value, text, bold }: { label: string; value?: number; text?: string; bold?: boolean }) {
  return (
    <Table.Tr>
      <Table.Td fw={bold ? 700 : undefined}>{label}</Table.Td>
      <Table.Td ta="right" fw={bold ? 700 : undefined} c={value !== undefined && value < 0 ? 'red' : undefined} className="mono">
        {text ?? bigMoney(value ?? 0)}
      </Table.Td>
    </Table.Tr>
  )
}
