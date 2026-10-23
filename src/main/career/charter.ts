import type { CharterOffer, CharterOperator, ClientKind, Person } from '@shared/types'
import type { AircraftType, Airport } from '@shared/world'
import { between, pick, seededRng } from '@shared/random'
import { hourlyRate, ratingFor, rankIndex, type RankId } from '@shared/career'
import type { Db } from '../db'
import { aircraftTypes, airports } from '../world'
import { distanceKm } from '../tracker/geo'
import { generateName } from './names'
import { blockMinutes } from './schedule'
import { countryName } from './text'

/** Вымышленные операторы бизнес-авиации. */
export const CHARTER_OPERATORS: CharterOperator[] = [
  {
    id: 'aurora-exec',
    name: 'Aurora Executive',
    description: 'Европейский оператор бизнес-авиации. Citation X для деловых поездок, ACJ319 — для правительственных делегаций.',
    fleet: ['C750', 'ACJ319']
  },
  {
    id: 'meridian-jet',
    name: 'Meridian Jet Charter',
    description: 'Трансатлантический чартерный оператор: корпоративные клиенты и частные перелёты. Citation X и Boeing Business Jet.',
    fleet: ['C750', 'BBJ']
  },
  {
    id: 'atlant-ba',
    name: 'Атлант Бизнес Авиа',
    description: 'Оператор бизнес-авиации с базами по всему миру. Полный парк: Citation X, ACJ319 и BBJ.',
    fleet: ['C750', 'ACJ319', 'BBJ']
  }
]

export const CHARTER_BASES = ['UUWW', 'ULLI', 'EGGW', 'LFPB', 'LSGG', 'EDDM', 'LIML', 'OMDB', 'KTEB', 'VHHH'].filter((c) => airports.has(c))

/** Должности кабинета — реальные, люди на них — вымышленные. */
const POSITIONS: { key: string; title: string; weight: number }[] = [
  { key: 'pm', title: 'Премьер-министр', weight: 1 },
  { key: 'vpm', title: 'Вице-премьер', weight: 2 },
  { key: 'mfa', title: 'Министр иностранных дел', weight: 4 },
  { key: 'mof', title: 'Министр финансов', weight: 2 },
  { key: 'mod', title: 'Министр обороны', weight: 1 },
  { key: 'econ', title: 'Министр экономики', weight: 2 },
  { key: 'energy', title: 'Министр энергетики', weight: 2 },
  { key: 'health', title: 'Министр здравоохранения', weight: 1 },
  { key: 'transport', title: 'Министр транспорта', weight: 2 },
  { key: 'trade', title: 'Министр торговли', weight: 2 },
  { key: 'speaker', title: 'Председатель парламента', weight: 1 },
  { key: 'cb', title: 'Глава центрального банка', weight: 1 }
]

const COMPANY_A = ['Северо', 'Глобал', 'Транс', 'Альфа', 'Нова', 'Вектор', 'Аркто', 'Меридиан', 'Сигма', 'Орион', 'Гелио', 'Балто']
const COMPANY_B = ['ойл', 'энерго', 'тех', 'групп', 'капитал', 'металл', 'фарм', 'логистик', 'строй', 'агро', 'финанс', 'медиа']
const CORP_ROLES = ['Генеральный директор', 'Председатель совета директоров', 'Финансовый директор', 'Основатель', 'Управляющий партнёр']
/** Род важен: «теннисист» / «теннисистка». */
const PRIVATE_TITLES: [m: string, f: string][] = [
  ['предприниматель', 'предпринимательница'],
  ['инвестор', 'инвестор'],
  ['известный архитектор', 'известный архитектор'],
  ['футболист', 'футболистка'],
  ['теннисист', 'теннисистка'],
  ['оперный певец', 'оперная певица'],
  ['кинорежиссёр', 'кинорежиссёр'],
  ['шеф-повар', 'шеф-повар'],
  ['писатель', 'писательница'],
  ['коллекционер искусства', 'коллекционер искусства']
]
const CLINICS = ['«Здоровье»', '«Медика»', '«Святой Луки»', '«Кардиоцентр»', '«Неотложка+»', '«Авиамед»']

/** Курортные аэропорты для частных клиентов. */
const RESORTS = ['LFMN', 'LEIB', 'LEPA', 'LGMK', 'LGSR', 'LSGS', 'LFLB', 'LIEO', 'LICJ', 'LDDU', 'LTBS', 'LTFE', 'OMDB', 'VRMM', 'FSIA', 'TNCM', 'MYNN', 'KASE', 'KEGE', 'HEGN', 'GCTS', 'LPFR', 'MMUN'].filter((c) =>
  airports.has(c)
)

