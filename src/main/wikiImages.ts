import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { WikiImage } from '@shared/types'

/**
 * Картинки из Википедии по названию статьи (фото машин и т.п.).
 * Ответы кэшируются на диске — Википедия ограничивает частоту запросов.
 */

const USER_AGENT = 'VirtualAirlineCareer/0.1 (personal flight-sim companion)'
/** Википедия отдаёт уменьшенные копии только стандартных ширин (…, 500, 960, 1280…). */
const MAX_WIDTH = 960

let cache: Record<string, WikiImage | null> | null = null

function cacheFile(): string {
  const dir = join(app.getPath('userData'), 'cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'wiki-images.json')
}

function load(): Record<string, WikiImage | null> {
  if (cache) return cache
  try {
    cache = JSON.parse(readFileSync(cacheFile(), 'utf8'))
  } catch {
    cache = {}
  }
  return cache!
}

export async function wikiImage(title: string): Promise<WikiImage | null> {
  const c = load()
  if (title in c) return c[title]
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
  let data: Record<string, any> | null = null
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
        continue
      }
      if (!res.ok) break
      data = await res.json()
    } catch {
      // Нет интернета — не кэшируем, попробуем в следующий раз.
      return null
    }
  }
  const orig = data?.originalimage
  const thumb: string | undefined = data?.thumbnail?.source
  // Оригинал бывает по 5–10 МБ: если он большой, берём уменьшенную копию.
  const image = orig && orig.width <= MAX_WIDTH ? orig.source : thumb?.replace(/\/\d+px-/, `/${MAX_WIDTH}px-`)
  const result: WikiImage | null = image
    ? { image, page: data!.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, title: data!.title }
    : null
  if (data) {
    c[title] = result
    writeFileSync(cacheFile(), JSON.stringify(c))
  }
  return result
}
