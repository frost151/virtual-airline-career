import { useEffect, useState } from 'react'
import { AppShell, Badge, Button, Group, NavLink, Popover, SimpleGrid, Stack, Text, Title } from '@mantine/core'
import type { SkipPreset } from '@shared/economy'
import { NavLink as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ProfileSummary } from '@shared/types'
import { MODE_LABEL, formatUtc } from '../format'
import { PHASE_LABEL } from '@shared/sim'
import { useSimStatus, useTrackerState, useWorldNow } from '../hooks'
import { errMsg, notifyCareerChanged, useCareerVersion } from '../lib'
import { WorldAirlines } from './WorldAirlines'
import { ActiveFlight } from './ActiveFlight'
import { SimCheck } from './SimCheck'
import { Company, refreshCustomLogos } from './Company'
import { Fleet } from './Fleet'
import { PilotProfile } from './PilotProfile'
import { RoutesScreen } from './RoutesScreen'
import { Finance } from './Finance'
import { Staff } from './Staff'
import { Logbook } from './Logbook'
import { Home } from './Home'
import { MapScreen } from './MapScreen'
import { Dispatch } from './Dispatch'
import { Career } from './Career'
import { SettingsScreen } from './SettingsScreen'
import { Economy } from './Economy'
import { Life } from './Life'
import { CatchUpModal } from '../components/CatchUpModal'
import { UpdateBadge } from '../components/Update'
import { SpeedWatch } from '../components/SpeedWatch'

/** Разделы, у которых уже есть настоящий экран. */
const READY = ['home', 'map', 'profile', 'dispatch', 'market', 'flight', 'logbook', 'career', 'company', 'fleet', 'routes', 'finance', 'staff', 'settings', 'economy', 'life']

interface Section {
  path: string
  label: string
  /** Этап плана, на котором раздел оживёт. */
  stage: number
  ownerOnly?: boolean
  pilotOnly?: boolean
}

const SECTIONS: Section[] = [
  { path: 'home', label: 'Главная', stage: 3 },
  { path: 'map', label: 'Карта', stage: 8 },
  { path: 'profile', label: 'Личный кабинет', stage: 7 },
  { path: 'dispatch', label: 'Диспетчерская', stage: 3 },
  { path: 'flight', label: 'Активный полёт', stage: 2 },
  { path: 'logbook', label: 'Бортжурнал', stage: 2 },
  { path: 'career', label: 'Карьера', stage: 3 },
  { path: 'company', label: 'Моя компания', stage: 7 },
  { path: 'life', label: 'Личная жизнь', stage: 5 },
  { path: 'fleet', label: 'Флот', stage: 7, ownerOnly: true },
  { path: 'routes', label: 'Маршруты', stage: 7, ownerOnly: true },
  { path: 'economy', label: 'Экономика', stage: 4 },
  { path: 'finance', label: 'Финансы', stage: 7, ownerOnly: true },
  { path: 'market', label: 'Рынок', stage: 5 },
  { path: 'staff', label: 'Персонал', stage: 7, ownerOnly: true },
  { path: 'settings', label: 'Настройки', stage: 3 }
]

interface Props {
  profile: ProfileSummary
  onExit(): void
}

