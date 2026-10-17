/* Загрузка и сохранение поверх StorageDriver. Здесь вся логика носителя:
   копии битого, блокировка записи поверх данных более новой сборки, очередь
   записей. Драйверы тонкие (driver.ts), разбор текста чистый (storage.ts). */

import type { ActiveSession, AppState, Millis, StorageDriver } from '../core/types'
import {
  deserialize, deserializeActive, serialize, serializeActive,
  type ActiveLoadResult, type LoadResult,
} from './storage'

/** Ключи носителя. Адресуют хранилище, а не формат, и не меняются с версией. */
export const KEYS = {
  state: 'state',
  active: 'active',
  stateBackup: 'state.backup',
  activeBackup: 'active.backup',
} as const

export type SaveKey = 'state' | 'active'

/** Почему запись выключена:
    - 'newer-version' - состояние или черновик записаны более новой сборкой;
    - 'read-failed' - носитель не отдал запись: что там лежит, неизвестно,
      и писать поверх нельзя;
    - 'backup-failed' - текст, при чтении которого что-то потерялось, не
      удалось отложить в копию: первая же запись стёрла бы его навсегда. */
export type SaveBlockReason = 'newer-version' | 'read-failed' | 'backup-failed'

export interface BackupNote {
  /** Чей текст откладывался. */
  from: SaveKey
  /** written - копия записана под key; already-saved - под key уже лежит
      ровно этот текст; written-aside - под основным ключом копии лежит другой,
      более ранний текст, он не тронут, а новый записан рядом под key;
      failed - копию записать не удалось (error). */
  status: 'written' | 'already-saved' | 'written-aside' | 'failed'
  key: string
  error?: string
}

