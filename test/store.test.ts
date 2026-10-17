import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeDriver, FakeLocalStorage, assert, assertEqual, finish, group, withFakeLocalStorage } from './_harness.ts'
import type { ActiveSession, AppState, StorageDriver } from '../src/core/types.ts'
import { defaultState, serialize, serializeActive } from '../src/state/storage.ts'
import {
  KEYS, asideBackupKey, createSaver, loadAll, persistStorage, storageEstimate, type SaveResult,
} from '../src/state/store.ts'
import {
  IDB_NAME, IDB_STORE, IDB_VERSION, LOCAL_PREFIX, browserEnv, idbDriver, localDriver, memoryDriver, openIdb,
  pickDriver, pickDriverVerbose,
} from '../src/state/driver.ts'

const NOW = Date.UTC(2026, 9, 17, 9, 0)
const FIXTURE_TEXT = readFileSync(join(process.cwd(), 'test', 'fixtures', 'state-v1.json'), 'utf8')
const fixture = (): AppState => JSON.parse(FIXTURE_TEXT) as AppState

function activeOf(state: AppState): ActiveSession {
  const session = JSON.parse(JSON.stringify(state.sessions['s-cardio']))
  delete session.endedAt
  return { version: 1, session, currentItemId: 'c1', wakeLockWanted: true }
}

/** Драйвер, у которого чтение отдельных ключей падает. */
class ReadFailDriver extends FakeDriver {
  failReads = new Set<string>()
  override async get(key: string): Promise<string | null> {
    if (this.failReads.has(key)) throw new Error(`чтение ${key} не удалось`)
    return super.get(key)
  }
}

/** Драйвер, чьи записи ждут ручного отпуска: видно, что в полёте одна. */
class GatedDriver implements StorageDriver {
  readonly name = 'memory' as const
  readonly data = new Map<string, string>()
  readonly writes: { key: string; value: string | null }[] = []
  private gates: (() => void)[] = []
  failNext: Error | null = null

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }
  set(key: string, value: string): Promise<void> {
    return this.gate(key, value)
  }
  remove(key: string): Promise<void> {
    return this.gate(key, null)
  }
  private gate(key: string, value: string | null): Promise<void> {
    this.writes.push({ key, value })
    const fail = this.failNext
    this.failNext = null
    return new Promise((resolve, reject) => {
      this.gates.push(() => {
        if (fail) return reject(fail)
        if (value === null) this.data.delete(key)
        else this.data.set(key, value)
        resolve()
      })
    })
  }
  get waiting(): number {
    return this.gates.length
  }
  /** Отпускает самую раннюю ждущую запись и даёт очереди продвинуться. */
  async release(): Promise<void> {
    const g = this.gates.shift()
    if (!g) throw new Error('нет ждущих записей')
    g()
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

/* ---- loadAll ---- */

await group('loadAll: пустой носитель - дефолт, без копий и блокировок', async () => {
  const d = new FakeDriver()
  const r = await loadAll(d, NOW)
  assertEqual(r.state, { state: defaultState(NOW), source: 'default', dropped: 0 }, 'state')
  assertEqual(r.active, { active: null, source: 'default', dropped: 0 }, 'active')
  assertEqual(r.backups, [], 'копий нет')
  assertEqual(r.saveBlock, { state: null, active: null }, 'запись разрешена')
  assertEqual(r.readErrors, {}, 'ошибок чтения нет')
  assertEqual(d.data.size, 0, 'носитель не тронут')
})

await group('loadAll: сохранённые состояние и черновик читаются', async () => {
  const d = new FakeDriver()
  const st = fixture()
  const a = activeOf(st)
  d.data.set(KEYS.state, FIXTURE_TEXT)
  d.data.set(KEYS.active, serializeActive(a))
  const r = await loadAll(d, NOW)
  assertEqual([r.state.source, r.state.dropped], ['stored', 0], 'state stored')
  assertEqual(r.state.state, st, 'состояние')
  assertEqual(r.active, { active: a, source: 'stored', dropped: 0 }, 'черновик')
  assertEqual(r.backups, [], 'без потерь копий нет')
  assertEqual(d.data.size, 2, 'ничего не записано')
})

await group('loadAll: битое состояние дословно копируется в state.backup, запись разрешена', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, '{"version":1,"sessions":')
  const r = await loadAll(d, NOW)
  assertEqual(r.state.source, 'corrupt', 'corrupt')
  assertEqual(d.data.get(KEYS.stateBackup), '{"version":1,"sessions":', 'копия дословно')
  assertEqual(d.data.get(KEYS.state), '{"version":1,"sessions":', 'оригинал не тронут при загрузке')
  assertEqual(r.backups, [{ from: 'state', status: 'written', key: KEYS.stateBackup }], 'заметка о копии')
  assertEqual(r.saveBlock, { state: null, active: null }, 'запись поверх разрешена')
})

