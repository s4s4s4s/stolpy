import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FakeDriver, FakeLocalStorage, assert, assertEqual, finish, group, withFakeLocalStorage } from './_harness.ts'
import type { ActiveSession, AppState, StorageDriver } from '../src/core/types.ts'
import { defaultState, serialize, serializeActive } from '../src/state/storage.ts'
import {
  KEYS, asideBackupKey, createSaver, listBackups, loadAll, migratedKey, openStorage, parseBackupKey, persistStorage,
  readBackupText, storageEstimate, wipeAll, type SaveKey, type SaveResult,
} from '../src/state/store.ts'
import {
  IDB_NAME, IDB_STORE, IDB_VERSION, LOCAL_PREFIX, browserEnv, idbDriver, localDriver, memoryDriver, openIdb,
  pickDriver, pickDriverVerbose,
} from '../src/state/driver.ts'

const NOW = Date.UTC(2026, 9, 17, 9, 0)
const FIXTURE_TEXT = readFileSync(join(process.cwd(), 'test', 'fixtures', 'state-v1.json'), 'utf8')
const fixture = (): AppState => JSON.parse(FIXTURE_TEXT) as AppState
/** Точка отсчёта сейвера на пустом носителе. */
const NOTHING_STORED: Record<SaveKey, string | null> = { state: null, active: null }

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
  async keys(prefix = ''): Promise<string[]> {
    return [...this.data.keys()].filter(k => k.startsWith(prefix)).sort()
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
  const saver = createSaver(d, x => results.push(x), { stored: r.stored, block: r.saveBlock })
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
  const saver = createSaver(d, x => results.push(x), { stored: NOTHING_STORED })
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
  const saver = createSaver(d, () => {}, { stored: NOTHING_STORED })
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
  const saver = createSaver(d, () => {}, { stored: NOTHING_STORED })
  const st = defaultState(NOW)
  const p = saver.saveState(st)
  st.settings.defaultRestSec = 5
  await p
  assertEqual(JSON.parse(d.data.get('state')!).settings.defaultRestSec, 90, 'мутация после вызова не попала')
})

await group('createSaver: ошибка записи даёт SaveResult с ошибкой, очередь продолжает работу', async () => {
  const d = new FakeDriver()
  const results: SaveResult[] = []
  const saver = createSaver(d, x => results.push(x), { stored: NOTHING_STORED })
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
  const saver = createSaver(d, () => {}, { stored: NOTHING_STORED })
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
  }, { stored: NOTHING_STORED })
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
  const saver = createSaver(d, () => {}, { stored: NOTHING_STORED, block: { active: 'read-failed' } })
  assertEqual(saver.block, { state: null, active: 'read-failed' }, 'block виден')
  const r = await saver.saveActive(null)
  assert(!r.ok && r.reason === 'blocked' && r.error.length > 0, 'черновик заблокирован с текстом')
  assertEqual(await saver.saveState(defaultState(NOW)), { ok: true, key: 'state' }, 'состояние пишется')
})

await group('createSaver + loadAll: после копии битого запись поверх и повторная загрузка', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, 'мусор')
  const loaded = await loadAll(d, NOW)
  const saver = createSaver(d, () => {}, { stored: loaded.stored, block: loaded.saveBlock })
  await saver.saveState(fixture())
  const again = await loadAll(d, NOW + 1)
  assertEqual([again.state.source, again.state.dropped], ['stored', 0], 'читается сохранённое')
  assertEqual(again.state.state, fixture(), 'то самое')
  assertEqual(d.data.get(KEYS.stateBackup), 'мусор', 'копия осталась')
})

/* ---- commitFinished: черновик снимается только после записанного состояния ---- */

/** Состояние с завершённой тренировкой черновика. */
function finishedStateOf(active: ActiveSession): AppState {
  const st = fixture()
  st.sessions[active.session.id] = { ...active.session, endedAt: NOW }
  return st
}

await group('commitFinished: снятие черновика не уходит, пока пишется состояние', async () => {
  const d = new GatedDriver()
  const a = activeOf(fixture())
  const draftText = serializeActive(a)
  d.data.set(KEYS.active, draftText)
  const saver = createSaver(d, () => {}, { stored: { state: null, active: draftText } })
  const finished = finishedStateOf(a)

  const p = saver.commitFinished(finished)
  await tick()
  assertEqual(d.writes, [{ key: 'state', value: serialize(finished) }], 'в полёте только состояние')
  await d.release()
  assertEqual(d.writes.at(-1), { key: 'active', value: null }, 'после записи состояния - снятие черновика')
  await d.release()
  const r = await p
  assertEqual(r, { ok: true, state: { ok: true, key: 'state' }, active: { ok: true, key: 'active' } }, 'итог ок')
  assertEqual(d.data.get(KEYS.state), serialize(finished), 'состояние с тренировкой на носителе')
  assert(!d.data.has(KEYS.active), 'черновик снят')
})

