import type {
  AppState, DateISO, ExerciseLibrary, MuscleGroup, Pillar, PillarProgress, Place, Program, ProgramPhase, ProgramProgress,
  Template, WeekSummary,
} from './types'
import { PILLARS } from './types'
import { PILLAR_TITLE } from './pillars'
import { addDays, weekdayIndexMon, weekStartOf } from './dates'
import type { ProgramPosition } from './program'
import type { WeekSettings } from './week'
import {
  dayKeyFor, isDayCompleted, isProgramActive, isTrainingDay, measurementDue, programPosition, trainingDayNumber,
} from './program'
import { daysWord, minutesWord, sessionsWord, setsWord } from './plural'
import {
  STRENGTH_DAY_MIN_SETS, dayLoad, exerciseLookup, isSecondaryRequired, pillarDeficit, weekProgress,
} from './week'

/* «Что сегодня» (раздел 4.7 плана, экран 6.1). Чистая функция: часы, хранилище
   и библиотеки не читаются, всё приходит во входе. Ядро не импортирует src/data. */

export const EVENING_HOUR = 20                      // с этого часа интервалы не предлагаются
export const RECOVERY_GROUP_SETS = 6                // группа мышц «занята», если за вчера и сегодня набрано столько подходов
export const DAILY_LIGHT_PHASES: readonly string[] = ['f0', 'f1', 'f2']
export const MAX_ALTERNATIVES = 2                   // всего до трёх подсказок: основная и две запасные

const HEAVY: readonly Pillar[] = ['strength', 'intervals']

export interface ActiveProgram {
  program: Program
  progress: ProgramProgress
}

export interface WhatTodayInput {
  state: AppState
  today: DateISO
  localHour: number                    // местный час 0-23; от EVENING_HOUR включительно считается вечером
  library: ExerciseLibrary             // встроенные упражнения; пользовательские берутся из state
  templates: readonly Template[]       // встроенные и пользовательские шаблоны
  place?: Place                        // фильтр по месту; без него берётся место последней сессии
  program?: ActiveProgram | null       // активная программа и её прогресс
  settings?: WeekSettings              // цели недели и данные для зон пульса; без него state.settings
}

export type SuggestionKind = 'program' | 'template' | 'daily-light' | 'external' | 'rest'

export interface Suggestion {
  kind: SuggestionKind
  pillar: Pillar | null                // null: подсказка не про один столп (закрытая неделя, программа без столпа)
  title: string
  reason: string                       // текст для экрана
  templateId?: string
  programDayKey?: string
}

export interface ProgramToday {
  phaseIndex: number
  phase: ProgramPhase
  week: number                         // сквозная неделя программы, с 1
  weekInPhase: number
  dayKey: string
  dayTitle: string
  dayNumber: number                    // номер тренировочного дня в неделе, с 1
  daysPerWeek: number
  deload: boolean
  measurementDue: boolean               // пора мерить максимум (раз в measurement.everyDays суток)
}

export interface WhatToday {
  primary: Suggestion
  alternatives: Suggestion[]           // не больше MAX_ALTERNATIVES
  dailyLight: Suggestion | null        // строка «ежедневная мелочь» программы фаз f0-f2
  programToday: ProgramToday | null    // день программы на сегодня, если он есть и не отмечен
  summary: WeekSummary
  daysLeft: number                     // дней до воскресенья включительно: понедельник 7, воскресенье 1
}

/* ---- программа ---- */

/* Сегодняшний тренировочный день активной программы, либо null: программа
   остановлена, не началась или кончилась, сегодня не тренировочный день недели
   или день уже отмечен выполненным. Неделя, фаза, ключ дня, разгрузка и замер
   считаются функциями program.ts: здесь своей арифметики программы нет. */
