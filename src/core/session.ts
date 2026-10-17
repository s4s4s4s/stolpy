/* Операции с тренировкой. Все функции чистые: возвращают новый объект сессии,
   входной не меняют; время и идентификаторы приходят параметрами. Некорректные
   вызовы (нет такого элемента, отрицательный вес, лишний подход) бросают
   RangeError с понятным текстом: экран такие значения не пропускает, поэтому
   исключение означает ошибку вызывающего кода, а не ввод человека.

   Библиотека (словарь по id) и протоколы (список) приходят параметрами:
   ядро не читает src/data. */

import { validateSplit } from './external'
import { makeId } from './ids'
import { isDateISO, todayLocal } from './dates'
import { roundKg } from './onerm'
import { PILLARS } from './pillars'
import { CUSTOM_PROTOCOL_LIMITS, LOAD_MAX_KG, REST_MAX_SEC, RIR_MAX, isMillis } from './limits'
import type {
  AppState, CardioItem, CustomProtocolParams, DateISO, Exercise, ExerciseLibrary, ExternalItem, HoldItem, IdFactory, IntervalItem,
  IntervalProtocol, Millis, Pillar, PlannedSet, Place, ProgramRef, ProtocolLibrary, Session, SessionItem, Side,
  Split, StrengthItem, StrengthSet, Template, TemplateItem,
} from './types'

export function idFactory(now: Millis, random: () => number = Math.random): IdFactory {
  return prefix => makeId(prefix, now, random)
}

/* Отдых по умолчанию между подходами, секунды, если шаблон его не задал. */
export const DEFAULT_REST_SEC = 90
/* Длительность удержания по умолчанию, если её нет ни в шаблоне, ни в упражнении. */
export const DEFAULT_HOLD_SEC = 30
export const CUSTOM_PROTOCOL_ID = 'custom'
export const MAX_RIR = RIR_MAX
const MS_PER_MIN = 60_000
const MIN_AVG_HR = 30
const MAX_PEAK_HR = 250

export { CUSTOM_PROTOCOL_LIMITS }

/* ---- справочники ---- */

function exerciseIndex(library: ExerciseLibrary): Map<string, Exercise> {
  return new Map(Object.entries(library))
}

function protocolIndex(protocols: ProtocolLibrary): Map<string, IntervalProtocol> {
  return new Map(protocols.map(protocol => [protocol.id, protocol]))
}

function fail(message: string): never {
  throw new RangeError(message)
}

/* ---- проверки ввода ---- */

function isPositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
function isNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/* Время записи: конечное неотрицательное число миллисекунд (core/limits). */
function requireMillis(value: number, what: string): void {
  if (!isMillis(value)) fail(`${what}: неотрицательное число миллисекунд, получено ${value}`)
}

/* Вес снаряда или помощь: больше нуля и не больше LOAD_MAX_KG. */
function requireLoad(value: number | undefined, what: string): void {
  if (value !== undefined && !(isPositive(value) && value <= LOAD_MAX_KG)) {
    fail(`${what}: число больше 0 и не больше ${LOAD_MAX_KG} кг, получено ${value}`)
  }
}

/* Секунды хранятся целыми (core/limits): измеренное таймером значение
   округляется здесь, а не выпадает при следующей загрузке. */
function wholeSeconds(value: number): number {
  return Math.round(value)
}

/* Копия без ключей со значением undefined: в JSON и сравнениях нет пустых полей. */
function compact<T extends object>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) if (v !== undefined) out[key] = v
  return out as T
}

/* ---- создание ---- */

export interface NewSessionParams {
  place: Place
  title: string
  now: Millis
  ids: IdFactory
  templateId?: string
  programRef?: ProgramRef
  excludeFromWeek?: boolean
}

/* Пустая идущая сессия. Дата - местная дата момента now. */
export function newSession(params: NewSessionParams): Session {
  requireMillis(params.now, 'Время начала тренировки')
  return compact<Session>({
    id: params.ids('sess'),
    date: todayLocal(new Date(params.now)),
    startedAt: params.now,
    place: params.place,
    title: params.title,
    templateId: params.templateId,
    programRef: params.programRef,
    items: [],
    excludeFromWeek: params.excludeFromWeek ? true : undefined,
  })
}

