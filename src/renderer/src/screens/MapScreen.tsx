import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Card, Group, MultiSelect, SegmentedControl, Select, Stack, Switch, Text, Title } from '@mantine/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { feature, mesh } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import countries from 'world-atlas/countries-50m.json'
import type { LiveFlight, NetworkMap } from '@shared/airlines'
import type { AirlineSummary } from '@shared/types'
import { formatClock } from '../format'
import { PlaneLayer, type PlaneDot } from '../components/planeLayer'
import { useTrackerState, useWorldNow } from '../hooks'
import { useCareerVersion } from '../lib'

/** Карта: борта в воздухе по часам мира и маршрутные сети компаний. */

/** Контур через линию перемены дат (Чукотка, Фиджи) — без разворота Leaflet тянет его полосой через всю карту. */
function unwrap(coords: unknown): unknown {
  if (!Array.isArray(coords)) return coords
  if (typeof coords[0] === 'number') return coords
  if (Array.isArray(coords[0]) && typeof coords[0][0] === 'number') {
    const ring = coords as number[][]
    const crosses = ring.some((p, i) => i > 0 && Math.abs(p[0] - ring[i - 1][0]) > 180)
    return crosses ? ring.map(([lon, lat]) => [lon < 0 ? lon + 360 : lon, lat]) : ring
  }
  return coords.map(unwrap)
}

function unwrapGeo<T>(g: T): T {
  return JSON.parse(JSON.stringify(g), (k, v) => (k === 'coordinates' ? unwrap(v) : v))
}

/** Подложка — контуры стран Natural Earth, встроены в программу: карта работает без интернета и ключей. */
const topo = countries as unknown as Topology
const world = unwrapGeo(feature(topo, topo.objects.countries as GeometryCollection))
const borders = unwrapGeo(mesh(topo, topo.objects.countries as GeometryCollection, (a, b) => a !== b))
const OCEAN = '#0a1622'
/** Цвета сетей на карте: своя компания — первая. */
const NET_COLORS = ['#4dabf7', '#ffa94d', '#69db7c', '#f783ac', '#b197fc', '#ffd43b', '#63e6be', '#ff8787']
const OWN = '#ffa94d'
const EMPLOYER = '#4dabf7'
const OTHER = '#e9c46a'

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/** Точка на дуге большого круга между a и b, f — доля пути 0…1. */
function greatCircle(a: [number, number], b: [number, number], f: number): [number, number] {
  const [la1, lo1, la2, lo2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])]
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2))
  if (d < 1e-9) return a
  const A = Math.sin((1 - f) * d) / Math.sin(d)
  const B = Math.sin(f * d) / Math.sin(d)
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2)
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2)
  const z = A * Math.sin(la1) + B * Math.sin(la2)
  return [deg(Math.atan2(z, Math.sqrt(x * x + y * y))), deg(Math.atan2(y, x))]
}

/** Курс с точки a на точку b по большому кругу, градусы от севера. */
function bearing(a: [number, number], b: [number, number]): number {
  const [la1, lo1, la2, lo2] = [rad(a[0]), rad(a[1]), rad(b[0]), rad(b[1])]
  const y = Math.sin(lo2 - lo1) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1)
  return (deg(Math.atan2(y, x)) + 360) % 360
}

/** Дуга для полилинии; разрыв на линии перемены дат, чтобы линия не шла через всю карту. */
function arc(a: [number, number], b: [number, number], n = 24): [number, number][][] {
  const out: [number, number][][] = [[]]
  let prev: [number, number] | null = null
  for (let i = 0; i <= n; i++) {
    const p = greatCircle(a, b, i / n)
    if (prev && Math.abs(p[1] - prev[1]) > 180) out.push([])
    out[out.length - 1].push(p)
    prev = p
  }
  return out
}

function useLeaflet(): [React.RefObject<HTMLDivElement>, L.Map | null] {
  const ref = useRef<HTMLDivElement>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  useEffect(() => {
    if (!ref.current) return
    const m = L.map(ref.current, { worldCopyJump: true, preferCanvas: true, minZoom: 2, maxZoom: 9 }).setView([50, 40], 3)
    m.attributionControl.setPrefix('Natural Earth')
    L.geoJSON(world, { interactive: false, style: { color: '#33475c', weight: 0, fillColor: '#1b2a3a', fillOpacity: 1 } }).addTo(m)
    L.geoJSON(borders, { interactive: false, style: { color: '#3d556e', weight: 0.7, opacity: 0.9 } }).addTo(m)
    setMap(m)
    return () => {
      m.remove()
      setMap(null)
    }
  }, [])
  return [ref, map]
}

