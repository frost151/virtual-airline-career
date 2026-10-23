import type {
  AircraftInfo,
  FlightPhase,
  FlightSource,
  FlightStatus,
  LandingReport,
  SimSample,
  TrackerEvent,
  TrackerState
} from '@shared/sim'
import type { AircraftType, Airport } from '@shared/world'
import { distanceKm, nearestAirport } from './geo'
import { gradeLanding } from './landing'
import { RuleEngine } from './rules'

export interface TrackerOptions {
  source: FlightSource
  airports: ReadonlyMap<string, Airport>
  getType(id: string): AircraftType | undefined
}

export interface FlightDraft {
  source: FlightSource
  status: FlightStatus
  departure: string | null
  arrival: string | null
  aircraft: AircraftInfo | null
  blockOffAt: number | null
  takeoffAt: number | null
  landingAt: number | null
  blockOnAt: number | null
  distanceKm: number
  fuelUsedKg: number
  maxAltFt: number
  landing: LandingReport | null
  score: number
  events: TrackerEvent[]
  track: [number, number, number, number][]
}

const TRACK_STEP_MS = 15_000
/** Сколько секунд после касания ловим пик перегрузки. */
const TOUCHDOWN_WINDOW_MS = 2_000
/** Отрыв короче этого после касания — «козёл», а не уход на второй круг. */
const BOUNCE_MAX_MS = 15_000

interface PendingLanding {
  t: number
  finalizeAt: number
  vsFpm: number
  gForce: number
  iasKt: number
  pitchDeg: number
  bankDeg: number
  simTouchdownAtStart: number | undefined
}

/**
 * Трекер одного полёта: принимает поток сэмплов из любого источника
 * (MSFS, демо, запись) и ведёт фазы, нарушения, посадку и статистику.
 * Вся логика опирается на время сэмпла, а не на системные часы.
 */
export class FlightTracker {
  readonly source: FlightSource
  phase: FlightPhase = 'preflight'
  aircraft: AircraftInfo | null = null
  departure: string | null = null
  events: TrackerEvent[] = []
  landing: LandingReport | null = null
  blockOffAt: number | null = null
  takeoffAt: number | null = null
  landingAt: number | null = null
  blockOnAt: number | null = null
  distanceKm = 0
  maxAltFt = 0
  crashed = false
  track: [number, number, number, number][] = []
  last: SimSample | null = null

  private rules = new RuleEngine()
  private timers = new Map<string, number>()
  private recent: SimSample[] = []
  private fuelAtBlockOff: number | null = null
  private minFuelAirborne = Infinity
  private refuelFlagged = false
  private teleportFlagged = false
  private pending: PendingLanding | null = null
  private bounceLiftoffAt: number | null = null
  private bounces = 0
  private liftoffAt: number | null = null

  constructor(private opts: TrackerOptions) {
    this.source = opts.source
  }

  get finished(): boolean {
    return this.phase === 'on_block' || this.crashed
  }

  get score(): number {
    const penalties = this.events.reduce((s, e) => s + e.penalty, 0) + (this.landing?.penalty ?? 0)
    return Math.max(0, 100 - penalties)
  }

  get fuelUsedKg(): number {
    if (this.fuelAtBlockOff === null || !this.last) return 0
    return Math.max(0, this.fuelAtBlockOff - this.last.fuelKg)
  }

  setAircraft(info: AircraftInfo): void {
    this.aircraft = info
  }

  feed(s: SimSample): void {
    const prev = this.last
    if (!prev) {
      this.departure = nearestAirport(this.opts.airports.values(), s.lat, s.lon)?.icao ?? null
    }

    if (!s.paused && prev && !prev.paused) {
      this.checkContinuity(prev, s)
    }

    if (!s.paused) {
      this.maxAltFt = Math.max(this.maxAltFt, s.altFt)
      this.recent.push(s)
      while (this.recent.length && s.t - this.recent[0].t > 3000) this.recent.shift()
      this.checkFuelAndCrash(s)
      this.updatePhase(prev, s)
      this.updateLanding(prev, s)
    }

    for (const e of this.rules.check(s, { phase: this.phase })) this.events.push(e)

    if (!this.track.length || s.t - this.track[this.track.length - 1][0] >= TRACK_STEP_MS) {
      this.track.push([s.t, +s.lat.toFixed(5), +s.lon.toFixed(5), Math.round(s.altFt)])
    }
    this.last = s
  }