await group('loadAll: dropped > 0 тоже даёт копию, source остаётся stored', async () => {
  const d = new FakeDriver()
  const raw = JSON.parse(FIXTURE_TEXT)
  raw.sessions['чужой'] = raw.sessions['s-cardio']
  const text = JSON.stringify(raw)
  d.data.set(KEYS.state, text)
  const r = await loadAll(d, NOW)
  assertEqual([r.state.source, r.state.dropped], ['stored', 1], 'stored с потерей')
  assertEqual(d.data.get(KEYS.stateBackup), text, 'копия исходного текста')
})

await group('loadAll: битый черновик копируется в active.backup, состояние не трогается', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, FIXTURE_TEXT)
  d.data.set(KEYS.active, '{"session":{"id":"x"}}')
  const r = await loadAll(d, NOW)
  assertEqual(r.active, { active: null, source: 'corrupt', dropped: 0 }, 'черновик null')
  assertEqual(d.data.get(KEYS.activeBackup), '{"session":{"id":"x"}}', 'копия черновика')
  assert(!d.data.has(KEYS.stateBackup), 'копии состояния нет')
  assertEqual(r.saveBlock, { state: null, active: null }, 'запись разрешена')
})

await group('loadAll: старая копия не затирается, новая ложится рядом и об этом сказано', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.stateBackup, 'прежняя потеря')
  d.data.set(KEYS.state, 'новая потеря')
  const r = await loadAll(d, NOW)
  const aside = asideBackupKey(KEYS.stateBackup, NOW)
  assertEqual(aside, `state.backup.${NOW}`, 'ключ рядом')
  assertEqual(d.data.get(KEYS.stateBackup), 'прежняя потеря', 'старая цела')
  assertEqual(d.data.get(aside), 'новая потеря', 'новая рядом')
  assertEqual(r.backups, [{ from: 'state', status: 'written-aside', key: aside }], 'заметка written-aside')

  const again = await loadAll(d, NOW + 1)
  assertEqual(again.backups, [{ from: 'state', status: 'written-aside', key: `state.backup.${NOW + 1}` }], 'повторная загрузка тоже не затирает')

  const same = new FakeDriver()
  same.data.set(KEYS.stateBackup, 'тот же текст')
  same.data.set(KEYS.state, 'тот же текст')
  const r2 = await loadAll(same, NOW)
  assertEqual(r2.backups, [{ from: 'state', status: 'already-saved', key: KEYS.stateBackup }], 'тот же текст не дублируется')
  assertEqual(same.data.size, 2, 'ничего не добавлено')
})

