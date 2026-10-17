/* Рекорды упражнения и ряд для графика. Считается по завершённым сессиям,
   которые передаёт вызывающий код. Разминочные подходы рекордами не
   считаются; подходы с помощью (assistKg) тоже: их повторы и вес несравнимы
   с обычными. */

import { estimate1rm, roundKg } from './onerm'
import type { DateISO, Exercise, Session, SetKind } from './types'

export interface ExerciseRecords {
  bestE1rm: number | null           // кг, оценка Эпли
  bestWeight: number | null         // кг, максимальный вес при повторах от 1
  bestReps: number | null           // максимум повторов при любом весе
  bestSeconds: number | null        // лучшее удержание или время подхода
  bestVolumeSet: number | null      // кг, вес x повторы одного подхода
  bestDistanceKm: number | null     // кардио
}

export type PrKind = 'e1rm' | 'weight' | 'reps' | 'seconds' | 'volume'

/* Всё, что нужно знать о подходе для рекордов. StrengthSet и Hold подходят
   как есть. */
export interface SetLike {
  kind?: SetKind
  weightKg?: number
  assistKg?: number
  reps?: number
  seconds?: number
}

export interface RecordOptions {
  /* Упражнение со своим весом: 1ПМ не считается, главный рекорд - повторы. */
  bodyweight?: boolean
}

export interface SeriesPoint {
  date: DateISO
  e1rm: number | null
  topWeight: number | null
  totalReps: number
  topSeconds: number | null
}

export type SessionSource = readonly Session[] | Readonly<Record<string, Session>>

export const EMPTY_RECORDS: ExerciseRecords = Object.freeze({
  bestE1rm: null,
  bestWeight: null,
  bestReps: null,
  bestSeconds: null,
  bestVolumeSet: null,
  bestDistanceKm: null,
})

/* Упражнения, у которых нагрузка не гири: всё, кроме ввода «вес и повторы». */
export function isBodyweight(exercise: Pick<Exercise, 'input'>): boolean {
  return exercise.input !== 'weight-reps'
}

function positive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function toList(source: SessionSource): readonly Session[] {
  return Array.isArray(source) ? source : Object.values(source)
}

/* Вес в подходе, если он есть, обязан быть положительным: нуль, минус и NaN
   значат битую запись, и такой подход не учитывается целиком. */
function isCounted(set: SetLike): boolean {
  if (set.kind === 'warmup' || positive(set.assistKg)) return false
  return set.weightKg === undefined || positive(set.weightKg)
}

function repsOf(set: SetLike): number | null {
  return typeof set.reps === 'number' && Number.isInteger(set.reps) && set.reps >= 1 ? set.reps : null
}

