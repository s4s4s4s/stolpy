import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

/* Запуск тестов: npm test (все) или npm run test:one -- <подстрока имени файла>.
   Каждый test/*.test.ts собирается esbuild в node_modules/.cache/stolpy/ и
   запускается отдельным процессом node, так что падение одного файла не
   скрывает остальные. Код выхода 1: упал любой файл, не нашлось ни одного
   файла или не собрался ни один файл. */

const TEST_DIR = 'test'
const CACHE_DIR = join('node_modules', '.cache', 'stolpy')
const SUFFIX = '.test.ts'

const filter = process.argv[2] ?? ''

const files = readdirSync(TEST_DIR)
  .filter(name => name.endsWith(SUFFIX) && name.includes(filter))
  .sort()

if (files.length === 0) {
  console.error(filter ? `Нет файлов test/*${SUFFIX} с подстрокой "${filter}"` : `Нет файлов test/*${SUFFIX}`)
  process.exit(1)
}

mkdirSync(CACHE_DIR, { recursive: true })

const results = []

for (const file of files) {
  const name = basename(file, SUFFIX)
  const outfile = join(CACHE_DIR, `${name}.mjs`)
  console.log(`\n=== ${file}`)

  try {
    await build({
      entryPoints: [join(TEST_DIR, file)],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'silent'
    })
  } catch (err) {
    console.error(`Сборка не удалась: ${err.message}`)
    results.push({ file, ok: false, reason: 'сборка' })
    continue
  }

  const run = spawnSync(process.execPath, [outfile], { stdio: 'inherit' })
  if (run.error) {
    console.error(`Не запустился: ${run.error.message}`)
    results.push({ file, ok: false, reason: 'запуск' })
  } else {
    results.push({ file, ok: run.status === 0, reason: `код ${run.status}` })
  }
}

console.log('\n=== Итог')
for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.file}${r.ok ? '' : ` (${r.reason})`}`)
}
const failed = results.filter(r => !r.ok).length
console.log(`Файлов: ${results.length}, прошло: ${results.length - failed}, упало: ${failed}`)
process.exit(failed > 0 ? 1 : 0)
