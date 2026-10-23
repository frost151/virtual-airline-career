import { useMemo, useState } from 'react'
import { Box, Text } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'

export interface LinePoint {
  x: number
  y: number
}

interface Props {
  points: LinePoint[]
  formatY(y: number): string
  /** Подписи делений оси Y (по умолчанию — как formatY). */
  formatTick?(y: number): string
  formatX(x: number): string
  /** Подпись для скринридеров. */
  label: string
  height?: number
}

const PAD = { top: 12, right: 12, bottom: 24, left: 52 }

/** Красивые деления оси: 1, 2, 2.5, 5 × 10^n. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let v = start; v <= max + 1e-9; v += step) ticks.push(+v.toFixed(10))
  return ticks
}

/**
 * Однорядный линейный график: тонкая линия 2px, приглушённая сетка,
 * перекрестье с подсказкой по ближайшей точке (мышь и стрелки клавиатуры).
 */
export function LineChart({ points, formatY, formatTick, formatX, label, height = 200 }: Props) {
  const { ref, width } = useElementSize()
  const [hover, setHover] = useState<number | null>(null)

  const geo = useMemo(() => {
    if (points.length < 2 || !width) return null
    const ys = points.map((p) => p.y)
    const pad = (Math.max(...ys) - Math.min(...ys)) * 0.1 || Math.abs(ys[0]) * 0.05 || 1
    const yTicks = niceTicks(Math.min(...ys) - pad, Math.max(...ys) + pad)
    const yMin = Math.min(yTicks[0], Math.min(...ys))
    const yMax = Math.max(yTicks[yTicks.length - 1], Math.max(...ys))
    const x0 = points[0].x
    const x1 = points[points.length - 1].x
    const iw = width - PAD.left - PAD.right
    const ih = height - PAD.top - PAD.bottom
    const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0 || 1)) * iw
    const sy = (y: number) => PAD.top + (1 - (y - yMin) / (yMax - yMin || 1)) * ih
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')
    // Без повторов: при малом числе точек одна и та же подписывалась бы дважды.
    const xTickIdx = [...new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (points.length - 1))))]
    return { sx, sy, path, yTicks, xTickIdx }
  }, [points, width, height])

  const nearest = (clientX: number, rect: DOMRect) => {
    if (!geo) return null
    const x = clientX - rect.left
    let best = 0
    let bestD = Infinity
    points.forEach((p, i) => {
      const d = Math.abs(geo.sx(p.x) - x)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    return best
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const cur = hover ?? points.length - 1
    setHover(Math.max(0, Math.min(points.length - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))))
  }

  if (points.length < 2) {
    return (
      <Text c="dimmed" size="sm" py="xl" ta="center">
        История появится через пару дней.
      </Text>
    )
  }

  const hp = hover !== null ? points[hover] : null
  return (
    <Box ref={ref} pos="relative" h={height}>
      {geo && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          onPointerMove={(e) => setHover(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setHover(null)}
          style={{ display: 'block', outline: 'none' }}
        >
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={geo.sy(t)} y2={geo.sy(t)} stroke="var(--mantine-color-dark-4)" strokeWidth={1} />
              <text x={PAD.left - 8} y={geo.sy(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">
                {(formatTick ?? formatY)(t)}
              </text>
            </g>
          ))}
          {geo.xTickIdx.map((i, k) => (
            <text
              key={k}
              x={geo.sx(points[i].x)}
              y={height - 6}
              textAnchor={k === 0 ? 'start' : k === geo.xTickIdx.length - 1 ? 'end' : 'middle'}
              fontSize={11}
              fill="var(--mantine-color-dimmed)"
            >
              {formatX(points[i].x)}
            </text>
          ))}
          <path d={geo.path} fill="none" stroke="var(--mantine-color-blue-4)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hp && (
            <g pointerEvents="none">
              <line x1={geo.sx(hp.x)} x2={geo.sx(hp.x)} y1={PAD.top} y2={height - PAD.bottom} stroke="var(--mantine-color-dark-2)" strokeWidth={1} />
              <circle cx={geo.sx(hp.x)} cy={geo.sy(hp.y)} r={5} fill="var(--mantine-color-blue-4)" stroke="var(--mantine-color-body)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {geo && hp && (
        <Box
          pos="absolute"
          top={4}
          left={Math.min(Math.max(geo.sx(hp.x) + 10, 0), width - 150)}
          px="xs"
          py={4}
          style={{
            pointerEvents: 'none',
            background: 'var(--mantine-color-dark-7)',
            border: '1px solid var(--mantine-color-dark-4)',
            borderRadius: 6,
            minWidth: 120
          }}
        >
          <Text fw={700} size="sm" className="mono">
            {formatY(hp.y)}
          </Text>
          <Text size="xs" c="dimmed">
            {formatX(hp.x)}
          </Text>
        </Box>
      )}
    </Box>
  )
}