await group('commitFinished: запись состояния упала - черновик остаётся на носителе', async () => {
  const d = new GatedDriver()
  const a = activeOf(fixture())
  const draftText = serializeActive(a)
  d.data.set(KEYS.active, draftText)
  const results: SaveResult[] = []
  const saver = createSaver(d, x => results.push(x), { stored: { state: null, active: draftText } })
  const quota = new Error('full')
  quota.name = 'QuotaExceededError'
  d.failNext = quota

  const p = saver.commitFinished(finishedStateOf(a))
  await tick()
  await d.release()
  const r = await p
  assert(!r.ok && !r.state.ok && r.state.reason === 'quota', 'отказ состояния по квоте')
  assertEqual(r.active, null, 'до снятия черновика очередь не дошла')
  await saver.flush()
  assertEqual(d.writes.map(w => w.key), ['state'], 'remove черновика не уходил')
  assertEqual(d.data.get(KEYS.active), draftText, 'черновик цел: тренировку можно завершить снова')
  assert(!d.data.has(KEYS.state), 'состояния нет')
  assertEqual(results.map(x => x.key), ['state'], 'onResult получил только отказ состояния')

  const again = saver.commitFinished(finishedStateOf(a))
  await tick()
  await d.release()
  await d.release()
  assertEqual((await again).ok, true, 'повтор после сбоя проходит')
  assert(!d.data.has(KEYS.active), 'черновик снят после записанного состояния')
})

await group('commitFinished: запись состояния выключена - черновик не трогается', async () => {
  const d = new FakeDriver()
  const a = activeOf(fixture())
  const draftText = serializeActive(a)
  d.data.set(KEYS.active, draftText)
  const saver = createSaver(d, () => {}, { stored: { state: null, active: draftText }, block: { state: 'read-failed' } })
  const r = await saver.commitFinished(finishedStateOf(a))
  assert(!r.ok && !r.state.ok && r.state.reason === 'blocked', 'состояние заблокировано')
  assertEqual(r.active, null, 'черновик не снимался')
  assertEqual(d.data.get(KEYS.active), draftText, 'черновик цел')
})

/* ---- конфликт с другой вкладкой ---- */

await group('createSaver: другая вкладка записала новее - отказ conflict, носитель не перетёрт, после rebase запись проходит', async () => {
  const d = new FakeDriver()
  d.data.set(KEYS.state, FIXTURE_TEXT)
  const loadedA = await loadAll(d, NOW)
  const loadedB = await loadAll(d, NOW)
  assertEqual(loadedA.stored, { state: FIXTURE_TEXT, active: null }, 'точка отсчёта - дословный текст носителя')
  const resultsA: SaveResult[] = []
  const tabA = createSaver(d, x => resultsA.push(x), { stored: loadedA.stored, block: loadedA.saveBlock })
  const tabB = createSaver(d, () => {}, { stored: loadedB.stored, block: loadedB.saveBlock })

  const fromB = fixture()
  fromB.bodyWeights = [...fromB.bodyWeights, { date: '2026-10-17', kg: 79.9 }]
  assertEqual(await tabB.saveState(fromB), { ok: true, key: 'state' }, 'вкладка B записала')
  const textB = serialize(fromB)

  const fromA = fixture()
  fromA.settings = { ...fromA.settings, defaultRestSec: fromA.settings.defaultRestSec + 15 }
  assert(serialize(fromA) !== FIXTURE_TEXT, 'правка A меняет текст')
  const r = await tabA.saveState(fromA)
  assert(!r.ok && r.reason === 'conflict', 'вкладка A получила conflict')
  assert(!r.ok && r.reason === 'conflict' && r.storedText === textB && r.error.length > 0, 'в отказе текст носителя и строка для экрана')
  assertEqual(d.data.get(KEYS.state), textB, 'запись B не перетёрта')
  assertEqual(resultsA, [r], 'onResult получил конфликт')

  const r2 = await tabA.saveState(fromA)
  assert(!r2.ok && r2.reason === 'conflict', 'без rebase ключ остаётся в конфликте')
  assertEqual(d.data.get(KEYS.state), textB, 'и носитель по-прежнему цел')

  const mergedA: AppState = { ...fromB, settings: fromA.settings }
  tabA.rebase('state', textB)
  assertEqual(await tabA.saveState(mergedA), { ok: true, key: 'state' }, 'после rebase запись проходит')
  assertEqual(d.data.get(KEYS.state), serialize(mergedA), 'на носителе слитое')
  const r3 = await tabB.saveState(fromB)
  assert(!r3.ok && r3.reason === 'conflict', 'теперь отстала вкладка B')
})