/* Значение из шаблона или упражнения: диапазон даёт нижнюю границу (цель, которую
   гарантированно можно выполнить), 'max' остаётся 'max'. */
function plannedReps(spec: TemplateItem['reps'], fallback: [number, number] | undefined): number | 'max' | undefined {
  if (spec === 'max') return 'max'
  if (typeof spec === 'number') return spec
  if (Array.isArray(spec)) return spec[0]
  return fallback?.[0]
}

function requirePositiveInt(value: number | undefined, what: string, exerciseId: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    fail(`${what} для «${exerciseId}»: целое число не меньше 1, получено ${String(value)}`)
  }
  return value
}

function findProtocol(
  protocols: Map<string, IntervalProtocol>,
  id: string | undefined,
  exerciseId: string,
  custom?: CustomProtocolParams,
): IntervalProtocol {
  if (id === undefined) fail(`Для интервального упражнения «${exerciseId}» не задан протокол`)
  // свой протокол из шаблона: значения сохранены в строке шаблона
  if (id === CUSTOM_PROTOCOL_ID && custom !== undefined) return customProtocol(custom)
  const protocol = protocols.get(id)
  if (!protocol) fail(`Протокол «${id}» упражнения «${exerciseId}» не найден`)
  return { ...protocol }
}

function buildItem(
  exercise: Exercise,
  protocols: Map<string, IntervalProtocol>,
  ids: IdFactory,
  spec: Partial<TemplateItem>,
): SessionItem {
  const id = ids('item')
  const note = spec.cue
  const base = { id, exerciseId: exercise.id, ...(note ? { note } : {}) }

  if (exercise.pillar === 'intervals') {
    const protocol = findProtocol(protocols, spec.protocolId ?? exercise.defaults.protocolId, exercise.id, spec.customProtocol)
    return { ...base, type: 'intervals', mode: exercise.cardioMode ?? 'other', protocol, roundsDone: 0 }
  }
  if (exercise.pillar === 'zone2' || exercise.input === 'distance-time') {
    return { ...base, type: 'cardio', mode: exercise.cardioMode ?? 'other', durationSec: 0 }
  }

  const sets = requirePositiveInt(spec.sets ?? exercise.defaults.sets, 'Число подходов', exercise.id)
  const perSide = spec.perSide ?? exercise.defaults.perSide ?? exercise.input === 'time-side'
  const timed = exercise.input === 'time' || exercise.input === 'time-side'

  if ((exercise.pillar === 'mobility' || exercise.pillar === 'balance') && timed) {
    return {
      ...base,
      type: 'hold',
      perSide,
      plannedSets: sets,
      plannedSeconds: spec.seconds ?? exercise.defaults.seconds?.[0] ?? DEFAULT_HOLD_SEC,
      holds: [],
    }
  }

  const unit: StrengthItem['unit'] = timed ? 'seconds' : 'reps'
  const target: Pick<PlannedSet, 'reps' | 'seconds'> = unit === 'seconds'
    ? { seconds: spec.seconds ?? exercise.defaults.seconds?.[0] }
    : { reps: plannedReps(spec.reps, exercise.defaults.reps) }
  const sides: (Side | undefined)[] = perSide ? ['left', 'right'] : [undefined]
  const planned: PlannedSet[] = []
  for (let i = 0; i < sets; i++) {
    for (const side of sides) planned.push(compact<PlannedSet>({ kind: 'work', ...target, side }))
  }
  return { ...base, type: 'strength', unit, planned, sets: [], restSec: spec.restSec ?? DEFAULT_REST_SEC }
}

/* Элемент тренировки из упражнения. spec - строка шаблона; без неё берутся
   значения упражнения по умолчанию. Тип элемента определяет упражнение:
   интервалы - снимок протокола, зона 2 и дистанция - кардио, время в
   мобильности и балансе - удержание, остальное - силовой элемент с планом
   подходов (при perSide на каждый подход две строки, левая и правая).
   Выбрасывает RangeError, если у интервального упражнения нет протокола. */
export function itemFromExercise(
  exercise: Exercise,
  protocols: ProtocolLibrary,
  ids: IdFactory,
  spec: Partial<TemplateItem> = {},
): SessionItem {
  return buildItem(exercise, protocolIndex(protocols), ids, spec)
}

