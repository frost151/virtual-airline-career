import { useEffect, useState } from 'react'
import {
  Avatar,
  Badge,
  Box,
  Card,
  Center,
  FileButton,
  Group,
  Image,
  Loader,
  RingProgress,
  SimpleGrid,
  Stack,
  Text,
  Title,
  UnstyledButton
} from '@mantine/core'
import { useNavigate } from 'react-router-dom'
import type { PlayerAirline, Stake } from '@shared/airlines'
import type { Asset, LifeState } from '@shared/lifestyle'
import type { ProfileSummary, WikiImage } from '@shared/types'
import type { RankId } from '@shared/career'
import { countryName, formatNum } from '../format'
import { errMsg, placeLabel, usePilot, usePlaces } from '../lib'
import { AirlineLogo } from '../components/AirlineLogo'
import { bigMoney } from '../components/StakePanel'

const PHOTO_SIZE = 400

/** Погоны: число золотых полос и звёзд по званию. CEO — особые, с эмблемой. */
const EPAULETTE: Record<RankId, { stripes: number; stars: number }> = {
  trainee: { stripes: 1, stars: 0 },
  fo: { stripes: 3, stars: 0 },
  captain: { stripes: 4, stars: 0 },
  senior_captain: { stripes: 4, stars: 1 },
  instructor: { stripes: 4, stars: 2 }
}

const GOLD = '#d4af37'
const NAVY = '#14213d'

/** Один погон: тёмная планка с золотыми полосами, звёздами или эмблемой CEO. */
function Epaulette({ stripes, stars, ceo }: { stripes: number; stars: number; ceo?: boolean }) {
  const w = 54
  const h = 130
  const stripeH = 7
  const gap = 6
  const bottom = h - 14
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ceo ? 'Погон CEO' : `Погон: ${stripes} полосы`}>
      <defs>
        <linearGradient id="gold" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f3d77a" />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="1" stopColor="#a8841f" />
        </linearGradient>
      </defs>
      {/* Планка со скошенным верхом и пуговицей. */}
      <path d={`M4 26 L${w / 2} 4 L${w - 4} 26 L${w - 4} ${h - 4} L4 ${h - 4} Z`} fill={NAVY} stroke="#0a1224" strokeWidth="2" />
      <circle cx={w / 2} cy={20} r={5} fill="url(#gold)" />
      {Array.from({ length: stripes }, (_, i) => (
        <rect key={i} x={6} y={bottom - i * (stripeH + gap) - stripeH} width={w - 12} height={stripeH} fill="url(#gold)" rx={1} />
      ))}
      {Array.from({ length: stars }, (_, i) => (
        <text key={i} x={w / 2} y={44 + i * 18} textAnchor="middle" fontSize="16" fill="url(#gold)">
          ★
        </text>
      ))}
      {ceo && (
        <g>
          {/* Крылья с эмблемой. */}
          <path d={`M${w / 2} 44 C 34 38, 46 38, 50 44 C 44 44, 38 46, ${w / 2} 50 C 16 46, 10 44, 4 44 C 8 38, 20 38, ${w / 2} 44 Z`} fill="url(#gold)" />
          <text x={w / 2} y={66} textAnchor="middle" fontSize="11" fontWeight="700" fill="url(#gold)" letterSpacing="1">
            CEO
          </text>
        </g>
      )}
    </svg>
  )
}

/** Квадратная обрезка по центру: фото в кабинете круглое. */
function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      const side = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = Math.min(PHOTO_SIZE, side)
      canvas
        .getContext('2d')!
        .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(img.src)
      resolve(canvas.toDataURL('image/jpeg', 0.88))
    }
    img.onerror = () => reject(new Error('Не удалось прочитать картинку'))
    img.src = URL.createObjectURL(file)
  })
}

