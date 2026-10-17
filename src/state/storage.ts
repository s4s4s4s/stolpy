/* Чистое ядро хранилища: версия формата, состояние по умолчанию, запись в
   текст и разбор текста обратно с миграцией и санитизацией. Браузера и
   драйверов здесь нет: store.ts читает и пишет через StorageDriver, а сюда
   приходят и отсюда уходят только строки и объекты.

   Главное правило разбора: НИКОГДА не бросать. Человек стоит в зале с
   телефоном; уронить приложение из-за кривого JSON хуже, чем потерять одну
   запись. Битая запись выпадает одна и считается в dropped, соседние
   выживают; что потерялось, видно по исходному тексту, который store.ts
   откладывает в копию до первого сохранения.

   Правило подсчёта потерь: в dropped считается всё, что в тексте БЫЛО и при
   разборе отброшено или заменено значением по умолчанию (запись, элемент
   сессии, подход, поле настроек). Отсутствующее поле потерей не считается:
   его не было, терять нечего. Поэтому dropped > 0 всегда означает, что
   исходный текст содержит что-то, чего нет в результате. */

import { PILLARS } from '../core/types'
import type {
  ActiveSession, AppState, CardioItem, CardioMode, DateISO, Equipment, Exercise, ExerciseDefaults,
  ExternalItem, Hold, HoldItem, HoldRun, IntervalItem, IntervalProtocol, IntervalRun, InputKind, Millis,
  MobilityZone, MuscleGroup, Pillar, Place, PlannedSet, ProgramProgress, ProgramRef, RestTimer, Session,
  SessionItem, SetKind, Settings, Side, SoundMode, Stopwatch, StrengthItem, StrengthSet, Template,
  TemplateItem, TestResult, WeeklyGoals,
} from '../core/types'
import { isDateISO } from '../core/dates'

/** Текущая версия формата, одна на AppState и ActiveSession.
    v1: первая версия, миграция сводится к санитизации.
    Правило наращивания: шаг vN -> vN+1, который не выражается санитизацией,
    ставится явной функцией migrateVNtoVN1(raw) в migrate до вызова sanitize*,
    здесь описывается, что добавилось, а тест читает test/fixtures/state-vN.json.
    Ключи хранилища адресуют носитель, а не формат, и при смене версии не меняются. */
export const CURRENT_VERSION = 1

/* ---- значения по умолчанию ---- */

export const DEFAULT_GOALS: WeeklyGoals = {
  strengthSets: 50, strengthDays: 3,
  zone2Minutes: 150,
  intervalSessions: 2, intervalHardMinutes: 32,
  mobilityMinutes: 30, mobilityDays: 3,
  balanceMinutes: 30, balanceDays: 3,
}

export function defaultSettings(): Settings {
  return {
    birthYear: null,
    bodyWeightKg: null,
    maxHrMode: 'formula',
    maxHrManual: null,
    restingHr: null,
    restingHrManual: false,
    goals: { ...DEFAULT_GOALS },
    homeEquipment: ['bodyweight', 'mat'],
    defaultRestSec: 90,
    sound: 'ambient',
    keepAwake: true,
    healthShortcutName: '',
    onboardingDone: false,
  }
}

/** Состояние первого запуска. now - момент установки (meta.installedAt). */
export function defaultState(now: Millis): AppState {
  return {
    version: CURRENT_VERSION,
    settings: defaultSettings(),
    sessions: {},
    customExercises: {},
    customTemplates: {},
    programs: {},
    testResults: [],
    bodyWeights: [],
    meta: { lastBackupAt: null, sessionsSinceBackup: 0, installedAt: now },
  }
}

export function serialize(state: AppState): string {
  return JSON.stringify(state)
}

export function serializeActive(active: ActiveSession): string {
  return JSON.stringify(active)
}

/* ---- словари допустимых значений ----
   Record<Union, true> вместо массива: забытое или лишнее значение союза
   ловит проверка типов, а не человек на экране. */

const PILLAR_SET: Record<Pillar, true> = Object.fromEntries(PILLARS.map(p => [p, true])) as Record<Pillar, true>
const MUSCLE_GROUPS: Record<MuscleGroup, true> = { legs: true, back: true, 'chest-shoulders': true, arms: true, core: true }
const MOBILITY_ZONES: Record<MobilityZone, true> = { hips: true, spine: true, ankles: true, hamstrings: true, shoulders: true }
const EQUIPMENT: Record<Equipment, true> = {
  bodyweight: true, 'pullup-bar': true, 'dip-bars': true, dumbbells: true, barbell: true, kettlebell: true,
  bands: true, 'grip-trainer': true, 'finger-extensor': true, 'jump-rope': true, 'exercise-bike': true,
  mat: true, bench: true, 'gym-machines': true, treadmill: true, rower: true, elliptical: true, outdoors: true,
}
const INPUT_KINDS: Record<InputKind, true> = { 'weight-reps': true, reps: true, time: true, 'time-side': true, 'distance-time': true }
const PLACES: Record<Place, true> = { home: true, gym: true, outside: true }
const TEMPLATE_PLACES: Record<Place | 'any', true> = { ...PLACES, any: true }
const SIDES: Record<Side, true> = { left: true, right: true }
const CARDIO_MODES: Record<CardioMode, true> = {
  walk: true, 'incline-walk': true, jog: true, run: true, bike: true, row: true, elliptical: true,
  swim: true, 'jump-rope': true, other: true,
}
const SET_KINDS: Record<SetKind, true> = { warmup: true, work: true, failure: true }
const SOUND_MODES: Record<SoundMode, true> = { silent: true, ambient: true, playback: true }
const MAX_HR_MODES: Record<Settings['maxHrMode'], true> = { formula: true, manual: true }
const STRENGTH_UNITS: Record<StrengthItem['unit'], true> = { reps: true, seconds: true }
const TEMPLATE_SOURCES: Record<NonNullable<Template['source']>, true> = {
  home: true, gym: true, johnson: true, program: true, custom: true,
}

