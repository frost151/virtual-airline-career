import { app, BrowserWindow } from 'electron'
import { createWriteStream, mkdirSync, type WriteStream } from 'fs'
import { join } from 'path'
import type { AircraftInfo, FlightSource, SimConnectionStatus, SimDiagnostics, SimSample, TrackerState } from '@shared/sim'
import { aircraftTypes, airports } from './world'
import { activeDb } from './profiles'
import type { CareerOutcome, FlightFinished } from '@shared/types'
import { getFlight, saveFlight } from './logbook'
import { getSettings } from './settings'
import { getBooking, onFlightFinished } from './career/career'
import type { CatchUpReport, SkipPreset } from '@shared/economy'
import { advanceWorld } from './economy/clock'
import { clockOffset, worldNow } from './worldTime'
import { prepareDeparture, requireSkippable, skipPresetMs, skipWorld } from './timeSkip'
import { takeRest as restNow } from './lifestyle/life'
import { REST } from './lifestyle/catalog'
import { MsfsSource } from './sim/msfs'
import { DemoSource, generateDemoFlight } from './sim/demo'
import { identifyAircraft } from './sim/aircraft'
import { FlightTracker } from './tracker/tracker'

/** Во сколько раз ускорен демо-полёт: час полёта примерно за две минуты. */
const DEMO_SPEED = Number(process.env.VAC_DEMO_SPEED) || 30
const BROADCAST_MS = 250

let tracker: FlightTracker | null = null
let activeBookingId: number | null = null
let demo: DemoSource | null = null
let recorder: WriteStream | null = null
let lastRecordedT = 0
let idleSample: SimSample | null = null
let dirty = true

const msfs = new MsfsSource({
  status: (s) => send('sim:status', s),
  aircraft: (a) => {
    if (tracker?.source === 'msfs') tracker.setAircraft(a)
    dirty = true
  },
  sample: (s) => {
    idleSample = s
    // Телеметрия MSFS идёт по реальным часам — переводим её на часы мира (с учётом перемотки).
    if (tracker?.source === 'msfs') feed({ ...s, t: s.t + clockOffset(activeDb()) })
    dirty = true
  }
})

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

export function initSession(): void {
  msfs.start()
  setInterval(worldTick, 60_000)
  setInterval(() => {
    if (!dirty) return
    dirty = false
    send('tracker:update', trackerState())
  }, BROADCAST_MS)
}

export function shutdownSession(): void {
  if (tracker) finishFlight()
  msfs.stop()
}

export const simStatus = (): SimConnectionStatus => msfs.status
export const simDiagnostics = (): SimDiagnostics => msfs.diagnostics()
export const setSimProbes = (names: string[]): void => msfs.setProbes(names)

export function trackerState(): TrackerState {
  if (tracker) return { ...tracker.snapshot(), bookingId: activeBookingId }
  return {
    active: false,
    source: null,
    phase: 'preflight',
    sample: idleSample,
    aircraft: msfs.aircraft,
    departure: null,
    events: [],
    landing: null,
    score: 100,
    blockOffAt: null,
    takeoffAt: null,
    landingAt: null,
    blockOnAt: null,
    fuelUsedKg: 0,
    distanceKm: 0,
    maxAltFt: 0,
    bookingId: null
  }
}

/**
 * Начать полёт. По брони игрок выбирает, сколько минут ему нужно до вылета (prepMin):
 * мир перематывается к этому моменту, и вылет будет ровно через выбранное время.
 */
export function startFlight(source: FlightSource, bookingId: number | null = null, prepMin = 30): TrackerState {
  const db = activeDb()
  if (tracker) throw new Error('Полёт уже идёт')
  if (source === 'msfs' && msfs.status !== 'connected') throw new Error('MSFS 2024 не подключён')
  if (bookingId !== null) {
    const report = prepareDeparture(db, bookingId, prepMin)
    if (report) showReport(report)
  }
  const booking = bookingId === null ? null : getBooking(db, bookingId)

  tracker = new FlightTracker({ source, airports, getType: (id) => aircraftTypes.get(id) })
  activeBookingId = booking?.id ?? null
  startRecording()

  if (source === 'msfs') {
    if (msfs.aircraft) tracker.setAircraft(msfs.aircraft)
  } else {
    const type = booking ? aircraftTypes.get(booking.typeId) : undefined
    const demoAircraft: AircraftInfo = type
      ? { title: `${type.name} (демо)`, typeId: type.id, typeName: type.name, profileId: null, profileName: null, profileVerified: false }
      : identifyAircraft('Fenix A320 (демо)', 'A320').info
    tracker.setAircraft(demoAircraft)
    const dep = airports.get(booking?.dep ?? 'ULLI')!
    const arr = airports.get(booking?.arr ?? 'UUEE')!
    demo = new DemoSource(generateDemoFlight(dep, arr, worldNow(db)), DEMO_SPEED)
    demo.start(feed, () => tracker && finishFlight())
  }
  dirty = true
  return tracker.snapshot()
}

