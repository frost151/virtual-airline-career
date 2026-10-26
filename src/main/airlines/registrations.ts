import { hashString, seededRng } from '@shared/random'
import { aircraftTypes } from '../world'

/**
 * Регистрационные номера бортов. Шаблоны повторяют серии, в которых авиакомпании регистрируют
 * свои самолёты (D-AI.. у Lufthansa, A6-E.. у Emirates, N...AN у American); конкретные буквы и цифры
 * генерируются. @ — буква, # — цифра.
 */

const AIRLINE_PATTERNS: Record<string, string[]> = {
  AAL: ['N###AN', 'N###NN'],
  DAL: ['N###DN', 'N###NW'],
  UAL: ['N###UA', 'N####U'],
  SWA: ['N###WN', 'N8###Q'],
  FDX: ['N###FD', 'N###FE'],
  UPS: ['N###UP'],
  ACA: ['C-F@@@', 'C-G@@@'],
  AMX: ['XA-@@@', 'N9##AM'],
  LAN: ['CC-B@@', 'CC-A@@'],
  AVA: ['N###AV'],
  CMP: ['HP-####CMP'],
  GLO: ['PR-G@@', 'PR-X@@'],
  ARG: ['LV-@@@'],
  CPA: ['B-H@@', 'B-K@@', 'B-@@@'],
  JAL: ['JA###J'],
  ANA: ['JA###A'],
  KAL: ['HL####'],
  SIA: ['9V-S@@'],
  THA: ['HS-T@@'],
  HVN: ['VN-A###'],
  MAS: ['9M-M@@'],
  AXM: ['9M-A@@', '9M-R@@'],
  GIA: ['PK-G@@'],
  PAL: ['RP-C####'],
  IGO: ['VT-I@@'],
  AIC: ['VT-A@@', 'VT-J@@'],
  EVA: ['B-16###'],
  QFA: ['VH-O@@', 'VH-V@@', 'VH-Z@@'],
  ANZ: ['ZK-N@@', 'ZK-O@@'],
  AFL: ['RA-73###'],
  SDM: ['RA-73###', 'EI-@@@'],
  PBD: ['RA-73###'],
  SBI: ['VQ-B@@', 'RA-73###'],
  SVR: ['VQ-B@@', 'RA-73###'],
  VDA: ['RA-82###'],
  BCS: ['D-A@@@'],
  DLH: ['D-AI@@', 'D-AB@@'],
  CLX: ['LX-V@@', 'LX-@@@'],
  AFR: ['F-G@@@', 'F-H@@@'],
  KLM: ['PH-B@@', 'PH-E@@'],
  BAW: ['G-EU@@', 'G-XW@@', 'G-ST@@'],
  EZY: ['G-EZ@@', 'G-UZ@@', 'OE-I@@'],
  IBE: ['EC-@@@'],
  ITY: ['EI-@@@'],
  SWR: ['HB-J@@'],
  AUA: ['OE-@@@'],
  SAS: ['SE-R@@', 'LN-R@@', 'OY-K@@'],
  FIN: ['OH-@@@'],
  LOT: ['SP-@@@'],
  TAP: ['CS-T@@'],
  AEE: ['SX-D@@'],
  THY: ['TC-J@@', 'TC-@@@'],
  RYR: ['EI-D@@', 'EI-E@@', 'EI-F@@'],
  WZZ: ['HA-@@@', '9H-W@@', 'G-WU@@'],
  BEL: ['OO-S@@'],
  TVS: ['OK-@@@'],
  ASL: ['YU-A@@'],
  ICE: ['TF-I@@', 'TF-F@@'],
  UAE: ['A6-E@@'],
  ETD: ['A6-A@@', 'A6-B@@'],
  FDB: ['A6-F@@'],
  QTR: ['A7-A@@', 'A7-B@@'],
  SVA: ['HZ-A@@'],
  ELY: ['4X-E@@'],
  RJA: ['JY-A@@'],
  OMA: ['A4O-@@'],
  ETH: ['ET-A@@'],
  MSR: ['SU-G@@'],
  RAM: ['CN-R@@'],
  KQA: ['5Y-K@@'],
  SAA: ['ZS-S@@'],
  BRU: ['EW-###PA'],
  UZB: ['UK-#####'],
  KZR: ['P4-@@@'],
  AHY: ['4K-AZ##']
}

