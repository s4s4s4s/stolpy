/* Общие сборщики для test/week.test.ts, streak.test.ts, recommend.test.ts:
   мини-библиотека упражнений, шаблоны и конструкторы сессий. Файл не *.test.ts,
   раннер его сам не запускает. */

import type {
  AppState, CardioItem, DateISO, Exercise, ExternalItem, HoldItem, IntervalItem, IntervalProtocol, Pillar,
  Session, SetKind, StrengthItem, StrengthSet, Template,
} from '../src/core/types.ts'
import { addDays } from '../src/core/dates.ts'
import { DEFAULT_WEEK_GOALS } from '../src/core/week.ts'

export const MON = '2026-10-12'
export const TUE = '2026-10-13'
export const WED = '2026-10-14'
export const THU = '2026-10-15'
export const FRI = '2026-10-16'
export const SAT = '2026-10-17'
export const SUN = '2026-10-18'
export const NEXT_MON = '2026-10-19'
export const PREV_SUN = '2026-10-11'

function ex(id: string, pillar: Pillar, extra: Partial<Exercise> = {}): Exercise {
  return {
    id, title: id, pillar, equipment: ['bodyweight'], input: 'reps',
    defaults: { sets: 3 }, technique: 'техника', ...extra,
  }
}

export const LIBRARY: Record<string, Exercise> = {
  squat: ex('squat', 'strength', { groups: ['legs'] }),
  lunge: ex('lunge', 'strength', { groups: ['legs', 'core'] }),
  bench: ex('bench', 'strength', { groups: ['chest-shoulders', 'arms'] }),
  row: ex('row', 'strength', { groups: ['back', 'arms'] }),
  plank: ex('plank', 'strength', { groups: ['core'], input: 'time' }),
  'z2-bike': ex('z2-bike', 'zone2', { input: 'distance-time', cardioMode: 'bike' }),
  hiit: ex('hiit', 'intervals', { cardioMode: 'bike' }),
  'stretch-hip': ex('stretch-hip', 'mobility', { zone: 'hips', input: 'time-side' }),
  'stretch-ham': ex('stretch-ham', 'mobility', { zone: 'hamstrings', input: 'time-side' }),
  'cat-cow': ex('cat-cow', 'mobility', { zone: 'spine', input: 'time' }),
  sls: ex('sls', 'balance', { input: 'time-side' }),
  'wgs-reps': ex('wgs-reps', 'mobility', { zone: 'hips', input: 'reps' }),
  'bird-reps': ex('bird-reps', 'balance', { input: 'reps' }),
}

export const PROTOCOL_4X4: IntervalProtocol = {
  id: 'norwegian-4x4', title: '4x4', workSec: 240, restSec: 180, rounds: 4,
  warmupSec: 300, cooldownSec: 300, note: '', source: 'test',
}

export const PROTOCOL_8X20: IntervalProtocol = {
  id: 'tabata-8', title: '8x20', workSec: 20, restSec: 10, rounds: 8,
  warmupSec: 120, cooldownSec: 60, note: '', source: 'test',
}

let counter = 0
function nextId(prefix: string): string {
  counter++
  return `${prefix}-${counter}`
}

export function baseState(): AppState {
  return {
    version: 1,
    settings: {
      birthYear: null, bodyWeightKg: null, maxHrMode: 'formula', maxHrManual: null,
      restingHr: null, restingHrManual: false, goals: { ...DEFAULT_WEEK_GOALS },
      homeEquipment: [], defaultRestSec: 90, sound: 'silent', keepAwake: false,
      healthShortcutName: '', onboardingDone: true,
    },
    sessions: {},
    customExercises: {},
    customTemplates: {},
    programs: {},
    testResults: [],
    bodyWeights: [],
    meta: { lastBackupAt: null, sessionsSinceBackup: 0, installedAt: 0 },
  }
}

export function stateOf(...sessions: Session[]): AppState {
  const state = baseState()
  for (const s of sessions) state.sessions[s.id] = s
  return state
}

