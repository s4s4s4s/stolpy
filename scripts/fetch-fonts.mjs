import { mkdirSync, writeFileSync } from 'node:fs'

/* Одноразовая загрузка шрифтов в репозиторий. Запуск: npm run fonts.
   Берёт CSS API v2 Google Fonts с user-agent современного браузера (иначе
   отдаётся ttf или один общий woff2 без подмножеств), оставляет подмножества
   latin и cyrillic, скачивает woff2 с fonts.gstatic.com в public/fonts,
   кладёт рядом OFL.txt и генерирует src/ui/styles/fonts.css.

   Результат коммитится: приложению сеть не нужна, шрифты отдаются со своего
   адреса и попадают в прекеш service worker. */

const FAMILIES = [
  { name: 'IBM Plex Mono', weights: [400, 500], copyright: 'Copyright 2017 IBM Corp. with Reserved Font Name "Plex"' },
  { name: 'Golos Text', weights: [400, 500, 600], copyright: 'Copyright 2022 The Golos Project Authors (https://github.com/salute-developers/golos-fonts)' },
  { name: 'Unbounded', weights: [500, 700], copyright: 'Copyright 2022 The Unbounded Project Authors (https://github.com/w3nu/unbounded)' }
]
const SUBSETS = ['latin', 'cyrillic']
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const FONTS_DIR = 'public/fonts'
const CSS_OUT = 'src/ui/styles/fonts.css'

const OFL_BODY = `-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting - in part or in whole - any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
`

const oflText = () =>
  `The fonts in this directory are licensed under the SIL Open Font License,
Version 1.1. Families and copyright statements:

${FAMILIES.map(f => `${f.name}: ${f.copyright}`).join('\n')}

${OFL_BODY}`

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @returns {Promise<string>}
 */
async function fetchText(url, headers) {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.text()
}

/** @param {string} url */
async function fetchBinary(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Разбирает ответ CSS API на блоки @font-face вместе с комментарием-подмножеством.
 * @param {string} css
 * @param {string} family
 * @returns {{ family: string, subset: string, weight: number, url: string, range: string }[]}
 */
function parseFaces(css, family) {
  const faces = []
  const re = /\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g
  for (const m of css.matchAll(re)) {
    const body = m[2]
    /** @param {RegExp} rx */
    const pick = rx => body.match(rx)?.[1]
    const weight = Number(pick(/font-weight:\s*(\d+)/))
    const url = pick(/url\((https:[^)]+\.woff2)\)/)
    const range = pick(/unicode-range:\s*([^;]+);/)
    if (!url || !range || !Number.isFinite(weight)) {
      throw new Error(`Не разобран блок @font-face (${family}, ${m[1]}):\n${body}`)
    }
    const face = { family, subset: m[1], weight, url, range }
    faces.push(face)
  }
  return faces
}

/** @param {string} name */
const slug = name => name.replace(/\s+/g, '')

/** @param {{ name: string, weights: number[] }} family */
async function loadFamily({ name, weights }) {
  const query = `family=${name.replace(/ /g, '+')}:wght@${weights.join(';')}&display=swap`
  const css = await fetchText(`https://fonts.googleapis.com/css2?${query}`, { 'User-Agent': USER_AGENT })
  const faces = parseFaces(css, name).filter(f => SUBSETS.includes(f.subset))
  for (const subset of SUBSETS) {
    for (const weight of weights) {
      if (!faces.some(f => f.subset === subset && f.weight === weight)) {
        throw new Error(`${name}: в ответе Google нет ${subset} ${weight}`)
      }
    }
  }
  return faces
}

/** Один и тот же файл у нескольких начертаний - вариативный шрифт: пишем его
    один раз, а в CSS даём диапазон весов. */
/** @param {Awaited<ReturnType<typeof loadFamily>>} faces */
function groupByFile(faces) {
  const byUrl = new Map()
  for (const f of faces) {
    const entry = byUrl.get(f.url) ?? { ...f, weights: [] }
    entry.weights.push(f.weight)
    byUrl.set(f.url, entry)
  }
  return [...byUrl.values()]
}

mkdirSync(FONTS_DIR, { recursive: true })
const cssBlocks = []
const written = []

for (const family of FAMILIES) {
  const files = groupByFile(await loadFamily(family))
  for (const f of files) {
    const min = Math.min(...f.weights)
    const max = Math.max(...f.weights)
    const weightTag = min === max ? String(min) : `${min}_${max}`
    const file = `${slug(family.name)}-${weightTag}-${f.subset}.woff2`
    const data = await fetchBinary(f.url)
    writeFileSync(`${FONTS_DIR}/${file}`, data)
    written.push(`${file} (${data.length} bytes)`)
    cssBlocks.push(`/* ${f.family} ${f.subset} */
@font-face {
  font-family: '${f.family}';
  font-style: normal;
  font-weight: ${min === max ? min : `${min} ${max}`};
  font-display: swap;
  src: url('/fonts/${file}') format('woff2');
  unicode-range: ${f.range};
}`)
  }
}

writeFileSync(`${FONTS_DIR}/OFL.txt`, oflText())
writeFileSync(
  CSS_OUT,
  `/* Сгенерировано scripts/fetch-fonts.mjs (npm run fonts), руками не править.
   Шрифты лежат в public/fonts, лицензия SIL OFL 1.1 рядом (OFL.txt). */

${cssBlocks.join('\n\n')}
`
)

console.log(written.join('\n'))
console.log(`${FONTS_DIR}/OFL.txt`)
console.log(CSS_OUT)
