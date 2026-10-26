import L from 'leaflet'
import type { AircraftCategory } from '@shared/world'

/**
 * Самолёты на карте, как на радарах: силуэт по типу, нос по курсу. Тысячи бортов рисуются
 * на одном canvas поверх карты — отдельные маркеры на каждый борт тормозили бы.
 */

export interface PlaneDot {
  id: string
  lat: number
  lon: number
  /** Курс, градусы от севера по часовой. */
  heading: number
  category: AircraftCategory
  color: string
  /** Выделен (выбран или своя компания) — обводка ярче. */
  highlight: boolean
}

/** Силуэты носом вверх в единичных координатах (длина ≈ 2). */
const JET = new Path2D(
  'M0,-1 L0.09,-0.82 L0.1,-0.25 L0.95,0.2 L0.95,0.32 L0.1,0.12 L0.08,0.65 L0.36,0.85 L0.36,0.95 L0,0.88 L-0.36,0.95 L-0.36,0.85 L-0.08,0.65 L-0.1,0.12 L-0.95,0.32 L-0.95,0.2 L-0.1,-0.25 L-0.09,-0.82 Z'
)
const HEAVY = new Path2D(
  'M0,-1 L0.11,-0.8 L0.12,-0.3 L1,0.18 L1,0.32 L0.12,0.1 L0.1,0.66 L0.42,0.86 L0.42,0.96 L0,0.88 L-0.42,0.96 L-0.42,0.86 L-0.1,0.66 L-0.12,0.1 L-1,0.32 L-1,0.18 L-0.12,-0.3 L-0.11,-0.8 Z'
)
const PROP = new Path2D(
  'M0,-1 L0.08,-0.8 L0.09,-0.3 L1,-0.25 L1,-0.08 L0.09,-0.05 L0.07,0.66 L0.34,0.76 L0.34,0.88 L0,0.84 L-0.34,0.88 L-0.34,0.76 L-0.07,0.66 L-0.09,-0.05 L-1,-0.08 L-1,-0.25 L-0.09,-0.3 L-0.08,-0.8 Z'
)

const SHAPE: Record<AircraftCategory, { path: Path2D; size: number }> = {
  widebody: { path: HEAVY, size: 9 },
  freighter: { path: HEAVY, size: 9 },
  narrowbody: { path: JET, size: 7 },
  regional: { path: JET, size: 6 },
  bizjet: { path: JET, size: 5 },
  turboprop: { path: PROP, size: 6 }
}

export class PlaneLayer extends L.Layer {
  private canvas = document.createElement('canvas')
  private dots: PlaneDot[] = []
  /** Где каждый борт нарисован на экране — для наведения и клика. */
  private hits: { id: string; x: number; y: number }[] = []
  private frame = 0

  onAdd(map: L.Map): this {
    const c = this.canvas
    c.style.position = 'absolute'
    c.style.left = '0'
    c.style.top = '0'
    c.style.pointerEvents = 'none'
    c.style.zIndex = '450'
    map.getContainer().appendChild(c)
    map.on('move zoom resize viewreset', this.schedule, this)
    this.draw()
    return this
  }

  onRemove(map: L.Map): this {
    map.off('move zoom resize viewreset', this.schedule, this)
    this.canvas.remove()
    cancelAnimationFrame(this.frame)
    return this
  }

  setDots(dots: PlaneDot[]): void {
    this.dots = dots
    this.schedule()
  }

  /** Ближайший борт к точке экрана в пределах radius пикселей. */
  hitTest(x: number, y: number, radius = 10): string | null {
    let best: string | null = null
    let bestD = radius * radius
    for (const h of this.hits) {
      const d = (h.x - x) ** 2 + (h.y - y) ** 2
      if (d < bestD) {
        bestD = d
        best = h.id
      }
    }
    return best
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.draw())
  }

  private draw(): void {
    const map = this._map
    if (!map) return
    const size = map.getSize()
    const ratio = window.devicePixelRatio || 1
    const c = this.canvas
    if (c.width !== size.x * ratio || c.height !== size.y * ratio) {
      c.width = size.x * ratio
      c.height = size.y * ratio
      c.style.width = `${size.x}px`
      c.style.height = `${size.y}px`
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.x, size.y)
    // При мелком масштабе самолёты чуть меньше, при крупном — крупнее.
    const scale = Math.max(0.75, Math.min(1.6, 0.55 + map.getZoom() * 0.15))
    const centerLon = map.getCenter().lng
    this.hits = []
    // Выделенные рисуем последними — поверх остальных.
    const ordered = [...this.dots].sort((a, b) => Number(a.highlight) - Number(b.highlight))
    for (const d of ordered) {
      // Копия мира, ближайшая к центру карты (карта прокручивается по долготе бесконечно).
      const lon = d.lon + Math.round((centerLon - d.lon) / 360) * 360
      const p = map.latLngToContainerPoint([d.lat, lon])
      if (p.x < -20 || p.y < -20 || p.x > size.x + 20 || p.y > size.y + 20) continue
      const shape = SHAPE[d.category] ?? SHAPE.narrowbody
      const s = shape.size * scale * (d.highlight ? 1.25 : 1)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate((d.heading * Math.PI) / 180)
      ctx.scale(s, s)
      ctx.fillStyle = d.color
      ctx.fill(shape.path)
      ctx.lineWidth = (d.highlight ? 1.4 : 0.8) / s
      ctx.strokeStyle = d.highlight ? '#ffffff' : 'rgba(0,0,0,0.65)'
      ctx.stroke(shape.path)
      ctx.restore()
      this.hits.push({ id: d.id, x: p.x, y: p.y })
    }
  }
}