export interface LoadAllResult {
  state: LoadResult
  active: ActiveLoadResult
  backups: BackupNote[]
  /** Ошибки чтения носителя по ключам; при ошибке чтения ключ считается
      пустым для отрисовки, но запись поверх блокируется. */
  readErrors: Partial<Record<SaveKey, string>>
  /** Блокировка записи по ключам; null - запись разрешена. */
  saveBlock: Record<SaveKey, SaveBlockReason | null>
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Копия ключа для повторного случая: основной ключ копии занят другим
    текстом. Метка времени делает ключ уникальным в пределах загрузки. */
export function asideBackupKey(baseKey: string, now: Millis): string {
  return `${baseKey}.${now}`
}

/** Откладывает дословный текст в копию. Уже лежащая под ключом копия с
    другим текстом не затирается: это могла быть единственная копия более
    ранней потери. Новый текст тогда ложится рядом под ключом с меткой
    времени, а итог возвращается вызывающему, чтобы экран мог сказать об этом. */
async function writeBackup(driver: StorageDriver, from: SaveKey, baseKey: string, text: string, now: Millis): Promise<BackupNote> {
  try {
    const existing = await driver.get(baseKey)
    if (existing === null) {
      await driver.set(baseKey, text)
      return { from, status: 'written', key: baseKey }
    }
    if (existing === text) return { from, status: 'already-saved', key: baseKey }
    const key = asideBackupKey(baseKey, now)
    await driver.set(key, text)
    return { from, status: 'written-aside', key }
  } catch (err) {
    return { from, status: 'failed', key: baseKey, error: errorText(err) }
  }
}

async function readKey(driver: StorageDriver, key: string): Promise<{ text: string | null; error?: string }> {
  try {
    return { text: await driver.get(key) }
  } catch (err) {
    return { text: null, error: errorText(err) }
  }
}

/** Читает состояние и черновик. Никогда не бросает. Текст, при чтении
    которого что-то потерялось (не разобрался или dropped > 0), до любой
    записи откладывается в копию: state.backup и active.backup.

    Блокировки: более новая версия любой из записей выключает запись обеих
    (новая сборка пишет их согласованно, старая не должна трогать ни одну);
    сбой чтения или копии состояния тоже выключает обе, потому что
    завершение тренировки пишет состояние и снимает черновик парой. Сбой
    чтения или копии черновика выключает только черновик. */
export async function loadAll(driver: StorageDriver, now: Millis): Promise<LoadAllResult> {
  const stateRead = await readKey(driver, KEYS.state)
  const activeRead = await readKey(driver, KEYS.active)
  const state = deserialize(stateRead.text, now)
  const active = deserializeActive(activeRead.text)

  const readErrors: Partial<Record<SaveKey, string>> = {}
  if (stateRead.error !== undefined) readErrors.state = stateRead.error
  if (activeRead.error !== undefined) readErrors.active = activeRead.error

  const backups: BackupNote[] = []
  const lost = (r: { source: string; dropped: number }): boolean => r.source === 'corrupt' || r.dropped > 0
  let stateBackupFailed = false
  let activeBackupFailed = false
  if (stateRead.text !== null && lost(state)) {
    const note = await writeBackup(driver, 'state', KEYS.stateBackup, stateRead.text, now)
    backups.push(note)
    stateBackupFailed = note.status === 'failed'
  }
  if (activeRead.text !== null && lost(active)) {
    const note = await writeBackup(driver, 'active', KEYS.activeBackup, activeRead.text, now)
    backups.push(note)
    activeBackupFailed = note.status === 'failed'
  }

  let stateBlock: SaveBlockReason | null = null
  let activeBlock: SaveBlockReason | null = null
  if (state.source === 'newer-version' || active.source === 'newer-version') {
    stateBlock = activeBlock = 'newer-version'
  } else if (readErrors.state !== undefined) {
    stateBlock = activeBlock = 'read-failed'
  } else if (stateBackupFailed) {
    stateBlock = activeBlock = 'backup-failed'
  } else if (readErrors.active !== undefined) {
    activeBlock = 'read-failed'
  } else if (activeBackupFailed) {
    activeBlock = 'backup-failed'
  }

  return { state, active, backups, readErrors, saveBlock: { state: stateBlock, active: activeBlock } }
}

/* ---- сохранение ---- */

export type SaveFailure = 'blocked' | 'quota' | 'failed'

export type SaveResult =
  | { ok: true; key: SaveKey }
  | { ok: false; key: SaveKey; reason: SaveFailure; error: string }

const BLOCK_MESSAGE: Record<SaveBlockReason, string> = {
  'newer-version': 'Данные записаны более новой версией приложения. Эта версия их не меняет: обновите приложение.',
  'read-failed': 'Хранилище не отдало сохранённые данные, поэтому запись поверх выключена, чтобы их не затереть.',
  'backup-failed': 'Не удалось отложить копию повреждённых данных, поэтому запись поверх выключена, чтобы их не затереть.',
}

function isQuotaError(err: unknown): boolean {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : ''
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
}

function failureOf(key: SaveKey, err: unknown): SaveResult {
  if (isQuotaError(err)) {
    return { ok: false, key, reason: 'quota', error: 'Хранилище переполнено, запись не сохранена. Выгрузите резервную копию и освободите место.' }
  }
  return { ok: false, key, reason: 'failed', error: `Запись не сохранена: ${errorText(err)}` }
}

type Op = { kind: 'set'; text: string } | { kind: 'remove' }

interface Lane {
  busy: boolean
  /** Последнее ожидающее значение и все, кто ждёт его записи. */
  pending: { op: Op; waiters: ((r: SaveResult) => void)[] } | null
  idle: (() => void)[]
}

export interface Saver {
  /** Сохраняет состояние. Промис разрешается результатом записи, которая
      покрыла это значение: если пока шла предыдущая запись пришло более
      позднее значение, это - результат записи позднего (оно новее и
      содержит всё, что было в раннем). */
  saveState(state: AppState): Promise<SaveResult>
  /** Сохраняет черновик; null снимает его с носителя. */
  saveActive(active: ActiveSession | null): Promise<SaveResult>
  /** Дожидается, пока обе очереди опустеют. */
  flush(): Promise<void>
  readonly block: Readonly<Record<SaveKey, SaveBlockReason | null>>
}

export interface SaverOptions {
  block?: Partial<Record<SaveKey, SaveBlockReason | null>>
}

/** Очередь записей: на ключ не больше одной записи в полёте и одно
    ожидающее значение. Пришедшее во время записи значение замещает
    ожидающее, поэтому частые тапы не копят очередь, а на носитель всегда
    уходит последнее. Текст снимается в момент вызова: правки объекта после
    вызова в запись не попадают. onResult получает итог каждой
    состоявшейся записи и каждого отказа из-за блокировки. */
export function createSaver(driver: StorageDriver, onResult: (result: SaveResult) => void, options: SaverOptions = {}): Saver {
  const block: Record<SaveKey, SaveBlockReason | null> = {
    state: options.block?.state ?? null,
    active: options.block?.active ?? null,
  }
  const lanes: Record<SaveKey, Lane> = {
    state: { busy: false, pending: null, idle: [] },
    active: { busy: false, pending: null, idle: [] },
  }

  /* Исключение обработчика не должно останавливать очередь: иначе lane.busy
     остался бы true навсегда и ни одна запись больше не ушла бы. Оно
     перебрасывается отдельной задачей и видно как необработанная ошибка. */
  function report(result: SaveResult): void {
    try {
      onResult(result)
    } catch (err) {
      queueMicrotask(() => {
        throw err
      })
    }
  }

  async function write(key: SaveKey, op: Op): Promise<SaveResult> {
    try {
      if (op.kind === 'set') await driver.set(key, op.text)
      else await driver.remove(key)
      return { ok: true, key }
    } catch (err) {
      return failureOf(key, err)
    }
  }

  async function pump(key: SaveKey): Promise<void> {
    const lane = lanes[key]
    lane.busy = true
    while (lane.pending) {
      const { op, waiters } = lane.pending
      lane.pending = null
      const result = await write(key, op)
      for (const resolve of waiters) resolve(result)
      report(result)
    }
    lane.busy = false
    const idle = lane.idle.splice(0)
    for (const resolve of idle) resolve()
  }

  function enqueue(key: SaveKey, op: Op): Promise<SaveResult> {
    const reason = block[key]
    if (reason !== null) {
      const result: SaveResult = { ok: false, key, reason: 'blocked', error: BLOCK_MESSAGE[reason] }
      report(result)
      return Promise.resolve(result)
    }
    const lane = lanes[key]
    return new Promise<SaveResult>(resolve => {
      const waiters = lane.pending ? lane.pending.waiters : []
      waiters.push(resolve)
      lane.pending = { op, waiters }
      if (!lane.busy) void pump(key)
    })
  }

  function whenIdle(key: SaveKey): Promise<void> {
    const lane = lanes[key]
    if (!lane.busy) return Promise.resolve()
    return new Promise(resolve => lane.idle.push(resolve))
  }

  return {
    saveState: state => enqueue('state', { kind: 'set', text: serialize(state) }),
    saveActive: active => enqueue('active', active === null ? { kind: 'remove' } : { kind: 'set', text: serializeActive(active) }),
    flush: async () => {
      await Promise.all([whenIdle('state'), whenIdle('active')])
    },
    block,
  }
}

/* ---- постоянство и размер ---- */

/** Часть StorageManager, которой пользуется приложение. */
export interface StorageManagerLike {
  persist?: () => Promise<boolean>
  persisted?: () => Promise<boolean>
  estimate?: () => Promise<{ usage?: number; quota?: number }>
}

export type PersistResult = 'granted' | 'denied' | 'unsupported'

function browserStorageManager(): StorageManagerLike | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage
}