/* Миллисекунды от даты: полдень UTC, разные сессии одного дня различаются смещением. */
export function ms(date: DateISO, hour = 12): number {
  return Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00Z`)
}

export interface SessionOpts {
  place?: Session['place']
  templateId?: string
  excludeFromWeek?: boolean
  completed?: boolean
  hour?: number
  endedAt?: number
}

export function session(date: DateISO, items: Session['items'], opts: SessionOpts = {}): Session {
  const startedAt = ms(date, opts.hour ?? 12)
  const s: Session = {
    id: nextId('s'), date, startedAt, place: opts.place ?? 'home', title: 'Тренировка', items,
  }
  if (opts.completed !== false) s.endedAt = opts.endedAt ?? startedAt + 3_600_000
  if (opts.templateId) s.templateId = opts.templateId
  if (opts.excludeFromWeek) s.excludeFromWeek = true
  return s
}

export function work(rir?: number, kind: SetKind = 'work'): StrengthSet {
  const set: StrengthSet = { kind, reps: 10, doneAt: 1 }
  if (rir !== undefined) set.rir = rir
  return set
}

export function warmup(): StrengthSet {
  return { kind: 'warmup', reps: 10, doneAt: 1 }
}

/* n рабочих подходов (RIR 2) упражнения exerciseId. */
export function strength(exerciseId: string, n: number, sets?: StrengthSet[]): StrengthItem {
  return {
    id: nextId('i'), exerciseId, type: 'strength', unit: 'reps', planned: [],
    sets: sets ?? Array.from({ length: n }, () => work(2)), restSec: 90,
  }
}

export function cardio(minutes: number, exerciseId = 'z2-bike', avgHr?: number): CardioItem {
  const item: CardioItem = { id: nextId('i'), exerciseId, type: 'cardio', mode: 'bike', durationSec: minutes * 60 }
  if (avgHr !== undefined) item.avgHr = avgHr
  return item
}

export function intervals(roundsDone: number, protocol: IntervalProtocol = PROTOCOL_4X4): IntervalItem {
  return { id: nextId('i'), exerciseId: 'hiit', type: 'intervals', mode: 'bike', protocol, roundsDone }
}

/* Удержания: seconds для каждого подхода. */
export function hold(exerciseId: string, seconds: number[]): HoldItem {
  return {
    id: nextId('i'), exerciseId, type: 'hold', perSide: false,
    plannedSets: seconds.length, plannedSeconds: 30,
    holds: seconds.map(s => ({ seconds: s, doneAt: 1 })),
  }
}

export function external(durationMin: number, split: ExternalItem['split']): ExternalItem {
  return {
    id: nextId('i'), type: 'external', activityId: 'other',
    activityTitle: 'Занятие', durationMin, split,
  }
}

/* Шаблон с одним элементом на упражнение. */
export function template(
  id: string, pillars: Pillar[], exerciseIds: string[], extra: Partial<Template> = {},
): Template {
  return {
    id, title: `Шаблон ${id}`, place: 'home', pillars,
    items: exerciseIds.map(exerciseId => ({ exerciseId })), estMinutes: 30, ...extra,
  }
}

/* Полностью выполненная неделя от понедельника monday: три силовых дня по 18 подходов,
   зона 2 150 минут, две интервальные сессии, мобильность и баланс по 30 минут за три дня. */
export function fullWeek(monday: string, skip: readonly Pillar[] = []): Session[] {
  const out: Session[] = []
  for (const offset of [0, 2, 4]) {
    const items = []
    if (!skip.includes('strength')) items.push(strength('squat', 9), strength('row', 9))
    if (!skip.includes('mobility')) items.push(hold('stretch-hip', [600]))
    if (!skip.includes('balance')) items.push(hold('sls', [600]))
    out.push(session(addDays(monday, offset), items))
  }
  if (!skip.includes('zone2')) out.push(session(addDays(monday, 1), [cardio(150)]))
  if (!skip.includes('intervals')) out.push(session(addDays(monday, 3), [intervals(4), intervals(4)]))
  return out
}