  /** Завершает полёт (автоматически на стоянке или вручную) и собирает итог. */
  finish(): FlightDraft {
    if (this.pending) this.finalizeLanding()
    const s = this.last
    const arrival = s && s.onGround && this.landingAt ? (nearestAirport(this.opts.airports.values(), s.lat, s.lon)?.icao ?? null) : null
    if (s && (!this.track.length || this.track[this.track.length - 1][0] !== s.t)) {
      this.track.push([s.t, +s.lat.toFixed(5), +s.lon.toFixed(5), Math.round(s.altFt)])
    }
    return {
      source: this.source,
      status: this.crashed ? 'crashed' : this.phase === 'on_block' ? 'completed' : 'aborted',
      departure: this.departure,
      arrival,
      aircraft: this.aircraft,
      blockOffAt: this.blockOffAt,
      takeoffAt: this.takeoffAt,
      landingAt: this.landingAt,
      blockOnAt: this.blockOnAt,
      distanceKm: Math.round(this.distanceKm),
      fuelUsedKg: Math.round(this.fuelUsedKg),
      maxAltFt: Math.round(this.maxAltFt),
      landing: this.landing,
      score: this.score,
      events: this.events,
      track: this.track
    }
  }

  snapshot(): TrackerState {
    return {
      active: true,
      source: this.source,
      phase: this.phase,
      sample: this.last,
      aircraft: this.aircraft,
      departure: this.departure,
      events: this.events,
      landing: this.landing,
      score: this.score,
      blockOffAt: this.blockOffAt,
      takeoffAt: this.takeoffAt,
      landingAt: this.landingAt,
      blockOnAt: this.blockOnAt,
      fuelUsedKg: Math.round(this.fuelUsedKg),
      distanceKm: Math.round(this.distanceKm),
      maxAltFt: Math.round(this.maxAltFt)
    }
  }

  // ——— внутреннее ———

  private event(t: number, code: string, severity: TrackerEvent['severity'], message: string, penalty = 0): void {
    this.events.push({ t, code, severity, message, penalty, phase: this.phase })
  }

  /** Условие держится не меньше ms (по времени сэмплов). */
  private held(key: string, cond: boolean, t: number, ms: number): boolean {
    if (!cond) {
      this.timers.delete(key)
      return false
    }
    const since = this.timers.get(key) ?? t
    this.timers.set(key, since)
    return t - since >= ms
  }

  private setPhase(phase: FlightPhase): void {
    this.phase = phase
    this.timers.clear()
  }

  /** Пройденный путь и проверка на «телепорт». */
  private checkContinuity(prev: SimSample, s: SimSample): void {
    const dt = (s.t - prev.t) / 1000
    if (dt <= 0) return
    const km = distanceKm(prev.lat, prev.lon, s.lat, s.lon)
    const maxSpeedKmS = (Math.max(prev.gsKt, s.gsKt, 30) * 1.852) / 3600
    const allowedKm = Math.max(1, maxSpeedKmS * dt * 2 + 0.5)
    if (!s.slew && km > allowedKm && dt < 30) {
      if (!this.teleportFlagged) {
        this.teleportFlagged = true
        this.event(s.t, 'teleport', 'critical', `Самолёт переместился на ${km.toFixed(1)} км за ${dt.toFixed(0)} с`, 30)
      }
      return
    }
    if (!s.onGround || s.gsKt > 1) this.distanceKm += km
  }

  private checkFuelAndCrash(s: SimSample): void {
    if (s.crashed && !this.crashed) {
      this.crashed = true
      this.event(s.t, 'crash', 'critical', 'Катастрофа', 100)
    }
    if (!s.onGround) {
      this.minFuelAirborne = Math.min(this.minFuelAirborne, s.fuelKg)
      if (!this.refuelFlagged && s.fuelKg - this.minFuelAirborne > 150) {
        this.refuelFlagged = true
        this.event(s.t, 'refuel_airborne', 'critical', 'Топливо добавлено в полёте', 30)
      }
    }
  }

  private markBlockOff(s: SimSample): void {
    if (this.blockOffAt === null) {
      this.blockOffAt = s.t
      this.fuelAtBlockOff = s.fuelKg
    }
  }

