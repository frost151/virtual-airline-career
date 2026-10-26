import { FL100_SPEED_LIMIT, LANDING_LIGHTS_BELOW_FT, OVERSPEED_GRACE_S, SPEED_TOLERANCE_KT } from '@shared/sim'
import type { EventSeverity, FlightPhase, SimSample, TrackerEvent } from '@shared/sim'

export interface RuleContext {
  phase: FlightPhase
}

interface Rule {
  code: string
  severity: EventSeverity
  penalty: number
  message: string
  /** Сколько мс условие должно держаться, прежде чем засчитать нарушение. */
  holdMs?: number
  /** Сколько раз за полёт можно снять баллы (дальше — только запись в журнал). */
  maxPenalized?: number
  when(s: SimSample, ctx: RuleContext): boolean
}

const AIRBORNE_PHASES: FlightPhase[] = ['takeoff', 'climb', 'cruise', 'descent', 'approach']
const airborne = (s: SimSample) => !s.onGround
const taxiing = (ctx: RuleContext) => ctx.phase === 'taxi_out' || ctx.phase === 'taxi_in'

const RULES: Rule[] = [
  {
    code: 'overspeed_fl100',
    severity: 'violation',
    penalty: 5,
    maxPenalized: 2,
    holdMs: OVERSPEED_GRACE_S * 1000,
    message: 'Скорость больше 250 узлов ниже FL100',
    when: (s) => airborne(s) && s.altFt < 10000 && s.iasKt > FL100_SPEED_LIMIT + SPEED_TOLERANCE_KT
  },
  {
    code: 'overspeed',
    severity: 'violation',
    penalty: 10,
    maxPenalized: 2,
    message: 'Превышение максимальной скорости (VMO/MMO)',
    when: (s) => s.overspeedWarning
  },
  {
    code: 'stall',
    severity: 'critical',
    penalty: 15,
    maxPenalized: 2,
    message: 'Сигнализация сваливания',
    when: (s) => airborne(s) && s.stallWarning
  },
  {
    code: 'beacon_off',
    severity: 'warning',
    penalty: 3,
    maxPenalized: 1,
    holdMs: 10000,
    message: 'Двигатели работают, маяк (beacon) выключен',
    when: (s) => s.enginesRunning > 0 && s.lights.beacon === false
  },
  {
    code: 'nav_off',
    severity: 'warning',
    penalty: 1,
    maxPenalized: 1,
    holdMs: 10000,
    message: 'Навигационные огни выключены',
    when: (s) => s.enginesRunning > 0 && s.lights.nav === false
  },
  {
    code: 'strobe_off',
    severity: 'warning',
    penalty: 2,
    maxPenalized: 1,
    holdMs: 15000,
    message: 'В полёте выключены стробы',
    when: (s) => airborne(s) && s.lights.strobe === false
  },
  {
    code: 'landing_lights_off',
    severity: 'warning',
    penalty: 2,
    maxPenalized: 2,
    holdMs: 15000,
    message: 'Посадочные фары выключены ниже 5 000 ft',
    when: (s, ctx) =>
      airborne(s) && s.altFt < LANDING_LIGHTS_BELOW_FT && AIRBORNE_PHASES.includes(ctx.phase) && s.lights.landing === false
  },
  {
    code: 'taxi_speed',
    severity: 'warning',
    penalty: 3,
    maxPenalized: 2,
    holdMs: 5000,
    message: 'Скорость руления больше 30 узлов',
    when: (s, ctx) => s.onGround && taxiing(ctx) && s.gsKt > 30
  },
  {
    code: 'excess_bank',
    severity: 'warning',
    penalty: 3,
    maxPenalized: 3,
    holdMs: 3000,
    message: 'Крен больше 35° — пассажирам некомфортно',
    when: (s) => airborne(s) && Math.abs(s.bankDeg) > 35
  },
  {
    code: 'excess_pitch',
    severity: 'warning',
    penalty: 3,
    maxPenalized: 3,
    holdMs: 3000,
    message: 'Тангаж вне комфортных пределов (+20° / −10°)',
    when: (s) => airborne(s) && (s.pitchDeg > 20 || s.pitchDeg < -10)
  },
  {
    code: 'slew',
    severity: 'critical',
    penalty: 20,
    maxPenalized: 1,
    message: 'Использован режим slew (перемещение самолёта)',
    when: (s) => s.slew
  },
  {
    code: 'sim_rate',
    severity: 'info',
    penalty: 0,
    holdMs: 2000,
    message: 'Ускорение времени в симуляторе',
    when: (s) => s.simRate > 1.01
  },
  {
    code: 'pause',
    severity: 'info',
    penalty: 0,
    message: 'Симулятор на паузе',
    when: (s) => s.paused
  }
]

/** Условие должно пропасть на столько мс, чтобы следующее срабатывание считалось новым эпизодом. */
const CLEAR_MS = 5000

interface RuleState {
  since: number | null
  firing: boolean
  falseSince: number | null
  penalized: number
}

export class RuleEngine {
  private state = new Map<string, RuleState>(RULES.map((r) => [r.code, { since: null, firing: false, falseSince: null, penalized: 0 }]))

  /** Проверяет сэмпл и возвращает новые события. */
  check(s: SimSample, ctx: RuleContext): TrackerEvent[] {
    const out: TrackerEvent[] = []
    for (const rule of RULES) {
      // На паузе проверяем только саму паузу и slew — остальные значения «заморожены».
      if (s.paused && rule.code !== 'pause' && rule.code !== 'slew') continue
      const st = this.state.get(rule.code)!
      if (rule.when(s, ctx)) {
        st.falseSince = null
        st.since ??= s.t
        if (!st.firing && s.t - st.since >= (rule.holdMs ?? 0)) {
          st.firing = true
          const penalize = st.penalized < (rule.maxPenalized ?? Infinity)
          if (penalize && rule.penalty > 0) st.penalized++
          out.push({
            t: s.t,
            code: rule.code,
            severity: rule.severity,
            message: rule.message,
            penalty: penalize ? rule.penalty : 0,
            phase: ctx.phase
          })
        }
      } else {
        st.since = null
        if (st.firing) {
          st.falseSince ??= s.t
          if (s.t - st.falseSince >= CLEAR_MS) {
            st.firing = false
            st.falseSince = null
          }
        }
      }
    }
    return out
  }
}