/* Какие упражнения шаблона уже не найти в библиотеке (например, удалено свое). */
export function missingExerciseIds(template: Template, library: ExerciseLibrary): string[] {
  const known = exerciseIndex(library)
  return template.items.filter(item => !known.has(item.exerciseId)).map(item => item.exerciseId)
}

/* Сессия по шаблону. Элементы, чьего упражнения нет в библиотеке, пропускаются
   (список даёт missingExerciseIds). Место 'any' становится 'home', если не
   передано place. Протокол интервалов копируется снимком. */
export function sessionFromTemplate(
  template: Template,
  library: ExerciseLibrary,
  protocols: ProtocolLibrary,
  now: Millis,
  ids: IdFactory,
  place?: Place,
): Session {
  const exercises = exerciseIndex(library)
  const protocolsById = protocolIndex(protocols)
  const base = newSession({
    place: place ?? (template.place === 'any' ? 'home' : template.place),
    title: template.title,
    now,
    ids,
    templateId: template.id,
    excludeFromWeek: template.excludeFromWeek,
  })
  const items: SessionItem[] = []
  for (const spec of template.items) {
    const exercise = exercises.get(spec.exerciseId)
    if (exercise) items.push(buildItem(exercise, protocolsById, ids, spec))
  }
  return { ...base, items }
}

/* ---- общие помощники для изменений ---- */

function indexOfItem(session: Session, itemId: string): number {
  const index = session.items.findIndex(item => item.id === itemId)
  if (index < 0) fail(`В тренировке нет элемента «${itemId}»`)
  return index
}

function replaceItem(session: Session, index: number, item: SessionItem): Session {
  return { ...session, items: session.items.map((old, i) => (i === index ? item : old)) }
}

function requireType<K extends SessionItem['type']>(
  session: Session,
  itemId: string,
  type: K,
): { index: number; item: Extract<SessionItem, { type: K }> } {
  const index = indexOfItem(session, itemId)
  const item = session.items[index]
  if (item.type !== type) fail(`Элемент «${itemId}» имеет тип ${item.type}, нужен ${type}`)
  return { index, item: item as Extract<SessionItem, { type: K }> }
}

function requireIndex(length: number, index: number, what: string): void {
  if (!Number.isInteger(index) || index < 0 || index >= length) fail(`${what}: нет позиции ${index} (всего ${length})`)
}

/* ---- элементы ---- */

export function addItem(session: Session, item: SessionItem): Session {
  if (session.items.some(existing => existing.id === item.id)) fail(`Элемент «${item.id}» уже есть в тренировке`)
  return { ...session, items: [...session.items, item] }
}

export function removeItem(session: Session, itemId: string): Session {
  indexOfItem(session, itemId)
  return { ...session, items: session.items.filter(item => item.id !== itemId) }
}

/* Заметка к элементу; пустая строка или undefined убирают её. */
export function setItemNote(session: Session, itemId: string, note: string | undefined): Session {
  const index = indexOfItem(session, itemId)
  const { note: _old, ...rest } = session.items[index]
  const text = note?.trim()
  return replaceItem(session, index, (text ? { ...rest, note: text } : rest) as SessionItem)
}

export function setSessionNote(session: Session, note: string | undefined): Session {
  const { note: _old, ...rest } = session
  const text = note?.trim()
  return text ? { ...rest, note: text } : rest
}

/* Калории, введённые руками. Положительное конечное число сохраняется
   округлённым до целых; undefined, ноль и отрицательные поле снимают.
   Нечисловое значение - ошибка вызывающего кода (RangeError). */
export function setSessionEnergy(session: Session, kcal: number | undefined): Session {
  const { energyKcal: _old, ...rest } = session
  if (kcal === undefined) return rest
  if (typeof kcal !== 'number' || Number.isNaN(kcal)) fail(`Калории: число, получено ${String(kcal)}`)
  const rounded = Math.round(kcal)
  return Number.isFinite(rounded) && rounded > 0 ? { ...rest, energyKcal: rounded } : rest
}

/* ---- силовые подходы ---- */

export type StrengthSetInput = Omit<StrengthSet, 'doneAt'>