/** Свои компании (контроль) и работодатель — их выделяем на картах. */
function useMyAirlines(): { own: string[]; employer: string | null; loaded: boolean } {
  const version = useCareerVersion()
  const [own, setOwn] = useState<string[]>([])
  const [employer, setEmployer] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    Promise.all([
      window.api.market.stakes().then((list) => setOwn(list.filter((s) => s.control).map((s) => s.icao))),
      window.api.career
        .state()
        .then((p) => setEmployer(p.employerKind === 'airline' ? p.employerId : null))
        .catch(() => setEmployer(null))
    ]).finally(() => setLoaded(true))
  }, [version])
  return { own, employer, loaded }
}

export function MapScreen() {
  const [mode, setMode] = useState<'live' | 'network'>('live')
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Карта</Title>
        <SegmentedControl
          value={mode}
          onChange={(v) => setMode(v as 'live' | 'network')}
          data={[
            { value: 'live', label: 'Полёты сейчас' },
            { value: 'network', label: 'Маршрутная сеть' }
          ]}
        />
      </Group>
      {mode === 'live' ? <LiveMap /> : <NetworkView />}
    </Stack>
  )
}

function useAirlineOptions(): { value: string; label: string }[] {
  const [list, setList] = useState<AirlineSummary[]>([])
  useEffect(() => {
    window.api.world.airlines().then(setList)
  }, [])
  return useMemo(() => list.map((a) => ({ value: a.icao, label: `${a.name} (${a.iata})` })).sort((a, b) => a.label.localeCompare(b.label)), [list])
}

// ——— полёты сейчас ———