  private updatePhase(prev: SimSample | null, s: SimSample): void {
    const t = s.t
    switch (this.phase) {
      case 'preflight':
        if (s.pushback) {
          this.markBlockOff(s)
          this.setPhase('pushback')
        } else if (s.onGround && s.gsKt > 3 && s.enginesRunning > 0) {
          this.markBlockOff(s)
          this.setPhase('taxi_out')
        }
        break
      case 'pushback':
        if (!s.pushback && s.gsKt > 3 && s.enginesRunning > 0) this.setPhase('taxi_out')
        break
      case 'taxi_out':
        if (s.onGround && s.gsKt > 40) this.setPhase('takeoff')
        break
      case 'takeoff':
        if (!s.onGround) {
          this.liftoffAt ??= t
          if (this.held('airborne', true, t, 3000)) {
            this.takeoffAt ??= this.liftoffAt
            this.setPhase('climb')
          }
        } else {
          this.liftoffAt = null
          if (s.gsKt < 30) {
            this.event(t, 'rejected_takeoff', 'info', 'Прерванный взлёт')
            this.setPhase('taxi_out')
          }
        }
        break
      case 'climb':
      case 'cruise':
      case 'descent': {
        const climbing = this.held('vs_up', s.vsFpm > 500, t, 30_000)
        const descending = this.held('vs_down', s.vsFpm < -500, t, 30_000)
        const level = this.held('vs_level', Math.abs(s.vsFpm) < 400, t, 60_000)
        if (this.phase !== 'climb' && climbing) this.setPhase('climb')
        else if (this.phase !== 'descent' && descending) this.setPhase('descent')
        else if (this.phase !== 'cruise' && level && s.altAglFt > 5000) this.setPhase('cruise')
        else if (this.phase === 'descent' && s.altAglFt < 3000 && s.gearDown) this.setPhase('approach')
        break
      }
      case 'approach':
        if (prev && s.vsFpm > 700 && s.altAglFt > 1000 && this.held('go_around', true, t, 5000)) {
          this.event(t, 'go_around', 'info', 'Уход на второй круг')
          this.setPhase('climb')
        }
        break
      case 'landing':
        if (s.onGround && s.gsKt < 40) this.setPhase('taxi_in')
        break
      case 'taxi_in':
        if (s.onGround && s.enginesRunning === 0 && s.gsKt < 1) {
          this.blockOnAt = t
          this.setPhase('on_block')
        }
        break
    }
  }

  private updateLanding(prev: SimSample | null, s: SimSample): void {
    if (!prev) return
    const touchdown = !prev.onGround && s.onGround
    const liftoff = prev.onGround && !s.onGround

    if (touchdown && this.phase !== 'landing' && ['climb', 'cruise', 'descent', 'approach'].includes(this.phase)) {
      this.landingAt ??= s.t
      // Вертикальная скорость касания — самая отрицательная за последние 2 с в воздухе.
      const air = this.recent.filter((x) => !x.onGround && s.t - x.t <= 2000)
      const vs = air.length ? Math.min(...air.map((x) => x.vsFpm)) : s.vsFpm
      this.pending = {
        t: s.t,
        finalizeAt: s.t + TOUCHDOWN_WINDOW_MS,
        vsFpm: vs,
        gForce: s.gForce,
        iasKt: s.iasKt,
        pitchDeg: s.pitchDeg,
        bankDeg: s.bankDeg,
        simTouchdownAtStart: prev.touchdownVsFpm
      }
      this.bounces = 0
      this.checkTouchdownConfig(s)
      this.setPhase('landing')
      return
    }

    if (this.phase === 'landing') {
      if (this.pending) {
        this.pending.gForce = Math.max(this.pending.gForce, s.gForce)
        // MSFS сам считает скорость касания — берём её, если она обновилась после касания.
        if (s.touchdownVsFpm !== undefined && s.touchdownVsFpm !== this.pending.simTouchdownAtStart && s.touchdownVsFpm < 0) {
          this.pending.vsFpm = s.touchdownVsFpm
        }
        if (s.t >= this.pending.finalizeAt) this.finalizeLanding()
      }
      if (liftoff) this.bounceLiftoffAt = s.t
      if (touchdown && this.bounceLiftoffAt !== null && s.t - this.bounceLiftoffAt < BOUNCE_MAX_MS) {
        this.bounces++
        this.bounceLiftoffAt = null
        if (this.landing) this.landing = gradeLanding({ ...this.landing, bounces: this.bounces })
      }
      // Долгий отрыв после касания — touch-and-go или уход на второй круг.
      if (!s.onGround && this.bounceLiftoffAt !== null && s.t - this.bounceLiftoffAt >= BOUNCE_MAX_MS) {
        this.bounceLiftoffAt = null
        this.event(s.t, 'touch_and_go', 'info', 'Касание с уходом на второй круг')
        this.setPhase('climb')
      }
    }
  }

  private finalizeLanding(): void {
    const p = this.pending!
    this.pending = null
    this.landing = gradeLanding({
      t: p.t,
      vsFpm: Math.round(p.vsFpm),
      gForce: +p.gForce.toFixed(2),
      iasKt: Math.round(p.iasKt),
      pitchDeg: +p.pitchDeg.toFixed(1),
      bankDeg: +p.bankDeg.toFixed(1),
      bounces: this.bounces
    })
  }

  private checkTouchdownConfig(s: SimSample): void {
    if (!s.gearDown) this.event(s.t, 'gear_up_landing', 'critical', 'Посадка с убранным шасси', 50)
    const type = this.aircraft?.typeId ? this.opts.getType(this.aircraft.typeId) : undefined
    if (type && s.weightKg > type.mlwKg * 1.01) {
      this.event(
        s.t,
        'overweight_landing',
        'violation',
        `Посадка с превышением MLW: ${Math.round(s.weightKg / 1000)} т при максимуме ${Math.round(type.mlwKg / 1000)} т`,
        10
      )
    }
  }
}