function checkedSet(input: StrengthSetInput, doneAt: Millis): StrengthSet {
  if (input.kind !== 'warmup' && input.kind !== 'work' && input.kind !== 'failure') {
    fail(`Вид подхода: warmup, work или failure, получено ${String(input.kind)}`)
  }
  requireLoad(input.weightKg, 'Вес подхода')
  requireLoad(input.assistKg, 'Помощь в подходе')
  if (input.reps !== undefined && !isNonNegativeInt(input.reps)) fail(`Повторы: целое число не меньше 0, получено ${input.reps}`)
  if (input.seconds !== undefined && !isNonNegative(input.seconds)) fail(`Секунды: число не меньше 0, получено ${input.seconds}`)
  if (input.reps === undefined && input.seconds === undefined) fail('В подходе нет ни повторов, ни секунд')
  if (input.rir !== undefined && !(Number.isInteger(input.rir) && input.rir >= 0 && input.rir <= MAX_RIR)) {
    fail(`RIR: целое от 0 до ${MAX_RIR}, получено ${input.rir}`)
  }
  if (input.side !== undefined && input.side !== 'left' && input.side !== 'right') fail(`Сторона: left или right, получено ${String(input.side)}`)
  requireMillis(doneAt, 'Время подхода')
  const seconds = input.seconds === undefined ? undefined : wholeSeconds(input.seconds)
  return compact<StrengthSet>({ ...input, seconds, doneAt })
}

/* Записывает подход в силовой элемент; запланированные строки не меняются. */
export function logSet(session: Session, itemId: string, input: StrengthSetInput, now: Millis): Session {
  const { index, item } = requireType(session, itemId, 'strength')
  return replaceItem(session, index, { ...item, sets: [...item.sets, checkedSet(input, now)] })
}

/* Правка записанного подхода; время записи сохраняется. undefined в patch
   стирает поле. */
export function updateSet(
  session: Session,
  itemId: string,
  setIndex: number,
  patch: Partial<StrengthSetInput>,
): Session {
  const { index, item } = requireType(session, itemId, 'strength')
  requireIndex(item.sets.length, setIndex, 'Правка подхода')
  const old = item.sets[setIndex]
  const { doneAt, ...fields } = old
  const merged = checkedSet({ ...fields, ...patch }, doneAt)
  return replaceItem(session, index, { ...item, sets: item.sets.map((s, i) => (i === setIndex ? merged : s)) })
}

export function removeSet(session: Session, itemId: string, setIndex: number): Session {
  const { index, item } = requireType(session, itemId, 'strength')
  requireIndex(item.sets.length, setIndex, 'Удаление подхода')
  return replaceItem(session, index, { ...item, sets: item.sets.filter((_, i) => i !== setIndex) })
}

/* Смена отдыха элемента (кнопки ±15 с на RestBar сохраняются на упражнение).
   Отдых от 0 до REST_MAX_SEC, хранится в целых секундах. */
export function setRestSec(session: Session, itemId: string, restSec: number): Session {
  const { index, item } = requireType(session, itemId, 'strength')
  if (!(isNonNegative(restSec) && restSec <= REST_MAX_SEC)) {
    fail(`Отдых: от 0 до ${REST_MAX_SEC} секунд, получено ${restSec}`)
  }
  return replaceItem(session, index, { ...item, restSec: wholeSeconds(restSec) })
}

/* ---- удержания ---- */

export interface HoldInput { seconds: number; side?: Side; eyesClosed?: boolean }

export function logHold(session: Session, itemId: string, input: HoldInput, now: Millis): Session {
  const { index, item } = requireType(session, itemId, 'hold')
  if (!isPositive(input.seconds) || wholeSeconds(input.seconds) < 1) {
    fail(`Удержание: от одной секунды, получено ${input.seconds}`)
  }
  if (item.perSide && input.side === undefined) fail('Удержание на сторону записывается со стороной')
  if (input.side !== undefined && input.side !== 'left' && input.side !== 'right') fail(`Сторона: left или right, получено ${String(input.side)}`)
  requireMillis(now, 'Время удержания')
  const hold = compact({
    seconds: wholeSeconds(input.seconds),
    side: item.perSide ? input.side : undefined,
    eyesClosed: input.eyesClosed ? true : undefined,
    doneAt: now,
  })
  return replaceItem(session, index, { ...item, holds: [...item.holds, hold] })
}