function maxOf(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/* Подходы, учитываемые рекордами: рабочие и до отказа, без помощи. */
function countedSets(sets: readonly SetLike[]): SetLike[] {
  return sets.filter(isCounted)
}

/* Лучшая оценка 1ПМ: рабочие подходы с вес > 0 и повторами 1..10. */
export function bestE1rm(sets: readonly SetLike[]): number | null {
  let best: number | null = null
  for (const set of countedSets(sets)) {
    const reps = repsOf(set)
    if (reps === null || !positive(set.weightKg)) continue
    best = maxOf(best, estimate1rm(set.weightKg, reps))
  }
  return best
}

/* Рекорды по набору подходов. */
export function recordsOfSets(sets: readonly SetLike[], options: RecordOptions = {}): ExerciseRecords {
  let bestWeight: number | null = null
  let bestReps: number | null = null
  let bestSeconds: number | null = null
  let bestVolumeSet: number | null = null
  for (const set of countedSets(sets)) {
    const reps = repsOf(set)
    if (positive(set.weightKg) && reps !== null) {
      bestWeight = maxOf(bestWeight, set.weightKg)
      bestVolumeSet = maxOf(bestVolumeSet, roundKg(set.weightKg * reps))
    }
    if (reps !== null) bestReps = maxOf(bestReps, reps)
    if (positive(set.seconds)) bestSeconds = maxOf(bestSeconds, set.seconds)
  }
  return {
    bestE1rm: options.bodyweight ? null : bestE1rm(sets),
    bestWeight,
    bestReps,
    bestSeconds,
    bestVolumeSet: options.bodyweight ? null : bestVolumeSet,
    bestDistanceKm: null,
  }
}

/* Все подходы упражнения в сессиях: силовые подходы, удержания, а также
   дистанции кардио отдельно. */
function collect(sessions: readonly Session[], exerciseId: string): { sets: SetLike[]; distanceKm: number | null } {
  const sets: SetLike[] = []
  let distanceKm: number | null = null
  for (const session of sessions) {
    for (const item of session.items) {
      if (item.type === 'external' || item.exerciseId !== exerciseId) continue
      if (item.type === 'strength') sets.push(...item.sets)
      else if (item.type === 'hold') sets.push(...item.holds)
      else if (item.type === 'cardio' && positive(item.distanceKm)) distanceKm = maxOf(distanceKm, item.distanceKm)
    }
  }
  return { sets, distanceKm }
}

/* Рекорды упражнения по сессиям (массив или словарь AppState.sessions). */
export function exerciseRecords(
  sessions: SessionSource,
  exerciseId: string,
  options: RecordOptions = {},
): ExerciseRecords {
  const { sets, distanceKm } = collect(toList(sessions), exerciseId)
  return { ...recordsOfSets(sets, options), bestDistanceKm: distanceKm }
}

function hasAnyRecord(records: ExerciseRecords): boolean {
  return (
    records.bestE1rm !== null || records.bestWeight !== null || records.bestReps !== null ||
    records.bestSeconds !== null || records.bestVolumeSet !== null
  )
}

function beats(value: number | null, previous: number | null): boolean {
  return value !== null && previous !== null && value > previous
}

/* Какие рекорды побил только что записанный подход относительно prev.
   prev - рекорды без этого подхода (в том числе с подходами, уже записанными
   в текущей сессии). Первая запись упражнения рекордом не считается: не с
   чем сравнивать. Разминка и подход с помощью рекордов не дают. Повторы как
   рекорд считаются только в подходе без добавочного веса. */
export function detectPr(prev: ExerciseRecords, set: SetLike, options: RecordOptions = {}): PrKind[] {
  if (!isCounted(set) || !hasAnyRecord(prev)) return []
  const reps = repsOf(set)
  const kinds: PrKind[] = []
  const weighted = positive(set.weightKg) && reps !== null
  if (!options.bodyweight && weighted) {
    if (beats(estimate1rm(set.weightKg!, reps!), prev.bestE1rm)) kinds.push('e1rm')
  }
  if (weighted && beats(set.weightKg!, prev.bestWeight)) kinds.push('weight')
  if (reps !== null && !positive(set.weightKg) && beats(reps, prev.bestReps)) kinds.push('reps')
  if (positive(set.seconds) && beats(set.seconds, prev.bestSeconds)) kinds.push('seconds')
  if (!options.bodyweight && weighted && beats(roundKg(set.weightKg! * reps!), prev.bestVolumeSet)) kinds.push('volume')
  return kinds
}

/* Ряд для графика: одна точка на сессию, где упражнение имеет учитываемые
   подходы, по возрастанию времени начала. */
export function exerciseSeries(
  sessions: SessionSource,
  exerciseId: string,
  options: RecordOptions = {},
): SeriesPoint[] {
  const ordered = [...toList(sessions)].sort((a, b) => a.startedAt - b.startedAt)
  const points: SeriesPoint[] = []
  for (const session of ordered) {
    const { sets } = collect([session], exerciseId)
    const counted = countedSets(sets)
    if (counted.length === 0) continue
    const records = recordsOfSets(counted, options)
    let totalReps = 0
    for (const set of counted) totalReps += repsOf(set) ?? 0
    points.push({
      date: session.date,
      e1rm: records.bestE1rm,
      topWeight: records.bestWeight,
      totalReps,
      topSeconds: records.bestSeconds,
    })
  }
  return points
}