await group('createSaver: черновик снят другой вкладкой - запись черновика и commitFinished отказывают conflict', async () => {
  const d = new FakeDriver()
  const a = activeOf(fixture())
  const draftText = serializeActive(a)
  d.data.set(KEYS.state, FIXTURE_TEXT)
  d.data.set(KEYS.active, draftText)
  const loaded = await loadAll(d, NOW)
  const tab = createSaver(d, () => {}, { stored: loaded.stored, block: loaded.saveBlock })
  // другая вкладка завершила эту тренировку: состояние новое, черновика нет
  const otherFinished = serialize(finishedStateOf(a))
  d.data.set(KEYS.state, otherFinished)
  d.data.delete(KEYS.active)

  const draft = await tab.saveActive({ ...a, currentItemId: 'c2' })
  assert(!draft.ok && draft.reason === 'conflict' && draft.storedText === null, 'черновик не воскрешён поверх снятого')
  assert(!d.data.has(KEYS.active), 'черновика на носителе нет')

  const r = await tab.commitFinished(finishedStateOf(a))
  assert(!r.ok && !r.state.ok && r.state.reason === 'conflict', 'состояние другой вкладки не перетёрто')
  assertEqual(r.active, null, 'черновик не снимался')
  assertEqual(d.data.get(KEYS.state), otherFinished, 'носитель цел')
})

await group('createSaver: сбой чтения перед записью - отказ failed, носитель не тронут', async () => {
  const d = new ReadFailDriver()
  d.data.set(KEYS.state, FIXTURE_TEXT)
  const saver = createSaver(d, () => {}, { stored: { state: FIXTURE_TEXT, active: null } })
  d.failReads.add(KEYS.state)
  const r = await saver.saveState(defaultState(NOW))
  assert(!r.ok && r.reason === 'failed' && r.error.includes('чтение state не удалось'), 'причина failed с текстом')
  assertEqual(d.data.get(KEYS.state), FIXTURE_TEXT, 'текст не тронут')
  d.failReads.delete(KEYS.state)
  assertEqual(await saver.saveState(defaultState(NOW)), { ok: true, key: 'state' }, 'после восстановления чтения запись проходит')
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
  await driver.set('state.backup', 'b')
  await driver.set('migrated.5.state', 'm')
  assertEqual(await driver.keys(), ['active', 'migrated.5.state', 'state.backup'], `${label}: keys по возрастанию`)
  assertEqual(await driver.keys('state'), ['state.backup'], `${label}: keys с префиксом`)
  assertEqual(await driver.keys('нет'), [], `${label}: keys без совпадений`)
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
  ls.setItem('чужое', '1')
  ls.setItem('other:state', '1')
  assertEqual(await local.keys(), ['active', 'migrated.5.state', 'state', 'state.backup'], 'keys localStorage: только свои, без префикса')
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
  const saver = createSaver(localDriver(ls), () => {}, { stored: NOTHING_STORED })
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
          getAllKeys: () => req(() => [...data.keys()]),
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

/* ---- сверка с запасным носителем ---- */

/** Состояние запасного режима: своя тренировка, вес и настройки. */
function strayStateOf(): AppState {
  const st = defaultState(NOW - 86_400_000)
  const session = JSON.parse(JSON.stringify(fixture().sessions['s-cardio']))
  session.id = 's-local'
  st.sessions['s-local'] = session
  st.bodyWeights = [{ date: '2026-10-16', kg: 80.5 }]
  st.settings = { ...st.settings, defaultRestSec: 150 }
  return st
}

function activeStartedAt(state: AppState, startedAt: number, itemId: string): ActiveSession {
  const a = activeOf(state)
  a.session.startedAt = startedAt
  a.currentItemId = itemId
  return a
}

function strayLocal(state: AppState | null, active: ActiveSession | null): { ls: FakeLocalStorage; stray: StorageDriver } {
  const ls = new FakeLocalStorage()
  if (state) ls.setItem(`${LOCAL_PREFIX}state`, serialize(state))
  if (active) ls.setItem(`${LOCAL_PREFIX}active`, serializeActive(active))
  return { ls, stray: localDriver(ls) }
}

function snapshot(ls: FakeLocalStorage): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i)!
    out[k] = ls.getItem(k)!
  }
  return out
}

