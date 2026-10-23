/** Детерминированная случайность: один и тот же ключ всегда даёт один результат. */

/** FNV-1a, 32 бита. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Генератор mulberry32: rng() → [0, 1). */
export function seededRng(seed: number | string): () => number {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]

export const between = (rng: () => number, min: number, max: number): number => min + rng() * (max - min)