/* Границы правдоподобия. Значение за ними - порча, а не рекорд. */
const BIRTH_YEAR_MIN = 1900
const BIRTH_YEAR_MAX = 2100
const BODY_WEIGHT_MAX_KG = 400
const LOAD_MAX_KG = 1000
const HR_MIN = 20
const HR_MAX = 260
const RIR_MAX = 5
const RPE_MIN = 1
const RPE_MAX = 10
const REST_MAX_SEC = 3600
const MAX_GROUPS_PER_EXERCISE = 2
const TRAINING_DAYS_PER_WEEK = 3

/* ---- проверки ---- */

type Raw = Record<string, unknown>
type Guard<T> = (v: unknown) => v is T

function isPlainObject(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function oneOf<T extends string>(table: Record<T, true>): Guard<T> {
  return (v: unknown): v is T => typeof v === 'string' && Object.hasOwn(table, v)
}

const isString = (v: unknown): v is string => typeof v === 'string'
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean'
const isTrue = (v: unknown): v is true => v === true
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPositiveFinite = (v: unknown): v is number => isFiniteNumber(v) && v > 0
const isNonNegFinite = (v: unknown): v is number => isFiniteNumber(v) && v >= 0
const isNonNegInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0
const isPositiveInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
/** Отметка времени Millis: конечное неотрицательное число. */
const isTimestamp = isNonNegFinite
const isDate = (v: unknown): v is DateISO => isDateISO(v)

function intIn(min: number, max: number): Guard<number> {
  return (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= max
}

function finiteIn(minExclusive: number, max: number): Guard<number> {
  return (v: unknown): v is number => isFiniteNumber(v) && v > minExclusive && v <= max
}

const isPositiveLoad = finiteIn(0, LOAD_MAX_KG)
const isBodyWeight = finiteIn(0, BODY_WEIGHT_MAX_KG)
const isHeartRate = intIn(HR_MIN, HR_MAX)

/** Диапазон [от, до] из целых неотрицательных, от не больше до. */
function isIntRange(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && isNonNegInt(v[0]) && isNonNegInt(v[1]) && v[0] <= v[1]
}

const isPillar = oneOf(PILLAR_SET)
const isMuscleGroup = oneOf(MUSCLE_GROUPS)
const isEquipment = oneOf(EQUIPMENT)
const isSide = oneOf(SIDES)
const isCardioMode = oneOf(CARDIO_MODES)
const isSetKind = oneOf(SET_KINDS)
const isPlace = oneOf(PLACES)

/** Признак битого необязательного поля: значение есть, но не проходит проверку. */
const BAD: unique symbol = Symbol('bad')
type Bad = typeof BAD

/** Необязательное поле: undefined и null значат «нет поля», остальное проверяется. */
function opt<T>(v: unknown, check: Guard<T>): T | undefined | Bad {
  if (v === undefined || v === null) return undefined
  return check(v) ? v : BAD
}

function has(v: unknown): boolean {
  return v !== undefined && v !== null
}

/** Убирает ключи со значением undefined, порядок остальных сохраняется. Без
    этого JSON и глубокое сравнение расходились бы на «поле есть, но пустое». */
function compact<T extends object>(obj: T): T {
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] === undefined) delete obj[key]
  }
  return obj
}

/** Результат санитизации составной записи: сама запись (null, если она
    выпала целиком) и сколько вложенного по пути отброшено. Выпавшая целиком
    запись в dropped НЕ входит: её считает тот, кто держит список. */
export interface Sanitized<T> {
  value: T | null
  dropped: number
}

/* ---- настройки ---- */

/** Битое поле заменяется значением по умолчанию по одному, соседние
    выживают. Каждое заменённое присутствовавшее поле считается в dropped. */