/** Личный кабинет: кто такой пилот, где живёт, на чём ездит, сколько стоит. */
export function PilotProfile({ profile }: { profile: ProfileSummary }) {
  const navigate = useNavigate()
  const [pilot] = usePilot()
  const [life, setLife] = useState<LifeState | null>(null)
  const [stakes, setStakes] = useState<Stake[]>([])
  const [companies, setCompanies] = useState<PlayerAirline[]>([])
  const [photo, setPhotoState] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.life.state().then(setLife)
    window.api.market.stakes().then(setStakes)
    window.api.owner.companies().then(setCompanies)
    window.api.profiles.photo().then(setPhotoState)
  }, [pilot])

  const home = life?.assets.find((a) => a.kind === 'home' && a.residence) ?? life?.assets.find((a) => a.kind === 'home')
  const places = usePlaces([pilot?.base, home?.airport])

  if (!pilot || !life || photo === undefined) return <Loader />

  const company = companies.find((c) => c.active)
  const ceo = !!company
  const stake = company ? stakes.find((s) => s.icao === company.icao) : undefined
  const ep = EPAULETTE[pilot.rank]
  const cars = life.assets.filter((a) => a.kind === 'car')
  const planes = life.assets.filter((a) => a.kind === 'aircraft')
  const assetsValue = life.assets.reduce((s, a) => s + a.value, 0)
  const invest = life.investments.reduce((s, i) => s + i.value, 0) + life.stakesValue
  const debt = life.loans.reduce((s, l) => s + l.balance, 0)
  const netWorth = pilot.cash + assetsValue + invest - debt

  const changePhoto = async (file: File | null) => {
    if (!file) return
    setError(null)
    try {
      const data = await readPhoto(file)
      await window.api.profiles.setPhoto(data)
      setPhotoState(data)
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <Stack>
      {/* Шапка: фото, имя, звание и погоны. */}
      <Card
        padding="xl"
        radius="md"
        style={{
          background: `linear-gradient(120deg, ${NAVY} 0%, #1d3b6e 55%, #2b5797 100%)`,
          color: 'white',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <Box
          style={{
            position: 'absolute',
            right: -60,
            top: -60,
            width: 260,
            height: 260,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(212,175,55,0.18), transparent 70%)'
          }}
        />
        <Group justify="space-between" align="center" wrap="nowrap" style={{ position: 'relative' }}>
          <Group gap="xl" wrap="nowrap">
            <FileButton accept="image/png,image/jpeg,image/webp" onChange={changePhoto}>
              {(props) => (
                <UnstyledButton {...props} title="Сменить фото">
                  <Avatar
                    src={photo}
                    size={128}
                    radius={128}
                    color="yellow"
                    style={{ border: `3px solid ${GOLD}`, boxShadow: '0 6px 24px rgba(0,0,0,0.35)' }}
                  >
                    <Text size="xs" ta="center" c="yellow.2">
                      Загрузить
                      <br />
                      фото
                    </Text>
                  </Avatar>
                </UnstyledButton>
              )}
            </FileButton>
            <Stack gap={6}>
              <Text size="xs" tt="uppercase" fw={600} style={{ letterSpacing: 2, color: GOLD }}>
                {ceo ? 'Генеральный директор и владелец' : pilot.rankName}
              </Text>
              <Title order={1} c="white">
                {profile.pilotName}
              </Title>
              {ceo ? (
                <Group gap="xs">
                  <AirlineLogo iata={company.iata} name={company.name} h={26} />
                  <Text c="gray.3">
                    {company.name} · доля {stake?.pct ?? 100}%
                  </Text>
                </Group>
              ) : pilot.employerName ? (
                <Group gap="xs">
                  {pilot.employerIata && <AirlineLogo iata={pilot.employerIata} name={pilot.employerName} h={26} />}
                  <Text c="gray.3">
                    {pilot.employerName} · база {placeLabel(places[pilot.base!], pilot.base!)}
                  </Text>
                </Group>
              ) : (
                <Text c="gray.4">Ищет работу</Text>
              )}
              {!photo && (
                <Text size="xs" c="gray.5">
                  Нажмите на круг, чтобы поставить своё фото
                </Text>
              )}
            </Stack>
          </Group>
          <Group gap={6} wrap="nowrap" visibleFrom="sm">
            <Epaulette stripes={ceo ? 4 : ep.stripes} stars={ceo ? 0 : ep.stars} ceo={ceo} />
            <Epaulette stripes={ceo ? 4 : ep.stripes} stars={ceo ? 0 : ep.stars} ceo={ceo} />
          </Group>
        </Group>
      </Card>

      {error && (
        <Text c="red" size="sm">
          {error}
        </Text>
      )}

      {/* Главные цифры. */}
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <BigStat label="Налёт" value={`${formatNum(Math.round(pilot.stats.hours))} ч`} />
        <BigStat label="Рейсов" value={formatNum(pilot.stats.flights)} />
        <BigStat label="Средняя оценка" value={pilot.stats.flights ? String(Math.round(pilot.stats.avgScore)) : '—'} />
        <BigStat label={ceo ? 'Престиж' : 'Репутация'} value={String(ceo ? life.prestige : Math.round(pilot.reputation))} />
        <BigStat label="Деньги" value={bigMoney(pilot.cash)} />
        <BigStat label="Чистый капитал" value={bigMoney(netWorth)} accent />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card withBorder radius="md">
          <CardTitle>Семья</CardTitle>
          <Group gap="lg" mt="xs">
            <Person label={profile.pilotName.split(/\s+/)[0]} sub="вы" />
            {life.family.partner && <Person label="Супруг(а)" sub="партнёр" />}
            {Array.from({ length: life.family.children }, (_, i) => (
              <Person key={i} label={`Ребёнок ${i + 1}`} sub="" small />
            ))}
          </Group>
          {!life.family.partner && !life.family.children && (
            <Text size="sm" c="dimmed" mt="xs">
              Пока один. Семью можно изменить в «Личной жизни».
            </Text>
          )}
        </Card>

        <Card withBorder radius="md">
          <CardTitle>Дом</CardTitle>
          {home ? (
            <Stack gap={4} mt="xs">
              <Text fw={600}>{home.name}</Text>
              <Text size="sm" c="dimmed">
                {home.airport ? placeLabel(places[home.airport], home.airport) : countryName(home.country)} ·{' '}
                {home.ownership === 'own' ? 'в собственности' : 'аренда'}
              </Text>
              {home.ownership === 'own' && <Text size="sm">Стоит {bigMoney(home.value)}</Text>}
            </Stack>
          ) : (
            <Empty text="Жилья нет" action="Подобрать" onClick={() => navigate('/life')} />
          )}
        </Card>

        <Card withBorder radius="md">
          <CardTitle>Самочувствие</CardTitle>
          <Group justify="space-around" mt="xs">
            <Ring label="Усталость" value={life.fatigue} invert />
            <Ring label="Здоровье" value={life.health} />
            <Ring label="Настроение" value={life.satisfaction} />
          </Group>
          <Text size="xs" c="dimmed" ta="center" mt={4}>
            Медкомиссия до {new Date(life.medicalUntil).toLocaleDateString('ru-RU')}
          </Text>
        </Card>
      </SimpleGrid>

      <Card withBorder radius="md">
        <Group justify="space-between">
          <CardTitle>Гараж</CardTitle>
          <Text size="sm" c="dimmed">
            {cars.length ? `${cars.length} ${plural(cars.length, 'машина', 'машины', 'машин')}` : ''}
          </Text>
        </Group>
        {cars.length ? (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mt="sm">
            {cars.map((c) => (
              <CarTile key={c.id} car={c} />
            ))}
          </SimpleGrid>
        ) : (
          <Empty text="Машины пока нет" action="В автосалон" onClick={() => navigate('/life')} />
        )}
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder radius="md">
          <CardTitle>Допуски</CardTitle>
          {pilot.ratings.length ? (
            <Group gap="xs" mt="xs">
              {pilot.ratings.map((r) => (
                <Badge key={r.id} size="lg" variant="light">
                  {r.name}
                </Badge>
              ))}
            </Group>
          ) : (
            <Text size="sm" c="dimmed" mt="xs">
              Допусков пока нет
            </Text>
          )}
          {planes.length > 0 && (
            <>
              <Text size="sm" fw={600} mt="md">
                Свои самолёты
              </Text>
              {planes.map((p) => (
                <Text key={p.id} size="sm">
                  {p.name} {p.ownership === 'rent' ? '(аренда)' : ''}
                </Text>
              ))}
            </>
          )}
        </Card>

        <Card withBorder radius="md">
          <CardTitle>Доли в авиакомпаниях</CardTitle>
          {stakes.length ? (
            <Stack gap="xs" mt="xs">
              {stakes.map((s) => (
                <Group key={s.icao} justify="space-between">
                  <Group gap="xs">
                    <Text fw={500}>{s.name}</Text>
                    {s.founded ? (
                      <Badge size="sm" color="yellow">
                        основатель
                      </Badge>
                    ) : s.control ? (
                      <Badge size="sm" color="green">
                        контроль
                      </Badge>
                    ) : null}
                  </Group>
                  <Text className="mono">
                    {s.pct}% · {bigMoney(s.value)}
                  </Text>
                </Group>
              ))}
            </Stack>
          ) : (
            <Empty text="Долей нет" action="На рынок" onClick={() => navigate('/market')} />
          )}
        </Card>
      </SimpleGrid>
    </Stack>
  )
}

const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: 1.5 }}>
      {children}
    </Text>
  )
}

function BigStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card withBorder radius="md" padding="md" style={accent ? { borderColor: GOLD } : undefined}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xl" fw={700} className="mono" c={accent ? 'yellow.7' : undefined}>
        {value}
      </Text>
    </Card>
  )
}

function Person({ label, sub, small }: { label: string; sub: string; small?: boolean }) {
  const initials = label
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
  return (
    <Stack gap={2} align="center">
      <Avatar size={small ? 40 : 52} radius="xl" color={small ? 'teal' : 'blue'}>
        {initials}
      </Avatar>
      <Text size="xs" ta="center" maw={80} lineClamp={1}>
        {label}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Stack>
  )
}

function Ring({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? 100 - value : value
  const color = good >= 60 ? 'teal' : good >= 35 ? 'yellow' : 'red'
  return (
    <Stack gap={0} align="center">
      <RingProgress
        size={84}
        thickness={8}
        roundCaps
        sections={[{ value, color }]}
        label={
          <Text ta="center" fw={700} size="sm">
            {value}
          </Text>
        }
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Stack>
  )
}

function Empty({ text, action, onClick }: { text: string; action: string; onClick(): void }) {
  return (
    <Group justify="space-between" mt="xs">
      <Text size="sm" c="dimmed">
        {text}
      </Text>
      <Text size="sm" c="blue" style={{ cursor: 'pointer' }} onClick={onClick}>
        {action} →
      </Text>
    </Group>
  )
}

/** Машина с фото из Википедии. */
function CarTile({ car }: { car: Asset }) {
  const [img, setImg] = useState<WikiImage | null | undefined>(undefined)
  useEffect(() => {
    window.api.life
      .carImage(car.itemId)
      .then(setImg)
      .catch(() => setImg(null))
  }, [car.itemId])
  return (
    <Card withBorder radius="md" padding={0} style={{ overflow: 'hidden' }}>
      <Box h={130} bg="dark.6">
        {img === undefined ? (
          <Center h="100%">
            <Loader size="sm" />
          </Center>
        ) : img ? (
          <Image src={img.image} alt={car.name} h={130} fit="cover" />
        ) : (
          <Center h="100%">
            <Text size="xs" c="dimmed">
              Фото недоступно
            </Text>
          </Center>
        )}
      </Box>
      <Stack gap={0} p="sm">
        <Text fw={600} size="sm" lineClamp={1}>
          {car.name}
        </Text>
        <Text size="xs" c="dimmed">
          стоит {bigMoney(car.value)}
        </Text>
      </Stack>
    </Card>
  )
}
