/* Загрузка и сохранение поверх StorageDriver. Здесь вся логика носителя:
   копии битого, блокировка записи поверх данных более новой сборки, очередь
   записей. Драйверы тонкие (driver.ts), разбор текста чистый (storage.ts). */

import type { ActiveSession, AppState, Millis, StorageDriver } from '../core/types'
import { importBackup, mergeStates, type MergeCollection, type MergeCount, type MergeResult } from '../core/backup'
import { pluralRu } from '../core/plural'
import {
  deserialize, deserializeActive, serialize, serializeActive,
  type ActiveLoadResult, type LoadResult,
} from './storage'
import { browserEnv, localDriver, pickDriverVerbose, type DriverEnv } from './driver'

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
  /** На каком носителе идёт работа и почему не на более предпочтительном. */
  storage: StorageInfo
  /** Сверка с запасным носителем прошлых запусков. */
  stray: StrayMerge
  /** Дословные тексты ключей на носителе после загрузки (null - ключа нет).
      Это точка отсчёта для createSaver: запись поверх идёт, только если на
      носителе всё ещё этот текст, иначе его успела сменить другая вкладка. */
  stored: Record<SaveKey, string | null>
}

/** Носитель работы. notice - строка постоянной полосы для экрана: у памяти
    и запасного localStorage она есть, у IndexedDB null. */
export interface StorageInfo {
  driver: StorageDriver['name']
  /** Причины отказа более предпочтительных носителей, по порядку попыток
      (pickDriverVerbose). */
  fallbacks: string[]
  notice: string | null
}

const STORAGE_NOTICE: Record<StorageDriver['name'], string | null> = {
  idb: null,
  local: 'Основное хранилище браузера не открылось, записи идут в запасное (localStorage). Когда основное откроется снова, они перенесутся в него сами.',
  memory: 'Хранилище браузера недоступно: записи живут только в этой вкладке и не сохранятся после закрытия. Выгрузите резервную копию, прежде чем закрыть приложение.',
}

/** Что сверка сделала с ключом запасного носителя:
    - absent - ключа там нет;
    - merged - содержимое перенесено в основной носитель;
    - kept-current - только черновик: основной начат позже или одновременно
      и остаётся, запасной не переносится;
    - unreadable - текст не разобрался или пуст, переносить нечего;
    - not-merged - не перенесено, причина в problem.
    Ключ, который был, после merged, kept-current и unreadable переименован
    в renamedTo и дословно лежит там копией. renamedTo null при непустом
    ключе значит, что ключ остался на месте и сверка повторится при
    следующей загрузке. */
export type StrayResult = 'absent' | 'merged' | 'kept-current' | 'unreadable' | 'not-merged'

/** Почему ключ запасного носителя остался на месте:
    - read-failed - запасной носитель не отдал запись;
    - newer-version - запись сделана более новой сборкой, эта её не трогает;
    - blocked - запись основного носителя выключена (saveBlock);
    - backup-failed - вытесняемый черновик основного не удалось отложить в копию;
    - write-failed - запись в основной носитель не удалась;
    - state-pending - черновик не переносится, пока не перенесено состояние;
    - rename-failed - перенос сделан, но ключ не переименован (повторный
      перенос ничего не задвоит: слияние идёт по id). */
export type StrayProblem =
  | 'read-failed' | 'newer-version' | 'blocked' | 'backup-failed' | 'write-failed' | 'state-pending' | 'rename-failed'

export interface StrayKeyReport {
  key: SaveKey
  result: StrayResult
  renamedTo: string | null
  problem?: StrayProblem
  error?: string
}

export interface StrayMerge {
  /** none - сверка не проводилась или сверять нечего; done - все бывшие
      ключи перенесены и переименованы; incomplete - хотя бы один остался на месте. */
  status: 'none' | 'done' | 'incomplete'
  /** Сколько записей человека перенесено в основное состояние (новые плюс заменившие). */
  moved: number
  /** Черновик тренировки из запасного носителя стал текущим. */
  draftMoved: boolean
  /** Счётчики слияния состояния; null - состояние не сливалось. */
  counts: Record<MergeCollection, MergeCount> | null
  keys: StrayKeyReport[]
  /** Строка для экрана; null - сказать нечего. */
  message: string | null
}