export function removeHold(session: Session, itemId: string, holdIndex: number): Session {
  const { index, item } = requireType(session, itemId, 'hold')
  requireIndex(item.holds.length, holdIndex, 'Удаление удержания')
  return replaceItem(session, index, { ...item, holds: item.holds.filter((_, i) => i !== holdIndex) })
}

/* ---- кардио ---- */

export type CardioPatch = Partial<Pick<CardioItem, 'mode' | 'durationSec' | 'distanceKm' | 'avgHr' | 'talkTest'>>

/* Пульс: от MIN_AVG_HR до MAX_PEAK_HR (внутри пределов хранения core/limits),
   хранится целым ударом в минуту. */
function checkedHr(value: number | undefined, what: string): number | undefined {
  if (value === undefined) return undefined
  if (!(Number.isFinite(value) && value >= MIN_AVG_HR && value <= MAX_PEAK_HR)) {
    fail(`${what}: от ${MIN_AVG_HR} до ${MAX_PEAK_HR}, получено ${value}`)
  }
  return Math.round(value)
}

/* Правка кардио-элемента. undefined стирает необязательное поле. */
export function updateCardio(session: Session, itemId: string, patch: CardioPatch): Session {
  const { index, item } = requireType(session, itemId, 'cardio')
  if (patch.durationSec !== undefined && !isNonNegative(patch.durationSec)) fail(`Длительность: секунды не меньше 0, получено ${patch.durationSec}`)
  if (patch.distanceKm !== undefined && !isPositive(patch.distanceKm)) fail(`Дистанция: положительное число, получено ${patch.distanceKm}`)
  const normalized: CardioPatch = { ...patch }
  if ('avgHr' in patch) normalized.avgHr = checkedHr(patch.avgHr, 'Средний пульс')
  if (patch.durationSec !== undefined) normalized.durationSec = wholeSeconds(patch.durationSec)
  const next = compact<CardioItem>({ ...item, ...normalized })
  return replaceItem(session, index, next)
}

/* ---- интервалы ---- */

export type IntervalsPatch = Partial<Pick<IntervalItem, 'mode' | 'protocol' | 'roundsDone' | 'peakHr'>>

export type { CustomProtocolParams }

function checkCustomLimits(p: CustomProtocolParams): void {
  for (const key of Object.keys(CUSTOM_PROTOCOL_LIMITS) as (keyof CustomProtocolParams)[]) {
    const [min, max] = CUSTOM_PROTOCOL_LIMITS[key]
    const value = p[key]
    if (!Number.isInteger(value) || value < min || value > max) {
      fail(`Свой протокол, ${key}: целое от ${min} до ${max}, получено ${String(value)}`)
    }
  }
}

/* Снимок протокола целиком: целые секунды и раунды, строки подписи. Тот же
   вид требует разбор сохранённого (sanitizeIntervalProtocol). */
function checkProtocolSnapshot(p: IntervalProtocol): void {
  const positive = (v: number) => Number.isSafeInteger(v) && v > 0
  const nonNegative = (v: number) => Number.isSafeInteger(v) && v >= 0
  if (typeof p.id !== 'string' || p.id.trim() === '' || typeof p.title !== 'string' ||
      typeof p.note !== 'string' || typeof p.source !== 'string' ||
      !positive(p.workSec) || !nonNegative(p.restSec) || !positive(p.rounds) ||
      !nonNegative(p.warmupSec) || !nonNegative(p.cooldownSec)) {
    fail(`Протокол «${String(p.id)}»: работа и раунды целые больше 0, отдых, разминка и заминка целые от 0, подписи строками`)
  }
}

/* Свой протокол по значениям человека (пределы раздела 3.4 плана). */
export function customProtocol(params: CustomProtocolParams): IntervalProtocol {
  checkCustomLimits(params)
  return {
    id: CUSTOM_PROTOCOL_ID,
    title: 'Свой протокол',
    workSec: params.workSec,
    restSec: params.restSec,
    rounds: params.rounds,
    warmupSec: params.warmupSec,
    cooldownSec: params.cooldownSec,
    note: 'Значения заданы вручную.',
    source: 'свой',
  }
}

