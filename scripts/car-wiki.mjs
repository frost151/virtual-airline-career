// Проставляет машинам статьи английской Википедии (для фото) и проверяет, что у каждой есть картинка.
// Запуск: node scripts/car-wiki.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const WIKI = {
  'lada-granta': 'Lada Granta', 'lada-niva-legend': 'Lada Niva Legend', 'lada-vesta': 'Lada Vesta', 'lada-niva-travel': 'Lada Niva Travel',
  'lada-largus': 'Lada Largus', 'uaz-patriot': 'UAZ Patriot', 'moskvich-3': 'JAC JS4', 'aurus-senat': 'Aurus Senat',
  'aurus-komendant': 'Aurus Komendant', 'renault-logan': 'Renault Logan', 'peugeot-3008': 'Peugeot 3008',
  'citroen-c5-aircross': 'Citroën C5 Aircross', 'bugatti-chiron': 'Bugatti Chiron', 'hyundai-solaris': 'Hyundai Solaris',
  'hyundai-creta': 'Hyundai Creta', 'kia-k5': 'Kia K5', 'kia-sportage': 'Kia Sportage', 'genesis-g90': 'Genesis G90',
  'chery-tiggo7': 'Chery Tiggo 7', 'haval-jolion': 'Haval Jolion', 'geely-monjaro': 'Geely Monjaro', 'byd-seal': 'BYD Seal',
  'zeekr-001': 'Zeekr 001', 'li-l9': 'Li Auto L9', 'hongqi-h9': 'Hongqi H9', 'toyota-corolla': 'Toyota Corolla (E210)',
  'honda-civic': 'Honda Civic (eleventh generation)', 'toyota-camry': 'Toyota Camry (XV80)', 'mazda-cx5': 'Mazda CX-5',
  'toyota-rav4': 'Toyota RAV4 (XA50)', 'lexus-es': 'Lexus ES', 'nissan-patrol': 'Nissan Patrol', 'toyota-lc300': 'Toyota Land Cruiser (J300)',
  'lexus-lx600': 'Lexus LX', 'vw-polo': 'Volkswagen Polo Mk6', 'skoda-octavia': 'Škoda Octavia', 'vw-golf': 'Volkswagen Golf Mk8',
  'vw-tiguan': 'Volkswagen Tiguan', 'bmw-3': 'BMW 3 Series (G20)', 'mercedes-c': 'Mercedes-Benz C-Class (W206)', 'audi-a6': 'Audi A6',
  'bmw-5': 'BMW 5 Series (G60)', 'mercedes-e': 'Mercedes-Benz E-Class (W214)', 'audi-q7': 'Audi Q7', 'bmw-x5': 'BMW X5 (G05)',
  'porsche-cayenne': 'Porsche Cayenne', 'porsche-taycan': 'Porsche Taycan', 'bmw-7': 'BMW 7 Series (G70)', 'porsche-911': 'Porsche 911 (992)',
  'mercedes-s': 'Mercedes-Benz S-Class (W223)', 'bmw-m5': 'BMW M5', 'audi-rs6': 'Audi RS 6', 'mercedes-g63': 'Mercedes-Benz G-Class',
  'maybach-s680': 'Mercedes-Maybach', 'volvo-xc90': 'Volvo XC90', 'polestar-2': 'Polestar 2', 'koenigsegg-jesko': 'Koenigsegg Jesko',
  'tesla-model3': 'Tesla Model 3', 'jeep-wrangler': 'Jeep Wrangler (JL)', 'tesla-modely': 'Tesla Model Y',
  'ford-mustang': 'Ford Mustang (seventh generation)', 'chevrolet-tahoe': 'Chevrolet Tahoe', 'tesla-models': 'Tesla Model S',
  'cadillac-escalade': 'Cadillac Escalade', 'lr-defender': 'Land Rover Defender (L663)', 'range-rover': 'Range Rover (L460)',
  'bentley-bentayga': 'Bentley Bentayga', 'bentley-continental': 'Bentley Continental GT', 'aston-db12': 'Aston Martin DB12',
  'mclaren-750s': 'McLaren 750S', 'rr-ghost': 'Rolls-Royce Ghost', 'rr-cullinan': 'Rolls-Royce Cullinan', 'fiat-500': 'Fiat 500 (2007)',
  'alfa-giulia': 'Alfa Romeo Giulia (952)', 'maserati-grecale': 'Maserati Grecale', 'lambo-urus': 'Lamborghini Urus',
  'ferrari-roma': 'Ferrari Roma', 'ferrari-sf90': 'Ferrari SF90 Stradale', 'lambo-revuelto': 'Lamborghini Revuelto'
}

const file = 'data/lifestyle/cars.json'
const cars = JSON.parse(readFileSync(file, 'utf8'))
const missing = []
// node scripts/car-wiki.mjs id1 id2 — проверить только эти машины.
const only = process.argv.slice(2)
for (const c of cars) {
  if (only.length && !only.includes(c.id)) continue
  c.wiki = WIKI[c.id] ?? c.wiki
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.wiki.replace(/ /g, '_'))}`
  let res
  // Википедия ограничивает частоту запросов: пауза между запросами и повтор при 429.
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    res = await fetch(url, { headers: { 'User-Agent': 'VirtualAirlineCareer/0.1 (personal game)' } })
    if (res.status !== 429) break
  }
  const data = res.ok ? await res.json() : null
  if (!data?.originalimage?.source) missing.push(`${c.id}: ${c.wiki} (${res.status})`)
}
writeFileSync(file, '[\n' + cars.map((c) => '  ' + JSON.stringify(c).replace(/":/g, '": ').replace(/,"/g, ', "')).join(',\n') + '\n]\n')
console.log(`Машин: ${cars.length}, без фото: ${missing.length}`)
missing.forEach((m) => console.log('  ' + m))