export function sanitizeSettings(v: unknown): { value: Settings; dropped: number } {
  const def = defaultSettings()
  if (v === undefined || v === null) return { value: def, dropped: 0 }
  if (!isPlainObject(v)) return { value: def, dropped: 1 }
  let dropped = 0

  function field<T>(raw: unknown, check: Guard<T>, fallback: T): T {
    if (raw === undefined) return fallback
    if (check(raw)) return raw
    dropped++
    return fallback
  }
  const nullable = <T>(check: Guard<T>): Guard<T | null> => (x: unknown): x is T | null => x === null || check(x)

  const goalsRaw = v.goals
  let goals: WeeklyGoals = { ...DEFAULT_GOALS }
  if (isPlainObject(goalsRaw)) {
    goals = Object.fromEntries(
      (Object.keys(DEFAULT_GOALS) as (keyof WeeklyGoals)[]).map(k => [k, field(goalsRaw[k], isNonNegInt, DEFAULT_GOALS[k])]),
    ) as unknown as WeeklyGoals
  } else if (goalsRaw !== undefined) {
    dropped++
  }

  let homeEquipment = def.homeEquipment
  const eqRaw = v.homeEquipment
  if (Array.isArray(eqRaw)) {
    const seen = new Set<Equipment>()
    for (const e of eqRaw) {
      if (isEquipment(e) && !seen.has(e)) seen.add(e)
      else dropped++
    }
    homeEquipment = [...seen]
  } else if (eqRaw !== undefined) {
    dropped++
  }

  return {
    value: {
      birthYear: field(v.birthYear, nullable(intIn(BIRTH_YEAR_MIN, BIRTH_YEAR_MAX)), def.birthYear),
      bodyWeightKg: field(v.bodyWeightKg, nullable(isBodyWeight), def.bodyWeightKg),
      maxHrMode: field(v.maxHrMode, oneOf(MAX_HR_MODES), def.maxHrMode),
      maxHrManual: field(v.maxHrManual, nullable(isHeartRate), def.maxHrManual),
      restingHr: field(v.restingHr, nullable(isHeartRate), def.restingHr),
      restingHrManual: field(v.restingHrManual, isBoolean, def.restingHrManual),
      goals,
      homeEquipment,
      defaultRestSec: field(v.defaultRestSec, intIn(0, REST_MAX_SEC), def.defaultRestSec),
      sound: field(v.sound, oneOf(SOUND_MODES), def.sound),
      keepAwake: field(v.keepAwake, isBoolean, def.keepAwake),
      healthShortcutName: field(v.healthShortcutName, isString, def.healthShortcutName),
      onboardingDone: field(v.onboardingDone, isBoolean, def.onboardingDone),
    },
    dropped,
  }
}

/* ---- элементы сессии ---- */

/** Подход силы. Вес и помощь конечные положительные, повторы и секунды
    целые неотрицательные, rir целое 0..5 или нет поля; есть хотя бы повторы
    или секунды. Любое нарушение - null. */
export function sanitizeStrengthSet(v: unknown): StrengthSet | null {
  if (!isPlainObject(v)) return null
  if (!isSetKind(v.kind) || !isTimestamp(v.doneAt)) return null
  const weightKg = opt(v.weightKg, isPositiveLoad)
  const assistKg = opt(v.assistKg, isPositiveLoad)
  const reps = opt(v.reps, isNonNegInt)
  const seconds = opt(v.seconds, isNonNegInt)
  const side = opt(v.side, isSide)
  const rir = opt(v.rir, intIn(0, RIR_MAX))
  if (weightKg === BAD || assistKg === BAD || reps === BAD || seconds === BAD || side === BAD || rir === BAD) return null
  if (reps === undefined && seconds === undefined) return null
  return compact<StrengthSet>({ kind: v.kind, weightKg, assistKg, reps, seconds, side, rir, doneAt: v.doneAt })
}

function sanitizePlannedSet(v: unknown): PlannedSet | null {
  if (!isPlainObject(v) || !isSetKind(v.kind)) return null
  const reps = opt(v.reps, (x: unknown): x is number | 'max' => x === 'max' || isNonNegInt(x))
  const seconds = opt(v.seconds, isNonNegInt)
  const side = opt(v.side, isSide)
  if (reps === BAD || seconds === BAD || side === BAD) return null
  return compact<PlannedSet>({ kind: v.kind, reps, seconds, side })
}

/** Общая часть элемента: id, exerciseId, note. null - элемент не опознать. */
function itemBase(v: Raw): { id: string; exerciseId: string; note?: string } | null {
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.exerciseId)) return null
  const note = opt(v.note, isString)
  if (note === BAD) return null
  return compact({ id: v.id, exerciseId: v.exerciseId, note })
}

/** Список, где битый элемент выпадает один и считается. */
function sanitizeList<T>(v: unknown, one: (x: unknown) => T | null): { list: T[]; dropped: number } {
  if (v === undefined || v === null) return { list: [], dropped: 0 }
  if (!Array.isArray(v)) return { list: [], dropped: 1 }
  const list: T[] = []
  let dropped = 0
  for (const x of v) {
    const s = one(x)
    if (s === null) dropped++
    else list.push(s)
  }
  return { list, dropped }
}

export function sanitizeStrengthItem(v: unknown): Sanitized<StrengthItem> {
  if (!isPlainObject(v) || v.type !== 'strength') return { value: null, dropped: 0 }
  const base = itemBase(v)
  if (!base || !(oneOf(STRENGTH_UNITS))(v.unit) || !intIn(0, REST_MAX_SEC)(v.restSec)) return { value: null, dropped: 0 }
  const goal = opt(v.goal, (x: unknown): x is { kind: 'total-reps'; reps: number } =>
    isPlainObject(x) && x.kind === 'total-reps' && isPositiveInt(x.reps))
  if (goal === BAD) return { value: null, dropped: 0 }
  const planned = sanitizeList(v.planned, sanitizePlannedSet)
  const sets = sanitizeList(v.sets, sanitizeStrengthSet)
  return {
    value: compact<StrengthItem>({
      ...base,
      type: 'strength',
      unit: v.unit,
      planned: planned.list,
      sets: sets.list,
      restSec: v.restSec,
      goal: goal === undefined ? undefined : { kind: 'total-reps', reps: goal.reps },
    }),
    dropped: planned.dropped + sets.dropped,
  }
}

export function sanitizeCardioItem(v: unknown): CardioItem | null {
  if (!isPlainObject(v) || v.type !== 'cardio') return null
  const base = itemBase(v)
  if (!base || !isCardioMode(v.mode) || !isNonNegInt(v.durationSec)) return null
  const distanceKm = opt(v.distanceKm, isPositiveFinite)
  const avgHr = opt(v.avgHr, isHeartRate)
  const talkTest = opt(v.talkTest, isBoolean)
  if (distanceKm === BAD || avgHr === BAD || talkTest === BAD) return null
  return compact<CardioItem>({ ...base, type: 'cardio', mode: v.mode, durationSec: v.durationSec, distanceKm, avgHr, talkTest })
}

