import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

/**
 * Запасной источник логотипов. Основной (pics.avs.io) интерфейс грузит напрямую;
 * сюда обращается, только если там логотипа нет. images.kiwi.com вместо отсутствующего
 * логотипа отдаёт одну и ту же заглушку — её отсекаем по размеру. Результат кэшируется на диске.
 */

const KIWI_PLACEHOLDER_BYTES = 3103

let cache: Record<string, string | null> | null = null

function cacheFile(): string {
  const dir = join(app.getPath('userData'), 'cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'airline-logos-fallback.json')
}

function load(): Record<string, string | null> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(cacheFile(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

export async function airlineLogoFallback(iata: string): Promise<string | null> {
  const c = load()
  if (iata in c) return c[iata]
  const url = `https://images.kiwi.com/airlines/128/${iata}.png`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const size = res.ok ? (await res.arrayBuffer()).byteLength : 0
    c[iata] = res.ok && size !== KIWI_PLACEHOLDER_BYTES ? url : null
    writeFileSync(cacheFile(), JSON.stringify(c))
    return c[iata]
  } catch {
    // Нет интернета — не кэшируем.
    return null
  }
}
