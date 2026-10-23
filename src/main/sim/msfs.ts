import {
  open,
  Protocol,
  SimConnectConstants,
  SimConnectDataType,
  SimConnectPeriod,
  DataRequestFlag,
  type SimConnectConnection
} from 'node-simconnect'
import type { AircraftInfo, LightsState, SimConnectionStatus, SimSample } from '@shared/sim'
import { identifyAircraft, type AircraftProfile, type LightKey } from './aircraft'

const LB_TO_KG = 0.45359237
const RECONNECT_MS = 5000
/** Чаще не отдаём — трекеру хватает 10 Гц; касание ловится отдельно. */
const MIN_SAMPLE_MS = 100

enum Def {
  Main = 1,
  Ident = 2,
  Lvars = 3
}
enum Req {
  Main = 1,
  Ident = 2,
  Lvars = 3
}
enum Evt {
  Pause = 1
}

/** Порядок важен: в нём же читаем ответ. */
const MAIN_VARS: [name: string, unit: string][] = [
  ['PLANE LATITUDE', 'degrees'],
  ['PLANE LONGITUDE', 'degrees'],
  ['PLANE ALTITUDE', 'feet'],
  ['PLANE ALT ABOVE GROUND MINUS CG', 'feet'],
  ['PLANE HEADING DEGREES TRUE', 'degrees'],
  ['AIRSPEED INDICATED', 'knots'],
  ['GROUND VELOCITY', 'knots'],
  ['AIRSPEED MACH', 'mach'],
  ['VERTICAL SPEED', 'feet per minute'],
  ['PLANE PITCH DEGREES', 'degrees'],
  ['PLANE BANK DEGREES', 'degrees'],
  ['G FORCE', 'gforce'],
  ['SIM ON GROUND', 'bool'],
  ['BRAKE PARKING POSITION', 'bool'],
  ['GEAR HANDLE POSITION', 'bool'],
  ['TRAILING EDGE FLAPS LEFT PERCENT', 'percent'],
  ['GENERAL ENG COMBUSTION:1', 'bool'],
  ['GENERAL ENG COMBUSTION:2', 'bool'],
  ['GENERAL ENG COMBUSTION:3', 'bool'],
  ['GENERAL ENG COMBUSTION:4', 'bool'],
  ['FUEL TOTAL QUANTITY WEIGHT', 'pounds'],
  ['TOTAL WEIGHT', 'pounds'],
  ['PUSHBACK STATE', 'enum'],
  ['STALL WARNING', 'bool'],
  ['OVERSPEED WARNING', 'bool'],
  ['IS SLEW ACTIVE', 'bool'],
  ['SIMULATION RATE', 'number'],
  ['CRASH FLAG', 'enum'],
  ['LIGHT BEACON', 'bool'],
  ['LIGHT STROBE', 'bool'],
  ['LIGHT LANDING', 'bool'],
  ['LIGHT NAV', 'bool'],
  ['LIGHT TAXI', 'bool'],
  ['PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second']
]

const STANDARD_LIGHTS: Record<LightKey, string> = {
  beacon: 'LIGHT BEACON',
  strobe: 'LIGHT STROBE',
  landing: 'LIGHT LANDING',
  nav: 'LIGHT NAV',
  taxi: 'LIGHT TAXI'
}

export interface MsfsListener {
  status(s: SimConnectionStatus): void
  sample(s: SimSample): void
  aircraft(a: AircraftInfo): void
}

/**
 * Подключение к MSFS 2024 через SimConnect с автоматическим переподключением.
 * Отдаёт телеметрию, опознанный самолёт и статус соединения.
 */
export class MsfsSource {
  status: SimConnectionStatus = 'disconnected'
  aircraft: AircraftInfo | null = null
  private handle: SimConnectConnection | null = null
  private profile: AircraftProfile | null = null
  private lvarValues: Record<string, number> = {}
  private lvarNames: [LightKey, string][] = []
  private paused = false
  private lastEmit = 0
  private lastOnGround: boolean | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(private listener: MsfsListener) {}

  start(): void {
    this.stopped = false
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.handle?.close()
    this.handle = null
    this.setStatus('disconnected')
  }

  private setStatus(s: SimConnectionStatus): void {
    if (this.status === s) return
    this.status = s
    this.listener.status(s)
  }

  private scheduleReconnect(): void {
    this.handle = null
    this.aircraft = null
    this.profile = null
    if (this.stopped) return
    this.setStatus('disconnected')
    this.reconnectTimer = setTimeout(() => void this.connect(), RECONNECT_MS)
  }

  private async connect(): Promise<void> {
    this.setStatus('connecting')
    try {
      // KittyHawk — минимальная версия протокола; MSFS 2024 её поддерживает.
      const { handle } = await open('Virtual Airline Career', Protocol.KittyHawk)
      this.handle = handle
      this.setStatus('connected')
      this.setup(handle)
    } catch {
      this.scheduleReconnect()
    }
  }