await group('сверка: состояние и черновик запасного режима переносятся, ключи переименованы', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const strayState = strayStateOf()
  const strayActive = activeStartedAt(fixture(), NOW - 600_000, 'c1')
  const { ls, stray } = strayLocal(strayState, strayActive)
  const stateText = ls.getItem(`${LOCAL_PREFIX}state`)
  const activeText = ls.getItem(`${LOCAL_PREFIX}active`)

  const r = await loadAll(primary, NOW, { stray, fallbacks: [] })
  assertEqual(r.stray.status, 'done', 'сверка завершена')
  assertEqual(r.stray.moved, 2, 'перенесены тренировка и вес')
  assertEqual(r.stray.draftMoved, true, 'черновик перенесён')
  assertEqual(r.stray.counts?.sessions, { added: 1, kept: 0, replaced: 0 }, 'счётчик тренировок')
  assertEqual(r.stray.keys.map(k => [k.key, k.result, k.renamedTo]), [
    ['state', 'merged', `migrated.${NOW}.state`],
    ['active', 'merged', `migrated.${NOW}.active`],
  ], 'отчёт по ключам')
  assert(r.stray.message !== null && r.stray.message.includes('2 записи и черновик тренировки'), `строка для экрана: ${r.stray.message}`)

  const fx = fixture()
  const stored = JSON.parse(primary.data.get(KEYS.state)!) as AppState
  assertEqual(Object.keys(stored.sessions).sort(), [...Object.keys(fx.sessions), 's-local'].sort(), 'в основном все тренировки обоих')
  assertEqual(stored.settings, fx.settings, 'настройки основного остались')
  assertEqual(r.state.state, stored, 'загруженное совпадает с записанным')
  assertEqual(r.state.source, 'stored', 'источник stored')
  assertEqual(primary.data.get(KEYS.active), serializeActive(strayActive), 'черновик записан в основной')
  assertEqual(r.active, { active: strayActive, source: 'stored', dropped: 0 }, 'загруженный черновик')
  assertEqual(r.backups, [], 'вытеснять было нечего')
  assertEqual(r.stored, { state: primary.data.get(KEYS.state), active: primary.data.get(KEYS.active) }, 'точка отсчёта - тексты после сверки')

  assertEqual(ls.getItem(`${LOCAL_PREFIX}state`), null, 'state в localStorage снят')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}active`), null, 'active в localStorage снят')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}migrated.${NOW}.state`), stateText, 'текст состояния дословно под migrated')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}migrated.${NOW}.active`), activeText, 'текст черновика дословно под migrated')
  assertEqual(r.storage, { driver: 'idb', fallbacks: [], notice: null }, 'носитель IndexedDB без полосы')

  const primaryBefore = new Map(primary.data)
  const lsBefore = snapshot(ls)
  const again = await loadAll(primary, NOW + 1000, { stray, fallbacks: [] })
  assertEqual(again.stray.status, 'none', 'повторная загрузка: сверять нечего')
  assertEqual(again.stray.keys.map(k => k.result), ['absent', 'absent'], 'ключей нет')
  assertEqual(again.stray.message, null, 'строки нет')
  assertEqual(new Map(primary.data), primaryBefore, 'основной носитель не тронут')
  assertEqual(snapshot(ls), lsBefore, 'localStorage не тронут')
  assertEqual(Object.keys(again.state.state.sessions).length, Object.keys(fx.sessions).length + 1, 'тренировки не задвоены')
})

await group('сверка: отказ записи слитого состояния не трогает localStorage', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const strayState = strayStateOf()
  const { ls, stray } = strayLocal(strayState, activeStartedAt(fixture(), NOW - 600_000, 'c1'))
  const lsBefore = snapshot(ls)
  primary.failWrites = true
  const r = await loadAll(primary, NOW, { stray })
  assertEqual(r.stray.status, 'incomplete', 'сверка не закончена')
  assertEqual(r.stray.keys.map(k => [k.key, k.result, k.problem, k.renamedTo]), [
    ['state', 'not-merged', 'write-failed', null],
    ['active', 'not-merged', 'state-pending', null],
  ], 'причины по ключам')
  assert(typeof r.stray.keys[0].error === 'string', 'текст ошибки записи')
  assertEqual(snapshot(ls), lsBefore, 'localStorage дословно прежний')
  assertEqual(r.state.state, fixture(), 'в работе прежнее основное состояние')
  assertEqual(r.active.active, null, 'черновик не подставлен')
  assertEqual(r.stray.moved, 0, 'ничего не перенесено')
  assert(r.stray.message !== null && r.stray.message.includes('Перенос повторится'), 'строка о повторе')
  assertEqual(primary.data.get(KEYS.state), FIXTURE_TEXT, 'основное не изменилось')

  primary.failWrites = false
  const retry = await loadAll(primary, NOW + 1, { stray })
  assertEqual([retry.stray.status, retry.stray.moved, retry.stray.draftMoved], ['done', 2, true], 'следующая загрузка переносит всё')
})

await group('сверка: черновик запасного свежее - основной уходит в active.backup', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const older = activeStartedAt(fixture(), NOW - 3_600_000, 'c1')
  const olderText = serializeActive(older)
  primary.data.set(KEYS.active, olderText)
  const newer = activeStartedAt(fixture(), NOW - 600_000, 'c1')
  const { ls, stray } = strayLocal(null, newer)
  const r = await loadAll(primary, NOW, { stray })
  assertEqual(r.stray.status, 'done', 'готово')
  assertEqual(r.stray.keys.map(k => k.result), ['absent', 'merged'], 'состояния не было, черновик перенесён')
  assertEqual(primary.data.get(KEYS.activeBackup), olderText, 'вытесненный черновик дословно в копии')
  assertEqual(r.backups, [{ from: 'active', status: 'written', key: KEYS.activeBackup }], 'о копии сказано')
  assertEqual(r.active.active, newer, 'в работе свежий черновик')
  assertEqual(primary.data.get(KEYS.active), serializeActive(newer), 'и он записан')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}migrated.${NOW}.active`), serializeActive(newer), 'запасной переименован')
  assertEqual(r.stray.moved, 0, 'записей состояния не переносилось')
  assert(r.stray.message !== null && r.stray.message.includes('черновик тренировки'), 'строка про черновик')
})