function LiveMap() {
  const [ref, map] = useLeaflet()
  const now = useWorldNow()
  const tracker = useTrackerState()
  const { own, employer } = useMyAirlines()
  const options = useAirlineOptions()
  const [only, setOnly] = useState<string[]>([])
  const [flights, setFlights] = useState<LiveFlight[]>([])
  const [selected, setSelected] = useState<LiveFlight | null>(null)
  const [hover, setHover] = useState<{ f: LiveFlight; x: number; y: number } | null>(null)
  const planes = useRef<PlaneLayer | null>(null)
  const route = useRef<L.LayerGroup | null>(null)
  const byId = useRef(new Map<string, LiveFlight>())
  const me = useRef<L.CircleMarker | null>(null)

  // Список бортов в воздухе — раз в 30 секунд и после перемотки; между запросами самолёты двигаются локально.
  useEffect(() => {
    const load = () => window.api.map.flights(only.length ? only : undefined).then(setFlights)
    void load()
    const t = setInterval(load, 30_000)
    const off = window.api.world.onChanged(load)
    return () => {
      clearInterval(t)
      off()
    }
  }, [only])

  useEffect(() => {
    if (!map) return
    const layer = new PlaneLayer().addTo(map)
    planes.current = layer
    route.current = L.layerGroup().addTo(map)
    // Наведение — подсказка с рейсом, клик — маршрут борта.
    const move = (e: L.LeafletMouseEvent) => {
      const id = layer.hitTest(e.containerPoint.x, e.containerPoint.y)
      const f = id ? byId.current.get(id) : undefined
      map.getContainer().style.cursor = f ? 'pointer' : ''
      setHover(f ? { f, x: e.containerPoint.x, y: e.containerPoint.y } : null)
    }
    const click = (e: L.LeafletMouseEvent) => {
      const id = layer.hitTest(e.containerPoint.x, e.containerPoint.y)
      setSelected(id ? (byId.current.get(id) ?? null) : null)
    }
    const out = () => setHover(null)
    map.on('mousemove', move)
    map.on('click', click)
    map.on('mouseout movestart zoomstart', out)
    return () => {
      map.off('mousemove', move)
      map.off('click', click)
      map.off('mouseout movestart zoomstart', out)
      layer.remove()
      route.current?.remove()
    }
  }, [map])

  const color = (f: LiveFlight) => (own.includes(f.airline) ? OWN : f.airline === employer ? EMPLOYER : OTHER)

  // Каждую секунду — новые положения и курсы по часам мира.
  useEffect(() => {
    byId.current = new Map(flights.map((f) => [f.id, f]))
    const dots: PlaneDot[] = []
    for (const f of flights) {
      if (now < f.depAt || now >= f.arrAt) continue
      const [lat, lon] = greatCircle(f.from, f.to, (now - f.depAt) / (f.arrAt - f.depAt))
      const mine = own.includes(f.airline) || f.airline === employer
      dots.push({ id: f.id, lat, lon, heading: bearing([lat, lon], f.to), category: f.category, color: color(f), highlight: mine || f.id === selected?.id })
    }
    planes.current?.setDots(dots)
  }, [now, flights, own, employer, selected])

  // Маршрут выбранного борта.
  useEffect(() => {
    const g = route.current
    if (!g) return
    g.clearLayers()
    if (!selected) return
    for (const part of arc(selected.from, selected.to, 48)) L.polyline(part, { color: '#fff', weight: 1.5, dashArray: '4 4' }).addTo(g)
  }, [selected])

  // Свой самолёт из MSFS — во время полёта.
  useEffect(() => {
    if (!map) return
    const s = tracker?.active ? tracker.sample : null
    if (!s) {
      me.current?.remove()
      me.current = null
      return
    }
    if (!me.current) me.current = L.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', fillColor: '#e03131', fillOpacity: 1, weight: 2 }).addTo(map)
    else me.current.setLatLng([s.lat, s.lon])
  }, [map, tracker])

  const shown = flights.filter((f) => now >= f.depAt && now < f.arrAt).length
  return (
    <>
      <Card withBorder>
        <Group justify="space-between" align="flex-end">
          <MultiSelect
            label="Компании"
            placeholder={only.length ? undefined : 'Все компании'}
            data={options}
            value={only}
            onChange={setOnly}
            searchable
            clearable
            w={520}
          />
          <Group gap="xs">
            <Badge color="orange" variant="dot">
              Ваша компания
            </Badge>
            <Badge color="blue" variant="dot">
              Работодатель
            </Badge>
            <Badge color="yellow" variant="dot">
              Другие
            </Badge>
            <Badge color="red" variant="dot">
              Вы в MSFS
            </Badge>
            <Text size="sm" c="dimmed">
              В воздухе: {shown}
            </Text>
          </Group>
        </Group>
      </Card>
      {selected && <FlightInfo f={selected} now={now} onClose={() => setSelected(null)} />}
      <Card withBorder p={0} style={{ overflow: 'hidden', position: 'relative' }}>
        <div ref={ref} style={{ height: 'calc(100vh - 290px)', minHeight: 420, background: OCEAN }} />
        {hover && <HoverCard f={hover.f} x={hover.x} y={hover.y} />}
      </Card>
      <Text size="xs" c="dimmed">
        Борта летят по расписанию авиакомпаний и часам мира: при перемотке времени они переносятся вместе с миром. Наведите на
        самолёт — увидите рейс; нажмите — покажется его маршрут.
      </Text>
    </>
  )
}

/** Подсказка при наведении: рейс, авиакомпания, тип, откуда и куда. */
function HoverCard({ f, x, y }: { f: LiveFlight; x: number; y: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x + 14,
        top: y + 14,
        zIndex: 600,
        pointerEvents: 'none',
        background: 'rgba(12, 20, 30, 0.94)',
        border: '1px solid rgba(120, 170, 220, 0.35)',
        borderRadius: 6,
        padding: '6px 10px',
        minWidth: 220
      }}
    >
      <Group gap={6} wrap="nowrap">
        <Text fw={700} size="sm">
          {f.flightNo}
        </Text>
        <Text size="sm" c="dimmed" truncate>
          {f.name}
        </Text>
      </Group>
      <Text size="xs">
        {f.typeName}
        {f.reg ? ` · ${f.reg}` : ''}
      </Text>
      <Text size="xs">
        {f.depCity} ({f.dep}) → {f.arrCity} ({f.arr})
      </Text>
    </div>
  )
}

function FlightInfo({ f, now, onClose }: { f: LiveFlight; now: number; onClose(): void }) {
  const pct = Math.round(Math.min(1, Math.max(0, (now - f.depAt) / (f.arrAt - f.depAt))) * 100)
  return (
    <Card withBorder>
      <Group justify="space-between">
        <Group gap="sm">
          <Text fw={700}>{f.flightNo}</Text>
          <Text>{f.name}</Text>
          <Badge variant="light">{f.typeName}</Badge>
          {f.reg && <Badge variant="outline">{f.reg}</Badge>}
        </Group>
        <Text size="sm" c="dimmed" style={{ cursor: 'pointer' }} onClick={onClose}>
          закрыть
        </Text>
      </Group>
      <Text size="sm" mt={4}>
        {f.dep} {formatClock(f.depAt)} → {f.arr} {formatClock(f.arrAt)} UTC · пройдено {pct}%
        {now >= f.arrAt ? ' · приземлился' : ''}
      </Text>
    </Card>
  )
}

