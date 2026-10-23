import type { Booking, OfpSummary } from '@shared/types'
import { aircraftTypes } from '../world'

const LB_TO_KG = 0.45359237
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Ссылка на SimBrief с заполненными полями рейса: пилот генерирует OFP, EFB аддона его подхватывает. */
export function simbriefDispatchUrl(b: Booking): string {
  const type = aircraftTypes.get(b.typeId)
  const d = new Date(b.depAt)
  const date = `${String(d.getUTCDate()).padStart(2, '0')}${MONTHS[d.getUTCMonth()]}${String(d.getUTCFullYear()).slice(2)}`
  const airline = b.callsign.replace(/\d+$/, '')
  const params = new URLSearchParams({
    airline,
    fltnum: b.callsign.slice(airline.length),
    callsign: b.callsign,
    type: type?.icao ?? b.typeId,
    orig: b.dep,
    dest: b.arr,
    date,
    deph: String(d.getUTCHours()),
    depm: String(d.getUTCMinutes()),
    units: 'KGS',
    pax: String(b.pax),
    // SimBrief принимает груз в тысячах выбранных единиц.
    cargo: (b.cargoKg / 1000).toFixed(1),
    manualrmk: 'Virtual Airline Career'
  })
  return `https://www.simbrief.com/system/dispatch.php?${params}`
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Последний OFP пользователя из открытого API SimBrief. */
export async function fetchLatestOfp(username: string): Promise<OfpSummary> {
  if (!username.trim()) throw new Error('Укажите имя пользователя SimBrief в настройках')
  const url = `https://www.simbrief.com/api/xml.fetcher.php?username=${encodeURIComponent(username.trim())}&json=1`
  let res: Response
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('Не удалось связаться с SimBrief — проверьте интернет')
  }
  const data = (await res.json().catch(() => null)) as Record<string, any> | null
  if (!data) throw new Error('SimBrief вернул непонятный ответ')
  if (data.fetch?.status && data.fetch.status !== 'Success') throw new Error(`SimBrief: ${data.fetch.status}`)

  const toKg = String(data.params?.units ?? 'kgs').toLowerCase().startsWith('lb') ? LB_TO_KG : 1
  return {
    origin: data.origin?.icao_code ?? '',
    destination: data.destination?.icao_code ?? '',
    alternate: data.alternate?.icao_code ?? null,
    route: data.general?.route ?? '',
    cruiseAlt: num(data.general?.initial_altitude),
    rampFuelKg: Math.round(num(data.fuel?.plan_ramp) * toKg),
    tripFuelKg: Math.round(num(data.fuel?.enroute_burn) * toKg),
    zfwKg: Math.round(num(data.weights?.est_zfw) * toKg),
    towKg: Math.round(num(data.weights?.est_tow) * toKg),
    pax: num(data.weights?.pax_count),
    enrouteMin: Math.round(num(data.times?.est_time_enroute) / 60),
    aircraftIcao: data.aircraft?.icaocode ?? ''
  }
}