await group('сверка: черновик основного свежее или одновременный - остаётся, запасной в копии', async () => {
  for (const delta of [0, 60_000]) {
    const primary = new FakeDriver('idb')
    primary.data.set(KEYS.state, FIXTURE_TEXT)
    const current = activeStartedAt(fixture(), NOW - 600_000 + delta, 'c1')
    primary.data.set(KEYS.active, serializeActive(current))
    const strayActive = activeStartedAt(fixture(), NOW - 600_000, 'c1')
    const strayText = serializeActive(strayActive)
    const { ls, stray } = strayLocal(null, strayActive)
    const r = await loadAll(primary, NOW, { stray })
    assertEqual(r.stray.keys[1].result, 'kept-current', `основной остался (delta ${delta})`)
    assertEqual(r.active.active, current, 'в работе черновик основного')
    assertEqual(primary.data.get(KEYS.active), serializeActive(current), 'основной не переписан')
    assertEqual(primary.data.has(KEYS.activeBackup), false, 'копию основного не делали')
    assertEqual(ls.getItem(`${LOCAL_PREFIX}active`), null, 'запасной снят')
    assertEqual(ls.getItem(`${LOCAL_PREFIX}migrated.${NOW}.active`), strayText, 'и лежит копией')
    assertEqual([r.stray.status, r.stray.draftMoved], ['done', false], 'итог')
  }
})

await group('сверка: копию вытесняемого черновика не записать - черновики не трогаются', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const older = activeStartedAt(fixture(), NOW - 3_600_000, 'c1')
  primary.data.set(KEYS.active, serializeActive(older))
  const { ls, stray } = strayLocal(null, activeStartedAt(fixture(), NOW - 600_000, 'c1'))
  const lsBefore = snapshot(ls)
  primary.failWrites = true
  const r = await loadAll(primary, NOW, { stray })
  assertEqual([r.stray.keys[1].result, r.stray.keys[1].problem], ['not-merged', 'backup-failed'], 'причина')
  assertEqual(r.active.active, older, 'в работе прежний черновик')
  assertEqual(snapshot(ls), lsBefore, 'localStorage прежний')
  assertEqual(r.stray.status, 'incomplete', 'не закончено')
})

await group('сверка: основное пусто - запасное берётся целиком, с настройками', async () => {
  const primary = new FakeDriver('idb')
  const strayState = strayStateOf()
  const { stray } = strayLocal(strayState, null)
  const r = await loadAll(primary, NOW, { stray })
  assertEqual(r.state, { state: strayState, source: 'stored', dropped: 0 }, 'состояние запасного режима')
  assertEqual(JSON.parse(primary.data.get(KEYS.state)!), strayState, 'записано в основной')
  assertEqual(r.state.state.settings.defaultRestSec, 150, 'настройки запасного режима не потеряны')
  assertEqual([r.stray.status, r.stray.moved], ['done', 2], 'итог')
})

