import { useEffect, useRef, useState } from 'react'
import { Alert, Badge, Button, Card, Collapse, Group, SimpleGrid, Stack, Table, Text, Textarea, Title } from '@mantine/core'
import type { SimDiagnostics } from '@shared/sim'

const POLL_MS = 500
const PROBES_KEY = 'vac.simProbes'

const LIGHTS: [label: string, standard: string][] = [
  ['Маяк', 'LIGHT BEACON'],
  ['Стробы', 'LIGHT STROBE'],
  ['Посадочные', 'LIGHT LANDING'],
  ['Навигационные', 'LIGHT NAV'],
  ['Рулёжные', 'LIGHT TAXI']
]

const LIGHT_VARS = new Set(LIGHTS.map(([, name]) => name))

type Verdict = 'ok' | 'fail' | null

interface PitchCheck {
  verdict: Verdict
  raw: number
}

/** Запоминаем первое однозначное наблюдение тангажа в наборе высоты. */
function observePitch(d: SimDiagnostics, prev: PitchCheck | null): PitchCheck | null {
  if (prev) return prev
  const v = d.vars
  const climbing = v['SIM ON GROUND'] === 0 && v['AIRSPEED INDICATED'] > 80 && v['VERTICAL SPEED'] > 500
  const raw = v['PLANE PITCH DEGREES']
  if (!climbing || raw === undefined || Math.abs(raw) < 3) return null
  // Программа считает, что в MSFS положительный тангаж — нос вниз; в наборе сырое значение должно быть отрицательным.
  return { verdict: raw < 0 ? 'ok' : 'fail', raw }
}

function pauseVerdict(d: SimDiagnostics): Verdict {
  const on = d.pauseEvents.some((e) => e.data !== 0)
  const off = d.pauseEvents.some((e) => e.data === 0)
  return on && off ? 'ok' : null
}

/** Касание сверяем с вертикальной скоростью: TOUCHDOWN в ft/s, ×60 должно быть близко к fpm. */
function touchdownVerdict(t: SimDiagnostics['touchdowns'][number]): Verdict {
  const fromSim = Math.abs(t.touchdownRaw) * 60
  const vs = Math.abs(t.vsFpm)
  if (fromSim === 0 || vs < 20) return null
  const ratio = fromSim / vs
  return ratio > 0.5 && ratio < 2 ? 'ok' : 'fail'
}

function VerdictBadge({ v }: { v: Verdict }) {
  if (v === 'ok') return <Badge color="green">Сходится</Badge>
  if (v === 'fail') return <Badge color="red">Не сходится</Badge>
  return (
    <Badge color="gray" variant="outline">
      Ждём
    </Badge>
  )
}

/** Время UTC с секундами: события паузы идут чаще раза в минуту. */
const clock = (t: number) => new Date(t).toISOString().slice(11, 19)

const fmt = (v: number | undefined, digits = 2) => (v === undefined ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(digits))

function loadProbes(): string {
  try {
    return localStorage.getItem(PROBES_KEY) ?? ''
  } catch {
    return ''
  }
}

