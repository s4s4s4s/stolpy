import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'

/* Иконка PWA «Столпы»: пять вертикальных столбиков разной высоты на общей
   базовой линии, одна янтарная фигура на тёмном фоне, без текста. Столбики
   читаются как пять столпов и как простая гистограмма, и держат контраст в 48px.
   Цвета из DESIGN.md: фон `--bg` (#131519), фигура `--amber` (#f0a860).
   Имена файлов совпадают с манифестом в vite.config.ts и со ссылками
   в index.html. */

const BG = '#131519'
const AMBER = '#f0a860'

/* Геометрия на сетке 512x512. Пять столбиков шириной 40 с промежутком 18
   занимают x от 120 до 392, общая база y=396, верхняя точка самого высокого
   y=116, так что фигура по вертикали центрирована (116..396, центр 256).
   Дальний нижний угол (120,396) отстоит от центра на ~195px, это внутри круга
   радиусом 205 (safe zone 80% для maskable-варианта). */
const BASE_Y = 396
const BAR_W = 40
const BAR_GAP = 18
const BAR_X0 = 120
const BAR_HEIGHTS = [140, 210, 280, 190, 240]

const bars = () =>
  BAR_HEIGHTS.map((h, i) => {
    const x = BAR_X0 + i * (BAR_W + BAR_GAP)
    return `<rect x="${x}" y="${BASE_Y - h}" width="${BAR_W}" height="${h}" rx="3" fill="${AMBER}"/>`
  }).join('')

/** Базовая иконка 512x512: непрозрачный тёмный фон и пять столбиков. */
const iconSvg = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  ${bars()}
</svg>`

/** Сплэш-экран iOS: полноэкранный тёмный фон с фигурой по центру, без текста.
    Статичная картинка, что видна долю секунды при запуске установленного
    приложения (без неё белая вспышка). */
/**
 * @param {number} w
 * @param {number} h
 */
const splashSvg = (w, h) => {
  const scale = (Math.min(w, h) * 0.34) / 512
  const tx = w / 2 - 256 * scale
  const ty = h / 2 - 256 * scale
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <g transform="translate(${tx} ${ty}) scale(${scale})">${bars()}</g>
</svg>`
}

/* Экраны iPhone от SE (2016) до 16 Pro Max, портретная ориентация: точки (CSS px),
   плотность пикселей. Физический размер сплэша = точки * плотность, тот же расчёт,
   каким Apple описывает apple-touch-startup-image в media-запросах index.html. */
const splashDevices = [
  { w: 320, h: 568, dpr: 2 }, // iPhone SE (1st gen)
  { w: 375, h: 667, dpr: 2 }, // iPhone 6/7/8, SE 2/3
  { w: 414, h: 736, dpr: 3 }, // iPhone 6/7/8 Plus
  { w: 414, h: 896, dpr: 2 }, // iPhone XR/11
  { w: 375, h: 812, dpr: 3 }, // iPhone X/XS/11 Pro, 12/13 mini
  { w: 414, h: 896, dpr: 3 }, // iPhone XS Max/11 Pro Max
  { w: 390, h: 844, dpr: 3 }, // iPhone 12/12 Pro/13/13 Pro/14
  { w: 428, h: 926, dpr: 3 }, // iPhone 12/13 Pro Max, 14 Plus
  { w: 393, h: 852, dpr: 3 }, // iPhone 14 Pro/15/15 Pro/16
  { w: 430, h: 932, dpr: 3 }, // iPhone 14 Pro Max/15 Plus/15 Pro Max/16 Plus
  { w: 402, h: 874, dpr: 3 }, // iPhone 16 Pro
  { w: 440, h: 956, dpr: 3 } // iPhone 17 Pro Max / 16 Pro Max
]

mkdirSync('public', { recursive: true })

/* Векторный значок для вкладки браузера: та же фигура на скруглённом фоне. */
writeFileSync(
  'public/favicon.svg',
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="${BG}"/>
  ${bars()}
</svg>
`
)
console.log('public/favicon.svg')

/** @type {[out: string, svg: string, width: number, height: number][]} */
const jobs = [
  ['public/icon-512.png', iconSvg(), 512, 512],
  ['public/icon-512-maskable.png', iconSvg(), 512, 512],
  ['public/icon-192.png', iconSvg(), 192, 192],
  ['public/apple-touch-icon.png', iconSvg(), 180, 180]
]

for (const { w, h, dpr } of splashDevices) {
  const pw = w * dpr
  const ph = h * dpr
  jobs.push([`public/splash-${pw}x${ph}.png`, splashSvg(pw, ph), pw, ph])
}

for (const [out, s, w, h] of jobs) {
  await sharp(Buffer.from(s)).resize(w, h).png().toFile(out)
  console.log(out)
}
