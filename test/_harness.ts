/* Общий каркас тестов: без зависимостей, только node. Тест-файл вызывает
   group(...) с проверками внутри и в конце finish(). Упавшая проверка не
   обрывает файл: сообщения копятся, группа печатает FAIL с причинами, а
   finish() выставляет process.exitCode = 1. */

let checks = 0
let failedChecks = 0
let groupsPassed = 0
let groupsFailed = 0
let current: string[] | null = null

function fail(message: string): void {
  failedChecks++
  if (current) current.push(message)
  else console.error(`  FAIL ${message}`)
}

export function assert(cond: unknown, msg: string): asserts cond {
  checks++
  if (!cond) fail(msg)
}

/** Печатаемый вид значения для диффа: JSON с отступами, undefined и функции помечены. */
function show(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (typeof value === 'function') return '[function]'
  if (typeof value === 'bigint') return `${value}n`
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v === undefined ? '[undefined]' : v), 2) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Первое расхождение двух значений: путь и обе стороны, либо null, если равны. */
function firstDiff(a: unknown, b: unknown, path: string): { path: string; a: unknown; b: unknown } | null {
  if (Object.is(a, b)) return null
  const bothObjects = typeof a === 'object' && typeof b === 'object' && a !== null && b !== null
  if (!bothObjects) return { path, a, b }
  if (Array.isArray(a) !== Array.isArray(b)) return { path, a, b }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime() ? null : { path, a, b }
  }
  if (a instanceof Map && b instanceof Map) {
    return firstDiff([...a.entries()], [...b.entries()], `${path}<Map>`)
  }
  if (a instanceof Set && b instanceof Set) {
    return firstDiff([...a.values()], [...b.values()], `${path}<Set>`)
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)])
  for (const key of keys) {
    const sub = Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`
    if (!(key in ao)) return { path: sub, a: undefined, b: bo[key] }
    if (!(key in bo)) return { path: sub, a: ao[key], b: undefined }
    const diff = firstDiff(ao[key], bo[key], sub)
    if (diff) return diff
  }
  return null
}

/** Глубокое сравнение. При расхождении сообщение содержит путь к первому
    отличию, значения по обе стороны и полные actual и expected. */
export function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  checks++
  const diff = firstDiff(actual, expected, '$')
  if (!diff) return
  fail(
    `${msg}\n      первое расхождение: ${diff.path}\n      получено: ${show(diff.a)}\n      ожидалось: ${show(diff.b)}` +
      `\n      actual: ${show(actual)}\n      expected: ${show(expected)}`
  )
}

/** Именованная группа проверок. Исключение внутри считается падением группы.
    Функция может быть асинхронной: тогда group возвращает промис, его нужно
    дождаться (await). */
export function group(name: string, fn: () => void | Promise<void>): void | Promise<void> {
  const messages: string[] = []
  const previous = current
  current = messages

  const report = (thrown?: unknown): void => {
    current = previous
    if (thrown !== undefined) {
      failedChecks++
      messages.push(`исключение: ${thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown)}`)
    }
    if (messages.length === 0) {
      groupsPassed++
      console.log(`  ok ${name}`)
    } else {
      groupsFailed++
      console.error(`  FAIL ${name}`)
      for (const m of messages) console.error(`    - ${m}`)
    }
  }

  let result: void | Promise<void>
  try {
    result = fn()
  } catch (err) {
    report(err ?? new Error('throw без значения'))
    return
  }
  if (result && typeof (result as Promise<void>).then === 'function') {
    return (result as Promise<void>).then(
      () => report(),
      err => report(err ?? new Error('reject без значения'))
    )
  }
  report()
}

/** Итог файла. Код выхода 1 при любом падении. */
export function finish(): void {
  console.log(`\nГрупп: ${groupsPassed + groupsFailed}, проверок: ${checks}, упало проверок: ${failedChecks}`)
  if (failedChecks > 0 || groupsFailed > 0) {
    console.error('ПРОВАЛ')
    process.exitCode = 1
  } else {
    console.log('OK')
  }
}

/** Контракт хранилища (совпадает структурно с StorageDriver из src/state/driver.ts). */
export interface FakeDriverShape {
  name: 'idb' | 'local' | 'memory'
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  keys(prefix?: string): Promise<string[]>
}

/** Драйвер в памяти для тестов хранилища. `data` позволяет посмотреть
    содержимое, `failWrites = true` заставляет set бросать (проверка ошибок
    записи), `failRemoves = true` - то же для remove. Имя задаётся в
    конструкторе: сверка с запасным носителем включается только у 'idb'. */
export class FakeDriver implements FakeDriverShape {
  readonly name: FakeDriverShape['name']
  readonly data = new Map<string, string>()
  failWrites = false
  failRemoves = false

  constructor(name: FakeDriverShape['name'] = 'memory') {
    this.name = name
  }

  async get(key: string): Promise<string | null> {
    return this.data.has(key) ? this.data.get(key)! : null
  }

  async set(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('FakeDriver: запись отключена (failWrites)')
    this.data.set(key, value)
  }

  async remove(key: string): Promise<void> {
    if (this.failRemoves) throw new Error('FakeDriver: удаление отключено (failRemoves)')
    this.data.delete(key)
  }

  async keys(prefix = ''): Promise<string[]> {
    return [...this.data.keys()].filter(k => k.startsWith(prefix)).sort()
  }
}

/** Storage целиком в памяти, без браузера. */
export class FakeLocalStorage implements Storage {
  private store = new Map<string, string>()
  get length(): number {
    return this.store.size
  }
  clear(): void {
    this.store.clear()
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

/** Подменяет globalThis.localStorage фейком на время fn и возвращает прежнее
    значение. Работает и с асинхронной fn. */
export function withFakeLocalStorage<T>(fn: (storage: FakeLocalStorage) => T): T {
  const storage = new FakeLocalStorage()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  const restore = (): void => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete (globalThis as { localStorage?: Storage }).localStorage
  }
  let result: T
  try {
    result = fn(storage)
  } catch (err) {
    restore()
    throw err
  }
  if (result && typeof (result as unknown as Promise<unknown>).then === 'function') {
    return (result as unknown as Promise<unknown>).finally(restore) as unknown as T
  }
  restore()
  return result
}