const REASONS_GOV = [
  'на внеочередной раунд переговоров',
  'на подписание межправительственного соглашения',
  'на срочные консультации с партнёрами',
  'на закрытую встречу по энергетическому сотрудничеству',
  'на саммит, программа которого изменилась в последний момент',
  'на церемонию открытия совместного проекта'
]

const STORIES: Record<ClientKind, ((v: StoryVars) => string)[]> = {
  government: [
    (v) =>
      `${v.who} и ${v.companions} должны срочно попасть в ${v.dest} ${v.reason}. Регулярный рейс отменён, поэтому канцелярия обратилась к вам. Вылет не позднее ${v.deadline} UTC, на борту — конфиденциальные документы.`,
    (v) =>
      `${v.who} возвращается раньше срока: обстоятельства изменились. Протокол просит полной конфиденциальности — никаких фотографий на перроне. Летим в ${v.dest}, вылет не позднее ${v.deadline} UTC.`,
    (v) =>
      `Делегация из ${v.pax} человек летит в ${v.dest} ${v.reason}. Возглавляет её ${v.who}. Служба протокола напоминает: плавный полёт и точность до минуты.`
  ],
  corporate: [
    (v) =>
      `${v.who} летит в ${v.dest} закрывать сделку, которая готовилась полгода. Юристы уже на месте — опоздание может стоить контракта. Вылет не позднее ${v.deadline} UTC.`,
    (v) =>
      `Совет директоров собирается в ${v.dest}. ${v.who} просит тишину в салоне — будет готовиться к выступлению. Пассажиров: ${v.pax}.`,
    (v) =>
      `${v.name}, ${v.titleLower}, внезапно меняет планы: вместо регулярного рейса — ваш самолёт до ${v.destTo}. Клиент ценит пунктуальность и мягкую посадку.`
  ],
  private: [
    (v) =>
      `${v.who} с семьёй летит отдыхать в ${v.dest}. Дети впервые на частном самолёте — постарайтесь, чтобы посадка была мягкой.`,
    (v) =>
      `${v.name}, ${v.title}, спешит на свадьбу лучшего друга в ${v.dest}. Церемония ждать не будет. Вылет не позднее ${v.deadline} UTC.`,
    (v) =>
      `${v.who} летит на закрытую вечеринку в ${v.dest}. Пассажиров: ${v.pax}. Просьба: шампанское охладить, турбулентность — обойти.`
  ],
  special: [
    (v) =>
      `Санитарный рейс: пациента в стабильно тяжёлом состоянии ждут в клинике в ${v.dest}. С ним летит ${v.who}. Каждая минута на счету — вылет не позднее ${v.deadline} UTC.`,
    (v) =>
      `Срочная доставка донорского органа в ${v.dest}. Окно — считаные часы. Сопровождает ${v.who}. Вылет не позднее ${v.deadline} UTC.`,
    (v) =>
      `Срочные документы для суда в ${v.dest}. Курьер — ${v.who}. Опоздание недопустимо: слушание начнётся без них.`
  ]
}

interface StoryVars {
  /** «Министр обороны Викрам Гупта (Индия)» или «Олег Воронцов (инвестор)». */
  who: string
  name: string
  title: string
  titleLower: string
  dest: string
  destTo: string
  reason: string
  companions: string
  pax: number
  deadline: string
}

/** Стоимость часа чартера для клиента, USD. */
const CHARTER_RATE: Record<string, number> = { C750: 6_500, ACJ319: 14_000, BBJ: 15_000 }
const KIND_MULT: Record<ClientKind, number> = { government: 1.2, corporate: 1.0, private: 1.1, special: 1.4 }
/** Премия пилоту бизнес-авиации к обычной ставке и суточные. */
const CHARTER_PAY_MULT = 1.5
const PER_DIEM = 150

const OFFER_BUCKET_MS = 4 * 3_600_000

interface PersonRow {
  id: number
  kind: ClientKind
  name: string
  title: string
  country: string
  relationship: number
  flights: number
}

const toPerson = (r: PersonRow): Person => ({ ...r })

