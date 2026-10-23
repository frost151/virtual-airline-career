import type { AircraftInfo, LightsState } from '@shared/sim'
import profilesJson from '../../../data/aircraft-profiles.json'
import { aircraftTypes } from '../world'

export type LightKey = keyof LightsState

export interface AircraftProfile {
  id: string
  name: string
  /** Подстроки (в нижнем регистре) в TITLE / ATC MODEL, по которым узнаём аддон. */
  match: string[]
  /** Уточнение варианта: первая совпавшая подстрока определяет тип. */
  types: { match: string; type: string }[]
  defaultType: string
  /** Откуда брать свет: стандартные переменные MSFS или L-переменные аддона. */
  lights: 'standard' | 'lvars'
  lvars?: Partial<Record<LightKey, { name: string; onIfAtLeast: number }>>
  /** Пока профиль не проверен на симуляторе, правила по свету для него не применяются. */
  verified: boolean
  notes: string
}

export const aircraftProfiles = profilesJson as AircraftProfile[]

const ICAO_CODES = [...new Set([...aircraftTypes.values()].map((t) => t.icao))]

export interface IdentifiedAircraft {
  info: AircraftInfo
  profile: AircraftProfile | null
}

/** Опознаёт самолёт по TITLE и ATC MODEL из симулятора. */
export function identifyAircraft(title: string, atcModel: string): IdentifiedAircraft {
  const haystack = `${title} ${atcModel}`.toLowerCase()
  const profile = aircraftProfiles.find((p) => p.match.some((m) => haystack.includes(m))) ?? null

  let typeId: string | null = null
  if (profile) {
    typeId = profile.types.find((t) => haystack.includes(t.match))?.type ?? profile.defaultType
  } else {
    // Без профиля пытаемся найти ICAO-код типа в ATC MODEL (часто там «A320», «B738» и т.п.).
    const upper = `${atcModel} ${title}`.toUpperCase()
    const icao = ICAO_CODES.find((c) => new RegExp(`(^|[^A-Z0-9])${c}([^A-Z0-9]|$)`).test(upper))
    typeId = icao ? ([...aircraftTypes.values()].find((t) => t.id === icao)?.id ?? null) : null
  }

  return {
    profile,
    info: {
      title,
      typeId,
      typeName: typeId ? (aircraftTypes.get(typeId)?.name ?? null) : null,
      profileId: profile?.id ?? null,
      profileName: profile?.name ?? null,
      profileVerified: profile?.verified ?? false
    }
  }
}