// ——— маршрутная сеть ———

function NetworkView() {
  const [ref, map] = useLeaflet()
  const { own, employer, loaded } = useMyAirlines()
  const options = useAirlineOptions()
  const [main, setMain] = useState<string | null>(null)
  const [rivals, setRivals] = useState<string[]>([])
  const [onlyShared, setOnlyShared] = useState(false)
  const [nets, setNets] = useState<NetworkMap[]>([])
  const layer = useRef<L.LayerGroup | null>(null)

  // По умолчанию — своя компания, иначе работодатель.
  useEffect(() => {
    if (loaded) setMain((m) => m ?? own[0] ?? employer ?? 'AFL')
  }, [loaded, own, employer])

  useEffect(() => {
    if (!main) return
    const codes = [main, ...rivals.filter((r) => r !== main)]
    Promise.all(codes.map((c) => window.api.map.network(c))).then(setNets)
  }, [main, rivals])

  useEffect(() => {
    if (!map) return
    layer.current = L.layerGroup().addTo(map)
    return () => {
      layer.current?.remove()
    }
  }, [map])

  useEffect(() => {
    const g = layer.current
    if (!map || !g || !nets.length) return
    g.clearLayers()
    const mainAirports = new Set(Object.keys(nets[0].airports))
    const bounds: [number, number][] = []
    nets.forEach((net, i) => {
      const c = NET_COLORS[i % NET_COLORS.length]
      for (const r of net.routes) {
        // «Только общие» — у конкурентов показываем лишь рейсы в города, куда летает основная компания.
        if (i > 0 && onlyShared && !(mainAirports.has(r.hub) && mainAirports.has(r.dest))) continue
        const a = net.airports[r.hub]
        const b = net.airports[r.dest]
        for (const part of arc([a.lat, a.lon], [b.lat, b.lon]))
          L.polyline(part, { color: c, weight: Math.min(4, 0.8 + r.freq * 0.4), opacity: i ? 0.55 : 0.8, dashArray: r.oneWay ? '5 5' : undefined })
            .bindTooltip(`${net.iata}: ${r.hub} — ${r.dest}${r.oneWay ? ' (в одну сторону)' : ` · ${r.freq} в день`}`)
            .addTo(g)
        if (i === 0) bounds.push([a.lat, a.lon], [b.lat, b.lon])
      }
      for (const [code, a] of Object.entries(net.airports)) {
        if (i > 0 && onlyShared && !mainAirports.has(code)) continue
        const hub = net.hubs.includes(code)
        L.circleMarker([a.lat, a.lon], { radius: hub ? 6 : 2.5, color: c, fillOpacity: 1, weight: hub ? 2 : 1 })
          .bindTooltip(`${code}${a.iata ? ` / ${a.iata}` : ''} — ${a.name}${hub ? ` · база ${net.iata}` : ''}`)
          .addTo(g)
      }
    })
    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 })
  }, [map, nets, onlyShared])

  return (
    <>
      <Card withBorder>
        <Group align="flex-end">
          <Select label="Компания" data={options} value={main} onChange={setMain} searchable allowDeselect={false} w={320} />
          <MultiSelect
            label="Наложить сети конкурентов"
            placeholder="Выберите компании"
            data={options.filter((o) => o.value !== main)}
            value={rivals}
            onChange={setRivals}
            searchable
            clearable
            maxValues={NET_COLORS.length - 1}
            w={420}
          />
          <Switch label="Только общие направления" checked={onlyShared} onChange={(e) => setOnlyShared(e.currentTarget.checked)} mb={8} />
        </Group>
        <Group gap="xs" mt="sm">
          {nets.map((n, i) => (
            <Badge key={n.icao} variant="dot" style={{ '--badge-dot-color': NET_COLORS[i % NET_COLORS.length] } as React.CSSProperties}>
              {n.name} · {n.routes.length} маршрутов
            </Badge>
          ))}
        </Group>
      </Card>
      <Card withBorder p={0} style={{ overflow: 'hidden' }}>
        <div ref={ref} style={{ height: 'calc(100vh - 320px)', minHeight: 420, background: OCEAN }} />
      </Card>
    </>
  )
}