export function programToday(active: ActiveProgram | null | undefined, today: DateISO): ProgramToday | null {
  const live = liveProgram(active, today)
  if (!live) return null
  const { program, progress, position } = live
  if (!isTrainingDay(progress, today) || isDayCompleted(progress, today)) return null
  const { phase } = position
  if (phase.rotation.length === 0) return null
  const dayKey = dayKeyFor(progress, phase)
  const day = phase.days.find(d => d.key === dayKey)
  if (!day) return null

  return {
    phaseIndex: position.phaseIndex,
    phase,
    week: position.week,
    weekInPhase: position.weekInPhase,
    dayKey,
    dayTitle: day.title,
    dayNumber: trainingDayNumber(progress, today),
    daysPerWeek: progress.trainingWeekdays.length,
    deload: position.deload,
    measurementDue: measurementDue(progress, today, program.measurement.everyDays),
  }
}

interface LiveProgram {
  program: Program
  progress: ProgramProgress
  position: ProgramPosition
}

/* Программа идёт: не остановлена, началась, срок не вышел, прогресс её, фазы есть. */
function liveProgram(active: ActiveProgram | null | undefined, today: DateISO): LiveProgram | null {
  if (!active) return null
  const { program, progress } = active
  if (!isProgramActive(progress)) return null
  if (progress.programId !== program.id || program.phases.length === 0) return null
  const position = programPosition(program, progress, today)
  if (position.week < 1 || position.week > program.weeks) return null
  return { program, progress, position }
}

function dailyLightSuggestion(
  active: ActiveProgram | null | undefined, today: DateISO, state: AppState, templates: readonly Template[],
): Suggestion | null {
  const live = liveProgram(active, today)
  if (!live) return null
  const eligible = live.position.phase.dailyLight ?? DAILY_LIGHT_PHASES.includes(live.position.phase.id)
  if (!eligible) return null
  const templateId = live.program.dailyLightTemplateId
  const doneToday = Object.values(state.sessions ?? {}).some(
    s => s != null && s.date === today && s.templateId === templateId,
  )
  if (doneToday) return null
  const template = templates.find(t => t.id === templateId)
  return {
    kind: 'daily-light',
    pillar: null,
    title: template?.title ?? 'Ежедневная мелочь',
    reason: `Фаза «${live.position.phase.title}»: короткая запись одним касанием, в недельный зачёт не идёт.`,
    templateId,
  }
}

/* ---- восстановление ---- */

/* Группы мышц, получившие от шести рабочих подходов суммарно за вчера и сегодня. */
export function recentlyTrainedGroups(
  state: AppState, today: DateISO, library?: ExerciseLibrary,
): Set<MuscleGroup> {
  const a = dayLoad(state, today, library).groups
  const b = dayLoad(state, addDays(today, -1), library).groups
  const out = new Set<MuscleGroup>()
  for (const g of Object.keys(a) as MuscleGroup[]) {
    if (a[g] + b[g] >= RECOVERY_GROUP_SETS) out.add(g)
  }
  return out
}

/* Группы мышц, которые нагружает шаблон (по силовым упражнениям). */
function templateGroups(template: Template, lookup: ExerciseLibrary): Set<MuscleGroup> {
  const out = new Set<MuscleGroup>()
  for (const item of template.items) {
    const ex = lookup[item.exerciseId]
    if (ex?.pillar !== 'strength') continue
    for (const g of ex.groups ?? []) out.add(g)
  }
  return out
}

/* Силовой шаблон заблокирован, если не меньше половины его групп мышц заняты. */
function strengthBlocked(template: Template, trained: Set<MuscleGroup>, lookup: ExerciseLibrary): boolean {
  const groups = templateGroups(template, lookup)
  if (groups.size === 0 || trained.size === 0) return false
  let busy = 0
  for (const g of groups) if (trained.has(g)) busy++
  return busy * 2 >= groups.size
}

/* ---- выбор шаблона ---- */

function lastUsedMap(state: AppState): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of countedSessionsAll(state)) {
    if (!s.templateId) continue
    const prev = out.get(s.templateId)
    if (prev === undefined || s.startedAt > prev) out.set(s.templateId, s.startedAt)
  }
  return out
}

/* Для истории использования шаблонов берём и исключённые из недели сессии
   (ежедневная мелочь), поэтому countedSessions здесь не годится. */
function countedSessionsAll(state: AppState) {
  return Object.values(state.sessions ?? {}).filter(s => s != null && typeof s.endedAt === 'number')
}