await group('loadAll: более новая версия блокирует запись обоих ключей и ничего не пишет', async () => {
  const d = new FakeDriver()
  const newer = JSON.stringify({ ...fixture(), version: 2 })
  d.data.set(KEYS.state, newer)
  d.data.set(KEYS.active, serializeActive(activeOf(fixture())))
  const r = await loadAll(d, NOW)
  assertEqual(r.state.source, 'newer-version', 'state newer')
  assertEqual(r.saveBlock, { state: 'newer-version', active: 'newer-version' }, 'оба заблокированы')
  assertEqual(r.backups, [], 'копий нет: данные целы')
  assertEqual(d.data.get(KEYS.state), newer, 'текст не тронут')

  const results: SaveResult[] = []
  const saver = createSaver(d, x => results.push(x), { block: r.saveBlock })
  const s1 = await saver.saveState(defaultState(NOW))
  const s2 = await saver.saveActive(null)
  assertEqual([s1.ok, s2.ok], [false, false], 'обе записи отклонены')
  assert(!s1.ok && s1.reason === 'blocked', 'причина blocked')
  assertEqual(results.length, 2, 'onResult получил оба отказа')
  assertEqual(d.data.get(KEYS.state), newer, 'состояние новой сборки цело')
  assert(d.data.has(KEYS.active), 'черновик не снят')
})

await group('loadAll: новая версия только у черновика тоже блокирует обе записи', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, FIXTURE_TEXT)
  d.data.set(KEYS.active, JSON.stringify({ ...activeOf(fixture()), version: 3 }))
  const r = await loadAll(d, NOW)
  assertEqual(r.active, { active: null, source: 'newer-version', dropped: 0 }, 'черновик null без записи')
  assertEqual(r.saveBlock, { state: 'newer-version', active: 'newer-version' }, 'обе блокированы')
  assert(!d.data.has(KEYS.activeBackup), 'копии нет')
})

await group('loadAll: сбой чтения не роняет и блокирует запись поверх', async () => {
  const d = new ReadFailDriver()
  d.data.set(KEYS.state, FIXTURE_TEXT)
  d.failReads.add(KEYS.state)
  const r = await loadAll(d, NOW)
  assertEqual(r.state.source, 'default', 'дефолт для отрисовки')
  assertEqual(r.readErrors, { state: 'чтение state не удалось' }, 'ошибка видна')
  assertEqual(r.saveBlock, { state: 'read-failed', active: 'read-failed' }, 'обе блокированы')

  const d2 = new ReadFailDriver()
  d2.data.set(KEYS.state, FIXTURE_TEXT)
  d2.failReads.add(KEYS.active)
  const r2 = await loadAll(d2, NOW)
  assertEqual(r2.state.source, 'stored', 'состояние прочитано')
  assertEqual(r2.saveBlock, { state: null, active: 'read-failed' }, 'блокирован только черновик')
})

await group('loadAll: копию не удалось записать - запись поверх блокируется', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, 'битое')
  d.failWrites = true
  const r = await loadAll(d, NOW)
  assertEqual(r.backups.length, 1, 'одна заметка')
  assertEqual([r.backups[0].status, r.backups[0].key], ['failed', KEYS.stateBackup], 'failed')
  assert(typeof r.backups[0].error === 'string' && r.backups[0].error.length > 0, 'с текстом ошибки')
  assertEqual(r.saveBlock, { state: 'backup-failed', active: 'backup-failed' }, 'запись выключена')

  const d2 = new FakeDriver()
  d2.data.set(KEYS.active, 'битое')
  d2.failWrites = true
  const r2 = await loadAll(d2, NOW)
  assertEqual(r2.saveBlock, { state: null, active: 'backup-failed' }, 'сбой копии черновика блокирует только черновик')
})

/* ---- createSaver ---- */

