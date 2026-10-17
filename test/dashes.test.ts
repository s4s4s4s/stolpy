import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { assert, finish, group } from './_harness.ts'

/* Правило проекта: длинное и среднее тире запрещены везде (код, комментарии,
   тексты интерфейса, документы). Только дефис. Сами символы здесь не
   записаны: их коды собираются из чисел, чтобы файл теста не нарушал правило. */

const EN_DASH = String.fromCharCode(0x2013)
const EM_DASH = String.fromCharCode(0x2014)

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dev-dist', '.git', 'shots'])
/* Пути относительно корня, с прямыми слэшами. */
const SKIP_PATHS = new Set(['public/fonts'])
const EXTENSIONS = new Set(['.ts', '.tsx', '.css', '.html', '.md', '.json', '.yml', '.yaml', '.mjs'])

const root = process.cwd()

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const rel = relative(root, full).split(sep).join('/')
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_PATHS.has(rel)) continue
      walk(full, out)
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf('.')
      if (dot >= 0 && EXTENSIONS.has(entry.name.slice(dot))) out.push(full)
    }
  }
}

const files: string[] = []
walk(root, files)

group('обход репозитория находит файлы', () => {
  assert(files.length > 0, 'не найдено ни одного файла для проверки, обход сломан')
})

group('в репозитории нет длинного и среднего тире', () => {
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const [dash, label] of [[EN_DASH, 'среднее тире'], [EM_DASH, 'длинное тире']] as const) {
        const col = line.indexOf(dash)
        assert(col < 0, `${relative(root, file).split(sep).join('/')}:${i + 1}: ${label} в колонке ${col + 1}`)
      }
    })
  }
})

finish()