/** Кабинет министров страны создаётся один раз и дальше живёт в профиле. */
function ensureCabinet(db: Db, country: string): void {
  const exists = db.prepare('SELECT 1 FROM people WHERE country = ? AND position_key IS NOT NULL LIMIT 1').get(country)
  if (exists) return
  const rng = seededRng(`cabinet|${country}|${Date.now()}`)
  const ins = db.prepare('INSERT INTO people (kind, name, title, country, position_key) VALUES (?, ?, ?, ?, ?)')
  for (const p of POSITIONS) ins.run('government', generateName(country, rng).name, p.title, country, p.key)
}

function pickPosition(rng: () => number): string {
  const total = POSITIONS.reduce((s, p) => s + p.weight, 0)
  let r = rng() * total
  for (const p of POSITIONS) {
    r -= p.weight
    if (r <= 0) return p.key
  }
  return 'mfa'
}

export function listClients(db: Db): Person[] {
  const rows = db.prepare('SELECT * FROM people WHERE flights > 0 ORDER BY relationship DESC, flights DESC').all() as unknown as PersonRow[]
  return rows.map(toPerson)
}

export function getPerson(db: Db, id: number): Person | null {
  const r = db.prepare('SELECT * FROM people WHERE id = ?').get(id) as unknown as PersonRow | undefined
  return r ? toPerson(r) : null
}

export function createPerson(db: Db, p: Omit<Person, 'id' | 'relationship' | 'flights'>): number {
  const res = db.prepare('INSERT INTO people (kind, name, title, country) VALUES (?, ?, ?, ?)').run(p.kind, p.name, p.title, p.country)
  return Number(res.lastInsertRowid)
}

export function updateRelationship(db: Db, id: number, delta: number): void {
  db.prepare('UPDATE people SET relationship = MAX(-10, MIN(10, relationship + ?)), flights = flights + 1 WHERE id = ?').run(delta, id)
}

function pickDestination(rng: () => number, kind: ClientKind, from: Airport, type: AircraftType): Airport | null {
  const maxKm = type.rangeKm * 0.9
  const fits = (a: Airport) => {
    if (a.icao === from.icao || (a.rwyM && a.rwyM < type.minRunwayM)) return false
    const km = distanceKm(from.lat, from.lon, a.lat, a.lon)
    return km > 250 && km < maxKm
  }
  let pool: Airport[]
  if (kind === 'private') {
    pool = RESORTS.map((c) => airports.get(c)!).filter(fits)
  } else if (kind === 'special') {
    pool = [...airports.values()].filter((a) => a.type === 'large' && fits(a) && distanceKm(from.lat, from.lon, a.lat, a.lon) < 2500)
  } else if (kind === 'government') {
    pool = [...airports.values()].filter((a) => a.type === 'large' && a.country !== from.country && fits(a))
  } else {
    pool = [...airports.values()].filter((a) => a.type === 'large' && fits(a))
  }
  if (!pool.length) pool = [...airports.values()].filter((a) => a.type !== 'small' && fits(a))
  return pool.length ? pick(rng, pool) : null
}

const fmtTime = (ms: number) => new Date(ms).toISOString().slice(11, 16)
const cityOf = (a: Airport) => a.city ?? a.name

export interface CharterContext {
  location: string
  operator: CharterOperator
  ratingIds: Set<string>
  rank: RankId
  /** id уже принятых заказов: их не показываем повторно. */
  taken: Set<string>
  now: number
  /** Игровой множитель заработка из настроек. */
  payMultiplier: number
  /** Уровень цен (инфляция с начала мира). */
  priceLevel: number
}

/** Типы, на которых пилот может выполнять заказы этого оператора. */
export function flyableTypes(ctx: Pick<CharterContext, 'operator' | 'ratingIds' | 'rank'>): AircraftType[] {
  return ctx.operator.fleet
    .map((id) => aircraftTypes.get(id)!)
    .filter((t) => ctx.ratingIds.has(ratingFor(t).id))
    // Делегации на ACJ/BBJ — только командирам.
    .filter((t) => t.id === 'C750' || rankIndex(ctx.rank) >= rankIndex('captain'))
}