/* Правка интервального элемента. Смена протокола снимком; для своего протокола
   проверяются пределы; число раундов не больше раундов протокола; смена
   протокола, после которой roundsDone выходит за раунды, отклоняется. */
export function updateIntervals(session: Session, itemId: string, patch: IntervalsPatch): Session {
  const { index, item } = requireType(session, itemId, 'intervals')
  if (patch.protocol?.id === CUSTOM_PROTOCOL_ID) checkCustomLimits(patch.protocol)
  if (patch.protocol) checkProtocolSnapshot(patch.protocol)
  const next = compact<IntervalItem>({ ...item, ...patch, ...(patch.protocol ? { protocol: { ...patch.protocol } } : {}) })
  if (!isNonNegativeInt(next.roundsDone) || next.roundsDone > next.protocol.rounds) {
    fail(`Раунды: целое от 0 до ${next.protocol.rounds}, получено ${String(next.roundsDone)}`)
  }
  const peakHr = checkedHr(next.peakHr, 'Пиковый пульс')
  return replaceItem(session, index, compact<IntervalItem>({ ...next, peakHr }))
}

/* ---- завершение ---- */

/* Пуст ли элемент: ничего не сделано. Внешнее занятие пустым не бывает. */
export function isItemEmpty(item: SessionItem): boolean {
  switch (item.type) {
    case 'strength': return item.sets.length === 0
    case 'cardio': return !(item.durationSec > 0)
    case 'intervals': return !(item.roundsDone > 0)
    case 'hold': return item.holds.length === 0
    case 'external': return false
  }
}

/* Есть ли в сессии хоть что-то сделанное. */
export function hasLoggedWork(session: Session): boolean {
  return session.items.some(item => !isItemEmpty(item))
}

export interface FinishOptions {
  /* Убрать элементы, где ничего не сделано. По умолчанию да. */
  pruneEmpty?: boolean
  note?: string
}

/* Закрывает сессию: endedAt = now (не раньше начала), пустые элементы
   убираются, заметка сохраняется. Уже завершённая сессия возвращается как есть. */
export function finishSession(session: Session, now: Millis, options: FinishOptions = {}): Session {
  if (session.endedAt !== undefined) return { ...session }
  requireMillis(now, 'Время окончания')
  const pruned = options.pruneEmpty === false ? session.items : session.items.filter(item => !isItemEmpty(item))
  const closed: Session = { ...session, items: pruned, endedAt: Math.max(now, session.startedAt) }
  return options.note !== undefined ? setSessionNote(closed, options.note) : closed
}

/* ---- сводка ---- */

export interface PillarStat {
  sets: number        // силовые рабочие подходы, удержания, рабочие отрезки интервалов
  minutes: number     // кардио, удержания, тяжёлые минуты интервалов, внешние минуты
}

export interface SessionSummary {
  minutes: number                       // целые минуты от начала до конца (или до now)
  sets: number                          // рабочие и до отказа силовые подходы
  tonnageKg: number                     // сумма вес x повторы рабочих подходов
  byPillar: Record<Pillar, PillarStat>
}

/* Целые минуты сессии; идущая считается до now. */
export function sessionMinutes(session: Session, now: Millis): number {
  const end = session.endedAt ?? now
  return Math.max(0, Math.round((end - session.startedAt) / MS_PER_MIN))
}

function emptyByPillar(): Record<Pillar, PillarStat> {
  return Object.fromEntries(PILLARS.map(pillar => [pillar, { sets: 0, minutes: 0 }])) as Record<Pillar, PillarStat>
}

export function sessionSummary(session: Session, library: ExerciseLibrary, now: Millis): SessionSummary {
  const exercises = exerciseIndex(library)
  const byPillar = emptyByPillar()
  let sets = 0
  let tonnage = 0
  for (const item of session.items) {
    const pillarOf = (fallback: Pillar): Pillar =>
      (item.type === 'external' ? undefined : exercises.get(item.exerciseId)?.pillar) ?? fallback
    switch (item.type) {
      case 'strength': {
        const stat = byPillar[pillarOf('strength')]
        for (const set of item.sets) {
          if (set.kind === 'warmup') continue
          sets++
          stat.sets++
          if (isPositive(set.weightKg) && isNonNegativeInt(set.reps)) tonnage += set.weightKg * set.reps
        }
        break
      }
      case 'cardio':
        byPillar[pillarOf('zone2')].minutes += item.durationSec / 60
        break
      case 'intervals':
        byPillar.intervals.sets += item.roundsDone
        byPillar.intervals.minutes += (item.roundsDone * item.protocol.workSec) / 60
        break
      case 'hold': {
        const stat = byPillar[pillarOf('mobility')]
        stat.sets += item.holds.length
        stat.minutes += item.holds.reduce((sum, hold) => sum + hold.seconds, 0) / 60
        break
      }
      case 'external':
        for (const pillar of PILLARS) byPillar[pillar].minutes += item.split[pillar] ?? 0
        break
    }
  }
  return { minutes: sessionMinutes(session, now), sets, tonnageKg: roundKg(tonnage), byPillar }
}

