/* Резервная копия: файл JSON, который человек выгружает и загружает руками.
   Удаление иконки с домашнего экрана iOS стирает данные приложения, поэтому
   копия - единственная страховка, и разбор её устроен так же строго, как
   разбор хранилища: никогда не бросает, битое выпадает и считается.

   Разбор и санитизация берутся из state/storage.ts (чистый модуль без
   браузера), чтобы копия и хранилище не расходились в правилах. */

import type { AppState, DateISO, Millis, ProgramProgress } from './types'
import { todayLocal } from './dates'
import { CURRENT_VERSION, migrate, parseVersion } from '../state/storage'

export const BACKUP_APP = 'stolpy'

export interface BackupFile {
  app: typeof BACKUP_APP
  version: number
  exportedAt: Millis
  state: AppState
}

/** Текст файла копии. Отступы ради человека, который откроет файл глазами. */
export function buildBackup(state: AppState, now: Millis): string {
  const file: BackupFile = { app: BACKUP_APP, version: CURRENT_VERSION, exportedAt: now, state }
  return JSON.stringify(file, null, 2)
}

/** Имя файла копии по местной дате: stolpy-2026-10-17.json. */
export function backupFileName(now: Date): string {
  return `${BACKUP_APP}-${todayLocal(now)}.json`
}

/** Отметка о сделанной копии: дата и обнулённый счётчик тренировок без копии. */
export function markBackedUp(state: AppState, now: Millis): AppState {
  return { ...state, meta: { ...state.meta, lastBackupAt: now, sessionsSinceBackup: 0 } }
}

export type BackupRejection = 'empty' | 'not-json' | 'not-stolpy' | 'newer-version'

export type ParsedBackup =
  | { ok: true; state: AppState; dropped: number; exportedAt: Millis | null }
  | { ok: false; reason: BackupRejection; message: string }

const REJECTION_MESSAGE: Record<BackupRejection, string> = {
  empty: 'В файле нет записей: ни тренировок, ни своих упражнений и шаблонов, ни программ, тестов или веса.',
  'not-json': 'Файл не читается как JSON: возможно, он обрезан или это не копия.',
  'not-stolpy': 'Это не резервная копия «Столпов».',
  'newer-version': 'Копия сделана более новой версией приложения. Обновите приложение и загрузите её снова.',
}

function reject(reason: BackupRejection): ParsedBackup {
  return { ok: false, reason, message: REJECTION_MESSAGE[reason] }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Есть ли в состоянии хоть одна запись человека. Настройки и служебные
    поля записями не считаются: копия только из них ничего не восстанавливает. */
export function hasRecords(state: AppState): boolean {
  return Object.keys(state.sessions).length > 0 ||
    Object.keys(state.customExercises).length > 0 ||
    Object.keys(state.customTemplates).length > 0 ||
    Object.keys(state.programs).length > 0 ||
    state.testResults.length > 0 ||
    state.bodyWeights.length > 0
}

/** Разбирает файл копии. Никогда не бросает. Отказ: пустой файл или копия
    без записей ('empty'), не JSON, не наш файл (нет app 'stolpy', нет
    объекта state, версия не число), более новая версия файла или
    состояния внутри. now нужен для meta.installedAt, если его нет в копии. */
export function parseBackup(text: string, now: Millis): ParsedBackup {
  if (text.trim() === '') return reject('empty')
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return reject('not-json')
  }
  if (!isPlainObject(parsed) || parsed.app !== BACKUP_APP || typeof parsed.version !== 'number' || !isPlainObject(parsed.state)) {
    return reject('not-stolpy')
  }
  const fileVersion = parseVersion(parsed.version)
  const stateVersion = parseVersion(parsed.state.version)
  if (fileVersion > CURRENT_VERSION || stateVersion > CURRENT_VERSION) return reject('newer-version')

  const { state, dropped } = migrate(parsed.state, stateVersion, now)
  if (!hasRecords(state)) return reject('empty')
  const exportedAt = typeof parsed.exportedAt === 'number' && Number.isFinite(parsed.exportedAt) && parsed.exportedAt >= 0
    ? parsed.exportedAt : null
  return { ok: true, state, dropped, exportedAt }
}

/* ---- слияние ---- */

export type MergeCollection =
  | 'sessions' | 'customExercises' | 'customTemplates' | 'programs' | 'testResults' | 'bodyWeights'

export interface MergeCount {
  /** Записей копии, которых не было в текущем состоянии. */
  added: number
  /** Записей копии, которые совпали по ключу с текущими и уступили им. */
  kept: number
  /** Записей копии, которые заменили текущие (только программы: у копии
      активность позже). */
  replaced: number
}