/** Заказы обновляются раз в 4 часа; внутри окна набор стабилен. */
export function charterOffers(db: Db, ctx: CharterContext): CharterOffer[] {
  const from = airports.get(ctx.location)
  const types = flyableTypes(ctx)
  if (!from || !types.length) return []
  const bucket = Math.floor(ctx.now / OFFER_BUCKET_MS)
  const offers: CharterOffer[] = []

  for (let i = 0; i < 5; i++) {
    const id = `${bucket}-${ctx.location}-${i}`
    if (ctx.taken.has(id)) continue
    const rng = seededRng(`${ctx.operator.id}|${id}`)
    const kind = pick(rng, ['government', 'government', 'corporate', 'corporate', 'private', 'private', 'special'] as ClientKind[])
    const bigJet = types.find((t) => t.id !== 'C750')
    // Большие делегации — на ACJ/BBJ, если пилот на них допущен.
    const type = kind === 'government' && bigJet && rng() < 0.5 ? bigJet : (types.find((t) => t.id === 'C750') ?? types[0])
    const dest = pickDestination(rng, kind, from, type)
    if (!dest) continue

    const km = distanceKm(from.lat, from.lon, dest.lat, dest.lon)
    const block = blockMinutes(type, km)
    // От конца 4-часового окна: заказ не «плывёт» внутри окна и всегда в будущем.
    const depAt = Math.ceil(((bucket + 1) * OFFER_BUCKET_MS + between(rng, 0.5, 6) * 3_600_000) / 900_000) * 900_000
    const deadline = depAt + (kind === 'special' || kind === 'government' ? 30 : 60) * 60_000
    const pax = Math.max(1, Math.round(between(rng, 1, type.id === 'C750' ? 8 : 18)))

    const client = makeClient(db, rng, kind, kind === 'government' && rng() < 0.4 ? dest.country : from.country)
    const vars: StoryVars = {
      who:
        kind === 'government'
          ? `${client.title} ${client.name} (${countryName(client.country)})`
          : `${client.name} (${client.title})`,
      name: client.name,
      title: client.title,
      titleLower: client.title.charAt(0).toLowerCase() + client.title.slice(1),
      dest: `${cityOf(dest)} (${countryName(dest.country)})`,
      destTo: cityOf(dest),
      reason: pick(rng, REASONS_GOV),
      companions: pax > 2 ? `${pax - 1} сопровождающих` : 'помощник',
      pax,
      deadline: fmtTime(deadline)
    }
    const story = pick(rng, STORIES[kind])(vars)
    const hours = block / 60
    const contractUsd = Math.round((hours * (CHARTER_RATE[type.id] ?? 8_000) * KIND_MULT[kind] * ctx.priceLevel) / 100) * 100
    const pilotPay = Math.round((hours * hourlyRate('bizjet', ctx.rank) * CHARTER_PAY_MULT + PER_DIEM) * ctx.payMultiplier * ctx.priceLevel)

    offers.push({
      id,
      client: { ...client, country: client.country },
      story,
      dep: from.icao,
      arr: dest.icao,
      depAt,
      deadline,
      typeId: type.id,
      pax,
      distanceKm: Math.round(km),
      blockMin: block,
      contractUsd,
      pilotPay
    })
  }
  return offers
}

/** Клиент заказа: постоянный (из записной книжки), министр из кабинета или новое лицо. */
function makeClient(db: Db, rng: () => number, kind: ClientKind, country: string): CharterOffer['client'] {
  // Постоянные клиенты возвращаются, если остались довольны.
  if (rng() < 0.3) {
    const regulars = db.prepare('SELECT * FROM people WHERE kind = ? AND relationship > 0 ORDER BY id').all(kind) as unknown as PersonRow[]
    if (regulars.length) {
      const r = pick(rng, regulars)
      return { id: r.id, name: r.name, title: r.title, kind, country: r.country, relationship: r.relationship }
    }
  }
  if (kind === 'government') {
    ensureCabinet(db, country)
    const key = pickPosition(rng)
    const r = db.prepare('SELECT * FROM people WHERE country = ? AND position_key = ?').get(country, key) as unknown as PersonRow
    return { id: r.id, name: r.name, title: r.title, kind, country, relationship: r.relationship }
  }
  const { name, gender } = generateName(country, rng)
  let title: string
  if (kind === 'corporate') title = `${pick(rng, CORP_ROLES)} «${pick(rng, COMPANY_A)}${pick(rng, COMPANY_B)}»`
  else if (kind === 'private') title = pick(rng, PRIVATE_TITLES)[gender === 'm' ? 0 : 1]
  else title = `врач клиники ${pick(rng, CLINICS)}`
  return { id: null, name, title, kind, country, relationship: 0 }
}

export const charterOperator = (id: string): CharterOperator | undefined => CHARTER_OPERATORS.find((o) => o.id === id)