/** Экран для проверки трекера на реальном MSFS 2024: сырые переменные, знаки, пауза, касание, свет аддонов. */
export function SimCheck() {
  const [d, setD] = useState<SimDiagnostics | null>(null)
  const [pitch, setPitch] = useState<PitchCheck | null>(null)
  const [probesText, setProbesText] = useState(loadProbes)
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const pitchRef = useRef<PitchCheck | null>(null)
  /** Какие значения принимали переменные света и L-переменные: так видно и «выкл», и «вкл» за один проход. */
  const seenRef = useRef<Record<string, number[]>>({})

  useEffect(() => {
    const probes = probesText.split('\n')
    void window.api.sim.setProbes(probes)
    // Пробы задаём один раз при открытии, дальше по кнопке «Применить».
  }, [])

  useEffect(() => {
    const tick = () =>
      window.api.sim.diagnostics().then((next) => {
        setD(next)
        const seen = seenRef.current
        for (const [name, val] of Object.entries(next.vars)) {
          if (!LIGHT_VARS.has(name) && !name.startsWith('L:')) continue
          const list = (seen[name] ??= [])
          if (!list.includes(val)) list.push(val)
        }
        const p = observePitch(next, pitchRef.current)
        if (p !== pitchRef.current) {
          pitchRef.current = p
          setPitch(p)
        }
      })
    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => clearInterval(id)
  }, [])

  if (!d) return null
  const v = d.vars
  const profileLvars = d.aircraft?.profileId ? Object.keys(v).filter((k) => k.startsWith('L:') && !d.probes.includes(k)) : []

  const applyProbes = () => {
    try {
      localStorage.setItem(PROBES_KEY, probesText)
    } catch {
      // Без localStorage пробы просто не запомнятся.
    }
    void window.api.sim.setProbes(probesText.split('\n'))
  }

  const copyReport = async () => {
    const report = {
      at: new Date().toISOString(),
      checks: {
        pitch,
        seenValues: seenRef.current,
        pause: pauseVerdict(d),
        touchdowns: d.touchdowns.map((t) => ({ ...t, verdict: touchdownVerdict(t) }))
      },
      ...d
    }
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Проверка симулятора</Title>
        <Group>
          <Badge size="lg" color={d.status === 'connected' ? 'green' : d.status === 'connecting' ? 'yellow' : 'gray'}>
            {d.status === 'connected' ? 'Подключён' : d.status === 'connecting' ? 'Подключение…' : 'Не подключён'}
          </Badge>
          <Button onClick={copyReport}>{copied ? 'Скопировано' : 'Копировать отчёт'}</Button>
        </Group>
      </Group>

      <Text size="sm" c="dimmed">
        Загрузите самолёт в MSFS 2024 и пройдите проверки ниже. Отметки ставятся сами. Когда закончите, нажмите «Копировать отчёт»
        и пришлите текст разработчику.
      </Text>

      {d.status !== 'connected' && (
        <Alert color="yellow">
          Нет связи с MSFS 2024. Программа подключается сама каждые 5 секунд, как только симулятор загрузится.
        </Alert>
      )}

      <Card withBorder>
        <Text fw={600} mb="xs">
          Самолёт
        </Text>
        <Table>
          <Table.Tbody>
            <Row k="Симулятор" v={d.simName ? `${d.simName} ${d.simVersion}` : '—'} />
            <Row k="TITLE" v={d.title ?? '—'} />
            <Row k="ATC MODEL" v={d.atcModel ?? '—'} />
            <Row k="ATC TYPE" v={d.atcType ?? '—'} />
            <Row k="aircraft.cfg" v={d.aircraftPath ?? '—'} mono />
            <Row k="Тип" v={d.aircraft?.typeName ?? 'не опознан'} />
            <Row
              k="Профиль аддона"
              v={
                d.aircraft?.profileName
                  ? `${d.aircraft.profileName}${d.aircraft.profileVerified ? '' : ' (не проверен)'}`
                  : 'нет, стандартные переменные'
              }
            />
          </Table.Tbody>
        </Table>
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Group justify="space-between" mb="xs">
            <Text fw={600}>1. Тангаж</Text>
            <VerdictBadge v={pitch?.verdict ?? null} />
          </Group>
          <Text size="sm">
            Взлетите и наберите высоту с поднятым носом. Отметка поставится сама: при наборе сырое значение должно быть
            отрицательным.
          </Text>
          <Text size="sm" mt="xs" className="mono">
            PLANE PITCH DEGREES сейчас: {fmt(v['PLANE PITCH DEGREES'])}
            {pitch && ` · в наборе: ${fmt(pitch.raw)}`}
          </Text>
        </Card>

        <Card withBorder>
          <Group justify="space-between" mb="xs">
            <Text fw={600}>2. Пауза</Text>
            <VerdictBadge v={pauseVerdict(d)} />
          </Group>
          <Text size="sm">Поставьте симулятор на паузу и снимите её. Попробуйте и обычную паузу, и активную.</Text>
          <Text size="sm" mt="xs" className="mono">
            {d.pauseEvents.length
              ? d.pauseEvents.map((e) => `${clock(e.t)} флаги=${e.data}`).join(' · ')
              : 'событий Pause_EX1 пока не было'}
          </Text>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Text fw={600} mb="xs">
          3. Касание
        </Text>
        <Text size="sm" mb="xs">
          Выполните посадку (подойдут и «козлы»). Скорость касания от симулятора должна быть близка к вертикальной скорости.
        </Text>
        {d.touchdowns.length ? (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Время</Table.Th>
                <Table.Th ta="right">VERTICAL SPEED, fpm</Table.Th>
                <Table.Th ta="right">TOUCHDOWN, ft/s</Table.Th>
                <Table.Th ta="right">то же, fpm</Table.Th>
                <Table.Th ta="right">G</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {d.touchdowns.map((t) => (
                <Table.Tr key={t.t}>
                  <Table.Td>{clock(t.t)}</Table.Td>
                  <Table.Td ta="right" className="mono">
                    {fmt(t.vsFpm, 0)}
                  </Table.Td>
                  <Table.Td ta="right" className="mono">
                    {fmt(t.touchdownRaw)}
                  </Table.Td>
                  <Table.Td ta="right" className="mono">
                    {fmt(t.touchdownRaw * 60, 0)}
                  </Table.Td>
                  <Table.Td ta="right" className="mono">
                    {fmt(t.gForce)}
                  </Table.Td>
                  <Table.Td>
                    <VerdictBadge v={touchdownVerdict(t)} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        ) : (
          <Text size="sm" c="dimmed">
            Касаний пока не было.
          </Text>
        )}
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          4. Свет
        </Text>
        <Text size="sm" mb="xs">
          Включайте и выключайте по очереди маяк, стробы, посадочные, навигационные и рулёжные огни. Значение должно меняться
          вместе с переключателем. У Fenix и PMDG стандартные переменные могут не реагировать: тогда смотрите на L-переменные
          профиля или добавьте пробы ниже.
        </Text>
        <Table>
          <Table.Tbody>
            {LIGHTS.map(([label, name]) => (
              <Table.Tr key={name}>
                <Table.Td>{label}</Table.Td>
                <Table.Td className="mono">{name}</Table.Td>
                <Table.Td ta="right" className="mono">
                  {fmt(v[name])} <Seen values={seenRef.current[name]} />
                </Table.Td>
              </Table.Tr>
            ))}
            {profileLvars.map((name) => (
              <Table.Tr key={name}>
                <Table.Td>профиль</Table.Td>
                <Table.Td className="mono">{name}</Table.Td>
                <Table.Td ta="right" className="mono">
                  {fmt(v[name])} <Seen values={seenRef.current[name]} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>

      <Card withBorder>
        <Text fw={600} mb="xs">
          Пробные переменные
        </Text>
        <Text size="sm" mb="xs">
          Одна переменная на строку, например <span className="mono">L:S_OH_EXT_LT_BEACON</span>. Имена L-переменных самолёта
          можно посмотреть в режиме разработчика MSFS: Tools → Behaviors → Local Variables.
        </Text>
        <Textarea
          autosize
          minRows={3}
          value={probesText}
          onChange={(e) => setProbesText(e.currentTarget.value)}
          classNames={{ input: 'mono' }}
        />
        <Group mt="xs">
          <Button size="xs" onClick={applyProbes}>
            Применить
          </Button>
        </Group>
        {d.probes.length > 0 && (
          <Table mt="xs">
            <Table.Tbody>
              {d.probes.map((name) => (
                <Row
                  key={name}
                  k={name}
                  v={`${fmt(v[name])} (были: ${(seenRef.current[name] ?? []).map((x) => fmt(x)).join(', ') || '—'})`}
                  mono
                />
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Card>

      {d.exceptions.length > 0 && (
        <Card withBorder>
          <Text fw={600} mb="xs">
            Ошибки SimConnect
          </Text>
          <Table>
            <Table.Tbody>
              {d.exceptions.map((e, i) => (
                <Row key={i} k={`${clock(e.t)} · код ${e.code}`} v={e.what ?? 'неизвестный пакет'} />
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <Card withBorder>
        <Group justify="space-between">
          <Text fw={600}>Все переменные</Text>
          <Button size="xs" variant="subtle" onClick={() => setShowAll((s) => !s)}>
            {showAll ? 'Скрыть' : 'Показать'}
          </Button>
        </Group>
        <Collapse in={showAll}>
          <Table mt="sm">
            <Table.Tbody>
              {Object.entries(v).map(([k, val]) => (
                <Row key={k} k={k} v={fmt(val, 4)} mono />
              ))}
            </Table.Tbody>
          </Table>
        </Collapse>
      </Card>
    </Stack>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <Table.Tr>
      <Table.Td className={mono ? 'mono' : undefined}>{k}</Table.Td>
      <Table.Td ta="right" className="mono">
        {v}
      </Table.Td>
    </Table.Tr>
  )
}

function Seen({ values }: { values: number[] | undefined }) {
  if (!values || values.length < 2) return null
  return (
    <Text span size="xs" c="dimmed">
      (были:{' '}
      {[...values]
        .sort((a, b) => a - b)
        .map((x) => fmt(x))
        .join(', ')}
      )
    </Text>
  )
}
