import { describe, expect, it } from 'vitest'
import type { FlightPhase, SimSample } from '@shared/sim'
import { aircraftTypes, airports } from '../world'
import { generateDemoFlight } from '../sim/demo'
import { FlightTracker } from './tracker'

const newTracker = () =>
  new FlightTracker({ source: 'demo', airports, getType: (id) => aircraftTypes.get(id) })

function run(samples: SimSample[]) {
  const tracker = newTracker()
  tracker.setAircraft({
    title: 'Demo A320',
    typeId: 'A320',
    typeName: 'Airbus A320ceo',
    profileId: null,
    profileName: null,
    profileVerified: false
  })
  const phases: FlightPhase[] = [tracker.phase]
  for (const s of samples) {
    tracker.feed(s)
    if (phases[phases.length - 1] !== tracker.phase) phases.push(tracker.phase)
  }
  return { tracker, phases, draft: tracker.finish() }
}

const demo = () => generateDemoFlight(airports.get('ULLI')!, airports.get('UUEE')!, Date.UTC(2026, 9, 23, 10, 0, 0))

describe('FlightTracker на демо-полёте ULLI → UUEE', () => {
  const { phases, draft } = run(demo())

  it('проходит все фазы по порядку', () => {
    expect(phases).toEqual([
      'preflight',
      'pushback',
      'taxi_out',
      'takeoff',
      'climb',
      'cruise',
      'descent',
      'approach',
      'landing',
      'taxi_in',
      'on_block'
    ])
  })

  it('определяет аэропорты и завершает полёт', () => {
    expect(draft.departure).toBe('ULLI')
    expect(draft.arrival).toBe('UUEE')
    expect(draft.status).toBe('completed')
    expect(draft.distanceKm).toBeGreaterThan(600)
    expect(draft.distanceKm).toBeLessThan(700)
    expect(draft.fuelUsedKg).toBeGreaterThan(1500)
  })

  it('оценивает мягкую посадку', () => {
    expect(draft.landing).not.toBeNull()
    expect(draft.landing!.vsFpm).toBe(-160)
    expect(draft.landing!.gForce).toBeCloseTo(1.12)
    expect(draft.landing!.bounces).toBe(0)
    expect(draft.landing!.penalty).toBe(0)
  })

  it('ловит заложенное превышение скорости ниже FL100 — и только его', () => {
    const penalized = draft.events.filter((e) => e.penalty > 0)
    expect(penalized.map((e) => e.code)).toEqual(['overspeed_fl100'])
    expect(draft.score).toBe(95)
  })
})

describe('FlightTracker: нарушения', () => {
  // Худшая оценка (30) уже включает перегрузку, поэтому +10 за g сверху не добавляется.
  it('жёсткая посадка снижает оценку', () => {
    const samples = demo()
    // Делаем касание жёстким: последние 2 с перед касанием снижаемся с −700 fpm.
    const td = samples.findIndex((s, i) => i > 0 && !samples[i - 1].onGround && s.onGround)
    for (let i = td - 1; i >= 0 && samples[td].t - samples[i].t <= 2000; i--) samples[i] = { ...samples[i], vsFpm: -700 }
    samples[td] = { ...samples[td], gForce: 1.9 }
    const { draft } = run(samples)
    expect(draft.landing!.vsFpm).toBe(-700)
    expect(draft.landing!.grade).toContain('Тяжёлая')
    expect(draft.landing!.penalty).toBe(30)
  })

  it('перегрузка добавляет штраф к умеренно жёсткой посадке', () => {
    const samples = demo()
    const td = samples.findIndex((s, i) => i > 0 && !samples[i - 1].onGround && s.onGround)
    for (let i = td - 1; i >= 0 && samples[td].t - samples[i].t <= 2000; i--) samples[i] = { ...samples[i], vsFpm: -350 }
    samples[td] = { ...samples[td], gForce: 1.9 }
    const { draft } = run(samples)
    expect(draft.landing!.grade).toContain('Жёсткая')
    expect(draft.landing!.penalty).toBe(15)
  })

  it('телепорт и дозаправка в воздухе засчитываются', () => {
    const samples = demo()
    const cruiseIdx = samples.findIndex((s) => s.altFt > 20000)
    samples[cruiseIdx] = { ...samples[cruiseIdx], lat: samples[cruiseIdx].lat + 1 }
    for (let i = cruiseIdx + 10; i < samples.length; i++) samples[i] = { ...samples[i], fuelKg: samples[i].fuelKg + 2000 }
    const { draft } = run(samples)
    const codes = draft.events.map((e) => e.code)
    expect(codes).toContain('teleport')
    expect(codes).toContain('refuel_airborne')
  })

  it('незаконченный полёт сохраняется как прерванный', () => {
    const samples = demo()
    const { draft } = run(samples.slice(0, Math.floor(samples.length / 2)))
    expect(draft.status).toBe('aborted')
    expect(draft.arrival).toBeNull()
  })
})