export interface LoadOptions {
  /** Причины выбора носителя из pickDriverVerbose. */
  fallbacks?: readonly string[]
  /** Запасной носитель прошлых запусков (localStorage). Сверка идёт, только
      если основной носитель IndexedDB. */
  stray?: StorageDriver
}

/** Префикс ключей, под которые сверка переименовывает перенесённое. */
export const MIGRATED_PREFIX = 'migrated.'

/** Ключ, под которым перенесённый ключ запасного носителя остаётся копией. */
export function migratedKey(key: SaveKey, now: Millis): string {
  return `${MIGRATED_PREFIX}${now}.${key}`
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
export async function loadAll(driver: StorageDriver, now: Millis, options: LoadOptions = {}): Promise<LoadAllResult> {
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

  const saveBlock = { state: stateBlock, active: activeBlock }
  const storage: StorageInfo = {
    driver: driver.name,
    fallbacks: [...(options.fallbacks ?? [])],
    notice: STORAGE_NOTICE[driver.name],
  }
  if (driver.name !== 'idb' || options.stray === undefined) {
    const stored = { state: stateRead.text, active: activeRead.text }
    return { state, active, backups, readErrors, saveBlock, storage, stray: NO_STRAY, stored }
  }
  const merged = await reconcileStray(driver, options.stray, { state, active, activeText: activeRead.text, saveBlock }, now, backups)
  // сверка могла записать состояние и черновик: точка отсчёта - то, что лежит теперь
  const stored = await storedTexts(driver, saveBlock, readErrors)
  return { state: merged.state, active: merged.active, backups, readErrors, saveBlock, storage, stray: merged.report, stored }
}

/** Тексты ключей после сверки. Ключ, который не прочитался, выключает
    запись так же, как сбой первого чтения (а для состояния - обе). */
async function storedTexts(
  driver: StorageDriver,
  saveBlock: Record<SaveKey, SaveBlockReason | null>,
  readErrors: Partial<Record<SaveKey, string>>,
): Promise<Record<SaveKey, string | null>> {
  const state = await readKey(driver, KEYS.state)
  const active = await readKey(driver, KEYS.active)
  if (state.error !== undefined) {
    readErrors.state ??= state.error
    saveBlock.state ??= 'read-failed'
    saveBlock.active ??= 'read-failed'
  }
  if (active.error !== undefined) {
    readErrors.active ??= active.error
    saveBlock.active ??= 'read-failed'
  }
  return { state: state.text, active: active.text }
}

/* ---- сверка с запасным носителем ---- */

/* Зачем: при временном сбое IndexedDB pickDriver уходит в localStorage, и
   записи того запуска ложатся туда. Следующий запуск открывает IndexedDB и
   этих записей не видит. Сверка переносит их в основной носитель, а ключи
   localStorage не удаляет, а переименовывает в migrated.<now>.<ключ>:
   исходный текст остаётся копией, повторная загрузка его уже не видит.

   Порядок записей: сначала основной носитель, потом переименование. Не
   записалось состояние - localStorage не трогается вовсе, и черновик тоже
   не переносится: следующая загрузка повторит всё целиком. */

const NO_STRAY: StrayMerge = { status: 'none', moved: 0, draftMoved: false, counts: null, keys: [], message: null }

interface PrimaryLoaded {
  state: LoadResult
  active: ActiveLoadResult
  /** Дословный текст черновика основного носителя: нужен для копии, если
      его вытесняет черновик запасного. */
  activeText: string | null
  saveBlock: Record<SaveKey, SaveBlockReason | null>
}

interface Reconciled {
  state: LoadResult
  active: ActiveLoadResult
  report: StrayMerge
}

function movedCount(counts: Record<MergeCollection, MergeCount>): number {
  let n = 0
  for (const c of Object.values(counts)) n += c.added + c.replaced
  return n
}

function hasMoves(counts: Record<MergeCollection, MergeCount>): boolean {
  return movedCount(counts) > 0
}

/** Переименовывает ключ запасного носителя: копия под migrated.<now>.<ключ>,
    затем удаление исходного. Исходный удаляется, только если под ним всё
    ещё тот текст, что перенесён: другая вкладка в запасном режиме могла
    успеть записать новый, и он должен дождаться следующей сверки. */
async function renameStray(stray: StorageDriver, key: SaveKey, text: string, now: Millis): Promise<{ renamedTo: string } | { error: string }> {
  const target = migratedKey(key, now)
  try {
    const existing = await stray.get(target)
    if (existing === null) await stray.set(target, text)
    else if (existing !== text) return { error: `ключ копии ${target} уже занят другим текстом` }
    const current = await stray.get(key)
    if (current !== text) return { error: `ключ ${key} изменился во время переноса` }
    await stray.remove(key)
    return { renamedTo: target }
  } catch (err) {
    return { error: errorText(err) }
  }
}

async function finishKey(stray: StorageDriver, key: SaveKey, result: StrayResult, text: string, now: Millis): Promise<StrayKeyReport> {
  const renamed = await renameStray(stray, key, text, now)
  if ('renamedTo' in renamed) return { key, result, renamedTo: renamed.renamedTo }
  return { key, result, renamedTo: null, problem: 'rename-failed', error: renamed.error }
}

function leftKey(key: SaveKey, problem: StrayProblem, error?: string): StrayKeyReport {
  return error === undefined ? { key, result: 'not-merged', renamedTo: null, problem } : { key, result: 'not-merged', renamedTo: null, problem, error }
}

/** Состояние: слияние по mergeStates, если основное хранит записи; если
    основное пусто или было нечитаемым (его текст уже в копии), запасное
    берётся целиком, вместе с настройками: других настроек у человека нет. */
async function reconcileState(
  primary: StorageDriver, stray: StorageDriver, loaded: PrimaryLoaded, now: Millis,
): Promise<{ report: StrayKeyReport; state: LoadResult; counts: Record<MergeCollection, MergeCount> | null }> {
  const key: SaveKey = 'state'
  const unchanged = { state: loaded.state, counts: null }
  const read = await readKey(stray, KEYS.state)
  if (read.error !== undefined) return { report: leftKey(key, 'read-failed', read.error), ...unchanged }
  if (read.text === null) return { report: { key, result: 'absent', renamedTo: null }, ...unchanged }

  const incoming = deserialize(read.text, now)
  if (incoming.source === 'newer-version') return { report: leftKey(key, 'newer-version'), ...unchanged }
  if (incoming.source !== 'stored') {
    return { report: await finishKey(stray, key, 'unreadable', read.text, now), ...unchanged }
  }
  if (loaded.saveBlock.state !== null) return { report: leftKey(key, 'blocked'), ...unchanged }

  const primaryHasState = loaded.state.source === 'stored'
  const merged: MergeResult = primaryHasState
    ? mergeStates(loaded.state.state, incoming.state)
    : importBackup(loaded.state.state, incoming.state, 'replace')
  if (!primaryHasState || hasMoves(merged.counts)) {
    try {
      await primary.set(KEYS.state, serialize(merged.state))
    } catch (err) {
      return { report: leftKey(key, 'write-failed', errorText(err)), ...unchanged }
    }
  }
  const state: LoadResult = primaryHasState
    ? { ...loaded.state, state: merged.state }
    : { state: merged.state, source: 'stored', dropped: 0 }
  return { report: await finishKey(stray, key, 'merged', read.text, now), state, counts: merged.counts }
}

/** Черновик: остаётся тот, что начат позже (session.startedAt), при
    равенстве - основной. Вытесняемый черновик основного сначала
    откладывается в active.backup; запасной, если не прошёл, остаётся
    дословно под migrated.<now>.active. */
async function reconcileActive(
  primary: StorageDriver, stray: StorageDriver, loaded: PrimaryLoaded, now: Millis, backups: BackupNote[],
): Promise<{ report: StrayKeyReport; active: ActiveLoadResult; draftMoved: boolean }> {
  const key: SaveKey = 'active'
  const unchanged = { active: loaded.active, draftMoved: false }
  const read = await readKey(stray, KEYS.active)
  if (read.error !== undefined) return { report: leftKey(key, 'read-failed', read.error), ...unchanged }
  if (read.text === null) return { report: { key, result: 'absent', renamedTo: null }, ...unchanged }

  const incoming = deserializeActive(read.text)
  if (incoming.source === 'newer-version') return { report: leftKey(key, 'newer-version'), ...unchanged }
  if (incoming.active === null) {
    return { report: await finishKey(stray, key, 'unreadable', read.text, now), ...unchanged }
  }
  if (loaded.saveBlock.active !== null) return { report: leftKey(key, 'blocked'), ...unchanged }

  const current = loaded.active.active
  if (current !== null && current.session.startedAt >= incoming.active.session.startedAt) {
    return { report: await finishKey(stray, key, 'kept-current', read.text, now), ...unchanged }
  }
  if (current !== null && loaded.activeText !== null) {
    const note = await writeBackup(primary, 'active', KEYS.activeBackup, loaded.activeText, now)
    backups.push(note)
    if (note.status === 'failed') return { report: leftKey(key, 'backup-failed', note.error), ...unchanged }
  }
  try {
    await primary.set(KEYS.active, serializeActive(incoming.active))
  } catch (err) {
    return { report: leftKey(key, 'write-failed', errorText(err)), ...unchanged }
  }
  const active: ActiveLoadResult = { active: incoming.active, source: 'stored', dropped: 0 }
  return { report: await finishKey(stray, key, 'merged', read.text, now), active, draftMoved: true }
}

function recordsWord(n: number): string {
  return pluralRu(n, 'запись', 'записи', 'записей')
}

function strayMessage(status: StrayMerge['status'], moved: number, draftMoved: boolean): string | null {
  if (status === 'none') return null
  const parts: string[] = []
  if (moved > 0 || draftMoved) {
    const what = [moved > 0 ? `${moved} ${recordsWord(moved)}` : '', draftMoved ? 'черновик тренировки' : '']
      .filter(s => s !== '').join(' и ')
    parts.push(`Из запасного хранилища перенесено: ${what}.`)
  } else if (status === 'done') {
    parts.push('Запасное хранилище сверено с основным: новых записей в нём не нашлось.')
  }
  if (status === 'done') {
    parts.push('Прежнее содержимое запасного хранилища сохранено копией в настройках.')
  } else {
    parts.push('Часть данных запасного хранилища перенести не удалось, они остались на месте. Перенос повторится при следующем запуске.')
  }
  return parts.join(' ')
}

async function reconcileStray(
  primary: StorageDriver, stray: StorageDriver, loaded: PrimaryLoaded, now: Millis, backups: BackupNote[],
): Promise<Reconciled> {
  const s = await reconcileState(primary, stray, loaded, now)
  const stateSettled = s.report.result !== 'not-merged'
  const a = stateSettled
    ? await reconcileActive(primary, stray, loaded, now, backups)
    : { report: await strayPresence(stray), active: loaded.active, draftMoved: false }

  const keys = [s.report, a.report]
  const present = keys.filter(k => k.result !== 'absent')
  const status: StrayMerge['status'] = present.length === 0
    ? 'none'
    : present.every(k => k.renamedTo !== null) ? 'done' : 'incomplete'
  const moved = s.counts === null ? 0 : movedCount(s.counts)
  return {
    state: s.state,
    active: a.active,
    report: { status, moved, draftMoved: a.draftMoved, counts: s.counts, keys, message: strayMessage(status, moved, a.draftMoved) },
  }
}

/** Отчёт по черновику, когда до него очередь не дошла: есть ли он вообще. */
async function strayPresence(stray: StorageDriver): Promise<StrayKeyReport> {
  const read = await readKey(stray, KEYS.active)
  if (read.error !== undefined) return leftKey('active', 'read-failed', read.error)
  if (read.text === null) return { key: 'active', result: 'absent', renamedTo: null }
  return leftKey('active', 'state-pending')
}

/* ---- запуск ---- */

export interface OpenedStorage {
  driver: StorageDriver
  /** Запасной носитель, сверенный с основным; null - сверки не было (основной
      не IndexedDB или localStorage нет). Его копии тоже показываются в
      настройках: listBackups(stray). */
  stray: StorageDriver | null
  result: LoadAllResult
}

/** Выбирает носитель, сверяет с запасным и читает всё. Никогда не бросает. */
export async function openStorage(now: Millis, env: DriverEnv = browserEnv()): Promise<OpenedStorage> {
  const picked = await pickDriverVerbose(env)
  const stray = picked.driver.name === 'idb' && env.localStorage !== null ? localDriver(env.localStorage) : null
  const options: LoadOptions = stray === null ? { fallbacks: picked.fallbacks } : { fallbacks: picked.fallbacks, stray }
  const result = await loadAll(picked.driver, now, options)
  return { driver: picked.driver, stray, result }
}

/* ---- копии и стирание для настроек ---- */

export type BackupKind = 'backup' | 'migrated'

export interface BackupKeyInfo {
  /** backup - копия битого (state.backup, state.backup.<now> и то же у
      active); migrated - перенесённое сверкой (migrated.<now>.<ключ>). */
  kind: BackupKind
  from: SaveKey
  /** Время из ключа; null у основного ключа копии, в нём времени нет. */
  at: Millis | null
}

export interface BackupEntry extends BackupKeyInfo {
  key: string
  /** Размер текста в байтах UTF-8: столько весит выгруженный файл. */
  bytes: number
  driver: StorageDriver['name']
}

const BACKUP_KEY = /^(state|active)\.backup(?:\.(\d+))?$/
const MIGRATED_KEY = /^migrated\.(\d+)\.(state|active)$/

function stampOf(digits: string): Millis | null {
  const n = Number(digits)
  return Number.isSafeInteger(n) ? n : null
}

/** Разбирает ключ копии; null - ключ не копия. */
export function parseBackupKey(key: string): BackupKeyInfo | null {
  const b = BACKUP_KEY.exec(key)
  if (b) {
    const from = b[1] as SaveKey
    if (b[2] === undefined) return { kind: 'backup', from, at: null }
    const at = stampOf(b[2])
    return at === null ? null : { kind: 'backup', from, at }
  }
  const m = MIGRATED_KEY.exec(key)
  if (m) {
    const at = stampOf(m[1])
    return at === null ? null : { kind: 'migrated', from: m[2] as SaveKey, at }
  }
  return null
}

/** Все копии на носителе: новые сверху, основные ключи копий (без времени)
    в конце. Ошибки носителя не глотаются: отказ промиса, экран показывает
    причину. */
export async function listBackups(driver: StorageDriver): Promise<BackupEntry[]> {
  const encoder = new TextEncoder()
  const out: BackupEntry[] = []
  for (const key of await driver.keys()) {
    const info = parseBackupKey(key)
    if (info === null) continue
    const text = await driver.get(key)
    // ключ исчез между keys() и get(): копии больше нет, показывать нечего
    if (text === null) continue
    out.push({ key, ...info, bytes: encoder.encode(text).length, driver: driver.name })
  }
  return out.sort((x, y) => {
    if (x.at !== y.at) {
      if (x.at === null) return 1
      if (y.at === null) return -1
      return y.at - x.at
    }
    return x.key < y.key ? -1 : x.key > y.key ? 1 : 0
  })
}

/** Дословный текст копии; null - такой копии нет. Ключ не копии - отказ
    RangeError: через эту функцию основные записи не читаются. */
export async function readBackupText(driver: StorageDriver, key: string): Promise<string | null> {
  if (parseBackupKey(key) === null) throw new RangeError(`Ключ ${key} не копия`)
  return driver.get(key)
}

/** Стирает все ключи приложения на носителе, включая копии. Возвращает
    число стёртых. Отказ на любом ключе обрывает стирание отказом промиса:
    что осталось, видно повторным listBackups. Сохранение через Saver
    после стирания снова запишет состояние, поэтому экран после wipeAll
    перезагружает приложение. */
export async function wipeAll(driver: StorageDriver): Promise<number> {
  const keys = await driver.keys()
  for (const key of keys) await driver.remove(key)
  return keys.length
}

/* ---- сохранение ---- */

/** 'conflict' - на носителе не тот текст, от которого шла эта вкладка:
    его записала другая вкладка или окно приложения того же origin. */
export type SaveFailure = 'blocked' | 'quota' | 'failed' | 'conflict'

export type SaveResult =
  | { ok: true; key: SaveKey }
  | { ok: false; key: SaveKey; reason: Exclude<SaveFailure, 'conflict'>; error: string }
  | { ok: false; key: SaveKey; reason: 'conflict'; error: string; storedText: string | null }

/** Итог завершения тренировки: состояние, затем снятие черновика. active
    null - до снятия черновика очередь не дошла, потому что состояние не
    записалось, и черновик остался на носителе. */
export interface FinishCommit {
  ok: boolean
  state: SaveResult
  active: SaveResult | null
}

const CONFLICT_MESSAGE =
  'Данные изменены в другой вкладке или окне приложения. Запись остановлена, чтобы их не затереть: ' +
  'нужно перечитать сохранённое и слить с открытым.'

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
  /** Текст, который по знанию этой вкладки лежит на носителе (null - ключа нет). */
  known: string | null
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
  /** Завершение тренировки одной операцией: сначала состояние с ней, и
      только если оно записалось - снятие черновика. При сбое записи
      состояния черновик остаётся на носителе, и тренировка не теряется.
      Отдельные saveState и saveActive(null) для завершения не годятся:
      очереди ключей независимы, и снятие черновика не ждёт состояния. */
  commitFinished(state: AppState): Promise<FinishCommit>
  /** После конфликта: вкладка перечитала носитель, слила его текст со своим
      и принимает storedText за новую точку отсчёта ключа. */
  rebase(key: SaveKey, storedText: string | null): void
  /** Дожидается, пока обе очереди опустеют. */
  flush(): Promise<void>
  readonly block: Readonly<Record<SaveKey, SaveBlockReason | null>>
}