/** Протокол проверяется целиком: снимок без любого из полей непригоден. */
export function sanitizeIntervalProtocol(v: unknown): IntervalProtocol | null {
  if (!isPlainObject(v)) return null
  if (
    !isNonEmptyString(v.id) || !isString(v.title) || !isPositiveInt(v.workSec) || !isNonNegInt(v.restSec) ||
    !isPositiveInt(v.rounds) || !isNonNegInt(v.warmupSec) || !isNonNegInt(v.cooldownSec) ||
    !isString(v.note) || !isString(v.source)
  ) return null
  return {
    id: v.id, title: v.title, workSec: v.workSec, restSec: v.restSec, rounds: v.rounds,
    warmupSec: v.warmupSec, cooldownSec: v.cooldownSec, note: v.note, source: v.source,
  }
}

export function sanitizeIntervalItem(v: unknown): IntervalItem | null {
  if (!isPlainObject(v) || v.type !== 'intervals') return null
  const base = itemBase(v)
  const protocol = sanitizeIntervalProtocol(v.protocol)
  if (!base || !isCardioMode(v.mode) || !protocol) return null
  if (!intIn(0, protocol.rounds)(v.roundsDone)) return null
  const peakHr = opt(v.peakHr, isHeartRate)
  if (peakHr === BAD) return null
  return compact<IntervalItem>({ ...base, type: 'intervals', mode: v.mode, protocol, roundsDone: v.roundsDone, peakHr })
}

function sanitizeHold(v: unknown): Hold | null {
  if (!isPlainObject(v) || !isNonNegInt(v.seconds) || !isTimestamp(v.doneAt)) return null
  const side = opt(v.side, isSide)
  const eyesClosed = opt(v.eyesClosed, isBoolean)
  if (side === BAD || eyesClosed === BAD) return null
  return compact<Hold>({ seconds: v.seconds, side, eyesClosed, doneAt: v.doneAt })
}

export function sanitizeHoldItem(v: unknown): Sanitized<HoldItem> {
  if (!isPlainObject(v) || v.type !== 'hold') return { value: null, dropped: 0 }
  const base = itemBase(v)
  if (!base || !isBoolean(v.perSide) || !isNonNegInt(v.plannedSets) || !isNonNegInt(v.plannedSeconds)) {
    return { value: null, dropped: 0 }
  }
  const holds = sanitizeList(v.holds, sanitizeHold)
  return {
    value: compact<HoldItem>({
      ...base, type: 'hold', perSide: v.perSide, plannedSets: v.plannedSets, plannedSeconds: v.plannedSeconds, holds: holds.list,
    }),
    dropped: holds.dropped,
  }
}

/** Внешнее занятие. Разбивка по столпам, которая не сходится (чужой ключ,
    отрицательные минуты, сумма больше длительности), обнуляется, а элемент
    остаётся: длительность и название ценнее разбивки. Обнуление считается. */
export function sanitizeExternalItem(v: unknown): Sanitized<ExternalItem> {
  if (!isPlainObject(v) || v.type !== 'external') return { value: null, dropped: 0 }
  const base = itemBase(v)
  if (!base || !isNonEmptyString(v.activityId) || !isString(v.activityTitle) || !isPositiveFinite(v.durationMin)) {
    return { value: null, dropped: 0 }
  }
  const rpe = opt(v.rpe, intIn(RPE_MIN, RPE_MAX))
  if (rpe === BAD) return { value: null, dropped: 0 }
  const durationMin = v.durationMin
  let split: Partial<Record<Pillar, number>> = {}
  let dropped = 0
  if (isPlainObject(v.split)) {
    const entries = Object.entries(v.split)
    const valid = entries.every(([k, m]) => isPillar(k) && isNonNegFinite(m))
    const sum = valid ? entries.reduce((s, [, m]) => s + (m as number), 0) : Infinity
    if (valid && sum <= durationMin) {
      for (const p of PILLARS) if (Object.hasOwn(v.split, p)) split[p] = v.split[p] as number
    } else {
      split = {}
      dropped = 1
    }
  } else if (has(v.split)) {
    dropped = 1
  }
  return {
    value: compact<ExternalItem>({
      ...base, type: 'external', activityId: v.activityId, activityTitle: v.activityTitle, durationMin, rpe, split,
    }),
    dropped,
  }
}

/** Элемент любого вида. Неизвестный type - null. */
export function sanitizeSessionItem(v: unknown): Sanitized<SessionItem> {
  if (!isPlainObject(v)) return { value: null, dropped: 0 }
  switch (v.type) {
    case 'strength': return sanitizeStrengthItem(v)
    case 'cardio': return { value: sanitizeCardioItem(v), dropped: 0 }
    case 'intervals': return { value: sanitizeIntervalItem(v), dropped: 0 }
    case 'hold': return sanitizeHoldItem(v)
    case 'external': return sanitizeExternalItem(v)
    default: return { value: null, dropped: 0 }
  }
}

/* ---- сессия ---- */