  private setup(h: SimConnectConnection): void {
    for (const [name, unit] of MAIN_VARS) h.addToDataDefinition(Def.Main, name, unit, SimConnectDataType.FLOAT64)
    h.requestDataOnSimObject(Req.Main, Def.Main, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.VISUAL_FRAME)

    h.addToDataDefinition(Def.Ident, 'TITLE', null, SimConnectDataType.STRING256)
    h.addToDataDefinition(Def.Ident, 'ATC MODEL', null, SimConnectDataType.STRING256)
    h.requestDataOnSimObject(
      Req.Ident,
      Def.Ident,
      SimConnectConstants.OBJECT_ID_USER,
      SimConnectPeriod.SECOND,
      DataRequestFlag.DATA_REQUEST_FLAG_CHANGED
    )

    h.subscribeToSystemEvent(Evt.Pause, 'Pause_EX1')

    h.on('event', (e) => {
      if (e.clientEventId === Evt.Pause) this.paused = e.data !== 0
    })
    h.on('simObjectData', (recv) => {
      if (recv.requestID === Req.Main) this.onMain(recv.data)
      else if (recv.requestID === Req.Ident) this.onIdent(recv.data.readString256(), recv.data.readString256())
      else if (recv.requestID === Req.Lvars) {
        for (const [, name] of this.lvarNames) this.lvarValues[name] = recv.data.readFloat64()
      }
    })
    h.on('quit', () => this.scheduleReconnect())
    h.on('close', () => this.scheduleReconnect())
    h.on('error', () => this.scheduleReconnect())
  }

  private onIdent(title: string, atcModel: string): void {
    const { info, profile } = identifyAircraft(title, atcModel)
    this.aircraft = info
    this.listener.aircraft(info)
    if (profile?.id !== this.profile?.id) this.subscribeLvars(profile)
  }

  /** Переопределяет запрос L-переменных под профиль аддона. */
  private subscribeLvars(profile: AircraftProfile | null): void {
    const h = this.handle
    if (!h) return
    this.profile = profile
    h.clearDataDefinition(Def.Lvars)
    this.lvarValues = {}
    this.lvarNames = profile?.lvars ? (Object.entries(profile.lvars).map(([k, v]) => [k, v!.name]) as [LightKey, string][]) : []
    if (!this.lvarNames.length) return
    for (const [, name] of this.lvarNames) h.addToDataDefinition(Def.Lvars, name, 'number', SimConnectDataType.FLOAT64)
    h.requestDataOnSimObject(Req.Lvars, Def.Lvars, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND)
  }

  private onMain(data: { readFloat64(): number }): void {
    const v: Record<string, number> = {}
    for (const [name] of MAIN_VARS) v[name] = data.readFloat64()

    const now = Date.now()
    const onGround = v['SIM ON GROUND'] !== 0
    // Момент касания/отрыва пропускаем всегда, остальное — не чаще MIN_SAMPLE_MS.
    if (onGround === this.lastOnGround && now - this.lastEmit < MIN_SAMPLE_MS) return
    this.lastEmit = now
    this.lastOnGround = onGround

    const raw: Record<string, number> = {}
    for (const name of Object.values(STANDARD_LIGHTS)) raw[name] = v[name]
    Object.assign(raw, this.lvarValues)

    const touchdown = v['PLANE TOUCHDOWN NORMAL VELOCITY']
    this.listener.sample({
      t: now,
      lat: v['PLANE LATITUDE'],
      lon: v['PLANE LONGITUDE'],
      altFt: v['PLANE ALTITUDE'],
      altAglFt: Math.max(0, v['PLANE ALT ABOVE GROUND MINUS CG']),
      headingDeg: v['PLANE HEADING DEGREES TRUE'],
      iasKt: v['AIRSPEED INDICATED'],
      gsKt: v['GROUND VELOCITY'],
      mach: v['AIRSPEED MACH'],
      vsFpm: v['VERTICAL SPEED'],
      // В MSFS положительный тангаж — нос вниз.
      pitchDeg: -v['PLANE PITCH DEGREES'],
      bankDeg: v['PLANE BANK DEGREES'],
      gForce: v['G FORCE'],
      onGround,
      parkingBrake: v['BRAKE PARKING POSITION'] !== 0,
      gearDown: v['GEAR HANDLE POSITION'] !== 0,
      flapsPct: v['TRAILING EDGE FLAPS LEFT PERCENT'],
      enginesRunning: [1, 2, 3, 4].filter((i) => v[`GENERAL ENG COMBUSTION:${i}`] !== 0).length,
      fuelKg: v['FUEL TOTAL QUANTITY WEIGHT'] * LB_TO_KG,
      weightKg: v['TOTAL WEIGHT'] * LB_TO_KG,
      // PUSHBACK STATE: 3 — буксировки нет.
      pushback: v['PUSHBACK STATE'] !== 3,
      stallWarning: v['STALL WARNING'] !== 0,
      overspeedWarning: v['OVERSPEED WARNING'] !== 0,
      paused: this.paused,
      slew: v['IS SLEW ACTIVE'] !== 0,
      simRate: v['SIMULATION RATE'],
      crashed: v['CRASH FLAG'] !== 0,
      lights: this.lights(v),
      touchdownVsFpm: touchdown ? -Math.abs(touchdown) * 60 : undefined,
      raw
    })
  }

  private lights(v: Record<string, number>): LightsState {
    const unknown: LightsState = { beacon: null, strobe: null, landing: null, nav: null, taxi: null }
    const p = this.profile
    // Непроверенный профиль аддона: свет считаем неизвестным, чтобы не штрафовать по неверным переменным.
    if (p && !p.verified) return unknown
    if (p?.lights === 'lvars' && p.lvars) {
      const out = { ...unknown }
      for (const [key, def] of Object.entries(p.lvars) as [LightKey, { name: string; onIfAtLeast: number }][]) {
        const val = this.lvarValues[def.name]
        out[key] = val === undefined ? null : val >= def.onIfAtLeast
      }
      return out
    }
    const out = { ...unknown }
    for (const [key, name] of Object.entries(STANDARD_LIGHTS) as [LightKey, string][]) out[key] = v[name] !== 0
    return out
  }
}
