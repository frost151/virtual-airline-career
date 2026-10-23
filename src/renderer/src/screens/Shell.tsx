import { useEffect, useState } from 'react'
import { AppShell, Badge, Button, Group, NavLink, Stack, Text, Title } from '@mantine/core'
import { NavLink as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { ProfileSummary } from '@shared/types'
import { MODE_LABEL, formatUtc } from '../format'
import { PHASE_LABEL } from '@shared/sim'
import { useSimStatus, useTrackerState } from '../hooks'
import { useCareerVersion } from '../lib'
import { WorldAirlines } from './WorldAirlines'
import { ActiveFlight } from './ActiveFlight'
import { Logbook } from './Logbook'
import { Home } from './Home'
import { Dispatch } from './Dispatch'
import { Career } from './Career'
import { SettingsScreen } from './SettingsScreen'
import { Economy } from './Economy'
import { Life } from './Life'
import { CatchUpModal } from '../components/CatchUpModal'

/** Разделы, у которых уже есть настоящий экран. */
const READY = ['home', 'dispatch', 'market', 'flight', 'logbook', 'career', 'settings', 'economy', 'life']

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
  { path: 'dispatch', label: 'Диспетчерская', stage: 3 },
  { path: 'flight', label: 'Активный полёт', stage: 2 },
  { path: 'logbook', label: 'Бортжурнал', stage: 2 },
  { path: 'career', label: 'Карьера', stage: 3, pilotOnly: true },
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
  const sections = SECTIONS.filter((s) => (!s.ownerOnly || profile.mode === 'owner') && (!s.pilotOnly || profile.mode === 'pilot'))

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
            <CheatBadge />
            <SimBadge />
            <UtcClock />
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
        <Routes>
          <Route path="/home" element={<Home profile={profile} />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/career" element={<Career />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/market" element={<WorldAirlines />} />
          <Route path="/economy" element={<Economy />} />
          <Route path="/life" element={<Life />} />
          <Route path="/flight" element={<ActiveFlight />} />
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

function UtcClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <Text className="mono">{now.toISOString().slice(11, 19)} UTC</Text>
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
