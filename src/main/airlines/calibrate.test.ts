import { it } from 'vitest'
import { openDatabase } from '../db'
import { initialMacro } from '../economy/macro'
import { initAirlineStates, simulateAirlinesMonth } from './sim'
import { loadStates } from './state'
import { airlines } from '../world'

// Калибровка: печатает маржу, загрузку и использование флота по всем компаниям (не проверка).
it.skipIf(!process.env.CALIBRATE)('калибровка экономики авиакомпаний', () => {
  const db = openDatabase(':memory:')
  const start = Date.UTC(2026, 9, 1)
  const macro = initialMacro(Math.floor(start / 86_400_000))
  initAirlineStates(db, macro, start, 'cal')
  const show = (label: string) => {
    const rows = [...loadStates(db).values()].map((s) => {
      const f = s.last!
      return { icao: s.icao, margin: f.revenue ? (f.profit / f.revenue) * 100 : 0, lf: f.lf, util: f.utilization, rev: f.revenue / 1e6 }
    })
    rows.sort((a, b) => a.margin - b.margin)
    const avg = (k: 'margin' | 'lf' | 'util') => rows.reduce((s, r) => s + r[k], 0) / rows.length
    console.log(`${label}: маржа ${avg('margin').toFixed(1)}%, LF ${avg('lf').toFixed(2)}, util ${avg('util').toFixed(2)}`)
    console.log(rows.map((r) => `${r.icao} ${r.margin.toFixed(0)}% lf${r.lf.toFixed(2)} u${r.util.toFixed(2)} $${r.rev.toFixed(0)}M`).join(' | '))
  }
  show('старт')
  for (const icao of (process.env.CAL_DETAIL ?? '').split(',').filter(Boolean)) {
    const s = loadStates(db).get(icao)!
    const f = s.last!
    console.log(icao, 'выручка', Math.round(f.revenue / 1e6), 'М; расходы', JSON.stringify(Object.fromEntries(Object.entries(f.costBreakdown).map(([k, v]) => [k, Math.round(v / 1e6)]))))
    const top = [...s.routes].filter((r) => r.freq > 0).sort((a, b) => a.profit - b.profit).slice(0, 4)
    console.log('  худшие маршруты:', top.map((r) => `${r.hub}-${r.dest} f${r.freq} lf${r.lf.toFixed(2)} $${r.fare} ${Math.round(r.profit / 1e3)}k`).join('; '))
  }
  let news = 0
  let restarts = 0
  for (let m = 1; m <= 24; m++) {
    const ms = Date.UTC(2026, 9 + m, 1)
    const res = simulateAirlinesMonth(db, { ...macro, day: Math.floor(ms / 86_400_000) }, ms, 'cal')
    news += res.news.length
    restarts += res.restarted.length
    if (m === 12 || m === 24) show(`через ${m} мес`)
  }
  console.log(`новостей ${news}, банкротств ${restarts}, компаний ${airlines.size}`)
})