function sanitizeProgramRef(v: unknown): ProgramRef | null {
  if (!isPlainObject(v)) return null
  if (!isNonEmptyString(v.programId) || !isNonEmptyString(v.phaseId) || !isNonEmptyString(v.dayKey) ||
      !isPositiveInt(v.week) || !isBoolean(v.deload)) return null
  return { programId: v.programId, phaseId: v.phaseId, dayKey: v.dayKey, week: v.week, deload: v.deload }
}

/** Сессия: null, если нет id, даты YYYY-MM-DD, startedAt, места из списка
    или массива items. Битый элемент выпадает один и считается; элемент с
    повторным id тоже выпадает (по id на него ссылаются таймеры). Битое
    необязательное поле сессии снимается и считается, сессия остаётся. */
export function sanitizeSession(v: unknown): Sanitized<Session> {
  if (!isPlainObject(v)) return { value: null, dropped: 0 }
  if (!isNonEmptyString(v.id) || !isDate(v.date) || !isTimestamp(v.startedAt) || !isPlace(v.place) || !Array.isArray(v.items)) {
    return { value: null, dropped: 0 }
  }
  let dropped = 0
  function optField<T>(raw: unknown, check: (x: unknown) => T | null): T | undefined {
    if (!has(raw)) return undefined
    const s = check(raw)
    if (s === null) dropped++
    return s ?? undefined
  }
  const guarded = <T>(g: Guard<T>) => (x: unknown): T | null => (g(x) ? x : null)

  const items: SessionItem[] = []
  const ids = new Set<string>()
  for (const raw of v.items) {
    const s = sanitizeSessionItem(raw)
    dropped += s.dropped
    if (s.value === null || ids.has(s.value.id)) {
      dropped++
      continue
    }
    ids.add(s.value.id)
    items.push(s.value)
  }

  let title = ''
  if (isString(v.title)) title = v.title
  else if (has(v.title)) dropped++

  const startedAt = v.startedAt
  return {
    value: compact<Session>({
      id: v.id,
      date: v.date,
      startedAt,
      endedAt: optField(v.endedAt, guarded((x: unknown): x is number => isTimestamp(x) && x >= startedAt)),
      place: v.place,
      title,
      templateId: optField(v.templateId, guarded(isNonEmptyString)),
      programRef: optField(v.programRef, sanitizeProgramRef),
      items,
      note: optField(v.note, guarded(isString)),
      excludeFromWeek: optField(v.excludeFromWeek, guarded(isBoolean)),
      health: optField(v.health, (x: unknown) =>
        isPlainObject(x) && isTimestamp(x.sentAt) && isBoolean(x.confirmed) ? { sentAt: x.sentAt, confirmed: x.confirmed } : null),
    }),
    dropped,
  }
}

/* ---- библиотека ---- */

function sanitizeExerciseDefaults(v: unknown): ExerciseDefaults | null {
  if (!isPlainObject(v) || !isNonNegInt(v.sets)) return null
  const reps = opt(v.reps, isIntRange)
  const seconds = opt(v.seconds, isIntRange)
  const perSide = opt(v.perSide, isBoolean)
  const minutes = opt(v.minutes, isPositiveFinite)
  const protocolId = opt(v.protocolId, isNonEmptyString)
  if (reps === BAD || seconds === BAD || perSide === BAD || minutes === BAD || protocolId === BAD) return null
  return compact<ExerciseDefaults>({
    sets: v.sets,
    reps: reps && [reps[0], reps[1]],
    seconds: seconds && [seconds[0], seconds[1]],
    perSide, minutes, protocolId,
  })
}

/** Своё упражнение. Группы: до двух, без повторов; инвентарь: хотя бы один,
    всё из списка. Любое нарушение - null. */
export function sanitizeExercise(v: unknown): Exercise | null {
  if (!isPlainObject(v)) return null
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.title) || !isPillar(v.pillar) || !oneOf(INPUT_KINDS)(v.input) ||
      !isString(v.technique)) return null
  const groups = opt(v.groups, (x: unknown): x is MuscleGroup[] =>
    Array.isArray(x) && x.length <= MAX_GROUPS_PER_EXERCISE && x.every(isMuscleGroup) && new Set(x).size === x.length)
  const zone = opt(v.zone, oneOf(MOBILITY_ZONES))
  const cardioMode = opt(v.cardioMode, isCardioMode)
  const custom = opt(v.custom, isTrue)
  if (groups === BAD || zone === BAD || cardioMode === BAD || custom === BAD) return null
  if (!Array.isArray(v.equipment) || v.equipment.length === 0 || !v.equipment.every(isEquipment)) return null
  const defaults = sanitizeExerciseDefaults(v.defaults)
  if (!defaults) return null
  return compact<Exercise>({
    id: v.id,
    title: v.title,
    pillar: v.pillar,
    groups: groups && [...groups],
    zone,
    equipment: [...new Set(v.equipment as Equipment[])],
    input: v.input,
    cardioMode,
    defaults,
    technique: v.technique,
    custom,
  })
}

function sanitizeTemplateItem(v: unknown): TemplateItem | null {
  if (!isPlainObject(v) || !isNonEmptyString(v.exerciseId)) return null
  const sets = opt(v.sets, isNonNegInt)
  const reps = opt(v.reps, (x: unknown): x is [number, number] | number | 'max' => x === 'max' || isNonNegInt(x) || isIntRange(x))
  const seconds = opt(v.seconds, isNonNegInt)
  const perSide = opt(v.perSide, isBoolean)
  const restSec = opt(v.restSec, intIn(0, REST_MAX_SEC))
  const minutes = opt(v.minutes, isPositiveFinite)
  const protocolId = opt(v.protocolId, isNonEmptyString)
  const cue = opt(v.cue, isString)
  if (sets === BAD || reps === BAD || seconds === BAD || perSide === BAD || restSec === BAD || minutes === BAD ||
      protocolId === BAD || cue === BAD) return null
  return compact<TemplateItem>({
    exerciseId: v.exerciseId,
    sets,
    reps: Array.isArray(reps) ? [reps[0], reps[1]] : reps,
    seconds, perSide, restSec, minutes, protocolId, cue,
  })
}

