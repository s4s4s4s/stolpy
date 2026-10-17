/* Выгрузка тренировки в Apple Health через «Команды» (раздел 8 плана).
   Прямого веб-API к Health нет: приложение собирает небольшой JSON, а действие
   «Log Workout» внутри команды пользователя записывает его в Health. Тип Health
   выбирает сама команда по метке HealthType. Модуль чистый: время и часовой
   пояс приходят параметрами. */

import type {
  CardioMode, Exercise, ExerciseLibrary, Millis, Pillar, Session, SessionItem, StrengthItem, StrengthSet,
} from './types.ts'
import { PILLARS } from './pillars.ts'

/** Метка вида тренировки. Команда сопоставляет её с типом Health. */
export type HealthType =
  | 'strength' | 'walking' | 'running' | 'cycling' | 'rowing' | 'elliptical' | 'swimming'
  | 'jump-rope' | 'cardio' | 'hiit' | 'flexibility' | 'balance' | 'other'

export interface HealthPayload {
  type: HealthType
  /** Начало в местном времени с часовым смещением: 2026-10-17T18:30:00+04:00. */
  startISO: string
  durationSeconds: number
  distanceKm?: number
  energyKcal?: number
}

export interface HealthPayloadOptions {
  /** Смещение местного времени от UTC в минутах (+240 для UTC+4). По умолчанию из системы. */
  tzOffsetMin?: number
}

/** Оценка силового подхода без секунд: секунд на повтор и запас на подход без данных. */
export const SEC_PER_REP = 3
export const DEFAULT_SET_SEC = 30

const CARDIO_TYPE: Record<CardioMode, HealthType> = {
  walk: 'walking',
  'incline-walk': 'walking',
  jog: 'running',
  run: 'running',
  bike: 'cycling',
  row: 'rowing',
  elliptical: 'elliptical',
  swim: 'swimming',
  'jump-rope': 'jump-rope',
  other: 'cardio',
}

const PILLAR_TYPE: Record<Exclude<Pillar, 'zone2'>, HealthType> = {
  strength: 'strength',
  intervals: 'hiit',
  mobility: 'flexibility',
  balance: 'balance',
}

function finitePositive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

function lookup(library: ExerciseLibrary, id: string): Exercise | undefined {
  return Object.prototype.hasOwnProperty.call(library, id) ? library[id] : undefined
}

function setSeconds(set: StrengthSet, unit: StrengthItem['unit']): number {
  if (finitePositive(set.seconds)) return set.seconds
  if (unit === 'reps' && finitePositive(set.reps)) return set.reps * SEC_PER_REP
  return DEFAULT_SET_SEC
}

/** Длительность одного элемента в секундах по записанным данным. */
export function itemSeconds(item: SessionItem): number {
  switch (item.type) {
    case 'strength': {
      const n = item.sets.length
      if (n === 0) return 0
      const work = item.sets.reduce((sum, s) => sum + setSeconds(s, item.unit), 0)
      const rest = finitePositive(item.restSec) ? item.restSec * (n - 1) : 0
      return work + rest
    }
    case 'cardio':
      return finitePositive(item.durationSec) ? item.durationSec : 0
    case 'intervals': {
      const rounds = Math.floor(item.roundsDone)
      if (!(rounds > 0)) return 0
      const p = item.protocol
      return p.warmupSec + rounds * p.workSec + (rounds - 1) * p.restSec + p.cooldownSec
    }
    case 'hold':
      return item.holds.reduce((sum, h) => sum + (finitePositive(h.seconds) ? h.seconds : 0), 0)
    case 'external':
      return finitePositive(item.durationMin) ? item.durationMin * 60 : 0
  }
}

/** Вес элемента по столпам в секундах. Удержание относят к столпу упражнения (мобильность или баланс). */
function pillarWeights(item: SessionItem, library: ExerciseLibrary): Partial<Record<Pillar, number>> {
  const seconds = itemSeconds(item)
  if (seconds <= 0) return {}
  switch (item.type) {
    case 'strength': return { strength: seconds }
    case 'cardio': return { zone2: seconds }
    case 'intervals': return { intervals: seconds }
    case 'hold': {
      const pillar = lookup(library, item.exerciseId)?.pillar
      return { [pillar === 'mobility' ? 'mobility' : 'balance']: seconds }
    }
    case 'external': {
      const total = PILLARS.reduce((s, p) => s + (finitePositive(item.split[p]) ? item.split[p]! : 0), 0)
      if (total <= 0) return {}
      const out: Partial<Record<Pillar, number>> = {}
      for (const p of PILLARS) {
        const m = item.split[p]
        if (finitePositive(m)) out[p] = (m / total) * seconds
      }
      return out
    }
  }
}