export interface MergeResult {
  state: AppState
  counts: Record<MergeCollection, MergeCount>
}

function zero(): MergeCount {
  return { added: 0, kept: 0, replaced: 0 }
}

/** Объединение словарей по ключу: при совпадении ключа остаётся текущая
    запись (она на этом устройстве и не старше копии), кроме случаев, где
    prefer говорит иное. */
function mergeMap<T>(
  current: Record<string, T>,
  incoming: Record<string, T>,
  count: MergeCount,
  preferIncoming: (cur: T, inc: T) => boolean = () => false,
): Record<string, T> {
  const out: Record<string, T> = { ...current }
  for (const [key, inc] of Object.entries(incoming)) {
    if (!Object.hasOwn(current, key)) {
      out[key] = inc
      count.added++
    } else if (preferIncoming(current[key], inc)) {
      out[key] = inc
      count.replaced++
    } else {
      count.kept++
    }
  }
  return out
}

/** Последняя дата активности программы: старт, отмеченные дни, замеры. */
function lastActivity(p: ProgramProgress): DateISO {
  let last = p.startedOn
  for (const d of p.completedDays) if (d.date > last) last = d.date
  for (const m of p.measurements) if (m.date > last) last = m.date
  return last
}

/** Копия программы побеждает, если её последняя активность позже, а при
    одной дате - если в ней больше отметок. При полном равенстве остаётся текущая. */
function incomingProgramIsNewer(cur: ProgramProgress, inc: ProgramProgress): boolean {
  const a = lastActivity(cur)
  const b = lastActivity(inc)
  if (b !== a) return b > a
  return inc.completedDays.length + inc.measurements.length > cur.completedDays.length + cur.measurements.length
}

/** Сливает копию в текущее состояние, не меняя ни одно из входных:
    сессии, свои упражнения, свои шаблоны и результаты тестов - по id; вес
    тела - по дате; программы - по programId, побеждает более поздняя
    активность. При совпадении ключа в остальных случаях остаётся текущая
    запись. Настройки и служебные поля остаются текущими. */
export function mergeStates(current: AppState, incoming: AppState): MergeResult {
  const counts: Record<MergeCollection, MergeCount> = {
    sessions: zero(), customExercises: zero(), customTemplates: zero(),
    programs: zero(), testResults: zero(), bodyWeights: zero(),
  }

  const testResults = [...current.testResults]
  const testIds = new Set(current.testResults.map(t => t.id))
  for (const t of incoming.testResults) {
    if (testIds.has(t.id)) {
      counts.testResults.kept++
    } else {
      testIds.add(t.id)
      testResults.push(t)
      counts.testResults.added++
    }
  }
  testResults.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  const weights = new Map(current.bodyWeights.map(w => [w.date, w.kg]))
  for (const w of incoming.bodyWeights) {
    if (weights.has(w.date)) {
      counts.bodyWeights.kept++
    } else {
      weights.set(w.date, w.kg)
      counts.bodyWeights.added++
    }
  }
  const bodyWeights = [...weights.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, kg]) => ({ date, kg }))

  return {
    state: {
      version: CURRENT_VERSION,
      settings: current.settings,
      sessions: mergeMap(current.sessions, incoming.sessions, counts.sessions),
      customExercises: mergeMap(current.customExercises, incoming.customExercises, counts.customExercises),
      customTemplates: mergeMap(current.customTemplates, incoming.customTemplates, counts.customTemplates),
      programs: mergeMap(current.programs, incoming.programs, counts.programs, incomingProgramIsNewer),
      testResults,
      bodyWeights,
      meta: current.meta,
    },
    counts,
  }
}

export type ImportMode = 'merge' | 'replace'

/** Применяет разобранную копию: слиянием или заменой целиком. Замена берёт
    копию как есть, включая настройки; счётчики тогда показывают, сколько
    записей пришло из копии (added), а текущие записи пропадают. */
export function importBackup(current: AppState, incoming: AppState, mode: ImportMode): MergeResult {
  if (mode === 'merge') return mergeStates(current, incoming)
  const added = (n: number): MergeCount => ({ added: n, kept: 0, replaced: 0 })
  return {
    state: incoming,
    counts: {
      sessions: added(Object.keys(incoming.sessions).length),
      customExercises: added(Object.keys(incoming.customExercises).length),
      customTemplates: added(Object.keys(incoming.customTemplates).length),
      programs: added(Object.keys(incoming.programs).length),
      testResults: added(incoming.testResults.length),
      bodyWeights: added(incoming.bodyWeights.length),
    },
  }
}