await group('createSaver: одна запись в полёте на ключ, поздняя замещает ожидающую', async () => {
  const d = new GatedDriver()
  const results: SaveResult[] = []
  const saver = createSaver(d, x => results.push(x))
  const s = (n: number): AppState => ({ ...defaultState(NOW), meta: { ...defaultState(NOW).meta, sessionsSinceBackup: n } })

  const p1 = saver.saveState(s(1))
  const p2 = saver.saveState(s(2))
  const p3 = saver.saveState(s(3))
  await tick()
  assertEqual(d.waiting, 1, 'в полёте одна запись')
  assertEqual(d.writes.length, 1, 'вторая и третья ждут')
  await d.release()
  assertEqual(d.writes.length, 2, 'после первой ушла одна, последняя')
  assertEqual(d.writes[1].value, serialize(s(3)), 'ушло последнее значение, второе замещено')
  await d.release()
  const [r1, r2, r3] = await Promise.all([p1, p2, p3])
  assertEqual([r1, r2, r3], [{ ok: true, key: 'state' }, { ok: true, key: 'state' }, { ok: true, key: 'state' }], 'все промисы разрешены')
  assertEqual(results.length, 2, 'onResult по числу настоящих записей')
  assertEqual(d.data.get('state'), serialize(s(3)), 'на носителе последнее')
  await saver.flush()
  assertEqual(d.waiting, 0, 'очередь пуста')
})

await group('createSaver: ключи независимы, null снимает черновик', async () => {
  const d = new GatedDriver()
  const saver = createSaver(d, () => {})
  const a = activeOf(fixture())
  void saver.saveState(fixture())
  void saver.saveActive(a)
  await tick()
  assertEqual(d.waiting, 2, 'state и active пишутся параллельно')
  await d.release()
  await d.release()
  assertEqual(d.data.get('active'), serializeActive(a), 'черновик записан')
  const pr = saver.saveActive(null)
  await tick()
  await d.release()
  assertEqual(await pr, { ok: true, key: 'active' }, 'снятие ок')
  assert(!d.data.has('active'), 'черновик снят')
  assertEqual(d.writes.at(-1), { key: 'active', value: null }, 'это remove')
})

await group('createSaver: текст снимается в момент вызова', async () => {
  const d = new FakeDriver()
  const saver = createSaver(d, () => {})
  const st = defaultState(NOW)
  const p = saver.saveState(st)
  st.settings.defaultRestSec = 5
  await p
  assertEqual(JSON.parse(d.data.get('state')!).settings.defaultRestSec, 90, 'мутация после вызова не попала')
})

await group('createSaver: ошибка записи даёт SaveResult с ошибкой, очередь продолжает работу', async () => {
  const d = new FakeDriver()
  const results: SaveResult[] = []
  const saver = createSaver(d, x => results.push(x))
  d.failWrites = true
  const r = await saver.saveState(defaultState(NOW))
  assert(!r.ok, 'не ок')
  assert(!r.ok && r.reason === 'failed' && r.key === 'state' && r.error.includes('failWrites'), 'причина и текст')
  assertEqual(results, [r], 'onResult получил ошибку')
  d.failWrites = false
  const r2 = await saver.saveState(defaultState(NOW))
  assertEqual(r2, { ok: true, key: 'state' }, 'следующая запись проходит')
})

await group('createSaver: переполнение квоты распознаётся', async () => {
  const d = new GatedDriver()
  const saver = createSaver(d, () => {})
  const quota = new Error('full')
  quota.name = 'QuotaExceededError'
  d.failNext = quota
  const p = saver.saveActive(activeOf(fixture()))
  await tick()
  await d.release()
  const r = await p
  assert(!r.ok && r.reason === 'quota', 'quota')
})

await group('createSaver: исключение в onResult не останавливает очередь', async () => {
  const d = new FakeDriver()
  let calls = 0
  const errors: unknown[] = []
  const saver = createSaver(d, () => {
    calls++
    throw new Error('обработчик упал')
  })
  const original = process.listeners('uncaughtException')
  process.removeAllListeners('uncaughtException')
  process.on('uncaughtException', err => errors.push(err))
  try {
    await saver.saveState(defaultState(NOW))
    await saver.saveState(defaultState(NOW + 1))
    await new Promise(resolve => setTimeout(resolve, 0))
  } finally {
    process.removeAllListeners('uncaughtException')
    for (const l of original) process.on('uncaughtException', l)
  }
  assertEqual(calls, 2, 'обе записи прошли')
  assertEqual(errors.length, 2, 'ошибки обработчика всплыли, а не проглочены')
  assertEqual(JSON.parse(d.data.get('state')!).meta.installedAt, NOW + 1, 'последняя записана')
})

