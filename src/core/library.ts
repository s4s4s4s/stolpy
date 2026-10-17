import { PILLARS } from './pillars'
import { makeId } from './ids'
import type {
  CardioMode, Equipment, Exercise, ExerciseDefaults, InputKind, MobilityZone, MuscleGroup,
  Millis, Pillar, Place, Settings,
} from './types'

/* Библиотека упражнений: слияние встроенных со своими, фильтры по месту и
   инвентарю, создание своего упражнения. Ядро не импортирует src/data:
   встроенный список приходит параметром (раздел 0, решение 3 плана). */

/** Библиотека по id. Прототипа у объекта нет, поэтому id вроде 'constructor' не ловится случайно. */
export type Library = Readonly<Record<string, Exercise>>

/* Полный перечень инвентаря. Record делает список исчерпывающим на этапе
   сборки: новый вариант Equipment без записи здесь не соберётся. */
const EQUIPMENT_PRESENCE: Record<Equipment, true> = {
  'bodyweight': true, 'pullup-bar': true, 'dip-bars': true, 'dumbbells': true, 'barbell': true,
  'kettlebell': true, 'bands': true, 'grip-trainer': true, 'finger-extensor': true, 'jump-rope': true,
  'exercise-bike': true, 'mat': true, 'bench': true, 'gym-machines': true, 'treadmill': true,
  'rower': true, 'elliptical': true, 'outdoors': true,
}
export const ALL_EQUIPMENT = Object.keys(EQUIPMENT_PRESENCE) as readonly Equipment[]

const GYM_EXCLUDED: readonly Equipment[] = ['outdoors', 'finger-extensor', 'grip-trainer']

/** Зал: весь инвентарь, кроме улицы, кистевого эспандера и разгибателей пальцев. */
export const GYM_EQUIPMENT: readonly Equipment[] = ALL_EQUIPMENT.filter(e => !GYM_EXCLUDED.includes(e))

/** Улица. */
export const OUTSIDE_EQUIPMENT: readonly Equipment[] = ['bodyweight', 'outdoors', 'jump-rope']

export function isEquipment(value: unknown): value is Equipment {
  return typeof value === 'string' && Object.hasOwn(EQUIPMENT_PRESENCE, value)
}

/** Слияние встроенных и своих упражнений. Порядок: встроенные, затем свои.
    При совпадении id побеждает встроенное: свои id получают префикс 'ex-',
    совпадение значит порченые данные, и стартовая библиотека не должна от них меняться. */
export function buildLibrary(
  builtin: readonly Exercise[],
  custom: Readonly<Record<string, Exercise>> = {},
): Library {
  const library: Record<string, Exercise> = Object.create(null)
  for (const exercise of builtin) library[exercise.id] = exercise
  for (const exercise of Object.values(custom)) {
    if (!Object.hasOwn(library, exercise.id)) library[exercise.id] = exercise
  }
  return library
}

/** Упражнения библиотеки списком, в порядке вставки. */
export function libraryList(library: Library): Exercise[] {
  return Object.values(library)
}

/** Инвентарь, доступный в месте. Дом: настройки пользователя плюс свой вес,
    который есть всегда. Зал и улица: константы. */
export function equipmentFor(place: Place, settings: Pick<Settings, 'homeEquipment'>): Equipment[] {
  if (place === 'gym') return [...GYM_EQUIPMENT]
  if (place === 'outside') return [...OUTSIDE_EQUIPMENT]
  const home = new Set<Equipment>(settings.homeEquipment.filter(isEquipment))
  home.add('bodyweight')
  return [...home]
}

/** Упражнение выполнимо, если есть хотя бы один вариант из его списка.
    Пустой список значит «ничего не нужно». */
export function canDoHere(exercise: Pick<Exercise, 'equipment'>, equipment: readonly Equipment[]): boolean {
  if (exercise.equipment.length === 0) return true
  return exercise.equipment.some(e => equipment.includes(e))
}