/** Свой шаблон. Ссылка на несуществующее упражнение здесь не проверяется:
    экран показывает «упражнение удалено», а шаблон не теряется. */
export function sanitizeTemplate(v: unknown): Sanitized<Template> {
  if (!isPlainObject(v)) return { value: null, dropped: 0 }
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.title) || !oneOf(TEMPLATE_PLACES)(v.place) ||
      !Array.isArray(v.pillars) || v.pillars.length === 0 || !v.pillars.every(isPillar) || !isNonNegFinite(v.estMinutes)) {
    return { value: null, dropped: 0 }
  }
  const excludeFromWeek = opt(v.excludeFromWeek, isBoolean)
  const source = opt(v.source, oneOf(TEMPLATE_SOURCES))
  const custom = opt(v.custom, isTrue)
  const createdAt = opt(v.createdAt, isTimestamp)
  if (excludeFromWeek === BAD || source === BAD || custom === BAD || createdAt === BAD) return { value: null, dropped: 0 }
  if (!Array.isArray(v.items)) return { value: null, dropped: 0 }
  const items = sanitizeList(v.items, sanitizeTemplateItem)
  return {
    value: compact<Template>({
      id: v.id,
      title: v.title,
      place: v.place,
      pillars: [...new Set(v.pillars as Pillar[])],
      items: items.list,
      estMinutes: v.estMinutes,
      excludeFromWeek, source, custom, createdAt,
    }),
    dropped: items.dropped,
  }
}

/* ---- программа, тесты, вес ---- */

/** Прогресс программы. Дни недели: ровно три разных целых 0..6. Битая
    отметка дня или замера выпадает одна и считается. */
export function sanitizeProgramProgress(v: unknown): Sanitized<ProgramProgress> {
  if (!isPlainObject(v)) return { value: null, dropped: 0 }
  const days = v.trainingWeekdays
  const daysOk = Array.isArray(days) && days.length === TRAINING_DAYS_PER_WEEK && days.every(intIn(0, 6)) &&
    new Set(days).size === TRAINING_DAYS_PER_WEEK
  if (!isNonEmptyString(v.programId) || !isDate(v.startedOn) || !daysOk || !isNonNegInt(v.phaseIndex) ||
      !isPositiveInt(v.phaseStartedWeek)) return { value: null, dropped: 0 }
  const exitConfirmedAt = opt(v.exitConfirmedAt, isTimestamp)
  const stoppedAt = opt(v.stoppedAt, isTimestamp)
  if (exitConfirmedAt === BAD || stoppedAt === BAD) return { value: null, dropped: 0 }
  const completed = sanitizeList(v.completedDays, (x: unknown) =>
    isPlainObject(x) && isDate(x.date) && isNonEmptyString(x.dayKey) && isNonEmptyString(x.sessionId)
      ? { date: x.date, dayKey: x.dayKey, sessionId: x.sessionId } : null)
  const measurements = sanitizeList(v.measurements, (x: unknown) =>
    isPlainObject(x) && isDate(x.date) && isNonNegInt(x.reps) ? { date: x.date, reps: x.reps } : null)
  return {
    value: compact<ProgramProgress>({
      programId: v.programId,
      startedOn: v.startedOn,
      trainingWeekdays: [...(days as number[])],
      phaseIndex: v.phaseIndex,
      phaseStartedWeek: v.phaseStartedWeek,
      completedDays: completed.list,
      measurements: measurements.list,
      exitConfirmedAt, stoppedAt,
    }),
    dropped: completed.dropped + measurements.dropped,
  }
}

/** Результат теста формы: значения полей - конечные числа, иначе null. */
export function sanitizeTestResult(v: unknown): TestResult | null {
  if (!isPlainObject(v)) return null
  if (!isNonEmptyString(v.id) || !isNonEmptyString(v.testId) || !isDate(v.date) || !isFiniteNumber(v.result)) return null
  if (!isPlainObject(v.values) || !Object.values(v.values).every(isFiniteNumber)) return null
  const note = opt(v.note, isString)
  if (note === BAD) return null
  return compact<TestResult>({
    id: v.id, testId: v.testId, date: v.date, values: { ...(v.values as Record<string, number>) }, result: v.result, note,
  })
}

/** Вес тела: одна запись на дату (повтор даты - выигрывает последняя по
    порядку, прежние считаются потерей), по возрастанию даты. */
export function sanitizeBodyWeights(v: unknown): { value: AppState['bodyWeights']; dropped: number } {
  const { list, dropped } = sanitizeList(v, (x: unknown) =>
    isPlainObject(x) && isDate(x.date) && isBodyWeight(x.kg) ? { date: x.date, kg: x.kg } : null)
  const byDate = new Map<DateISO, number>()
  for (const w of list) byDate.set(w.date, w.kg)
  const value = [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([date, kg]) => ({ date, kg }))
  return { value, dropped: dropped + (list.length - value.length) }
}

/** Служебные поля. Битое поле заменяется значением по умолчанию и считается;
    installedAt по умолчанию - now. */