/* ---- прошлый раз ---- */

export interface Prefill {
  weightKg?: number
  assistKg?: number
  reps?: number
  seconds?: number
}

function lastWorkSet(session: Session, exerciseId: string): StrengthSet | null {
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i]
    if (item.type !== 'strength' || item.exerciseId !== exerciseId) continue
    for (let j = item.sets.length - 1; j >= 0; j--) {
      if (item.sets[j].kind !== 'warmup') return item.sets[j]
    }
  }
  return null
}

/* Значения для строки подхода: последний рабочий подход упражнения (work или
   failure, не разминка). Если передана идущая сессия current и в ней уже есть
   такой подход, берётся он; иначе последний по времени начала подход
   завершённых сессий. Нет истории - null. */
export function prefillFor(
  state: Pick<AppState, 'sessions'>,
  exerciseId: string,
  current?: Session,
): Prefill | null {
  let found = current ? lastWorkSet(current, exerciseId) : null
  if (!found) {
    const history = Object.values(state.sessions).sort((a, b) => b.startedAt - a.startedAt)
    for (const session of history) {
      found = lastWorkSet(session, exerciseId)
      if (found) break
    }
  }
  if (!found) return null
  return compact<Prefill>({
    weightKg: found.weightKg,
    assistKg: found.assistKg,
    reps: found.reps,
    seconds: found.seconds,
  })
}

/* ---- шаблон из тренировки ---- */

function minOf(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.min(...values)
}
function maxOfList(values: number[]): number | undefined {
  return values.length === 0 ? undefined : Math.max(...values)
}

function templateItemFromStrength(item: StrengthItem): TemplateItem | null {
  const counted = item.sets.filter(set => set.kind !== 'warmup')
  if (counted.length === 0) return null
  const left = counted.filter(set => set.side === 'left').length
  const right = counted.filter(set => set.side === 'right').length
  const perSide = left > 0 || right > 0
  const sets = perSide ? Math.max(left, right) : counted.length
  const spec: TemplateItem = { exerciseId: item.exerciseId, sets, restSec: item.restSec }
  if (perSide) spec.perSide = true
  if (item.unit === 'seconds') {
    const seconds = minOf(counted.map(set => set.seconds).filter(isPositive))
    if (seconds !== undefined) spec.seconds = Math.round(seconds)
  } else {
    const reps = counted.map(set => set.reps).filter((r): r is number => isPositive(r))
    const lo = minOf(reps)
    const hi = maxOfList(reps)
    if (lo !== undefined && hi !== undefined) spec.reps = lo === hi ? lo : [lo, hi]
  }
  return spec
}

function templateItemFromHold(item: HoldItem): TemplateItem | null {
  if (item.holds.length === 0) return null
  const left = item.holds.filter(hold => hold.side === 'left').length
  const right = item.holds.filter(hold => hold.side === 'right').length
  const sets = item.perSide ? Math.max(left, right, 1) : item.holds.length
  const spec: TemplateItem = {
    exerciseId: item.exerciseId,
    sets,
    seconds: Math.round(Math.min(...item.holds.map(hold => hold.seconds))),
  }
  if (item.perSide) spec.perSide = true
  return spec
}

/* Интервалы: id протокола, а у своего протокола ещё и его значения, иначе
   шаблон открыл бы стартовые значения своего протокола из библиотеки. */