await group('сверка: битое основное уже в копии - запасное занимает его место', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, '{битое')
  const strayState = strayStateOf()
  const { stray } = strayLocal(strayState, null)
  const r = await loadAll(primary, NOW, { stray })
  assertEqual(primary.data.get(KEYS.stateBackup), '{битое', 'битое отложено до записи')
  assertEqual(r.state.state, strayState, 'в работе состояние запасного режима')
  assertEqual(r.stray.status, 'done', 'итог')
})

await group('сверка: нечитаемое запасное только переименовывается', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const ls = new FakeLocalStorage()
  ls.setItem(`${LOCAL_PREFIX}state`, '{обрыв')
  ls.setItem(`${LOCAL_PREFIX}active`, 'null')
  const r = await loadAll(primary, NOW, { stray: localDriver(ls) })
  assertEqual(r.stray.keys.map(k => [k.result, k.renamedTo]), [
    ['unreadable', `migrated.${NOW}.state`],
    ['unreadable', `migrated.${NOW}.active`],
  ], 'оба переименованы')
  assertEqual(primary.data.get(KEYS.state), FIXTURE_TEXT, 'основное не тронуто')
  assertEqual(primary.data.has(KEYS.active), false, 'черновик не появился')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}migrated.${NOW}.state`), '{обрыв', 'текст сохранён дословно')
  assertEqual([r.stray.status, r.stray.moved], ['done', 0], 'итог')
  assert(r.stray.message !== null && r.stray.message.includes('новых записей в нём не нашлось'), 'строка')
})

await group('сверка: запасное от более новой сборки и блокировка основного - ничего не трогается', async () => {
  const newer = new FakeDriver('idb')
  newer.data.set(KEYS.state, FIXTURE_TEXT)
  const lsNewer = new FakeLocalStorage()
  lsNewer.setItem(`${LOCAL_PREFIX}state`, JSON.stringify({ ...strayStateOf(), version: 99 }))
  const before = snapshot(lsNewer)
  const r1 = await loadAll(newer, NOW, { stray: localDriver(lsNewer) })
  assertEqual([r1.stray.keys[0].result, r1.stray.keys[0].problem], ['not-merged', 'newer-version'], 'более новая сборка')
  assertEqual(r1.stray.keys[1].result, 'absent', 'черновика нет')
  assertEqual(r1.stray.status, 'incomplete', 'не закончено')
  assertEqual(snapshot(lsNewer), before, 'localStorage прежний')
  assertEqual(newer.data.get(KEYS.state), FIXTURE_TEXT, 'основное прежнее')

  const blocked = new FakeDriver('idb')
  blocked.data.set(KEYS.state, JSON.stringify({ ...fixture(), version: 99 }))
  const strayState = strayStateOf()
  const { ls, stray } = strayLocal(strayState, activeStartedAt(fixture(), NOW, 'c1'))
  const lsBefore = snapshot(ls)
  const r2 = await loadAll(blocked, NOW, { stray })
  assertEqual(r2.saveBlock.state, 'newer-version', 'основное заблокировано')
  assertEqual(r2.stray.keys.map(k => [k.result, k.problem]), [['not-merged', 'blocked'], ['not-merged', 'state-pending']], 'причины')
  assertEqual(snapshot(ls), lsBefore, 'localStorage прежний')
  assertEqual(blocked.data.size, 1, 'основной не тронут')
})

await group('сверка: ключ не переименовался - повторная загрузка не задваивает', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const stray = new FakeDriver('local')
  stray.data.set(KEYS.state, serialize(strayStateOf()))
  stray.failRemoves = true
  const r = await loadAll(primary, NOW, { stray })
  assertEqual([r.stray.keys[0].result, r.stray.keys[0].problem, r.stray.keys[0].renamedTo], ['merged', 'rename-failed', null], 'перенесено, но не переименовано')
  assertEqual(r.stray.status, 'incomplete', 'не закончено')
  assertEqual(r.stray.moved, 2, 'перенос состоялся')
  assert(stray.data.has(`migrated.${NOW}.state`), 'копия успела лечь')

  stray.failRemoves = false
  const written = primary.data.get(KEYS.state)
  const again = await loadAll(primary, NOW + 1, { stray })
  assertEqual([again.stray.status, again.stray.moved], ['done', 0], 'повтор: новых записей нет')
  assertEqual(again.stray.counts?.sessions, { added: 0, kept: 1, replaced: 0 }, 'тренировка совпала по id')
  assertEqual(primary.data.get(KEYS.state), written, 'основное не переписано')
  assertEqual(Object.keys(again.state.state.sessions).length, Object.keys(fixture().sessions).length + 1, 'без дублей')
  assertEqual(stray.data.has(KEYS.state), false, 'теперь снят')
})

await group('сверка: занятый ключ копии и смена текста во время переноса не теряют данные', async () => {
  const primary = new FakeDriver('idb')
  primary.data.set(KEYS.state, FIXTURE_TEXT)
  const stray = new FakeDriver('local')
  const text = serialize(strayStateOf())
  stray.data.set(KEYS.state, text)
  stray.data.set(`migrated.${NOW}.state`, 'другое')
  const r = await loadAll(primary, NOW, { stray })
  assertEqual(r.stray.keys[0].problem, 'rename-failed', 'занятый ключ копии не затёрт')
  assertEqual(stray.data.get(`migrated.${NOW}.state`), 'другое', 'чужая копия цела')
  assertEqual(stray.data.get(KEYS.state), text, 'исходный остался')

  class ChangingDriver extends FakeDriver {
    reads = 0
    override async get(key: string): Promise<string | null> {
      if (key === KEYS.state && ++this.reads === 2) this.data.set(KEYS.state, 'записано другой вкладкой')
      return super.get(key)
    }
  }
  const changing = new ChangingDriver('local')
  changing.data.set(KEYS.state, text)
  const r2 = await loadAll(new FakeDriver('idb'), NOW, { stray: changing })
  assertEqual(r2.stray.keys[0].problem, 'rename-failed', 'изменённый ключ не удалён')
  assertEqual(changing.data.get(KEYS.state), 'записано другой вкладкой', 'новый текст ждёт следующей сверки')
})

await group('сверка: только у IndexedDB; носитель и причины видны в результате', async () => {
  for (const name of ['local', 'memory'] as const) {
    const d = new FakeDriver(name)
    const { ls, stray } = strayLocal(strayStateOf(), null)
    const before = snapshot(ls)
    const r = await loadAll(d, NOW, { stray, fallbacks: ['IndexedDB: InvalidStateError'] })
    assertEqual(r.stray.status, 'none', `${name}: сверки нет`)
    assertEqual(snapshot(ls), before, `${name}: localStorage не тронут`)
    assertEqual(r.storage.driver, name, `${name}: имя носителя`)
    assertEqual(r.storage.fallbacks, ['IndexedDB: InvalidStateError'], `${name}: причины`)
    assert(r.storage.notice !== null, `${name}: полоса есть`)
  }
  const mem = await loadAll(new FakeDriver('memory'), NOW)
  assert(mem.storage.notice!.includes('не сохранятся после закрытия'), 'полоса памяти')
  const local = await loadAll(new FakeDriver('local'), NOW)
  assert(local.storage.notice!.includes('localStorage'), 'полоса запасного режима')
  const idb = await loadAll(new FakeDriver('idb'), NOW)
  assertEqual([idb.storage.notice, idb.stray.status], [null, 'none'], 'IndexedDB без запасного: полосы и сверки нет')
})

await group('openStorage: выбор носителя, сверка и причины', async () => {
  const strayState = strayStateOf()
  const { ls } = strayLocal(strayState, null)
  const f = fakeIdb('ok')
  const opened = await openStorage(NOW, { indexedDB: f.factory, localStorage: ls })
  assertEqual(opened.driver.name, 'idb', 'IndexedDB')
  assert(opened.stray !== null && opened.stray.name === 'local', 'запасной носитель отдан для настроек')
  assertEqual([opened.result.stray.status, opened.result.stray.moved], ['done', 2], 'сверено')
  assertEqual(JSON.parse(f.data.get(KEYS.state) as string), strayState, 'в IndexedDB записано')
  assertEqual(ls.getItem(`${LOCAL_PREFIX}state`), null, 'в localStorage снято')
  assertEqual(opened.result.storage, { driver: 'idb', fallbacks: [], notice: null }, 'носитель')

  const ls2 = new FakeLocalStorage()
  const fallback = await openStorage(NOW, { indexedDB: fakeIdb('error').factory, localStorage: ls2 })
  assertEqual([fallback.driver.name, fallback.stray], ['local', null], 'запасной режим без сверки')
  assertEqual(fallback.result.storage.fallbacks, ['IndexedDB: InvalidStateError'], 'причина')
  assert(fallback.result.storage.notice !== null, 'полоса')

  const memory = await openStorage(NOW, { indexedDB: null, localStorage: null })
  assertEqual(memory.result.storage.driver, 'memory', 'память')
  assertEqual(memory.result.storage.fallbacks, ['IndexedDB: нет в этом браузере', 'localStorage: нет в этом браузере'], 'причины')
})

/* ---- копии и стирание ---- */

await group('parseBackupKey: копии битого и перенесённого', () => {
  assertEqual(parseBackupKey('state.backup'), { kind: 'backup', from: 'state', at: null }, 'основная копия')
  assertEqual(parseBackupKey('active.backup.1760691600000'), { kind: 'backup', from: 'active', at: 1760691600000 }, 'копия рядом')
  assertEqual(parseBackupKey(migratedKey('state', 5)), { kind: 'migrated', from: 'state', at: 5 }, 'перенесённое')
  for (const k of ['state', 'active', 'state.backupx', 'state.backup.', 'state.backup.1e3', 'migrated.x.state', 'migrated.5.other', 'state.backup.99999999999999999999']) {
    assertEqual(parseBackupKey(k), null, `не копия: ${k}`)
  }
})

await group('listBackups: все копии с датой из ключа и размером', async () => {
  const d = new FakeDriver('idb')
  d.data.set('state', 'основное')
  d.data.set('active', 'черновик')
  d.data.set('state.backup', 'ab')
  d.data.set('state.backup.5', 'йй')
  d.data.set('active.backup', '{}')
  d.data.set('active.backup.7', 'x')
  d.data.set('migrated.9.state', 'abc')
  d.data.set('migrated.x.state', 'чужое')
  const list = await listBackups(d)
  assertEqual(list, [
    { key: 'migrated.9.state', kind: 'migrated', from: 'state', at: 9, bytes: 3, driver: 'idb' },
    { key: 'active.backup.7', kind: 'backup', from: 'active', at: 7, bytes: 1, driver: 'idb' },
    { key: 'state.backup.5', kind: 'backup', from: 'state', at: 5, bytes: 4, driver: 'idb' },
    { key: 'active.backup', kind: 'backup', from: 'active', at: null, bytes: 2, driver: 'idb' },
    { key: 'state.backup', kind: 'backup', from: 'state', at: null, bytes: 2, driver: 'idb' },
  ], 'порядок, размер в байтах UTF-8, только копии')
  assertEqual(await listBackups(new FakeDriver()), [], 'пусто')

  const ls = new FakeLocalStorage()
  ls.setItem(`${LOCAL_PREFIX}migrated.3.active`, 'a')
  ls.setItem('migrated.4.active', 'не наше')
  assertEqual((await listBackups(localDriver(ls))).map(e => [e.key, e.driver]), [['migrated.3.active', 'local']], 'localStorage: свои ключи без префикса')

  const failing = new FakeDriver()
  failing.keys = async () => { throw new Error('носитель недоступен') }
  let caught: unknown = null
  try {
    await listBackups(failing)
  } catch (err) {
    caught = err
  }
  assert(caught instanceof Error && caught.message === 'носитель недоступен', 'ошибка носителя проброшена')
})

await group('readBackupText: дословный текст копии, основные ключи не читаются', async () => {
  const d = new FakeDriver()
  d.data.set('state', 'основное')
  d.data.set('state.backup.5', '{битое')
  assertEqual(await readBackupText(d, 'state.backup.5'), '{битое', 'текст')
  assertEqual(await readBackupText(d, 'active.backup'), null, 'нет копии')
  let caught: unknown = null
  try {
    await readBackupText(d, 'state')
  } catch (err) {
    caught = err
  }
  assert(caught instanceof RangeError, 'основной ключ - RangeError')
})

await group('wipeAll: стирает все ключи приложения и только их', async () => {
  const d = new FakeDriver('idb')
  for (const k of ['state', 'active', 'state.backup', 'migrated.1.state']) d.data.set(k, 'x')
  assertEqual(await wipeAll(d), 4, 'число стёртых')
  assertEqual(d.data.size, 0, 'пусто')
  assertEqual(await wipeAll(d), 0, 'повтор на пустом')

  const ls = new FakeLocalStorage()
  ls.setItem(`${LOCAL_PREFIX}state`, 'x')
  ls.setItem(`${LOCAL_PREFIX}migrated.1.active`, 'x')
  ls.setItem('other-app', 'чужое')
  assertEqual(await wipeAll(localDriver(ls)), 2, 'localStorage: свои ключи')
  assertEqual(snapshot(ls), { 'other-app': 'чужое' }, 'чужой ключ на том же origin цел')

  const stuck = new FakeDriver()
  stuck.data.set('state', 'x')
  stuck.failRemoves = true
  let caught: unknown = null
  try {
    await wipeAll(stuck)
  } catch (err) {
    caught = err
  }
  assert(caught instanceof Error, 'отказ удаления - отказ промиса')
  assertEqual(stuck.data.size, 1, 'не стёртое видно')
})

finish()
