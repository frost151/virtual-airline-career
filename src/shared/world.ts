/** Статические данные мира (папка data/). Меняются только правкой JSON. */

export interface Airport {
  icao: string
  iata: string | null
  name: string
  city: string | null
  /** ISO 3166-1 alpha-2 */
  country: string
  lat: number
  lon: number
  elevFt: number
  type: 'large' | 'medium' | 'small'
  scheduled: boolean
  /** Самая длинная ВПП (с твёрдым покрытием, если есть), м. */
  rwyM: number
}

export type AircraftCategory = 'turboprop' | 'regional' | 'narrowbody' | 'widebody' | 'freighter' | 'bizjet'

export interface AircraftType {
  /** Уникальный ключ в игре (может отличаться от ICAO: B77F, ACJ319, BBJ). */
  id: string
  /** Код типа ICAO. */
  icao: string
  name: string
  manufacturer: string
  category: AircraftCategory
  inProduction: boolean
  /** Типичная компоновка / максимум кресел. 0 у грузовых. */
  seats: number
  maxSeats: number
  /** Грузоподъёмность по грузу (для грузовых — основная), кг. */
  cargoKg: number
  /** Дальность при типичной загрузке (у грузовых — неполной, а не максимальной), км. */
  rangeKm: number
  cruiseKt: number
  mtowKg: number
  mlwKg: number
  oewKg: number
  maxFuelKg: number
  /** Средний расход в крейсерском режиме, кг/ч. */
  fuelBurnKgH: number
  /** Требуемая длина ВПП на взлёте с MTOW у уровня моря, м. */
  minRunwayM: number
  /** Рыночная стоимость: новый (если в производстве) или типичный борт средних лет, млн USD. */
  valueMusd: number
  /** Прямые расходы на ТО за лётный час, USD. */
  maintUsdPerHour: number
}

export type AirlineArchetype = 'legacy' | 'lowcost' | 'regional' | 'leisure' | 'cargo'

/** Рейс в одну сторону: самолёт улетает один раз и остаётся в аэропорту прилёта, пока не создан обратный рейс. */
export interface OneWayLeg {
  hub: string
  dest: string
  type: string
  /** Вылет, мс UTC мира. */
  depAt: number
  /** Номер рейса. */
  num: number
  /** Регистрация борта. */
  reg: string
}

export interface Airline {
  icao: string
  iata: string
  /** Оригинальное название авиакомпании (без перевода). */
  name: string
  callsign: string
  country: string
  archetype: AirlineArchetype
  /** Начальная репутация 0–100. */
  reputation: number
  fleet: { type: string; count: number }[]
  /** Сеть: направления из каждого хаба/базы. Частоты рассчитывает модель спроса. */
  network: {
    hub: string
    destinations: string[]
    /** Живые данные экономики (в профиле): рейсов в день, загрузка, средний тариф по направлениям. */
    freq?: Record<string, number>
    lf?: Record<string, number>
    fare?: Record<string, number>
    /** Тип самолёта, назначенный владельцем на направление. */
    type?: Record<string, string>
    /** Номер первого рейса «туда», заданный владельцем. */
    num?: Record<string, number>
  }[]
  /** Рейсы в одну сторону, ждущие обратного (у компании игрока). */
  legs?: OneWayLeg[]
  /** Версия живого состояния — сбрасывает кэш расписания при изменениях сети. */
  version?: number
  /** Ключ кэша расписания: версия плюс метка профиля (у разных профилей версии совпадают). */
  cacheKey?: string
}
