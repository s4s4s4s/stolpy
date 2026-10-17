import type {
  AppState, DateISO, ExerciseLibrary, GoalsSource, MobilityZone, MuscleGroup, Pillar, PillarProgress, PillarUnit, Session,
  SessionItem, Settings, StrengthSet, WeekSummary, WeeklyGoals,
} from './types'
import { PILLARS } from './types'
import { PILLAR_UNIT } from './pillars'
import { addDays, isDateISO, weekStartOf } from './dates'
import { minutesWord, sessionsWord } from './plural'
import { checkZone2, maxHrFromSettings, zoneBounds } from './hr'
import type { ZoneBounds } from './hr'

/* Подсчёт недели по пяти столпам, разделы 4.1-4.5 плана. Все функции чистые:
   часы и хранилище не читаются, неделя задаётся датой понедельника (любая дата
   недели тоже подходит, её приведут к понедельнику).

   Учитываются только завершённые сессии (есть endedAt), без excludeFromWeek,
   неделя определяется по session.date, а не по времени завершения.

   Библиотека упражнений (src/data) в ядро не импортируется, поэтому
   принадлежность упражнения столпу и группам мышц берётся из параметра library
   плюс state.customExercises. Без записи об упражнении: силовая запись
   считается силой, кардио - зоной 2, интервалы - интервалами, а удержание
   (HoldItem) не относится ни к какому столпу и в зачёт не идёт. */

export const WEEK_MINIMUMS = {
  strengthSets: 20,
  strengthDays: 2,
  zone2Minutes: 90,
  intervalSessions: 1,
  mobilityMinutes: 10,
  balanceMinutes: 10,
} as const

/* Цели недели, если настроек нет или в них мусор (раздел 4, значения по умолчанию). */
export const DEFAULT_WEEK_GOALS: WeeklyGoals = {
  strengthSets: 50, strengthDays: 3,
  zone2Minutes: 150,
  intervalSessions: 2, intervalHardMinutes: 32,
  mobilityMinutes: 30, mobilityDays: 3,
  balanceMinutes: 30, balanceDays: 3,
}

export const STRENGTH_DAY_MIN_SETS = 6        // силовой день: от шести рабочих подходов
export const MAX_WORKING_RIR = 3              // запас больше трёх повторов в зачёт не идёт
export const DAY_MIN_MINUTES = 5              // день мобильности или баланса: от пяти минут
export const EXTERNAL_INTERVAL_MIN_MINUTES = 10  // внешнее занятие с интервалами считается сессией
/* Оценка длительности одного повтора упражнения мобильности или баланса, которое
   вводится повторами (большая растяжка, гусеница, bird dog): секунд в подходе нет,
   без оценки такая работа не дала бы столпу ни минуты. */
export const SECONDS_PER_REP = 4


const MUSCLE_GROUPS: readonly MuscleGroup[] = ['legs', 'back', 'chest-shoulders', 'arms', 'core']
const MOBILITY_ZONES: readonly MobilityZone[] = ['hips', 'spine', 'ankles', 'hamstrings', 'shoulders']

/* Столпы, у которых второй показатель входит в условие «выполнен». По плану
   (решение 0.6 и раздел 4.1) это только сила: три силовых дня обязательны.
   Дни мобильности и баланса (4.4, 4.5) и тяжёлые минуты интервалов (4.3) -
   справочные строки, шкала и выполнение на них не завязаны. */
const SECONDARY_GATES: Record<Pillar, boolean> = {
  strength: true, zone2: false, intervals: false, mobility: false, balance: false,
}

/* Входит ли второй показатель столпа в условие выполнения: подписи «осталось»
   называют только то, без чего столп не закрыть. */
export function isSecondaryRequired(pillar: Pillar): boolean {
  return SECONDARY_GATES[pillar]
}

/* ---- разбор входа ---- */