function lastPlace(state: AppState): Place | undefined {
  let best: { at: number; place: Place } | undefined
  for (const s of countedSessionsAll(state)) {
    if (!best || s.startedAt > best.at) best = { at: s.startedAt, place: s.place }
  }
  return best?.place
}

/* Шаблоны столпа в порядке предпочтения: сначала те, у которых он главный,
   внутри группы самый давний по использованию первым (для силы это и есть
   ротация A, B, C), при равенстве порядок входа. */
function rankedTemplates(
  pillar: Pillar, templates: readonly Template[], place: Place | undefined, used: Map<string, number>,
): Template[] {
  const matching = templates
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => !t.excludeFromWeek && t.pillars.includes(pillar))
    .filter(({ t }) => place === undefined || t.place === 'any' || t.place === place)
  const rank = ({ t }: { t: Template }) => (t.pillars[0] === pillar ? 0 : 1)
  matching.sort((a, b) =>
    rank(a) - rank(b) ||
    (used.get(a.t.id) ?? -Infinity) - (used.get(b.t.id) ?? -Infinity) ||
    a.index - b.index)
  return matching.map(m => m.t)
}

/* ---- тексты ---- */

function remainingText(p: PillarProgress): string {
  const parts: string[] = []
  const left = Math.ceil(p.target - p.value)
  if (left > 0) {
    if (p.unit === 'sets') parts.push(`${left} ${setsWord(left)}`)
    else if (p.unit === 'minutes') parts.push(`${left} ${minutesWord(left)}`)
    else parts.push(`${left} ${sessionsWord(left)}`)
  }
  const s = p.secondary
  if (s && isSecondaryRequired(p.pillar)) {
    const daysLeft = Math.ceil(s.target - s.value)
    if (daysLeft > 0) parts.push(`${daysLeft} ${daysWord(daysLeft)}`)
  }
  return parts.join(' и ')
}

function pressureReason(p: PillarProgress, daysLeft: number): string {
  const tail = daysLeft === 1 ? 'сегодня последний день недели' : `до конца недели ${daysLeft} ${daysWord(daysLeft)}`
  return `${PILLAR_TITLE[p.pillar]}: осталось ${remainingText(p)}, ${tail}.`
}

/* ---- основная функция ---- */

interface Pending {
  pillar: Pillar
  progress: PillarProgress
  pressure: number
}