export function sanitizeMeta(v: unknown, now: Millis): { value: AppState['meta']; dropped: number } {
  const def = { lastBackupAt: null, sessionsSinceBackup: 0, installedAt: now }
  if (v === undefined || v === null) return { value: def, dropped: 0 }
  if (!isPlainObject(v)) return { value: def, dropped: 1 }
  let dropped = 0
  const pickField = <T>(raw: unknown, check: Guard<T>, fallback: T): T => {
    if (raw === undefined) return fallback
    if (check(raw)) return raw
    dropped++
    return fallback
  }
  return {
    value: {
      lastBackupAt: pickField(v.lastBackupAt, (x: unknown): x is number | null => x === null || isTimestamp(x), def.lastBackupAt),
      sessionsSinceBackup: pickField(v.sessionsSinceBackup, isNonNegInt, def.sessionsSinceBackup),
      installedAt: pickField(v.installedAt, isTimestamp, def.installedAt),
    },
    dropped,
  }
}

/* ---- коллекции по ключу ---- */

/** Словарь записей по id. Запись под чужим ключом (sessions['a'].id === 'b')
    выпадает: иначе одна запись жила бы под двумя ключами. */
function sanitizeRecordMap<T>(
  v: unknown,
  one: (x: unknown) => Sanitized<T>,
  keyOf: (x: T) => string,
): { value: Record<string, T>; dropped: number } {
  if (v === undefined || v === null) return { value: {}, dropped: 0 }
  if (!isPlainObject(v)) return { value: {}, dropped: 1 }
  const value: Record<string, T> = {}
  let dropped = 0
  for (const [key, raw] of Object.entries(v)) {
    const s = one(raw)
    dropped += s.dropped
    if (s.value === null || keyOf(s.value) !== key) dropped++
    else value[key] = s.value
  }
  return { value, dropped }
}

const plain = <T>(fn: (x: unknown) => T | null) => (x: unknown): Sanitized<T> => ({ value: fn(x), dropped: 0 })

/* ---- миграция и разбор ---- */

/** Поднимает сырой объект любой версии не выше текущей до AppState текущей
    версии. Пока шагов нет, это санитизация; rawVersion - версия до миграции,
    по ней будущие шаги migrateVNtoVN1 решают, применяться ли. */
export function migrate(raw: Record<string, unknown>, rawVersion: number, now: Millis): { state: AppState; dropped: number } {
  void rawVersion // шагов между версиями пока нет: CURRENT_VERSION = 1
  const settings = sanitizeSettings(raw.settings)
  const sessions = sanitizeRecordMap(raw.sessions, sanitizeSession, s => s.id)
  const customExercises = sanitizeRecordMap(raw.customExercises, plain(sanitizeExercise), e => e.id)
  const customTemplates = sanitizeRecordMap(raw.customTemplates, sanitizeTemplate, t => t.id)
  const programs = sanitizeRecordMap(raw.programs, sanitizeProgramProgress, p => p.programId)
  const tests = sanitizeList(raw.testResults, sanitizeTestResult)
  // повтор id - одна запись дважды; первая остаётся, повтор считается потерей
  const testIds = new Set<string>()
  const testResults: TestResult[] = []
  for (const t of tests.list) {
    if (testIds.has(t.id)) continue
    testIds.add(t.id)
    testResults.push(t)
  }
  const bodyWeights = sanitizeBodyWeights(raw.bodyWeights)
  const meta = sanitizeMeta(raw.meta, now)
  return {
    state: {
      version: CURRENT_VERSION,
      settings: settings.value,
      sessions: sessions.value,
      customExercises: customExercises.value,
      customTemplates: customTemplates.value,
      programs: programs.value,
      testResults,
      bodyWeights: bodyWeights.value,
      meta: meta.value,
    },
    dropped: settings.dropped + sessions.dropped + customExercises.dropped + customTemplates.dropped +
      programs.dropped + tests.dropped + (tests.list.length - testResults.length) + bodyWeights.dropped + meta.dropped,
  }
}

/** Источник состояния:
    - 'stored' - прочитано и при необходимости мигрировано; dropped может быть > 0;
    - 'default' - читать нечего (нет записи, пустая строка, JSON null);
    - 'newer-version' - записано более новой сборкой. Отдаётся состояние по
      умолчанию только для отрисовки; вызывающий обязан не сохранять ничего,
      иначе дефолт затрёт данные, понятные новой сборке;
    - 'corrupt' - текст не разбирается (не JSON, JSON не объект, черновик без
      опознаваемой сессии). Исходный текст вызывающий откладывает в копию,
      после чего запись поверх допустима: прочитать это не может никто. */
export type StateSource = 'stored' | 'default' | 'newer-version' | 'corrupt'

export interface LoadResult {
  state: AppState
  source: StateSource
  /** Сколько присутствовавшего в тексте отброшено при разборе. Не ноль только у 'stored'. */
  dropped: number
}

export interface ActiveLoadResult {
  active: ActiveSession | null
  source: StateSource
  dropped: number
}

type ParsedText =
  | { kind: 'empty' }
  | { kind: 'corrupt' }
  | { kind: 'newer'; version: number }
  | { kind: 'object'; raw: Raw; version: number }

/** Общий разбор текста записи. Версия: число больше текущей - более новая
    сборка (даже дробное: лучше не тронуть, чем затереть); целое 0..текущей -
    как есть; иначе (нет поля, мусор) - 0, то есть старше любой версии. */
