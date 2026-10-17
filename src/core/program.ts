import { addDays, daysBetween, isDateISO, todayLocal, weekStartOf, weekdayIndexMon } from './dates'
import type {
  DateISO, Millis, Program, ProgramDay, ProgramDayItem, ProgramPhase, ProgramProgress, ProgramRef,
  Template, TemplateItem,
} from './types'

/* Логика программы тренировок: сквозная неделя, фаза, ротация дней, разгрузка,
   замер, застой, переход между фазами. Ядро не знает, какая это программа:
   Program приходит параметром. Время (today, now) тоже параметры. */

export const DELOAD_FACTOR = 0.6
export const MEASUREMENT_EVERY_DAYS = 14
/* Через сколько недель сверх плана фазы показывается подсказка про застой. */
export const STAGNATION_AFTER_WEEKS = 3
/* Прикидка длительности подхода и отдыха для estMinutes, когда данных нет. */
const ESTIMATE_WORK_SEC = 40
const ESTIMATE_REST_SEC = 90

export interface TotalRepsGoal { kind: 'total-reps'; reps: number }

/* Template для старта сессии плюс то, что в Template не помещается:
   programRef кладётся в Session.programRef, goals - по индексу элемента
   items - в StrengthItem.goal («плотность»: 25 повторений за минимум подходов). */
export interface ProgramDayTemplate extends Template {
  programRef: ProgramRef
  goals: Record<number, TotalRepsGoal>
}

export interface ProgramPosition {
  week: number                    // сквозная неделя от startedOn, 0 - программа ещё не началась
  phaseIndex: number              // фаза по подтверждению человека
  phase: ProgramPhase
  weekInPhase: number             // 1 - первая неделя текущей фазы; может превысить phaseWeeks
  phaseWeeks: number              // длина фазы по плану
  overdueWeeks: number            // сколько недель сверх плана фазы
  deload: boolean
  calendarPhaseIndex: number      // фаза по календарю (ориентир)
}

function assertProgress(program: Program, progress: ProgramProgress): void {
  if (progress.programId !== program.id) {
    throw new RangeError(`Прогресс относится к программе ${JSON.stringify(progress.programId)}, а не к ${JSON.stringify(program.id)}`)
  }
}

/* ---- запуск и остановка ---- */

/* null, если три дня подходят, иначе причина текстом для экрана выбора дней.
   0 = понедельник. «Не подряд» считается по кругу недели: вс и пн рядом. */
export function validateTrainingWeekdays(days: readonly number[]): string | null {
  if (!Array.isArray(days) || days.length !== 3) return 'Нужно выбрать ровно три дня недели'
  if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return 'День недели - целое число от 0 (понедельник) до 6 (воскресенье)'
  const sorted = [...days].sort((a, b) => a - b)
  if (new Set(sorted).size !== 3) return 'Дни не должны повторяться'
  for (let i = 0; i < 3; i++) {
    const gap = (sorted[(i + 1) % 3] - sorted[i] + 7) % 7
    if (gap < 2) return 'Тяжёлые дни не должны идти подряд: между ними нужен день отдыха'
  }
  return null
}

/* Старт: неделя 1 начинается с понедельника недели startDate. */
export function startProgram(program: Program, startDate: DateISO, trainingWeekdays: readonly number[]): ProgramProgress {
  const problem = validateTrainingWeekdays(trainingWeekdays)
  if (problem) throw new RangeError(problem)
  if (program.phases.length === 0) throw new RangeError(`В программе ${program.id} нет фаз`)
  return {
    programId: program.id,
    startedOn: weekStartOf(startDate),
    trainingWeekdays: [...trainingWeekdays].sort((a, b) => a - b),
    phaseIndex: 0,
    phaseStartedWeek: 1,
    completedDays: [],
    measurements: [],
  }
}

export function isProgramActive(progress: ProgramProgress): boolean {
  return progress.stoppedAt === undefined
}