await group('createSaver: блокировка одного ключа не трогает другой', async () => {
  const d = new FakeDriver()
  const saver = createSaver(d, () => {}, { block: { active: 'read-failed' } })
  assertEqual(saver.block, { state: null, active: 'read-failed' }, 'block виден')
  const r = await saver.saveActive(null)
  assert(!r.ok && r.reason === 'blocked' && r.error.length > 0, 'черновик заблокирован с текстом')
  assertEqual(await saver.saveState(defaultState(NOW)), { ok: true, key: 'state' }, 'состояние пишется')
})

await group('createSaver + loadAll: после копии битого запись поверх и повторная загрузка', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, 'мусор')
  const loaded = await loadAll(d, NOW)
  const saver = createSaver(d, () => {}, { block: loaded.saveBlock })
  await saver.saveState(fixture())
  const again = await loadAll(d, NOW + 1)
  assertEqual([again.state.source, again.state.dropped], ['stored', 0], 'читается сохранённое')
  assertEqual(again.state.state, fixture(), 'то самое')
  assertEqual(d.data.get(KEYS.stateBackup), 'мусор', 'копия осталась')
})

/* ---- persistStorage, storageEstimate ---- */

await group('persistStorage: granted, denied, unsupported', async () => {
  assertEqual(await persistStorage(undefined), 'unsupported', 'нет StorageManager')
  assertEqual(await persistStorage({}), 'unsupported', 'нет persist')
  assertEqual(await persistStorage({ persist: async () => true }), 'granted', 'разрешено')
  assertEqual(await persistStorage({ persist: async () => false }), 'denied', 'отказ')
  let asked = false
  assertEqual(await persistStorage({ persisted: async () => true, persist: async () => { asked = true; return false } }), 'granted', 'уже закреплено')
  assert(!asked, 'повторно не спрашивает')
  assertEqual(await persistStorage({ persist: async () => { throw new Error('нет') } }), 'denied', 'отказ промиса - не закреплено')
  assertEqual(await persistStorage(), 'unsupported', 'в node без navigator.storage')
})

await group('storageEstimate: числа или null', async () => {
  assertEqual(await storageEstimate(undefined), null, 'нет менеджера')
  assertEqual(await storageEstimate({ estimate: async () => ({ usage: 1024, quota: 2048 }) }), { usageBytes: 1024, quotaBytes: 2048 }, 'числа')
  assertEqual(await storageEstimate({ estimate: async () => ({ usage: 0, quota: 0 }) }), { usageBytes: 0, quotaBytes: 0 }, 'нули')
  assertEqual(await storageEstimate({ estimate: async () => ({}) }), null, 'без полей')
  assertEqual(await storageEstimate({ estimate: async () => { throw new Error('x') } }), null, 'отказ')
})

/* ---- драйверы ---- */

async function driverContract(driver: StorageDriver, label: string): Promise<void> {
  assertEqual(await driver.get('state'), null, `${label}: пусто`)
  await driver.set('state', '{"a":1}')
  assertEqual(await driver.get('state'), '{"a":1}', `${label}: записано`)
  await driver.set('state', '{"a":2}')
  assertEqual(await driver.get('state'), '{"a":2}', `${label}: перезаписано`)
  await driver.set('active', '')
  assertEqual(await driver.get('active'), '', `${label}: пустая строка - не null`)
  await driver.remove('state')
  assertEqual(await driver.get('state'), null, `${label}: удалено`)
  await driver.remove('нет-такого')
}