export interface LibraryFilter {
  pillar?: Pillar
  /** Место без equipment: зал и улица берут свои константы, дом без equipment не фильтруется по инвентарю. */
  place?: Place
  /** Строка поиска: слова через пробел, все должны встретиться в названии или id. */
  query?: string
  /** Доступный инвентарь; перекрывает инвентарь места. */
  equipment?: readonly Equipment[]
}

/** Свёртка для поиска: нижний регистр, ё как е, лишние пробелы убраны. */
function fold(text: string): string {
  return text.toLowerCase().replaceAll('ё', 'е')
}

export function filterLibrary(library: Library, filter: LibraryFilter = {}): Exercise[] {
  const available =
    filter.equipment ??
    (filter.place === 'gym' ? GYM_EQUIPMENT : filter.place === 'outside' ? OUTSIDE_EQUIPMENT : undefined)
  const words = fold(filter.query ?? '').split(/\s+/).filter(Boolean)

  return libraryList(library).filter(exercise => {
    if (filter.pillar && exercise.pillar !== filter.pillar) return false
    if (available && !canDoHere(exercise, available)) return false
    if (words.length > 0) {
      const haystack = fold(`${exercise.title} ${exercise.id}`)
      if (!words.every(w => haystack.includes(w))) return false
    }
    return true
  })
}

/* ---- своё упражнение ---- */

export interface CustomExerciseInput {
  title: string
  pillar: Pillar
  groups?: MuscleGroup[]
  zone?: MobilityZone
  equipment: Equipment[]
  input: InputKind
  cardioMode?: CardioMode
  defaults: ExerciseDefaults
  technique?: string
}

export const CUSTOM_TITLE_MAX = 60
export const CUSTOM_TECHNIQUE_MAX = 280
const SETS_MAX = 20

const MUSCLE_GROUPS: readonly MuscleGroup[] = ['legs', 'back', 'chest-shoulders', 'arms', 'core']
const MOBILITY_ZONES: readonly MobilityZone[] = ['hips', 'spine', 'ankles', 'hamstrings', 'shoulders']
const CARDIO_MODES: readonly CardioMode[] = [
  'walk', 'incline-walk', 'jog', 'run', 'bike', 'row', 'elliptical', 'swim', 'jump-rope', 'other',
]

/* Какие виды ввода допустимы для столпа. */
const INPUTS_BY_PILLAR: Record<Pillar, readonly InputKind[]> = {
  strength: ['weight-reps', 'reps', 'time', 'time-side'],
  zone2: ['distance-time'],
  intervals: ['time'],
  mobility: ['time', 'time-side', 'reps'],
  balance: ['time', 'time-side', 'reps'],
}

const INPUT_TITLE: Record<InputKind, string> = {
  'weight-reps': 'вес и повторы',
  'reps': 'повторы',
  'time': 'время',
  'time-side': 'время на сторону',
  'distance-time': 'дистанция и время',
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1
}

function checkRange(range: unknown, name: string, errors: string[]): void {
  if (!Array.isArray(range) || range.length !== 2 || !isPositiveInt(range[0]) || !isPositiveInt(range[1])) {
    errors.push(`${name}: два целых числа от 1`)
  } else if (range[0] > range[1]) {
    errors.push(`${name}: левая граница не больше правой`)
  }
}

/** Список ошибок ввода по-русски; пустой список значит «можно создавать».
    Нужен форме, чтобы показать причины, пока кнопка неактивна. */