/* Повторная остановка время не перезаписывает. */
export function stopProgram(progress: ProgramProgress, now: Millis): ProgramProgress {
  if (progress.stoppedAt !== undefined) return progress
  return { ...progress, stoppedAt: now }
}

/* ---- неделя, фаза, разгрузка ---- */

/* Сквозная неделя: 1 - неделя с startedOn; 0, если today раньше старта. */
export function programWeek(progress: ProgramProgress, today: DateISO): number {
  const days = daysBetween(progress.startedOn, today)
  return days < 0 ? 0 : Math.floor(days / 7) + 1
}

/* Каждая deloadEveryWeeks-я неделя от старта (4, 8, 12, ...). */
export function isDeloadWeek(program: Program, week: number): boolean {
  const every = program.deloadEveryWeeks
  return every > 0 && Number.isInteger(week) && week > 0 && week % every === 0
}

/* Фаза по календарю: за пределами сетки - ближайшая крайняя. */
export function calendarPhaseIndex(program: Program, week: number): number {
  const found = program.phases.findIndex(p => week >= p.weeks[0] && week <= p.weeks[1])
  if (found >= 0) return found
  return week < program.phases[0].weeks[0] ? 0 : program.phases.length - 1
}

function currentPhaseIndex(program: Program, progress: ProgramProgress): number {
  const last = program.phases.length - 1
  const i = progress.phaseIndex
  return Number.isInteger(i) ? Math.min(Math.max(i, 0), last) : 0
}

/* Текущая фаза - та, что человек подтвердил (phaseIndex), а не календарная. */
export function phaseFor(program: Program, progress: ProgramProgress): ProgramPhase {
  return program.phases[currentPhaseIndex(program, progress)]
}

export function programPosition(program: Program, progress: ProgramProgress, today: DateISO): ProgramPosition {
  assertProgress(program, progress)
  const week = programWeek(progress, today)
  const phaseIndex = currentPhaseIndex(program, progress)
  const phase = program.phases[phaseIndex]
  const startedWeek = Number.isInteger(progress.phaseStartedWeek) && progress.phaseStartedWeek >= 1 ? progress.phaseStartedWeek : 1
  const weekInPhase = week < 1 ? 0 : Math.max(1, week - startedWeek + 1)
  const phaseWeeks = phase.weeks[1] - phase.weeks[0] + 1
  return {
    week,
    phaseIndex,
    phase,
    weekInPhase,
    phaseWeeks,
    overdueWeeks: Math.max(0, weekInPhase - phaseWeeks),
    deload: isDeloadWeek(program, week),
    calendarPhaseIndex: calendarPhaseIndex(program, Math.max(week, 1)),
  }
}

/* ---- ротация дней ---- */

/* Следующий день ротации - по числу выполненных дней текущей фазы, поэтому
   пропуск сетку не сдвигает: A-B-A, затем B-A-B для ротации [A, B]. Дни до
   подтверждённого перехода (exitConfirmedAt, по местной дате) в счёт не идут. */
export function dayKeyFor(progress: ProgramProgress, phase: ProgramPhase): string {
  if (phase.rotation.length === 0) throw new RangeError(`В фазе ${phase.id} пустая ротация дней`)
  const confirmedAt = progress.exitConfirmedAt
  const cutoff: DateISO | null = confirmedAt !== undefined && Number.isFinite(confirmedAt)
    ? todayLocal(new Date(confirmedAt))
    : null
  const done = progress.completedDays.filter(d => isDateISO(d.date) && (cutoff === null || d.date > cutoff)).length
  return phase.rotation[done % phase.rotation.length]
}

export function isTrainingDay(progress: ProgramProgress, today: DateISO): boolean {
  if (!isProgramActive(progress)) return false
  if (programWeek(progress, today) < 1) return false
  return progress.trainingWeekdays.includes(weekdayIndexMon(today))
}

export function isDayCompleted(progress: ProgramProgress, today: DateISO): boolean {
  return progress.completedDays.some(d => d.date === today)
}