function parseText(text: string | null): ParsedText {
  if (text === null || text.trim() === '') return { kind: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { kind: 'corrupt' }
  }
  if (parsed === null) return { kind: 'empty' }
  if (!isPlainObject(parsed)) return { kind: 'corrupt' }
  const version = parseVersion(parsed.version)
  if (version > CURRENT_VERSION) return { kind: 'newer', version }
  return { kind: 'object', raw: parsed, version }
}

/** Версия формата из сырого поля, правило как у parseText. */
export function parseVersion(v: unknown): number {
  if (typeof v === 'number' && v > CURRENT_VERSION) return v
  return isNonNegInt(v) ? v : 0
}

/** Разбирает сохранённый AppState. Никогда не бросает. now нужен только для
    состояния по умолчанию (meta.installedAt). */
export function deserialize(text: string | null, now: Millis): LoadResult {
  const parsed = parseText(text)
  switch (parsed.kind) {
    case 'empty': return { state: defaultState(now), source: 'default', dropped: 0 }
    case 'corrupt': return { state: defaultState(now), source: 'corrupt', dropped: 0 }
    case 'newer': return { state: defaultState(now), source: 'newer-version', dropped: 0 }
    case 'object': {
      const { state, dropped } = migrate(parsed.raw, parsed.version, now)
      return { state, source: 'stored', dropped }
    }
  }
}

function sanitizeTimer<T extends { itemId: string }>(
  v: unknown,
  itemIds: Set<string>,
  build: (x: Raw) => T | null,
): T | undefined | Bad {
  if (!has(v)) return undefined
  if (!isPlainObject(v) || !isString(v.itemId) || !itemIds.has(v.itemId)) return BAD
  return build(v) ?? BAD
}

function sanitizePausable(x: Raw): Stopwatch | null {
  if (!isString(x.itemId) || !isTimestamp(x.startedAt) || !isNonNegFinite(x.pausedTotalMs)) return null
  const startedAt = x.startedAt
  const pausedAt = opt(x.pausedAt, (p: unknown): p is number => isTimestamp(p) && p >= startedAt)
  if (pausedAt === BAD) return null
  return compact<Stopwatch>({ itemId: x.itemId, startedAt, pausedAt, pausedTotalMs: x.pausedTotalMs })
}

/** Поднимает сырой черновик до ActiveSession. Без опознаваемой сессии - null.
    Таймер, который ссылается на несуществующий элемент или битый сам,
    снимается и считается: идущая тренировка важнее висящего таймера. */
export function migrateActive(raw: Record<string, unknown>, rawVersion: number): Sanitized<ActiveSession> {
  void rawVersion // шагов между версиями пока нет: CURRENT_VERSION = 1
  const session = sanitizeSession(raw.session)
  if (session.value === null) return { value: null, dropped: 0 }
  let dropped = session.dropped
  const itemIds = new Set(session.value.items.map(i => i.id))
  const take = <T>(x: T | undefined | Bad): T | undefined => {
    if (x === BAD) {
      dropped++
      return undefined
    }
    return x
  }

  const currentItemId = take(opt(raw.currentItemId, (x: unknown): x is string => isString(x) && itemIds.has(x)))
  const rest = take(sanitizeTimer<RestTimer>(raw.rest, itemIds, x =>
    isTimestamp(x.startedAt) && isTimestamp(x.endsAt) && x.endsAt >= x.startedAt
      ? { itemId: x.itemId as string, startedAt: x.startedAt, endsAt: x.endsAt } : null))
  const stopwatch = take(sanitizeTimer<Stopwatch>(raw.stopwatch, itemIds, sanitizePausable))
  const interval = take(sanitizeTimer<IntervalRun>(raw.interval, itemIds, sanitizePausable))
  const hold = take(sanitizeTimer<HoldRun>(raw.hold, itemIds, x => {
    if (!isNonNegInt(x.stepIndex) || !isTimestamp(x.stepStartedAt) || !isTimestamp(x.stepEndsAt) ||
        x.stepEndsAt < x.stepStartedAt) return null
    const paused = opt(x.paused, isBoolean)
    if (paused === BAD) return null
    return compact<HoldRun>({
      itemId: x.itemId as string, stepIndex: x.stepIndex, stepStartedAt: x.stepStartedAt, stepEndsAt: x.stepEndsAt, paused,
    })
  }))
  let wakeLockWanted = false
  if (isBoolean(raw.wakeLockWanted)) wakeLockWanted = raw.wakeLockWanted
  else if (has(raw.wakeLockWanted)) dropped++

  return {
    value: compact<ActiveSession>({
      version: CURRENT_VERSION,
      session: session.value,
      currentItemId, rest, stopwatch, interval, hold,
      wakeLockWanted,
    }),
    dropped,
  }
}

/** Разбирает черновик идущей тренировки. Никогда не бросает. Битый черновик
    даёт null с source 'corrupt' (копию делает store.ts); более новой версии -
    null с source 'newer-version' (сохранение блокируется целиком). */
export function deserializeActive(text: string | null): ActiveLoadResult {
  const parsed = parseText(text)
  switch (parsed.kind) {
    case 'empty': return { active: null, source: 'default', dropped: 0 }
    case 'corrupt': return { active: null, source: 'corrupt', dropped: 0 }
    case 'newer': return { active: null, source: 'newer-version', dropped: 0 }
    case 'object': {
      const { value, dropped } = migrateActive(parsed.raw, parsed.version)
      if (value === null) return { active: null, source: 'corrupt', dropped: 0 }
      return { active: value, source: 'stored', dropped }
    }
  }
}
