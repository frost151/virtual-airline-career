import type { LightsState, SimSample } from '@shared/sim'
import type { Airport } from '@shared/world'
import { bearingDeg, destinationPoint, distanceKm } from '../tracker/geo'

const KT_TO_KMS = 1.852 / 3600
const OEW_KG = 42600
const PAYLOAD_KG = 14000

/**
 * Синтетический полёт A320 от гейта до гейта.
 * Нужен, чтобы проверять трекер без симулятора. В наборе специально есть
 * 20-секундное превышение 250 узлов ниже FL100 (дольше отсрочки в 15 с) — трекер должен его поймать.
 */
export function generateDemoFlight(dep: Airport, arr: Airport, startT: number): SimSample[] {
  const out: SimSample[] = []
  const course = bearingDeg(dep.lat, dep.lon, arr.lat, arr.lon)
  const totalKm = distanceKm(dep.lat, dep.lon, arr.lat, arr.lon)
  const cruiseAlt = Math.min(35000, Math.round((totalKm * 50) / 1000) * 1000)

  let t = startT
  let lat = dep.lat
  let lon = dep.lon
  let alt = dep.elevFt
  let heading = course
  let ias = 0
  let vs = 0
  // Топлива — на перелёт плюс резерв, чтобы демо работало и на дальних маршрутах.
  let fuel = Math.max(6800, Math.round((totalKm / (450 * KT_TO_KMS)) * 0.8 + 3000))
  let engines = 0
  let onGround = true
  let gearDown = true
  let flaps = 0
  let pushback = false
  let parkingBrake = true
  let pitch = 0
  let g = 1
  const lights: LightsState = { beacon: false, strobe: false, landing: false, nav: true, taxi: false }

  const tas = () => ias * (1 + Math.max(0, alt) / 1000 * 0.02)
  const emit = () => {
    const gs = onGround ? ias : tas()
    out.push({
      t,
      lat,
      lon,
      altFt: alt,
      altAglFt: Math.max(0, alt - (onGround ? alt : groundElevation())),
      headingDeg: heading,
      iasKt: ias,
      gsKt: gs,
      mach: tas() / 661,
      vsFpm: vs,
      pitchDeg: pitch,
      bankDeg: 0,
      gForce: g,
      onGround,
      parkingBrake,
      gearDown,
      flapsPct: flaps,
      enginesRunning: engines,
      fuelKg: fuel,
      weightKg: OEW_KG + PAYLOAD_KG + fuel,
      pushback,
      stallWarning: false,
      overspeedWarning: false,
      paused: false,
      slew: false,
      simRate: 1,
      crashed: false,
      lights: { ...lights }
    })
  }
  // Пока летим, рельеф считаем плавным переходом от высоты вылета к высоте прилёта.
  const groundElevation = () => {
    const rem = distanceKm(lat, lon, arr.lat, arr.lon)
    return rem > totalKm / 2 ? dep.elevFt : arr.elevFt
  }
  const move = (dt: number, speedKt: number, hdg: number) => {
    ;[lat, lon] = destinationPoint(lat, lon, hdg, speedKt * KT_TO_KMS * dt)
  }
  const burn = (dt: number, kgPerSec: number) => {
    fuel -= kgPerSec * dt * (engines / 2)
  }
  const step = (dt: number) => {
    t += dt * 1000
  }

  // 1. На стоянке: подготовка, маяк, запуск двигателей в буксировке.
  for (let s = 0; s < 120; s++) {
    if (s === 90) lights.beacon = true
    emit()
    step(1)
  }

  // 2. Буксировка назад.
  pushback = true
  parkingBrake = false
  for (let s = 0; s < 120; s++) {
    if (s === 30) engines = 1
    if (s === 60) engines = 2
    ias = s < 100 ? 2 : 0
    move(1, ias, (course + 180) % 360)
    burn(1, 0.2)
    emit()
    step(1)
  }
  pushback = false

  // 3. Руление к полосе.
  lights.taxi = true
  flaps = 25
  for (let s = 0; s < 360; s++) {
    ias = s < 340 ? 15 : 5
    move(1, ias, course)
    burn(1, 0.2)
    if (s === 350) {
      lights.strobe = true
      lights.landing = true
      lights.taxi = false
    }
    emit()
    step(1)
  }

  // 4. Разбег и отрыв.
  while (ias < 150) {
    ias += 3
    pitch = ias > 140 ? 8 : 0
    move(1, ias, course)
    burn(1, 1.5)
    emit()
    step(1)
  }
  onGround = false

  // 5. Полёт: набор, крейсер, снижение, заход.
  let airborneSec = 0
  let blipLeft = 20
  let mode: 'climb' | 'cruise' | 'descent' | 'approach' = 'climb'
  for (;;) {
    const agl = alt - groundElevation()
    const dt = agl < 300 && mode === 'approach' ? 0.25 : 1
    const remaining = distanceKm(lat, lon, arr.lat, arr.lon)
    heading = bearingDeg(lat, lon, arr.lat, arr.lon)
    airborneSec += dt

    if (airborneSec > 30) {
      gearDown = mode === 'approach' && agl < 2500
      flaps = mode === 'approach' ? (agl < 2000 ? 100 : 50) : airborneSec > 90 ? 0 : 25
    }

    const todKm = ((alt - arr.elevFt - 3000) / 1000) * 3.2 * 1.852 + 18
    if (mode === 'climb' && alt >= cruiseAlt) mode = 'cruise'
    if ((mode === 'climb' || mode === 'cruise') && remaining <= todKm) mode = 'descent'
    if (mode === 'descent' && agl <= 3000) mode = 'approach'

    const gsKms = tas() * KT_TO_KMS
    switch (mode) {
      case 'climb':
        vs = alt < 10000 ? 2500 : Math.max(1200, 2500 - (alt - 10000) / 20)
        ias = alt < 10000 ? (alt > 6000 && blipLeft > 0 ? 268 : 250) : 290
        if (alt > 6000 && blipLeft > 0) blipLeft -= dt
        pitch = 8
        burn(dt, 1.0)
        break
      case 'cruise':
        vs = 0
        ias = 280
        pitch = 2.5
        burn(dt, 0.7)
        break
      case 'descent': {
        const toGate = Math.max(1, (remaining - 17.5) / gsKms)
        vs = Math.max(-3500, Math.min(-500, (-(agl - 3000) / toGate) * 60))
        ias = alt < 11000 ? (agl < 5000 ? 210 : 250) : 280
        pitch = -1
        burn(dt, 0.25)
        break
      }
      case 'approach': {
        const toTouch = Math.max(1, remaining / gsKms)
        vs = agl < 30 ? -160 : Math.max(-1200, Math.min(-300, (-agl / toTouch) * 60))
        ias = agl < 1500 ? 140 : 170
        pitch = agl < 30 ? 5 : 2.5
        burn(dt, 0.45)
        break
      }
    }
    if (alt < 10000) lights.landing = true
    else if (mode === 'climb' || mode === 'cruise') lights.landing = false

    alt = Math.min(cruiseAlt, alt + (vs / 60) * dt)
    move(dt, tas(), heading)
    step(dt)

    if (mode === 'approach' && alt <= arr.elevFt) {
      alt = arr.elevFt
      onGround = true
      g = 1.12
      emit()
      break
    }
    emit()
  }

  // 6. Пробег.
  vs = 0
  g = 1
  pitch = 0
  while (ias > 20) {
    ias = Math.max(20, ias - 3)
    move(1, ias, heading)
    burn(1, 0.3)
    emit()
    step(1)
  }

  // 7. Руление на стоянку.
  lights.landing = false
  lights.strobe = false
  lights.taxi = true
  flaps = 0
  for (let s = 0; s < 300; s++) {
    ias = 12
    move(1, ias, heading)
    burn(1, 0.2)
    emit()
    step(1)
  }

  // 8. Стоянка, выключение.
  ias = 0
  parkingBrake = true
  lights.taxi = false
  for (let s = 0; s < 120; s++) {
    if (s === 30) engines = 0
    if (s === 60) lights.beacon = false
    emit()
    step(1)
  }
  return out
}

/** Проигрывает готовый массив сэмплов с ускорением времени. */
export class DemoSource {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private samples: SimSample[],
    private speed: number
  ) {}

  start(onSample: (s: SimSample) => void, onEnd: () => void): void {
    const realStart = Date.now()
    const simStart = this.samples[0].t
    let i = 0
    this.timer = setInterval(() => {
      const simNow = simStart + (Date.now() - realStart) * this.speed
      while (i < this.samples.length && this.samples[i].t <= simNow) onSample(this.samples[i++])
      if (i >= this.samples.length) {
        this.stop()
        onEnd()
      }
    }, 50)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