/** Просит браузер не вычищать данные при нехватке места. Зовётся на каждом
    запуске: Safari решает заново. Отказ промиса persist() значит «не
    закреплено» и так и показывается, а не прячется. */
export async function persistStorage(manager: StorageManagerLike | undefined = browserStorageManager()): Promise<PersistResult> {
  if (!manager || typeof manager.persist !== 'function') return 'unsupported'
  try {
    if (typeof manager.persisted === 'function' && (await manager.persisted())) return 'granted'
    return (await manager.persist()) ? 'granted' : 'denied'
  } catch {
    return 'denied'
  }
}

export interface StorageEstimate {
  usageBytes: number
  quotaBytes: number
}

/** Занятое и доступное место; null - браузер не говорит или отказал. */
export async function storageEstimate(manager: StorageManagerLike | undefined = browserStorageManager()): Promise<StorageEstimate | null> {
  if (!manager || typeof manager.estimate !== 'function') return null
  let estimate: { usage?: number; quota?: number }
  try {
    estimate = await manager.estimate()
  } catch {
    return null
  }
  const { usage, quota } = estimate
  if (typeof usage !== 'number' || typeof quota !== 'number' || !Number.isFinite(usage) || !Number.isFinite(quota)) return null
  return { usageBytes: usage, quotaBytes: quota }
}