/** Завершает полёт вручную или автоматически, пишет его в бортжурнал и передаёт в карьеру. */
export function finishFlight(): FlightFinished | null {
  if (!tracker) return null
  demo?.stop()
  demo = null
  const draft = tracker.finish()
  tracker = null
  const bookingId = activeBookingId
  activeBookingId = null
  recorder?.end()
  recorder = null
  const db = activeDb()
  // Полёт, который даже не начался (не сдвинулись со стоянки), не сохраняем.
  const flightId = draft.blockOffAt === null ? null : saveFlight(db, draft)
  let outcome: CareerOutcome | null = null
  if (flightId !== null && bookingId !== null) {
    outcome = onFlightFinished(db, bookingId, getFlight(db, flightId), getSettings(db).demoCountsForCareer)
  }
  const result: FlightFinished = { flightId, outcome }
  dirty = true
  send('tracker:finished', result)
  return result
}

let pendingReport: CatchUpReport | null = null
/** Сводку «Пока вас не было» показываем, только если отсутствовали заметное время. */
const REPORT_AFTER_MS = 3 * 3_600_000

/** Досчитывает мир при открытии профиля и запоминает сводку для интерфейса. */
export function catchUpOnOpen(): void {
  const db = activeDb()
  const report = advanceWorld(db, worldNow(db))
  pendingReport = report && report.to - report.from >= REPORT_AFTER_MS ? report : null
}

/** Сводку после перемотки показываем сразу: интерфейс заберёт её через takeReport. */
function showReport(report: CatchUpReport): void {
  pendingReport = report
  dirty = true
  send('world:changed', null)
  send('world:report', null)
}

/** Перемотать время (не во время полёта). */
export function skipTime(preset: SkipPreset): void {
  if (tracker) throw new Error('Во время полёта время не перематывается')
  const db = activeDb()
  const report = skipWorld(db, skipPresetMs(db, preset))
  if (report) showReport(report)
  else send('world:changed', null)
}

/** Платный отдых: оплата и эффект сразу, потом мир перематывается на время отдыха. */
export function takeRest(id: string): void {
  if (tracker) throw new Error('Во время полёта отдыхать нельзя')
  const db = activeDb()
  const hours = REST.find((r) => r.id === id)?.hours ?? 0
  requireSkippable(db, hours * 3_600_000)
  restNow(db, id)
  const report = hours ? skipWorld(db, hours * 3_600_000) : null
  if (report) showReport(report)
  else send('world:changed', null)
}

/** Сдвиг часов мира относительно реального времени — интерфейсу для часов в шапке. */
export const worldClockOffset = (): number => clockOffset(activeDb())

export function takeReport(): CatchUpReport | null {
  const r = pendingReport
  pendingReport = null
  return r
}

/** Раз в минуту мир продвигается вперёд (новые сутки, сорванные брони). Во время полёта — ждём. */
function worldTick(): void {
  try {
    if (!tracker && advanceWorld(activeDb(), worldNow(activeDb()))) send('world:changed', null)
  } catch {
    // Профиль не открыт — нечего считать.
  }
}

function feed(s: SimSample): void {
  if (!tracker) return
  tracker.feed(s)
  record(s)
  dirty = true
  if (tracker.finished) finishFlight()
}

/** Пишем телеметрию в файл: 1 Гц, а у земли — всё подряд. Пригодится для разбора полётов. */
function startRecording(): void {
  const dir = join(app.getPath('userData'), 'recordings')
  mkdirSync(dir, { recursive: true })
  const name = new Date().toISOString().replace(/[:.]/g, '-')
  recorder = createWriteStream(join(dir, `${name}.jsonl`))
  lastRecordedT = 0
}

function record(s: SimSample): void {
  if (!recorder) return
  if (s.altAglFt > 200 && s.t - lastRecordedT < 1000) return
  lastRecordedT = s.t
  recorder.write(JSON.stringify(s) + '\n')
}