await group('memoryDriver и localDriver: контракт StorageDriver', async () => {
  await driverContract(memoryDriver(), 'memory')
  assertEqual(await memoryDriver({ state: 'x' }).get('state'), 'x', 'начальные данные')
  const ls = new FakeLocalStorage()
  const local = localDriver(ls)
  await driverContract(local, 'local')
  await local.set('state', 'v')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}state`), 'v', 'ключ с префиксом stolpy:')
  assertEqual(ls.getItem('state'), null, 'без префикса не пишет')
  assertEqual(local.name, 'local', 'имя')
})

await group('localDriver: исключение Storage уходит отказом промиса', async () => {
  const ls = new FakeLocalStorage()
  ls.setItem = () => {
    const e = new Error('quota')
    e.name = 'QuotaExceededError'
    throw e
  }
  let caught: unknown = null
  try {
    await localDriver(ls).set('state', 'x')
  } catch (err) {
    caught = err
  }
  assert(caught instanceof Error && caught.name === 'QuotaExceededError', 'ошибка проброшена')
  const saver = createSaver(localDriver(ls), () => {})
  const r = await saver.saveState(defaultState(NOW))
  assert(!r.ok && r.reason === 'quota', 'saver распознал квоту через localDriver')
})

/* Минимальная подделка IndexedDB: события приходят асинхронно, как в
   браузере. Хватает на проверку тонкого idbDriver и openIdb. */
type Handler = (() => void) | null
function later(fn: () => void): void {
  setTimeout(fn, 0)
}
function fakeIdb(mode: 'ok' | 'error' | 'blocked' | 'throw') {
  const data = new Map<string, unknown>()
  const stores = new Set<string>()
  let upgrades = 0
  let failTx = false
  const db = {
    objectStoreNames: { contains: (n: string) => stores.has(n) },
    createObjectStore: (n: string) => { stores.add(n) },
    onversionchange: null as Handler,
    closed: false,
    close() { this.closed = true },
    transaction(name: string, txMode: string) {
      if (!stores.has(name)) throw new Error(`нет хранилища ${name}`)
      const tx = { oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler, error: null as Error | null, mode: txMode }
      const req = (fn: () => unknown) => {
        const r = { result: undefined as unknown, error: null as Error | null, onsuccess: null as Handler }
        later(() => {
          if (failTx) {
            tx.error = new Error('диск')
            tx.onerror?.()
            return
          }
          r.result = fn()
          r.onsuccess?.()
          tx.oncomplete?.()
        })
        return r
      }
      return {
        objectStore: () => ({
          get: (k: string) => req(() => data.get(k)),
          put: (v: unknown, k: string) => req(() => { data.set(k, v); return k }),
          delete: (k: string) => req(() => { data.delete(k); return undefined }),
        }),
        ...tx,
        set oncomplete(f: Handler) { tx.oncomplete = f },
        set onerror(f: Handler) { tx.onerror = f },
        set onabort(f: Handler) { tx.onabort = f },
        get error() { return tx.error },
      }
    },
  }
  const opened: { name: string; version: number }[] = []
  const factory = {
    open(name: string, version: number) {
      opened.push({ name, version })
      if (mode === 'throw') throw new Error('SecurityError')
      const req = {
        result: db, error: null as Error | null,
        onupgradeneeded: null as Handler, onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler,
      }
      later(() => {
        if (mode === 'error') {
          req.error = new Error('InvalidStateError')
          req.onerror?.()
        } else if (mode === 'blocked') {
          req.onblocked?.()
        } else {
          if (!stores.has(IDB_STORE)) {
            upgrades++
            req.onupgradeneeded?.()
          }
          req.onsuccess?.()
        }
      })
      return req
    },
  }
  return {
    factory: factory as unknown as IDBFactory, db, data, opened,
    get upgrades() { return upgrades },
    failTransactions() { failTx = true },
  }
}

await group('openIdb + idbDriver: база stolpy, хранилище kv, контракт', async () => {
  const f = fakeIdb('ok')
  const db = await openIdb(f.factory)
  assertEqual(f.opened, [{ name: IDB_NAME, version: IDB_VERSION }], 'имя и версия')
  assertEqual([IDB_NAME, IDB_STORE], ['stolpy', 'kv'], 'константы')
  assertEqual(f.upgrades, 1, 'хранилище создано при первом открытии')
  await openIdb(f.factory)
  assertEqual(f.upgrades, 1, 'второй раз не создаётся')
  const driver = idbDriver(db)
  assertEqual(driver.name, 'idb', 'имя')
  await driverContract(driver, 'idb')
  f.data.set('weird', 42)
  let caught: unknown = null
  try {
    await driver.get('weird')
  } catch (err) {
    caught = err
  }
  assert(caught instanceof Error, 'не строка под ключом - отказ, а не тихий null')
  ;(db as unknown as { onversionchange: () => void }).onversionchange()
  assert(f.db.closed, 'onversionchange закрывает соединение')
})

await group('idbDriver: ошибка транзакции уходит отказом', async () => {
  const f = fakeIdb('ok')
  const driver = idbDriver(await openIdb(f.factory))
  f.failTransactions()
  let caught: unknown = null
  try {
    await driver.set('state', 'x')
  } catch (err) {
    caught = err
  }
  assert(caught instanceof Error && caught.message === 'диск', 'ошибка транзакции проброшена')
})

await group('openIdb: onerror, onblocked и исключение open дают отказ', async () => {
  for (const mode of ['error', 'blocked', 'throw'] as const) {
    let caught: unknown = null
    try {
      await openIdb(fakeIdb(mode).factory)
    } catch (err) {
      caught = err
    }
    assert(caught instanceof Error, `отказ при ${mode}`)
  }
})

await group('pickDriver: IndexedDB, затем localStorage, затем память', async () => {
  const ok = await pickDriverVerbose({ indexedDB: fakeIdb('ok').factory, localStorage: new FakeLocalStorage() })
  assertEqual([ok.driver.name, ok.fallbacks], ['idb', []], 'IndexedDB открылась')

  const toLocal = await pickDriverVerbose({ indexedDB: fakeIdb('error').factory, localStorage: new FakeLocalStorage() })
  assertEqual(toLocal.driver.name, 'local', 'ошибка открытия - localStorage')
  assertEqual(toLocal.fallbacks, ['IndexedDB: InvalidStateError'], 'причина записана')

  const blocked = await pickDriverVerbose({ indexedDB: fakeIdb('blocked').factory, localStorage: new FakeLocalStorage() })
  assertEqual(blocked.driver.name, 'local', 'блокировка - localStorage')

  const noIdb = await pickDriverVerbose({ indexedDB: null, localStorage: new FakeLocalStorage() })
  assertEqual(noIdb.driver.name, 'local', 'нет IndexedDB - localStorage')

  const brokenLs = new FakeLocalStorage()
  brokenLs.setItem = () => { throw new Error('приватный режим') }
  const toMemory = await pickDriverVerbose({ indexedDB: fakeIdb('throw').factory, localStorage: brokenLs })
  assertEqual(toMemory.driver.name, 'memory', 'localStorage не пишет - память')
  assertEqual(toMemory.fallbacks, ['IndexedDB: SecurityError', 'localStorage: приватный режим'], 'обе причины')

  const nothing = await pickDriver({ indexedDB: null, localStorage: null })
  assertEqual(nothing.name, 'memory', 'ничего нет - память')

  const probeLs = new FakeLocalStorage()
  await pickDriver({ indexedDB: null, localStorage: probeLs })
  assertEqual(probeLs.length, 0, 'пробная запись убрана')
})

await group('browserEnv и pickDriver по умолчанию в node', async () => {
  await withFakeLocalStorage(async ls => {
    const env = browserEnv()
    assertEqual(env.indexedDB, null, 'IndexedDB в node нет')
    assert(env.localStorage === ls, 'localStorage подхвачен из globalThis')
    const d = await pickDriver()
    assertEqual(d.name, 'local', 'выбран localStorage')
  })
})

finish()