function templateItemFromIntervals(item: IntervalItem): TemplateItem {
  const p = item.protocol
  if (p.id !== CUSTOM_PROTOCOL_ID) return { exerciseId: item.exerciseId, protocolId: p.id }
  return {
    exerciseId: item.exerciseId,
    protocolId: p.id,
    customProtocol: { workSec: p.workSec, restSec: p.restSec, rounds: p.rounds, warmupSec: p.warmupSec, cooldownSec: p.cooldownSec },
  }
}

/* Шаблон из тренировки (раздел 3.3 плана): упражнения в порядке сессии, число
   подходов и диапазон повторов из фактических подходов (разминки не входят),
   удержания и кардио по факту. Внешние занятия и элементы без сделанной
   работы пропускаются. Свой интервальный протокол сохраняется с id 'custom'
   и своими значениями (customProtocol). Нечего сохранять - null. */
export function saveAsTemplate(
  session: Session,
  library: ExerciseLibrary,
  title: string,
  now: Millis,
  ids: IdFactory,
): Template | null {
  const exercises = exerciseIndex(library)
  const items: TemplateItem[] = []
  const pillars = new Set<Pillar>()
  for (const item of session.items) {
    let spec: TemplateItem | null = null
    let fallbackPillar: Pillar = 'strength'
    switch (item.type) {
      case 'strength':
        spec = templateItemFromStrength(item)
        break
      case 'hold':
        spec = templateItemFromHold(item)
        fallbackPillar = 'mobility'
        break
      case 'cardio':
        if (item.durationSec > 0) spec = { exerciseId: item.exerciseId, minutes: Math.max(1, Math.round(item.durationSec / 60)) }
        fallbackPillar = 'zone2'
        break
      case 'intervals':
        if (item.roundsDone > 0) spec = templateItemFromIntervals(item)
        fallbackPillar = 'intervals'
        break
    }
    if (!spec || item.type === 'external') continue
    items.push(spec)
    pillars.add(exercises.get(item.exerciseId)?.pillar ?? fallbackPillar)
  }
  if (items.length === 0) return null
  const name = title.trim() || session.title
  return compact<Template>({
    id: ids('tpl'),
    title: name,
    place: session.place,
    pillars: PILLARS.filter(pillar => pillars.has(pillar)),
    items,
    estMinutes: Math.max(1, sessionMinutes(session, now)),
    excludeFromWeek: session.excludeFromWeek ? true : undefined,
    source: 'custom',
    custom: true,
    createdAt: now,
  })
}

/* ---- внешнее занятие (экран #/external) ---- */

export interface ExternalSessionInput {
  activityId: string
  activityTitle: string
  durationMin: number
  split: Split
  rpe?: number
  date: DateISO
  note?: string
}

/* Готовая завершённая сессия из одного внешнего занятия. Распределение
   проверяет validateSplit, RPE - целое 1..10, дата - календарная. Нулевые
   доли убираются. Время начала отсчитывается назад от now на длительность. */
export function externalSession(input: ExternalSessionInput, now: Millis, ids: IdFactory): Session {
  const check = validateSplit(input.split, input.durationMin)
  if (!check.ok) fail(check.error)
  if (!isDateISO(input.date)) fail(`Дата занятия: YYYY-MM-DD, получено ${JSON.stringify(input.date)}`)
  if (input.rpe !== undefined && !(Number.isInteger(input.rpe) && input.rpe >= 1 && input.rpe <= 10)) {
    fail(`RPE: целое от 1 до 10, получено ${input.rpe}`)
  }
  requireMillis(now, 'Время записи')
  if (now - input.durationMin * MS_PER_MIN < 0) fail(`Время записи ${now} раньше начала занятия длиной ${input.durationMin} мин`)
  const split: Split = {}
  for (const pillar of PILLARS) {
    const minutes = input.split[pillar]
    if (minutes) split[pillar] = minutes
  }
  const item: ExternalItem = compact<ExternalItem>({
    id: ids('item'),
    type: 'external',
    activityId: input.activityId,
    activityTitle: input.activityTitle,
    durationMin: input.durationMin,
    rpe: input.rpe,
    split,
  })
  const base = compact<Session>({
    id: ids('sess'),
    date: input.date,
    startedAt: now - input.durationMin * MS_PER_MIN,
    endedAt: now,
    place: 'outside',
    title: input.activityTitle,
    items: [item],
  })
  return setSessionNote(base, input.note)
}