export function whatToday(input: WhatTodayInput): WhatToday {
  const { state, today, library, templates } = input
  const lookup = exerciseLookup(state, library)
  const summary = weekProgress(state, weekStartOf(today), input.settings, library)
  const daysLeft = 7 - weekdayIndexMon(today)
  const evening = Number.isFinite(input.localHour) && input.localHour >= EVENING_HOUR
  const place = input.place ?? lastPlace(state)
  const used = lastUsedMap(state)

  const loadToday = dayLoad(state, today, library)
  const loadYesterday = dayLoad(state, addDays(today, -1), library)
  const trained = recentlyTrainedGroups(state, today, library)
  const strengthDoneToday = loadToday.workingSets >= STRENGTH_DAY_MIN_SETS
  const intervalsDoneToday = loadToday.intervalSessions > 0
  const heavyDoneToday = strengthDoneToday || intervalsDoneToday

  const programDay = programToday(input.program, today)
  const dailyLight = dailyLightSuggestion(input.program, today, state, templates)

  const pending: Pending[] = PILLARS
    .filter(p => !summary.pillars[p].done)
    .map(p => ({
      pillar: p,
      progress: summary.pillars[p],
      pressure: pillarDeficit(summary.pillars[p]) / daysLeft,
    }))
    .sort((a, b) => b.pressure - a.pressure || PILLARS.indexOf(a.pillar) - PILLARS.indexOf(b.pillar))

  const eligible: Pending[] = []
  const skipped: Suggestion[] = []
  const skip = (pillar: Pillar, title: string, reason: string): void => {
    skipped.push({ kind: 'rest', pillar, title: `${PILLAR_TITLE[pillar]}: ${title}`, reason })
  }
  const zone2Pending = pending.some(p => p.pillar === 'zone2')

  for (const item of pending) {
    const { pillar } = item
    if (pillar === 'intervals' && evening) {
      skip(pillar, 'не вечером', zone2Pending
        ? `После ${EVENING_HOUR}:00 интервалы мешают сну, перед сном лучше зона 2.`
        : `После ${EVENING_HOUR}:00 интервалы мешают сну, лучше завтра.`)
      continue
    }
    if (pillar === 'intervals' && (intervalsDoneToday || loadYesterday.intervalSessions > 0)) {
      skip(pillar, 'отдых', intervalsDoneToday
        ? 'Интервалы после сегодняшней сессии: отдых.'
        : 'Интервалы были вчера: отдых после вчерашнего.')
      continue
    }
    if (pillar === 'strength' && programDay) continue    // силовой слот занят днём программы
    if (pillar === 'strength' && strengthDoneToday) {
      skip(pillar, 'отдых', 'Отдых после сегодняшней тренировки: эти группы мышц ещё заняты.')
      continue
    }
    if (HEAVY.includes(pillar) && heavyDoneToday) {
      skip(pillar, 'завтра', pillar === 'intervals'
        ? 'Интервалы лучше завтра: сегодня тяжёлая нагрузка уже была.'
        : 'Силу лучше завтра: сегодня тяжёлая нагрузка уже была.')
      continue
    }
    eligible.push(item)
  }

  // Один тяжёлый столп в день: если день программы или другой тяжёлый столп уже занял слот.
  let heavyTaken = programDay !== null
  const suggestions: Suggestion[] = []
  for (const item of eligible) {
    const { pillar, progress } = item
    if (HEAVY.includes(pillar)) {
      if (heavyTaken) {
        skip(pillar, 'завтра', pillar === 'intervals'
          ? 'Интервалы лучше завтра: сегодня одна тяжёлая тренировка.'
          : 'Силу лучше завтра: сегодня одна тяжёлая тренировка.')
        continue
      }
    }
    const ranked = rankedTemplates(pillar, templates, place, used)
    if (ranked.length === 0) {
      suggestions.push({
        kind: 'external',
        pillar,
        title: `${PILLAR_TITLE[pillar]}: занятие вне приложения`,
        reason: `${pressureReason(progress, daysLeft)} Подходящего шаблона нет, можно записать занятие вручную.`,
      })
      if (HEAVY.includes(pillar)) heavyTaken = true
      continue
    }
    const pick = pillar === 'strength' ? ranked.find(t => !strengthBlocked(t, trained, lookup)) : ranked[0]
    if (!pick) {
      skip(pillar, 'отдых', loadToday.workingSets > 0
        ? 'Отдых после сегодняшней тренировки: эти группы мышц ещё заняты.'
        : 'Отдых после вчерашнего: эти группы мышц ещё не восстановились.')
      continue
    }
    suggestions.push({
      kind: 'template',
      pillar,
      title: pick.title,
      reason: pressureReason(progress, daysLeft),
      templateId: pick.id,
    })
    if (HEAVY.includes(pillar)) heavyTaken = true
  }

  const ordered: Suggestion[] = []
  if (programDay) {
    ordered.push({
      kind: 'program',
      pillar: 'strength',
      title: `День программы: неделя ${programDay.week}, день ${programDay.dayNumber}`,
      reason: `${programDay.dayTitle}, фаза «${programDay.phase.title}».` +
        (programDay.deload ? ' Разгрузочная неделя: подходов меньше.' : '') +
        (programDay.measurementDue ? ' Пора замерить максимум.' : ''),
      programDayKey: programDay.dayKey,
    })
  }
  ordered.push(...suggestions, ...skipped)
  if (summary.allDone || ordered.length === 0) {
    ordered.push({
      kind: 'rest',
      pillar: null,
      title: 'Неделя закрыта',
      reason: 'Все пять столпов выполнены. Лёгкое движение по желанию.',
    })
  }

  return {
    primary: ordered[0],
    alternatives: ordered.slice(1, 1 + MAX_ALTERNATIVES),
    dailyLight,
    programToday: programDay,
    summary,
    daysLeft,
  }
}