export function validateCustomExercise(input: CustomExerciseInput): string[] {
  const errors: string[] = []
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title) errors.push('Название не может быть пустым')
  else if (title.length > CUSTOM_TITLE_MAX) errors.push(`Название длиннее ${CUSTOM_TITLE_MAX} знаков`)

  if (!PILLARS.includes(input.pillar)) {
    errors.push('Неизвестный столп')
    return errors
  }

  if (!Array.isArray(input.equipment) || input.equipment.length === 0) {
    errors.push('Нужен хотя бы один вариант инвентаря')
  } else if (!input.equipment.every(isEquipment)) {
    errors.push('Неизвестный инвентарь')
  }

  if (!INPUTS_BY_PILLAR[input.pillar].includes(input.input)) {
    errors.push(`Для этого столпа не подходит ввод «${INPUT_TITLE[input.input] ?? String(input.input)}»`)
  }

  if (input.technique !== undefined && (typeof input.technique !== 'string' || input.technique.length > CUSTOM_TECHNIQUE_MAX)) {
    errors.push(`Техника: строка не длиннее ${CUSTOM_TECHNIQUE_MAX} знаков`)
  }

  if (input.pillar === 'strength') {
    const groups = input.groups
    if (!Array.isArray(groups) || groups.length < 1 || groups.length > 2) errors.push('Сила: одна или две группы мышц')
    else if (!groups.every(g => MUSCLE_GROUPS.includes(g)) || new Set(groups).size !== groups.length) {
      errors.push('Сила: группы мышц не распознаны или повторяются')
    }
  } else if (input.groups && input.groups.length > 0) {
    errors.push('Группы мышц задаются только для силы')
  }

  if (input.pillar === 'mobility') {
    if (!input.zone || !MOBILITY_ZONES.includes(input.zone)) errors.push('Мобильность: нужна зона')
  } else if (input.zone) {
    errors.push('Зона задаётся только для мобильности')
  }

  if (input.pillar === 'zone2' || input.pillar === 'intervals') {
    if (!input.cardioMode || !CARDIO_MODES.includes(input.cardioMode)) errors.push('Нужен вид кардио')
  } else if (input.cardioMode) {
    errors.push('Вид кардио задаётся только для зоны 2 и интервалов')
  }

  const d = input.defaults
  if (!d || typeof d !== 'object') {
    errors.push('Нужны умолчания')
    return errors
  }
  if (!isPositiveInt(d.sets) || d.sets > SETS_MAX) errors.push(`Подходов: целое от 1 до ${SETS_MAX}`)

  const timed = input.input === 'time' || input.input === 'time-side'
  if (input.pillar === 'zone2') {
    if (!isPositiveInt(d.minutes)) errors.push('Зона 2: нужны минуты по умолчанию, целое от 1')
  } else if (input.pillar === 'intervals') {
    if (typeof d.protocolId !== 'string' || d.protocolId.trim() === '') errors.push('Интервалы: нужен протокол')
  } else if (timed) {
    checkRange(d.seconds, 'Секунды', errors)
    if (d.reps) errors.push('Для ввода по времени повторы не задаются')
  } else {
    checkRange(d.reps, 'Повторы', errors)
    if (d.seconds) errors.push('Для ввода по повторам секунды не задаются')
  }
  if (input.input === 'time-side' && d.perSide === false) errors.push('Ввод «время на сторону» всегда на каждую сторону')

  return errors
}

/** Новое своё упражнение. Бросает RangeError с перечнем ошибок, если ввод
    не проходит validateCustomExercise. Время и случайность приходят снаружи. */
export function newCustomExercise(
  input: CustomExerciseInput,
  now: Millis = Date.now(),
  random: () => number = Math.random,
): Exercise {
  const errors = validateCustomExercise(input)
  if (errors.length > 0) throw new RangeError(`Своё упражнение не создано: ${errors.join('; ')}`)

  const defaults: ExerciseDefaults = { sets: input.defaults.sets }
  if (input.defaults.reps) defaults.reps = [input.defaults.reps[0], input.defaults.reps[1]]
  if (input.defaults.seconds) defaults.seconds = [input.defaults.seconds[0], input.defaults.seconds[1]]
  if (input.defaults.minutes !== undefined) defaults.minutes = input.defaults.minutes
  if (input.defaults.protocolId) defaults.protocolId = input.defaults.protocolId.trim()
  if (input.defaults.perSide || input.input === 'time-side') defaults.perSide = true

  const exercise: Exercise = {
    id: makeId('ex', now, random),
    title: input.title.trim(),
    pillar: input.pillar,
    equipment: [...new Set(input.equipment)],
    input: input.input,
    defaults,
    technique: (input.technique ?? '').trim(),
    custom: true,
  }
  if (input.pillar === 'strength') exercise.groups = [...(input.groups as MuscleGroup[])]
  if (input.pillar === 'mobility') exercise.zone = input.zone
  if (input.cardioMode) exercise.cardioMode = input.cardioMode
  return exercise
}
