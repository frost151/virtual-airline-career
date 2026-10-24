import { useEffect, useState } from 'react'
import { Box, Text } from '@mantine/core'

/** Основной CDN логотипов: картинка по коду IATA, 404 — если логотипа нет. */
const primary = (iata: string) => `https://pics.avs.io/240/80/${iata}.png`

/** Запасные ссылки, уже выясненные через main (null — логотипа нет нигде). */
const fallbackCache = new Map<string, string | null>()

/** Логотипы компаний игрока: свой код IATA не должен подтягивать чужой логотип с CDN. */
const customLogos = new Map<string, string | null>()

export function setCustomLogos(list: { iata: string; logo: string | null }[]): void {
  customLogos.clear()
  for (const a of list) customLogos.set(a.iata, a.logo)
}

const initialSrc = (iata: string | null): string | null => {
  if (!iata) return null
  if (customLogos.has(iata)) return customLogos.get(iata)!
  return fallbackCache.has(iata) ? fallbackCache.get(iata)! : primary(iata)
}

interface Props {
  iata: string | null
  name: string
  /** Высота логотипа, px. */
  h?: number
}

/** Логотип авиакомпании; если его нет — значок с буквами названия. */
export function AirlineLogo({ iata, name, h = 22 }: Props) {
  const [src, setSrc] = useState<string | null>(() => initialSrc(iata))

  useEffect(() => {
    setSrc(initialSrc(iata))
  }, [iata])

  const onError = async () => {
    if (!iata || customLogos.has(iata)) return setSrc(null)
    // Основной CDN не знает компанию — спрашиваем запасной (один раз на код).
    if (src === primary(iata)) {
      const url = fallbackCache.has(iata) ? fallbackCache.get(iata)! : await window.api.world.logoFallback(iata).catch(() => null)
      fallbackCache.set(iata, url)
      setSrc(url)
    } else setSrc(null)
  }

  const w = h * 3
  if (src) {
    return (
      <Box w={w} h={h} style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <img
          src={src}
          alt={name}
          title={name}
          onError={onError}
          style={{ maxHeight: h, maxWidth: w, objectFit: 'contain', background: 'white', borderRadius: 4, padding: 2 }}
        />
      </Box>
    )
  }
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0])
    .join('')
    .toUpperCase()
  return (
    <Box
      w={w}
      h={h}
      title={name}
      style={{
        flexShrink: 0,
        borderRadius: 4,
        border: '1px solid var(--mantine-color-dark-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <Text size="xs" fw={700} c="dimmed">
        {initials}
      </Text>
    </Box>
  )
}