/** Серии по стране — для своих компаний игрока и тех, кого нет в списке выше. */
const COUNTRY_PATTERNS: Record<string, string> = {
  US: 'N###@@', CA: 'C-G@@@', MX: 'XA-@@@', CL: 'CC-@@@', CO: 'HK-####', PA: 'HP-####', BR: 'PR-@@@', AR: 'LV-@@@',
  CN: 'B-####', HK: 'B-@@@', JP: 'JA###@', KR: 'HL####', SG: '9V-@@@', TH: 'HS-@@@', VN: 'VN-A###', MY: '9M-@@@', ID: 'PK-@@@',
  PH: 'RP-C####', IN: 'VT-@@@', TW: 'B-#####', AU: 'VH-@@@', NZ: 'ZK-@@@', RU: 'RA-7####', DE: 'D-A@@@', LU: 'LX-@@@',
  FR: 'F-H@@@', NL: 'PH-@@@', GB: 'G-@@@@', ES: 'EC-@@@', IT: 'I-@@@@', CH: 'HB-@@@', AT: 'OE-@@@', DK: 'OY-@@@',
  SE: 'SE-@@@', NO: 'LN-@@@', FI: 'OH-@@@', PL: 'SP-@@@', PT: 'CS-@@@', GR: 'SX-@@@', TR: 'TC-@@@', IE: 'EI-@@@',
  HU: 'HA-@@@', BE: 'OO-@@@', CZ: 'OK-@@@', RS: 'YU-@@@', IS: 'TF-@@@', AE: 'A6-@@@', QA: 'A7-@@@', SA: 'HZ-@@@',
  IL: '4X-@@@', JO: 'JY-@@@', OM: 'A4O-@@', ET: 'ET-@@@', EG: 'SU-@@@', MA: 'CN-@@@', KE: '5Y-@@@', ZA: 'ZS-@@@',
  BY: 'EW-###@@', UZ: 'UK-#####', KZ: 'UP-@####', AZ: '4K-@@###', UA: 'UR-@@@', AM: 'EK-#####', GE: '4L-@@@'
}

/** Российские серии зависят от типа: Superjet — RA-89xxx, Ил-96 — RA-96xxx, Ан-124 — RA-82xxx. */
function russianPattern(typeId: string): string | null {
  const t = aircraftTypes.get(typeId)
  if (!t) return null
  if (t.icao === 'SU95') return 'RA-89###'
  if (t.icao === 'IL96') return 'RA-96###'
  if (t.icao === 'A124') return 'RA-82###'
  if (t.icao === 'IL76') return 'RA-76###'
  return null
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

function fill(pattern: string, rng: () => number): string {
  let out = ''
  for (const ch of pattern) {
    if (ch === '@') out += LETTERS[Math.floor(rng() * LETTERS.length)]
    else if (ch === '#') out += String(Math.floor(rng() * 10))
    else out += ch
  }
  // У американских номеров после N не бывает нуля.
  return out.replace(/^N0/, 'N1')
}

export function registrationPattern(icao: string, country: string, typeId: string): string[] {
  const own = AIRLINE_PATTERNS[icao]
  const ru = country === 'RU' ? russianPattern(typeId) : null
  if (ru) return [ru]
  return own ?? [COUNTRY_PATTERNS[country] ?? '@@-@@@']
}

/** Новая регистрация, которой ещё нет среди taken. */
export function newRegistration(icao: string, country: string, typeId: string, taken: Set<string>, salt: string): string {
  const patterns = registrationPattern(icao, country, typeId)
  const rng = seededRng(`${icao}|${typeId}|${salt}`)
  for (let i = 0; i < 200; i++) {
    const reg = fill(patterns[hashString(`${salt}|${i}`) % patterns.length], rng)
    if (!taken.has(reg)) return reg
  }
  return `${icao}-${salt}`
}

/** Регистрация, введённая игроком: латиница, цифры и дефис. */
export function normalizeRegistration(reg: string): string {
  const r = reg.trim().toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9-]{2,9}$/.test(r)) throw new Error('Регистрация — от 3 до 10 знаков: латинские буквы, цифры и дефис')
  return r
}