export interface SaverOptions {
  /** Тексты ключей на носителе, от которых идёт вкладка (LoadAllResult.stored). */
  stored: Record<SaveKey, string | null>
  block?: Partial<Record<SaveKey, SaveBlockReason | null>>
}

/** Очередь записей: на ключ не больше одной записи в полёте и одно
    ожидающее значение. Пришедшее во время записи значение замещает
    ожидающее, поэтому частые тапы не копят очередь, а на носитель всегда
    уходит последнее. Текст снимается в момент вызова: правки объекта после
    вызова в запись не попадают. onResult получает итог каждой
    состоявшейся записи и каждого отказа из-за блокировки или конфликта.

    Защита от записи поверх другой вкладки: перед каждой записью ключ
    перечитывается, и запись идёт, только если на носителе тот текст, от
    которого шла эта вкладка (options.stored, затем её собственные записи).
    Иначе - отказ 'conflict' с текстом носителя; ключ остаётся в конфликте,
    пока вкладка не сольёт данные и не вызовет rebase. Чтение и запись -
    две операции носителя, поэтому записи двух вкладок в одно и то же
    мгновение проверка не разведёт; от записи давно открытой вкладки поверх
    свежих данных она защищает. */
export function createSaver(driver: StorageDriver, onResult: (result: SaveResult) => void, options: SaverOptions): Saver {
  const block: Record<SaveKey, SaveBlockReason | null> = {
    state: options.block?.state ?? null,
    active: options.block?.active ?? null,
  }
  const lanes: Record<SaveKey, Lane> = {
    state: { known: options.stored.state, busy: false, pending: null, idle: [] },
    active: { known: options.stored.active, busy: false, pending: null, idle: [] },
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
    const lane = lanes[key]
    let current: string | null
    try {
      current = await driver.get(key)
    } catch (err) {
      return { ok: false, key, reason: 'failed', error: `Перед записью хранилище не отдало сохранённое: ${errorText(err)}` }
    }
    if (current !== lane.known) return { ok: false, key, reason: 'conflict', error: CONFLICT_MESSAGE, storedText: current }
    try {
      if (op.kind === 'set') await driver.set(key, op.text)
      else await driver.remove(key)
    } catch (err) {
      return failureOf(key, err)
    }
    lane.known = op.kind === 'set' ? op.text : null
    return { ok: true, key }
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

  const saveState = (state: AppState): Promise<SaveResult> => enqueue('state', { kind: 'set', text: serialize(state) })
  const saveActive = (active: ActiveSession | null): Promise<SaveResult> =>
    enqueue('active', active === null ? { kind: 'remove' } : { kind: 'set', text: serializeActive(active) })

  return {
    saveState,
    saveActive,
    commitFinished: async state => {
      const stateResult = await saveState(state)
      if (!stateResult.ok) return { ok: false, state: stateResult, active: null }
      const activeResult = await saveActive(null)
      return { ok: activeResult.ok, state: stateResult, active: activeResult }
    },
    rebase: (key, storedText) => {
      lanes[key].known = storedText
    },
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
