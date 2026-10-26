/** Телеметрия и состояние трекера — общие для main-процесса и интерфейса. */

export interface LightsState {
  /** null — состояние неизвестно (у аддона свои переменные, профиль не проверен). */
  beacon: boolean | null
  strobe: boolean | null
  landing: boolean | null
  nav: boolean | null
  taxi: boolean | null
}

export interface SimSample {
  /** Время сэмпла, мс UTC. У демо-полёта — виртуальное время. */
  t: number
  lat: number
  lon: number
  /** Высота над уровнем моря, ft. */
  altFt: number
  altAglFt: number
  headingDeg: number
  iasKt: number
  gsKt: number
  mach: number
  vsFpm: number
  /** Тангаж, градусы: плюс — нос вверх. */
  pitchDeg: number
  /** Крен, градусы. */
  bankDeg: number
  gForce: number
  onGround: boolean
  parkingBrake: boolean
  gearDown: boolean
  flapsPct: number
  enginesRunning: number
  fuelKg: number
  weightKg: number
  pushback: boolean
  stallWarning: boolean
  overspeedWarning: boolean
  paused: boolean
  slew: boolean
  simRate: number
  crashed: boolean
  lights: LightsState
  /** Скорость касания по данным симулятора, fpm (отрицательная), если известна. */
  touchdownVsFpm?: number
  /** Сырые значения переменных — для диагностики профилей аддонов. */
  raw?: Record<string, number>
}

export interface AircraftInfo {
  title: string
  /** ID типа из каталога (data/aircraft-types.json), если опознан. */
  typeId: string | null
  typeName: string | null
  /** Профиль аддона, если опознан. */
  profileId: string | null
  profileName: string | null
  /** Проверен ли профиль на реальном симуляторе: иначе свет не проверяется. */
  profileVerified: boolean
}

export type SimConnectionStatus = 'disconnected' | 'connecting' | 'connected'

/** Снимок для экрана «Проверка симулятора»: по нему сверяем переменные и профили с реальным MSFS. */
export interface SimDiagnostics {
  status: SimConnectionStatus
  /** Имя и версия симулятора из ответа SimConnect на подключение. */
  simName: string | null
  simVersion: string | null
  title: string | null
  atcModel: string | null
  atcType: string | null
  /** Путь к aircraft.cfg загруженного самолёта (системное состояние AircraftLoaded). */
  aircraftPath: string | null
  aircraft: AircraftInfo | null
  /** Сырые значения: основные переменные, L-переменные профиля и пробы. Ключ — имя переменной. */
  vars: Record<string, number>
  /** Пробные переменные, заданные вручную (например, «L:S_OH_EXT_LT_BEACON»). */
  probes: string[]
  /** Последние события Pause_EX1 с сырым значением флагов. */
  pauseEvents: { t: number; data: number }[]
  /** Последние касания: вертикальная скорость в момент касания и значение PLANE TOUCHDOWN NORMAL VELOCITY. */
  touchdowns: { t: number; vsFpm: number; touchdownRaw: number; pitchRaw: number; gForce: number }[]
  /** Ошибки SimConnect: обычно это неизвестная переменная или неверная единица. */
  exceptions: { t: number; code: number; what: string | null }[]
}

export type FlightPhase =
  | 'preflight'
  | 'pushback'
  | 'taxi_out'
  | 'takeoff'
  | 'climb'
  | 'cruise'
  | 'descent'
  | 'approach'
  | 'landing'
  | 'taxi_in'
  | 'on_block'

export type EventSeverity = 'info' | 'warning' | 'violation' | 'critical'

export interface TrackerEvent {
  t: number
  code: string
  severity: EventSeverity
  message: string
  /** Сколько баллов снято за событие. */
  penalty: number
  phase: FlightPhase
}

export interface LandingReport {
  t: number
  vsFpm: number
  gForce: number
  iasKt: number
  pitchDeg: number
  bankDeg: number
  bounces: number
  grade: string
  penalty: number
}

export type FlightSource = 'msfs' | 'demo'

export interface TrackerState {
  active: boolean
  source: FlightSource | null
  phase: FlightPhase
  sample: SimSample | null
  aircraft: AircraftInfo | null
  departure: string | null
  events: TrackerEvent[]
  landing: LandingReport | null
  score: number
  blockOffAt: number | null
  takeoffAt: number | null
  landingAt: number | null
  blockOnAt: number | null
  fuelUsedKg: number
  distanceKm: number
  maxAltFt: number
  /** Бронь, по которой выполняется полёт (null — свободный полёт). */
  bookingId?: number | null
}

export type FlightStatus = 'completed' | 'aborted' | 'crashed'

export interface FlightRecord {
  id: number
  source: FlightSource
  status: FlightStatus
  departure: string | null
  arrival: string | null
  aircraftTitle: string
  aircraftType: string | null
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
  /** Трек: [t, lat, lon, altFt] каждые ~15 с. */
  track: [number, number, number, number][]
  delayCode: string | null
  createdAt: string
}

export const PHASE_LABEL: Record<FlightPhase, string> = {
  preflight: 'Подготовка',
  pushback: 'Буксировка',
  taxi_out: 'Руление на ВПП',
  takeoff: 'Взлёт',
  climb: 'Набор высоты',
  cruise: 'Крейсерский полёт',
  descent: 'Снижение',
  approach: 'Заход на посадку',
  landing: 'Посадка',
  taxi_in: 'Руление на стоянку',
  on_block: 'На стоянке'
}

/** Ограничение скорости ниже FL100 и допуск к нему: штраф — только выше 260 узлов. */
export const FL100_SPEED_LIMIT = 250
export const SPEED_TOLERANCE_KT = 10
/** Сколько секунд даётся, чтобы снизить скорость, прежде чем снять баллы. */
export const OVERSPEED_GRACE_S = 15
/** Посадочные фары можно включать где угодно между 10 000 ft и этой высотой. */
export const LANDING_LIGHTS_BELOW_FT = 5000
