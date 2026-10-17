import { canDoHere } from './library'
import { PILLARS } from './pillars'
import { CUSTOM_PROTOCOL_ID } from './session'
import type {
  AppState, Equipment, Exercise, ExerciseLibrary, IntervalProtocol, Millis, Pillar, Place, ProtocolLibrary, Split,
  Template, TemplateItem,
} from './types'

/* Работа с шаблонами: что выполнимо в месте, какие столпы закрывает шаблон и
   сколько на это уходит минут, когда шаблон запускали в последний раз.
   Шаблоны, библиотека и протоколы приходят параметрами (ядро не импортирует src/data). */

/* Допущения оценки времени. Оценка грубая: она нужна, чтобы показать «около N минут
   силы», а не чтобы вести секундомер. Разминка и смена снаряда в неё не входят. */
const SECONDS_PER_REP = 3
const MAX_REPS_GUESS = 10
const STRENGTH_REST_SEC = 60
const HOLD_TRANSITION_SEC = 5
const EXERCISE_SETUP_SEC = 10

/** Шаблоны, которые можно выполнить здесь: место совпадает или шаблон на любое
    место, и для каждого упражнения есть подходящий инвентарь. Шаблон со ссылкой
    на удалённое упражнение остаётся в списке: экран помечает его через
    missingExercises, а не прячет без объяснения. Порядок входа сохраняется. */
export function templatesFor(
  templates: readonly Template[],
  place: Place,
  equipment: readonly Equipment[],
  library: ExerciseLibrary,
): Template[] {
  return templates.filter(template => {
    if (template.place !== 'any' && template.place !== place) return false
    return template.items.every(item => {
      const exercise = library[item.exerciseId]
      return exercise === undefined || canDoHere(exercise, equipment)
    })
  })
}

/** Id упражнений шаблона, которых нет в библиотеке (удалены), без повторов, в порядке шаблона. */
export function missingExercises(template: Template, library: ExerciseLibrary): string[] {
  const missing: string[] = []
  for (const item of template.items) {
    if (library[item.exerciseId] === undefined && !missing.includes(item.exerciseId)) missing.push(item.exerciseId)
  }
  return missing
}

/** Время последнего запуска шаблона: окончание самой свежей тренировки по нему
    (у тренировки без окончания - начало). null, если шаблон не запускали. */
export function lastUsedAt(state: Pick<AppState, 'sessions'>, templateId: string): Millis | null {
  let last: Millis | null = null
  for (const session of Object.values(state.sessions)) {
    if (session.templateId !== templateId) continue
    const at = session.endedAt ?? session.startedAt
    if (last === null || at > last) last = at
  }
  return last
}

export interface TemplateCoverage {
  /** Закрываемые столпы в порядке PILLARS. */
  pillars: Pillar[]
  /** Примерные минуты по каждому закрытому столпу, целые, не меньше 1. */
  minutes: Split
}

const midpoint = ([lo, hi]: readonly [number, number]): number => (lo + hi) / 2

function repsOf(item: TemplateItem, exercise: Exercise): number {
  if (item.reps === 'max') return MAX_REPS_GUESS
  if (typeof item.reps === 'number') return item.reps
  if (item.reps) return midpoint(item.reps)
  return exercise.defaults.reps ? midpoint(exercise.defaults.reps) : MAX_REPS_GUESS
}

/* Секунды на один подход, без отдыха. */
function workSecOf(item: TemplateItem, exercise: Exercise): number {
  const timed = exercise.input === 'time' || exercise.input === 'time-side'
  if (item.seconds !== undefined) return item.seconds
  if (timed) return exercise.defaults.seconds ? midpoint(exercise.defaults.seconds) : 0
  return repsOf(item, exercise) * SECONDS_PER_REP
}

function holdOrSetSeconds(item: TemplateItem, exercise: Exercise): number {
  const sets = item.sets ?? exercise.defaults.sets
  const sides = (item.perSide ?? exercise.defaults.perSide ?? false) ? 2 : 1
  const rest = item.restSec ?? (exercise.pillar === 'strength' ? STRENGTH_REST_SEC : HOLD_TRANSITION_SEC)
  return sets * (workSecOf(item, exercise) * sides + rest) + EXERCISE_SETUP_SEC
}

function protocolSeconds(p: Pick<IntervalProtocol, 'warmupSec' | 'rounds' | 'workSec' | 'restSec' | 'cooldownSec'>): number {
  return p.warmupSec + p.rounds * (p.workSec + p.restSec) + p.cooldownSec
}

/** Столпы шаблона и примерные минуты каждого. Упражнения, которых нет в
    библиотеке, пропускаются. protocols нужны для интервалов: длительность берётся
    из протокола; без него интервальная часть получает остаток от estMinutes
    после остальных упражнений. */
export function templateCoverage(
  template: Template,
  library: ExerciseLibrary,
  protocols: ProtocolLibrary = [],
): TemplateCoverage {
  const seconds: Split = {}
  const add = (pillar: Pillar, sec: number): void => {
    seconds[pillar] = (seconds[pillar] ?? 0) + sec
  }
  let hasUnknownIntervals = false

  for (const item of template.items) {
    const exercise = library[item.exerciseId]
    if (!exercise) continue
    seconds[exercise.pillar] ??= 0
    if (exercise.pillar === 'zone2') {
      add('zone2', (item.minutes ?? exercise.defaults.minutes ?? 0) * 60)
    } else if (exercise.pillar === 'intervals') {
      const id = item.protocolId ?? exercise.defaults.protocolId
      // у своего протокола значения в строке шаблона, а не в библиотеке
      const protocol = id === CUSTOM_PROTOCOL_ID && item.customProtocol !== undefined
        ? { ...item.customProtocol }
        : protocols.find(p => p.id === id)
      if (protocol) add('intervals', protocolSeconds(protocol))
      else hasUnknownIntervals = true
    } else {
      add(exercise.pillar, holdOrSetSeconds(item, exercise))
    }
  }

  if (hasUnknownIntervals) {
    const known = Object.values(seconds).reduce((sum, s) => sum + s, 0)
    const rest = Math.max(0, template.estMinutes * 60 - known)
    add('intervals', rest)
  }

  const pillars = PILLARS.filter(p => seconds[p] !== undefined)
  const minutes: Split = {}
  for (const pillar of pillars) {
    minutes[pillar] = Math.max(1, Math.round((seconds[pillar] ?? 0) / 60))
  }
  return { pillars, minutes }
}