function amount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function positiveGoal(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function nonNegativeGoal(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function normalizeGoals(source?: Partial<WeeklyGoals> | null): WeeklyGoals {
  const g = source ?? {}
  const d = DEFAULT_WEEK_GOALS
  return {
    strengthSets: positiveGoal(g.strengthSets, d.strengthSets),
    strengthDays: nonNegativeGoal(g.strengthDays, d.strengthDays),
    zone2Minutes: positiveGoal(g.zone2Minutes, d.zone2Minutes),
    intervalSessions: positiveGoal(g.intervalSessions, d.intervalSessions),
    intervalHardMinutes: nonNegativeGoal(g.intervalHardMinutes, d.intervalHardMinutes),
    mobilityMinutes: positiveGoal(g.mobilityMinutes, d.mobilityMinutes),
    mobilityDays: nonNegativeGoal(g.mobilityDays, d.mobilityDays),
    balanceMinutes: positiveGoal(g.balanceMinutes, d.balanceMinutes),
    balanceDays: nonNegativeGoal(g.balanceDays, d.balanceDays),
  }
}

/* Что нужно неделе от настроек: цели и, по желанию, данные для зон пульса.
   Settings из состояния подходит целиком; без возраста и ручного максимума
   зоны не считаются, и подпись зоны 2 обходится без доли попаданий. */
export type WeekSettings = GoalsSource & Partial<Pick<Settings, 'birthYear' | 'maxHrMode' | 'maxHrManual' | 'restingHr'>>

/* Границы зоны 2 по настройкам человека на дату; null, если максимум неизвестен. */
function weekZoneBounds(settings: WeekSettings | undefined, date: DateISO): ZoneBounds | null {
  if (!settings) return null
  const maxHr = maxHrFromSettings({
    birthYear: settings.birthYear ?? null,
    maxHrMode: settings.maxHrMode ?? 'formula',
    maxHrManual: settings.maxHrManual ?? null,
  }, date)
  return zoneBounds(maxHr, settings.restingHr)
}

export function exerciseLookup(state: AppState, library?: ExerciseLibrary): ExerciseLibrary {
  return { ...(library ?? {}), ...(state.customExercises ?? {}) }
}

/* Завершённые сессии, которые идут в зачёт недели. */
export function countedSessions(state: AppState): Session[] {
  const all = Object.values(state.sessions ?? {})
  return all.filter(s =>
    s != null && typeof s.endedAt === 'number' && !s.excludeFromWeek && isDateISO(s.date))
}

/* Подход идёт в зачёт силы: рабочий или до отказа, запас не больше трёх. */
export function isWorkingSet(set: StrengthSet): boolean {
  if (set.kind !== 'work' && set.kind !== 'failure') return false
  return typeof set.rir !== 'number' || !Number.isFinite(set.rir) || set.rir <= MAX_WORKING_RIR
}

/* ---- факты одной сессии ---- */

interface Facts {
  strengthSets: number
  groups: Record<MuscleGroup, number>
  zone2Min: number
  zone2Sessions: number
  hrSessions: number              // сессии зоны 2 с введённым средним пульсом (только при известных границах зон)
  hrInZone: number                // из них со средним пульсом внутри зоны 2
  intervalSessions: number
  hardMin: number
  mobilityMin: number
  balanceMin: number
  zoneMin: Record<MobilityZone, number>
  bestBalanceSec: number
  externalStrengthMin: number     // минуты силы внешних занятий: в шкалу силы не идут, только строка на экране столпа
}

function emptyGroups(): Record<MuscleGroup, number> {
  return { legs: 0, back: 0, 'chest-shoulders': 0, arms: 0, core: 0 }
}

function emptyFacts(): Facts {
  return {
    strengthSets: 0, groups: emptyGroups(), zone2Min: 0, zone2Sessions: 0, hrSessions: 0, hrInZone: 0, intervalSessions: 0,
    hardMin: 0, mobilityMin: 0, balanceMin: 0,
    zoneMin: { hips: 0, spine: 0, ankles: 0, hamstrings: 0, shoulders: 0 },
    bestBalanceSec: 0,
    externalStrengthMin: 0,
  }
}

function addFacts(into: Facts, from: Facts): void {
  into.strengthSets += from.strengthSets
  for (const g of MUSCLE_GROUPS) into.groups[g] += from.groups[g]
  into.zone2Min += from.zone2Min
  into.zone2Sessions += from.zone2Sessions
  into.hrSessions += from.hrSessions
  into.hrInZone += from.hrInZone
  into.intervalSessions += from.intervalSessions
  into.hardMin += from.hardMin
  into.mobilityMin += from.mobilityMin
  into.balanceMin += from.balanceMin
  for (const z of MOBILITY_ZONES) into.zoneMin[z] += from.zoneMin[z]
  into.bestBalanceSec = Math.max(into.bestBalanceSec, from.bestBalanceSec)
  into.externalStrengthMin += from.externalStrengthMin
}

function addPillarMinutes(facts: Facts, pillar: Pillar, minutes: number, zone?: MobilityZone): void {
  if (pillar === 'mobility') {
    facts.mobilityMin += minutes
    if (zone) facts.zoneMin[zone] += minutes
  } else if (pillar === 'balance') {
    facts.balanceMin += minutes
  }
}

function itemFacts(item: SessionItem, lookup: ExerciseLibrary, facts: Facts): void {
  const exercise = item.type === 'external' ? undefined : lookup[item.exerciseId]
  switch (item.type) {
    case 'strength': {
      const sets = Array.isArray(item.sets) ? item.sets : []
      const pillar = exercise?.pillar ?? 'strength'
      if (pillar === 'strength') {
        for (const set of sets) {
          if (!isWorkingSet(set)) continue
          facts.strengthSets++
          for (const g of exercise?.groups ?? []) facts.groups[g]++
        }
      } else if (pillar === 'mobility' || pillar === 'balance') {
        // упражнение столпа мобильности или баланса, записанное как подходы: считаем секунды
        let seconds = 0
        let best = 0
        for (const set of sets) {
          if (set.kind === 'warmup') continue
          const held = amount(set.seconds)
          // подход без секунд, но с повторами: время оценивается; в лучшую стойку оценка не идёт
          seconds += held > 0 ? held : amount(set.reps) * SECONDS_PER_REP
          best = Math.max(best, held)
        }
        addPillarMinutes(facts, pillar, seconds / 60, exercise?.zone)
        if (pillar === 'balance') facts.bestBalanceSec = Math.max(facts.bestBalanceSec, best)
      }
      return
    }
    case 'cardio': {
      const minutes = amount(item.durationSec) / 60
      facts.zone2Min += minutes
      if (minutes > 0) facts.zone2Sessions = 1
      return
    }
    case 'intervals': {
      const done = amount(item.roundsDone)
      const rounds = amount(item.protocol?.rounds)
      const needed = Math.max(1, Math.ceil(rounds / 2))
      if (done >= needed) facts.intervalSessions++
      facts.hardMin += (done * amount(item.protocol?.workSec)) / 60
      return
    }
    case 'hold': {
      const pillar = exercise?.pillar
      if (pillar !== 'mobility' && pillar !== 'balance') return
      let seconds = 0
      let best = 0
      for (const hold of Array.isArray(item.holds) ? item.holds : []) {
        const s = amount(hold.seconds)
        seconds += s
        best = Math.max(best, s)
      }
      addPillarMinutes(facts, pillar, seconds / 60, exercise?.zone)
      if (pillar === 'balance') facts.bestBalanceSec = Math.max(facts.bestBalanceSec, best)
      return
    }
    case 'external': {
      // внешние минуты силы в шкалу силы не идут (у силы единица - подходы),
      // они копятся отдельно для строки на экране столпа (раздел 3.7)
      const split = item.split ?? {}
      facts.externalStrengthMin += amount(split.strength)
      const zone2 = amount(split.zone2)
      facts.zone2Min += zone2
      if (zone2 > 0) facts.zone2Sessions = 1
      const intervals = amount(split.intervals)
      facts.hardMin += intervals
      if (intervals >= EXTERNAL_INTERVAL_MIN_MINUTES) facts.intervalSessions++
      facts.mobilityMin += amount(split.mobility)
      facts.balanceMin += amount(split.balance)
      return
    }
  }
}

/* Средний пульс кардио-записей сессии, взвешенный по длительности (запись без
   длительности весит как одна секунда); null, если пульс нигде не введён. */
function sessionAvgHr(session: Session): number | null {
  let weighted = 0
  let weight = 0
  for (const item of Array.isArray(session.items) ? session.items : []) {
    if (!item || item.type !== 'cardio') continue
    const hr = amount(item.avgHr)
    if (hr === 0) continue
    const w = amount(item.durationSec) || 1
    weighted += hr * w
    weight += w
  }
  return weight > 0 ? weighted / weight : null
}

function sessionFacts(session: Session, lookup: ExerciseLibrary, bounds: ZoneBounds | null = null): Facts {
  const facts = emptyFacts()
  for (const item of Array.isArray(session.items) ? session.items : []) {
    if (item) itemFacts(item, lookup, facts)
  }
  // zone2Sessions считается по сессии, а не по записи: две кардио-записи подряд это одна сессия
  facts.zone2Sessions = Math.min(facts.zone2Sessions, 1)
  const verdict = checkZone2(sessionAvgHr(session), bounds)
  if (verdict !== null) {
    facts.hrSessions = 1
    if (verdict === 'in') facts.hrInZone = 1
  }
  return facts
}

/* ---- сбор по неделе ---- */

interface WeekFacts {
  total: Facts
  byDate: Map<DateISO, Facts>
}

function collectWeek(
  state: AppState, weekStart: DateISO, lookup: ExerciseLibrary, bounds: ZoneBounds | null = null,
): WeekFacts {
  const start = weekStartOf(weekStart)
  const end = addDays(start, 6)
  const total = emptyFacts()
  const byDate = new Map<DateISO, Facts>()
  for (const session of countedSessions(state)) {
    if (session.date < start || session.date > end) continue
    const facts = sessionFacts(session, lookup, bounds)
    addFacts(total, facts)
    const day = byDate.get(session.date) ?? emptyFacts()
    addFacts(day, facts)
    byDate.set(session.date, day)
  }
  return { total, byDate }
}

function countDays(week: WeekFacts, pick: (f: Facts) => number, threshold: number): number {
  let days = 0
  for (const facts of week.byDate.values()) if (pick(facts) >= threshold) days++
  return days
}

/* ---- публичные срезы ---- */

/* Рабочие подходы силы за неделю по группам мышц. Подход идёт в каждую группу
   упражнения (до двух), поэтому сумма по группам может превышать число подходов. */
export function workingSetsByGroup(
  state: AppState, weekStart: DateISO, library?: ExerciseLibrary,
): Record<MuscleGroup, number> {
  return { ...collectWeek(state, weekStart, exerciseLookup(state, library)).total.groups }
}

/* Число силовых дней недели: дат с шестью рабочими подходами и больше. */
export function strengthDays(state: AppState, weekStart: DateISO, library?: ExerciseLibrary): number {
  return countDays(collectWeek(state, weekStart, exerciseLookup(state, library)), f => f.strengthSets, STRENGTH_DAY_MIN_SETS)
}

/* Минуты силовой работы внешних занятий недели (ExternalItem.split.strength,
   пилатес, скалолазание), целые. В подходы и шкалу силы не переводятся. */
export function externalStrengthMinutes(state: AppState, weekStart: DateISO): number {
  return Math.round(collectWeek(state, weekStart, exerciseLookup(state)).total.externalStrengthMin)
}

/* Строка экрана столпа силы по разделу 3.7; null, если таких минут нет. */
export function externalStrengthText(minutes: number): string | null {
  const n = Number.isFinite(minutes) ? Math.round(minutes) : 0
  return n > 0 ? `ещё ${n} ${minutesWord(n)} силовой работы вне приложения` : null
}

/* Минуты мобильности недели по зонам (ориентир плана: 10 минут на зону). */
export function mobilityByZone(
  state: AppState, weekStart: DateISO, library?: ExerciseLibrary,
): Record<MobilityZone, number> {
  const zones = collectWeek(state, weekStart, exerciseLookup(state, library)).total.zoneMin
  return {
    hips: Math.round(zones.hips), spine: Math.round(zones.spine), ankles: Math.round(zones.ankles),
    hamstrings: Math.round(zones.hamstrings), shoulders: Math.round(zones.shoulders),
  }
}

/* Нагрузка одной даты для блокировок восстановления: рабочие подходы силы по
   группам и число интервальных сессий. Правила зачёта те же, что у недели. */
export interface DayLoad {
  workingSets: number
  groups: Record<MuscleGroup, number>
  intervalSessions: number
}

export function dayLoad(state: AppState, date: DateISO, library?: ExerciseLibrary): DayLoad {
  const lookup = exerciseLookup(state, library)
  const acc = emptyFacts()
  for (const session of countedSessions(state)) {
    if (session.date === date) addFacts(acc, sessionFacts(session, lookup))
  }
  return { workingSets: acc.strengthSets, groups: acc.groups, intervalSessions: acc.intervalSessions }
}

/* ---- сборка PillarProgress ---- */

/* Минуты складываются из секунд делением, поэтому ровные 150 могут прийти как
   149,99999999999997. Допуск EPS гасит только эту погрешность, а не нехватку. */
const EPS = 1e-9

/* Показ вниз: 149,5 минуты не рисуются как выполненные 150, 7,96 тяжёлой минуты как 8. */
function floorMin(n: number): number {
  return Math.floor(n + EPS)
}
function floor1(n: number): number {
  return Math.floor(n * 10 + EPS) / 10
}

interface BuildArgs {
  pillar: Pillar
  value: number                   // для показа: минуты округлены вниз, чтобы шкала не показывала цель, которой ещё нет
  exact?: number                  // точное значение для сравнений с целью и минимумом; по умолчанию value
  target: number
  minimum: number
  secondary?: { value: number; target: number }
  detail: string
}

function buildProgress(a: BuildArgs): PillarProgress {
  const exact = a.exact ?? a.value
  const secondaryOk = !SECONDARY_GATES[a.pillar] || !a.secondary || a.secondary.value >= a.secondary.target
  const unit: PillarUnit = PILLAR_UNIT[a.pillar]
  const progress: PillarProgress = {
    pillar: a.pillar,
    value: a.value,
    target: a.target,
    minimum: Math.min(a.minimum, a.target),
    unit,
    ratio: exact / a.target,
    done: exact + EPS >= a.target && secondaryOk,
    reachedMinimum: exact + EPS >= Math.min(a.minimum, a.target),
    detail: a.detail,
  }
  if (a.secondary) progress.secondary = a.secondary
  return progress
}

function progressFor(pillar: Pillar, week: WeekFacts, goals: WeeklyGoals): PillarProgress {
  const t = week.total
  switch (pillar) {
    case 'strength': {
      const days = countDays(week, f => f.strengthSets, STRENGTH_DAY_MIN_SETS)
      return buildProgress({
        pillar, value: t.strengthSets, target: goals.strengthSets, minimum: WEEK_MINIMUMS.strengthSets,
        secondary: { value: days, target: goals.strengthDays },
        detail: `силовых дней: ${days} из ${goals.strengthDays}`,
      })
    }
    case 'zone2': {
      const sessions = [...week.byDate.values()].reduce((n, f) => n + f.zone2Sessions, 0)
      return buildProgress({
        pillar, value: floorMin(t.zone2Min), exact: t.zone2Min, target: goals.zone2Minutes, minimum: WEEK_MINIMUMS.zone2Minutes,
        detail: `${sessions} ${sessionsWord(sessions)}` +
          (t.hrSessions > 0 ? `, пульс в зоне 2: ${t.hrInZone} из ${t.hrSessions}` : ''),
      })
    }
    case 'intervals': {
      const hard = floor1(t.hardMin)
      return buildProgress({
        pillar, value: t.intervalSessions, target: goals.intervalSessions, minimum: WEEK_MINIMUMS.intervalSessions,
        secondary: { value: hard, target: goals.intervalHardMinutes },
        detail: `тяжёлых минут: ${hard} из ${goals.intervalHardMinutes}`,
      })
    }
    case 'mobility': {
      const days = countDays(week, f => f.mobilityMin, DAY_MIN_MINUTES)
      return buildProgress({
        pillar, value: floorMin(t.mobilityMin), exact: t.mobilityMin, target: goals.mobilityMinutes, minimum: WEEK_MINIMUMS.mobilityMinutes,
        secondary: { value: days, target: goals.mobilityDays },
        detail: `дней: ${days} из ${goals.mobilityDays}`,
      })
    }
    case 'balance': {
      const days = countDays(week, f => f.balanceMin, DAY_MIN_MINUTES)
      const best = Math.round(t.bestBalanceSec)
      return buildProgress({
        pillar, value: floorMin(t.balanceMin), exact: t.balanceMin, target: goals.balanceMinutes, minimum: WEEK_MINIMUMS.balanceMinutes,
        secondary: { value: days, target: goals.balanceDays },
        detail: `дней: ${days} из ${goals.balanceDays}` + (best > 0 ? `, лучшая стойка ${best} с` : ''),
      })
    }
  }
}

function summarize(week: WeekFacts, weekStart: DateISO, goals: WeeklyGoals): WeekSummary {
  const pillars = {} as Record<Pillar, PillarProgress>
  for (const pillar of PILLARS) pillars[pillar] = progressFor(pillar, week, goals)
  return { weekStart, pillars, allDone: PILLARS.every(p => pillars[p].done) }
}

/* Итог недели по пяти столпам. weekStart приводится к понедельнику. Цели берутся
   из settings, а без него из state.settings; мусор в целях заменяется умолчаниями. */
export function weekProgress(
  state: AppState, weekStart: DateISO, settings?: WeekSettings, library?: ExerciseLibrary,
): WeekSummary {
  const start = weekStartOf(weekStart)
  const source = settings ?? state.settings
  const goals = normalizeGoals(source?.goals)
  return summarize(collectWeek(state, start, exerciseLookup(state, library), weekZoneBounds(source, start)), start, goals)
}

/* Один столп недели. */
export function pillarProgress(
  state: AppState, weekStart: DateISO, pillar: Pillar, settings?: WeekSettings, library?: ExerciseLibrary,
): PillarProgress {
  return weekProgress(state, weekStart, settings, library).pillars[pillar]
}

/* Последние n недель по возрастанию: последняя - неделя даты today. */
export function weekHistory(
  state: AppState, today: DateISO, n = 8, settings?: WeekSettings, library?: ExerciseLibrary,
): WeekSummary[] {
  const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
  const current = weekStartOf(today)
  const source = settings ?? state.settings
  const goals = normalizeGoals(source?.goals)
  const lookup = exerciseLookup(state, library)
  const out: WeekSummary[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(current, -7 * i)
    out.push(summarize(collectWeek(state, start, lookup, weekZoneBounds(source, start)), start, goals))
  }
  return out
}

/* Доля недельной нормы, которой не хватает, от 0 до 1. Учитывает второй
   показатель (дни), если он входит в условие выполнения столпа. */
export function pillarDeficit(progress: PillarProgress): number {
  if (progress.target <= 0) return 0
  let deficit = Math.max(0, progress.target - progress.value) / progress.target
  const s = progress.secondary
  if (s && SECONDARY_GATES[progress.pillar] && s.target > 0) {
    deficit = Math.max(deficit, Math.max(0, s.target - s.value) / s.target)
  }
  return Math.min(1, deficit)
}