/** Столп с наибольшим временем; при равенстве первый в порядке PILLARS. */
function dominantPillar(session: Session, library: ExerciseLibrary): Pillar | null {
  const totals: Record<Pillar, number> = { strength: 0, zone2: 0, intervals: 0, mobility: 0, balance: 0 }
  for (const item of session.items) {
    const w = pillarWeights(item, library)
    for (const p of PILLARS) totals[p] += w[p] ?? 0
  }
  let best: Pillar | null = null
  for (const p of PILLARS) {
    if (totals[p] > 0 && (best === null || totals[p] > totals[best])) best = p
  }
  return best
}

/** Вид кардио с наибольшим временем среди кардио-элементов; без них 'cardio'. */
function dominantCardioType(session: Session): HealthType {
  const byType = new Map<HealthType, number>()
  for (const item of session.items) {
    if (item.type !== 'cardio') continue
    const seconds = itemSeconds(item)
    if (seconds <= 0) continue
    const type = CARDIO_TYPE[item.mode] ?? 'cardio'
    byType.set(type, (byType.get(type) ?? 0) + seconds)
  }
  let best: HealthType = 'cardio'
  let bestSeconds = 0
  for (const [type, seconds] of byType) {
    if (seconds > bestSeconds) { best = type; bestSeconds = seconds }
  }
  return best
}

/** Тип тренировки по преобладающему столпу; для зоны 2 по виду кардио. */
export function healthType(session: Session, library: ExerciseLibrary): HealthType {
  const pillar = dominantPillar(session, library)
  if (pillar === null) return 'other'
  if (pillar === 'zone2') return dominantCardioType(session)
  return PILLAR_TYPE[pillar]
}

/** Продолжительность по разделу 8 плана: сумма элементов. Время от начала до
    конца сессии не берётся первым: кнопку «Завершить» нажимают и через часы
    после последнего подхода, и в Health ушла бы чужая длительность. Время по
    часам - запасной путь, только когда элементы дают ноль. Известный дефект
    Команд (длительность 0) обходится тем, что число всегда считается здесь. */
export function sessionSeconds(session: Session): number {
  const items = Math.round(session.items.reduce((sum, item) => sum + itemSeconds(item), 0))
  if (items > 0) return items
  const { startedAt, endedAt } = session
  if (typeof endedAt === 'number' && Number.isFinite(endedAt) && Number.isFinite(startedAt) && endedAt > startedAt) {
    return Math.round((endedAt - startedAt) / 1000)
  }
  return 0
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0')
}

/** Момент в местном времени с часовым смещением (ISO 8601). Смещение в минутах от UTC. */
export function toLocalISO(ms: Millis, tzOffsetMin: number): string {
  const offset = Math.round(tzOffsetMin)
  const shifted = new Date(ms + offset * 60_000)
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return (
    `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  )
}

function systemOffsetMin(ms: Millis): number {
  return -new Date(ms).getTimezoneOffset()
}

/** Данные для Команды. Расстояние берётся из кардио-элементов, калории только из session.energyKcal. */
export function healthPayload(
  session: Session,
  library: ExerciseLibrary,
  options: HealthPayloadOptions = {},
): HealthPayload {
  const offset = options.tzOffsetMin ?? systemOffsetMin(session.startedAt)
  const payload: HealthPayload = {
    type: healthType(session, library),
    startISO: toLocalISO(session.startedAt, offset),
    durationSeconds: sessionSeconds(session),
  }
  const km = session.items.reduce(
    (sum, item) => sum + (item.type === 'cardio' && finitePositive(item.distanceKm) ? item.distanceKm : 0),
    0,
  )
  if (km > 0) payload.distanceKm = Math.round(km * 100) / 100
  if (finitePositive(session.energyKcal)) payload.energyKcal = Math.round(session.energyKcal)
  return payload
}

/** Текст для navigator.share и параметра text: JSON одной строкой. */
export function healthShareText(payload: HealthPayload): string {
  return JSON.stringify(payload)
}

/** Запасной путь: ссылка запуска команды. Пустое или пробельное имя даёт null. */
export function healthShortcutUrl(name: string, text: string): string | null {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '') return null
  return `shortcuts://run-shortcut?name=${encodeURIComponent(trimmed)}&input=text&text=${encodeURIComponent(text)}`
}

/** Отметка об отправке. Повторная отправка сбрасывает подтверждение. Исходная сессия не меняется. */
export function markSent(session: Session, now: Millis): Session {
  return { ...session, health: { sentAt: now, confirmed: false } }
}

/** Пользователь подтвердил, что запись появилась в Health. Без отправки возвращает сессию как есть. */
export function markConfirmed(session: Session): Session {
  if (!session.health) return session
  return { ...session, health: { ...session.health, confirmed: true } }
}

/** Уже отправлялась: перед повторной отправкой нужно предупредить о дубликате в Health. */
export function isDuplicateSend(session: Session): boolean {
  return session.health !== undefined
}