/* Дни программы, отмеченные выполненными; повтор того же sessionId игнорируется. */
export function completeProgramDay(
  progress: ProgramProgress,
  entry: { date: DateISO; dayKey: string; sessionId: string },
): ProgramProgress {
  if (!isDateISO(entry.date)) throw new RangeError(`Некорректная дата: ${JSON.stringify(entry.date)}`)
  if (progress.completedDays.some(d => d.sessionId === entry.sessionId)) return progress
  return { ...progress, completedDays: [...progress.completedDays, { ...entry }] }
}

/* ---- день программы как шаблон ---- */

/* Какие элементы дня видны на неделе фазы w. Элемент с fromWeekInPhase N > 1
   заменяет предыдущий элемент списка (негатив -> полное упражнение), пока N не
   наступила, видно предыдущий. fromWeekInPhase 1 - просто «с начала фазы». */
export function visibleItems(items: readonly ProgramDayItem[], weekInPhase: number): ProgramDayItem[] {
  const from = (item: ProgramDayItem | undefined): number => item?.fromWeekInPhase ?? 1
  return items.filter((item, i) => {
    if (from(item) > weekInPhase) return false
    const next = items[i + 1]
    return !(next !== undefined && from(next) > 1 && from(next) <= weekInPhase)
  })
}

function scaleCount(n: number, deload: boolean): number {
  return deload ? Math.max(1, Math.round(n * DELOAD_FACTOR)) : n
}

function toTemplateItem(item: ProgramDayItem, deload: boolean): { item: TemplateItem; goal?: TotalRepsGoal } {
  const out: TemplateItem = { exerciseId: item.exerciseId, sets: scaleCount(item.sets, deload) }
  let cue = item.cue
  if (item.ladder !== undefined && item.ladder.length > 0) {
    // Круг лесенки без отдыха между ступенями записывается одним подходом.
    const circle = item.ladder.reduce((a, b) => a + b, 0)
    out.reps = circle
    const head = `Круг лесенки ${item.ladder.join('-')} (${circle} повторений) без отдыха между ступенями.`
    cue = cue ? `${head} ${cue}` : head
  } else if (item.reps !== undefined) {
    out.reps = Array.isArray(item.reps) ? [item.reps[0], item.reps[1]] : item.reps
  }
  if (item.seconds !== undefined) out.seconds = item.seconds
  if (item.restSec !== undefined) out.restSec = item.restSec
  if (cue !== undefined) out.cue = cue
  if (item.goal === undefined) return { item: out }
  return { item: out, goal: { kind: 'total-reps', reps: scaleCount(item.goal.reps, deload) } }
}

function estimateMinutes(items: readonly TemplateItem[]): number {
  let sec = 0
  for (const it of items) {
    sec += (it.sets ?? 1) * ((it.seconds ?? ESTIMATE_WORK_SEC) + (it.restSec ?? ESTIMATE_REST_SEC))
  }
  return Math.max(1, Math.round(sec / 60))
}

function findDay(phase: ProgramPhase, key: string): ProgramDay {
  const day = phase.days.find(d => d.key === key)
  if (!day) throw new RangeError(`В фазе ${phase.id} нет дня ${JSON.stringify(key)}`)
  return day
}

/* Шаблон тренировки на сегодня: день по ротации, элементы по неделе фазы,
   подходы и круги лесенки x0,6 с округлением (минимум 1) на разгрузочной
   неделе; на ней же цель «плотности» масштабируется так же. */
export function programDayTemplate(program: Program, progress: ProgramProgress, today: DateISO): ProgramDayTemplate {
  if (!isProgramActive(progress)) throw new RangeError('Программа остановлена')
  const pos = programPosition(program, progress, today)
  if (pos.week < 1) throw new RangeError(`Программа начинается ${progress.startedOn}, сегодня ${today}`)
  const dayKey = dayKeyFor(progress, pos.phase)
  const day = findDay(pos.phase, dayKey)

  const items: TemplateItem[] = []
  const goals: Record<number, TotalRepsGoal> = {}
  for (const src of visibleItems(day.items, pos.weekInPhase)) {
    const built = toTemplateItem(src, pos.deload)
    if (built.goal) goals[items.length] = built.goal
    items.push(built.item)
  }

  return {
    id: `${program.id}-${pos.phase.id}-${dayKey.toLowerCase()}`,
    title: `${pos.phase.title}: ${day.title}${pos.deload ? ' (разгрузка)' : ''}`,
    place: 'any',
    pillars: ['strength'],
    items,
    estMinutes: estimateMinutes(items),
    source: 'program',
    programRef: { programId: program.id, phaseId: pos.phase.id, dayKey, week: pos.week, deload: pos.deload },
    goals,
  }
}