export function Shell({ profile, onExit }: Props) {
  const location = useLocation()
  const tracker = useTrackerState()
  useEffect(() => void refreshCustomLogos(), [profile.id])
  // Разделы владельца видны, когда у игрока есть контроль над компанией (своя или 51% в чужой).
  const version = useCareerVersion()
  const [controls, setControls] = useState(false)
  useEffect(() => {
    const load = () => window.api.market.stakes().then((list) => setControls(list.some((s) => s.control)))
    void load()
    return window.api.world.onChanged(load)
  }, [version])
  const sections = SECTIONS.filter((s) => (!s.ownerOnly || controls) && (!s.pilotOnly || profile.mode === 'pilot'))

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 0 }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Text fw={700}>{profile.name}</Text>
            <Badge variant="light">{MODE_LABEL[profile.mode]}</Badge>
            <Text size="sm" c="dimmed">
              {profile.pilotName}
            </Text>
          </Group>
          <Group gap="md">
            <UpdateBadge />
            <CheatBadge />
            <SimBadge />
            <WorldClock />
            <TimeSkip flying={!!tracker?.active} />
            <Button size="xs" variant="subtle" onClick={onExit}>
              Сменить профиль
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {sections.map((s) => (
          <NavLink
            key={s.path}
            component={RouterLink}
            to={`/${s.path}`}
            label={s.label}
            active={location.pathname === `/${s.path}`}
            rightSection={
              s.path === 'flight' && tracker?.active ? (
                <Badge size="xs" color="green" variant="dot">
                  {PHASE_LABEL[tracker.phase]}
                </Badge>
              ) : undefined
            }
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <CatchUpModal />
        <SpeedWatch />
        <Routes>
          <Route path="/home" element={<Home profile={profile} />} />
          <Route path="/map" element={<MapScreen />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/career" element={<Career />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/market" element={<WorldAirlines />} />
          <Route path="/economy" element={<Economy />} />
          <Route path="/life" element={<Life />} />
          <Route path="/flight" element={<ActiveFlight />} />
          <Route path="/sim-check" element={<SimCheck />} />
          <Route path="/company" element={<Company />} />
          <Route path="/profile" element={<PilotProfile profile={profile} />} />
          <Route path="/fleet" element={<Fleet />} />
          <Route path="/routes" element={<RoutesScreen />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/logbook" element={<Logbook />} />
          {sections
            .filter((s) => !READY.includes(s.path))
            .map((s) => (
              <Route key={s.path} path={`/${s.path}`} element={<Placeholder section={s} profile={profile} />} />
            ))}
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  )
}

const SIM_BADGE = {
  connected: { color: 'green', label: 'MSFS 2024: подключён' },
  connecting: { color: 'yellow', label: 'MSFS 2024: подключение…' },
  disconnected: { color: 'gray', label: 'MSFS 2024: не подключён' }
} as const

/** Метка «ЧИТ», пока включён режим читера. */
function CheatBadge() {
  const version = useCareerVersion()
  const [on, setOn] = useState(false)
  useEffect(() => {
    window.api.settings.get().then((s) => setOn(s.cheatMode)).catch(() => setOn(false))
  }, [version])
  return on ? (
    <Badge color="red" variant="filled">
      ЧИТ
    </Badge>
  ) : null
}

function SimBadge() {
  const b = SIM_BADGE[useSimStatus()]
  return (
    <Badge color={b.color} variant="dot">
      {b.label}
    </Badge>
  )
}

/** Часы мира: с перемоткой они уходят вперёд от реальных, поэтому показываем и дату. */
function WorldClock() {
  const now = useWorldNow()
  const date = new Date(now).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return (
    <Text className="mono" title="Время мира">
      {date} · {new Date(now).toISOString().slice(11, 19)} UTC
    </Text>
  )
}

const SKIPS: [SkipPreset, string][] = [
  ['3h', '+3 часа'],
  ['1d', '+1 сутки'],
  ['1w', '+1 неделя'],
  ['month', 'До 1-го числа']
]

/** Перемотка времени мира: отдых, ожидание, итоги месяца — без реального ожидания. */
function TimeSkip({ flying }: { flying: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const skip = async (preset: SkipPreset) => {
    setError(null)
    setBusy(true)
    try {
      await window.api.world.skip(preset)
      notifyCareerChanged()
      setOpen(false)
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow>
      <Popover.Target>
        <Button
          size="xs"
          variant="light"
          disabled={flying}
          title={flying ? 'Во время полёта время не перематывается' : undefined}
          onClick={() => setOpen((v) => !v)}
        >
          Перемотать время
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs" maw={280}>
          <Text size="sm">
            Мир пойдёт вперёд сразу: пилот отдохнёт, придут зарплаты и счета, компании подведут итоги.
          </Text>
          <SimpleGrid cols={2} spacing="xs">
            {SKIPS.map(([preset, label]) => (
              <Button key={preset} size="xs" variant="light" loading={busy} onClick={() => skip(preset)}>
                {label}
              </Button>
            ))}
          </SimpleGrid>
          {error && (
            <Text size="xs" c="red">
              {error}
            </Text>
          )}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}

function Placeholder({ section, profile }: { section: Section; profile: ProfileSummary }) {
  return (
    <Stack>
      <Title order={3}>{section.label}</Title>
      <Text c="dimmed">Раздел появится на этапе {section.stage}.</Text>
      {section.path === 'home' && <Text size="sm">Мир запущен: {formatUtc(profile.worldStartUtc)}</Text>}
    </Stack>
  )
}