/* ---- замер максимума ---- */

/* Замер положен, если с последнего (или со старта) прошло не меньше everyDays
   суток. Записи с битой датой игнорируются. */
export function measurementDue(
  progress: ProgramProgress,
  today: DateISO,
  everyDays: number = MEASUREMENT_EVERY_DAYS,
): boolean {
  if (!isProgramActive(progress)) return false
  if (programWeek(progress, today) < 1) return false
  let last: DateISO = progress.startedOn
  for (const m of progress.measurements) {
    if (isDateISO(m.date) && m.date > last) last = m.date
  }
  return daysBetween(last, today) >= everyDays
}

export function addMeasurement(progress: ProgramProgress, date: DateISO, reps: number): ProgramProgress {
  if (!isDateISO(date)) throw new RangeError(`Некорректная дата: ${JSON.stringify(date)}`)
  if (!Number.isInteger(reps) || reps < 0) throw new RangeError(`Повторения замера: целое неотрицательное, получено ${reps}`)
  return { ...progress, measurements: [...progress.measurements, { date, reps }] }
}

/* ---- застой ---- */

/* Недели сверх плана текущей фазы: счётчик «неделя 12 из 11» даёт 1. */
export function overdueWeeks(program: Program, progress: ProgramProgress, today: DateISO): number {
  return programPosition(program, progress, today).overdueWeeks
}

/* Тексты застоя, когда фаза идёт на STAGNATION_AFTER_WEEKS недель и больше
   сверх плана; иначе пустой список. */
export function stagnationHint(program: Program, progress: ProgramProgress, today: DateISO): string[] {
  if (!isProgramActive(progress)) return []
  return overdueWeeks(program, progress, today) >= STAGNATION_AFTER_WEEKS ? [...program.stagnation] : []
}

/* ---- переход между фазами ---- */

export function isLastPhase(program: Program, progress: ProgramProgress): boolean {
  return currentPhaseIndex(program, progress) === program.phases.length - 1
}

/* Все пункты чек-листа выхода отмечены вручную. */
export function exitChecklistComplete(phase: ProgramPhase, checked: readonly boolean[]): boolean {
  return phase.exit.length > 0 && checked.length === phase.exit.length && checked.every(c => c === true)
}

/* Переход в следующую фазу после ручного подтверждения чек-листа. Новая фаза
   начинается с текущей недели; now запоминается в exitConfirmedAt, и дни,
   выполненные до этой даты включительно, в ротацию новой фазы не идут.
   Из последней фазы перехода нет: программа заканчивается остановкой. */
export function advancePhase(program: Program, progress: ProgramProgress, today: DateISO, now: Millis): ProgramProgress {
  assertProgress(program, progress)
  if (!isProgramActive(progress)) throw new RangeError('Программа остановлена')
  if (isLastPhase(program, progress)) throw new RangeError('Это последняя фаза: переходить некуда')
  const week = programWeek(progress, today)
  if (week < 1) throw new RangeError(`Программа начинается ${progress.startedOn}, сегодня ${today}`)
  return {
    ...progress,
    phaseIndex: currentPhaseIndex(program, progress) + 1,
    phaseStartedWeek: week,
    exitConfirmedAt: now,
  }
}

/* Понедельник сквозной недели week (для подписей и ориентира в календаре). */
export function weekStartDate(progress: ProgramProgress, week: number): DateISO {
  return addDays(progress.startedOn, (week - 1) * 7)
}
