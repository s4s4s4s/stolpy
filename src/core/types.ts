/* Контракт данных приложения. Раздел 2 плана перенесён без потерь; сверху
   добавлены Settings.restingHrManual, StorageDriver и общие типы результатов
   недели (PillarProgress, WeekSummary). Этот файл читают все пакеты ядра. */

export const PILLARS = ['strength', 'zone2', 'intervals', 'mobility', 'balance'] as const
export type Pillar = typeof PILLARS[number]
export type MuscleGroup = 'legs' | 'back' | 'chest-shoulders' | 'arms' | 'core'
export type MobilityZone = 'hips' | 'spine' | 'ankles' | 'hamstrings' | 'shoulders'
export type Equipment =
  | 'bodyweight' | 'pullup-bar' | 'dip-bars' | 'dumbbells' | 'barbell' | 'kettlebell' | 'bands'
  | 'grip-trainer' | 'finger-extensor' | 'jump-rope' | 'exercise-bike' | 'mat' | 'bench'
  | 'gym-machines' | 'treadmill' | 'rower' | 'elliptical' | 'outdoors'
export type InputKind = 'weight-reps' | 'reps' | 'time' | 'time-side' | 'distance-time'
export type Place = 'home' | 'gym' | 'outside'
export type Side = 'left' | 'right'
export type CardioMode =
  | 'walk' | 'incline-walk' | 'jog' | 'run' | 'bike' | 'row' | 'elliptical' | 'swim' | 'jump-rope' | 'other'
export type DateISO = string      // 'YYYY-MM-DD', местная дата
export type Millis = number       // Date.now()
/* Минуты (или секунды, смотря где применено) по столпам; ключа нет, если по столпу нуль. */
export type Split = Partial<Record<Pillar, number>>
/* Источник идентификаторов: префикс -> уникальный id. В приложении это
   idFactory(Date.now()), в тестах - счётчик. */
export type IdFactory = (prefix: string) => string

/* ---- библиотека ---- */
export interface ExerciseDefaults {
  sets: number
  reps?: [number, number]         // диапазон повторов
  seconds?: [number, number]      // диапазон секунд удержания или работы
  perSide?: boolean
  minutes?: number                // для кардио зоны 2
  protocolId?: string             // для интервалов
}
export interface Exercise {
  id: string
  title: string
  pillar: Pillar
  groups?: MuscleGroup[]          // сила: до двух основных групп
  zone?: MobilityZone             // мобильность
  equipment: Equipment[]          // достаточно одного из списка
  input: InputKind
  cardioMode?: CardioMode
  defaults: ExerciseDefaults
  technique: string               // одна-две строки
  custom?: true
}

/* Библиотека упражнений по id: встроенные плюс свои. Ядро получает её
   параметром и src/data не читает. */
export type ExerciseLibrary = Readonly<Record<string, Exercise>>

/* ---- шаблоны ---- */
export interface TemplateItem {
  exerciseId: string
  sets?: number
  reps?: [number, number] | number | 'max'
  seconds?: number
  perSide?: boolean
  restSec?: number
  minutes?: number                // кардио
  protocolId?: string             // интервалы
  customProtocol?: CustomProtocolParams  // значения своего протокола при protocolId 'custom'
  cue?: string                    // подсказка к выполнению в этом шаблоне
}
/* Значения своего интервального протокола (пределы раздела 3.4 плана). */
export interface CustomProtocolParams {
  workSec: number
  restSec: number
  rounds: number
  warmupSec: number
  cooldownSec: number
}
export interface Template {
  id: string
  title: string
  place: Place | 'any'
  pillars: Pillar[]
  items: TemplateItem[]
  estMinutes: number
  excludeFromWeek?: boolean       // ежедневная мелочь программы
  source?: 'home' | 'gym' | 'johnson' | 'program' | 'custom'
  custom?: true
  createdAt?: Millis
}

/* ---- интервальные протоколы ---- */
export interface IntervalProtocol {
  id: string
  title: string
  workSec: number
  restSec: number
  rounds: number
  warmupSec: number
  cooldownSec: number
  note: string
  source: string
}
/* Набор протоколов, который ядро получает параметром (в приложении это
   INTERVAL_PROTOCOLS из src/data). */
export type ProtocolLibrary = readonly IntervalProtocol[]

/* ---- тренировка ---- */
export type SetKind = 'warmup' | 'work' | 'failure'
export interface PlannedSet { kind: SetKind; reps?: number | 'max'; seconds?: number; side?: Side }
export interface StrengthSet {
  kind: SetKind
  weightKg?: number               // только положительное
  assistKg?: number               // помощь (резина, противовес), положительное
  reps?: number
  seconds?: number
  side?: Side
  rir?: number                    // 0..5, необязательно
  doneAt: Millis
}
/* Общее у всех элементов тренировки. Элементы с упражнением из библиотеки
   добавляют exerciseId; внешнее занятие упражнения не имеет. */
interface ItemBase { id: string; note?: string }
interface ExerciseItemBase extends ItemBase { exerciseId: string }
export interface StrengthItem extends ExerciseItemBase {
  type: 'strength'
  unit: 'reps' | 'seconds'
  planned: PlannedSet[]
  sets: StrengthSet[]
  restSec: number
  goal?: { kind: 'total-reps'; reps: number }      // «плотность»: 25 за минимум подходов
}
export interface CardioItem extends ExerciseItemBase {
  type: 'cardio'
  mode: CardioMode
  durationSec: number
  distanceKm?: number
  avgHr?: number
  talkTest?: boolean              // мог говорить предложениями
}
export interface IntervalItem extends ExerciseItemBase {
  type: 'intervals'
  mode: CardioMode
  protocol: IntervalProtocol      // снимок, свой протокол имеет id 'custom'
  roundsDone: number              // завершённые рабочие отрезки
  peakHr?: number
}
export interface Hold { seconds: number; side?: Side; eyesClosed?: boolean; doneAt: Millis }
export interface HoldItem extends ExerciseItemBase {
  type: 'hold'
  perSide: boolean
  plannedSets: number
  plannedSeconds: number
  holds: Hold[]
}
export interface ExternalItem extends ItemBase {
  type: 'external'
  activityId: string              // ключ EXTERNAL_ACTIVITIES или 'other'
  activityTitle: string
  durationMin: number
  rpe?: number                    // 1..10
  split: Split                    // минуты по столпам, сумма не больше durationMin
}
export type SessionItem = StrengthItem | CardioItem | IntervalItem | HoldItem | ExternalItem

export interface ProgramRef { programId: string; phaseId: string; dayKey: string; week: number; deload: boolean }
export interface Session {
  id: string
  date: DateISO                   // местная дата начала, по ней неделя
  startedAt: Millis
  endedAt?: Millis                // нет у идущей
  place: Place
  title: string
  templateId?: string
  programRef?: ProgramRef
  items: SessionItem[]
  note?: string
  excludeFromWeek?: boolean
  energyKcal?: number             // калории, введённые руками; уходят в Health, сами не считаются
  health?: { sentAt: Millis; confirmed: boolean }
}

/* ---- таймеры идущей тренировки ---- */
export interface RestTimer { itemId: string; startedAt: Millis; endsAt: Millis }
export interface Stopwatch { itemId: string; startedAt: Millis; pausedAt?: Millis; pausedTotalMs: number }
export interface IntervalRun { itemId: string; startedAt: Millis; pausedAt?: Millis; pausedTotalMs: number }
/* Удержания идут по шагам. Пока pausedAt задан, шаг на паузе и остаток равен
   stepEndsAt - pausedAt; при возобновлении обе метки шага сдвигаются на длину паузы. */
export interface HoldRun { itemId: string; stepIndex: number; stepStartedAt: Millis; stepEndsAt: Millis; pausedAt?: Millis }
export interface ActiveSession {
  version: number
  session: Session
  currentItemId?: string
  rest?: RestTimer
  stopwatch?: Stopwatch
  interval?: IntervalRun
  hold?: HoldRun
  wakeLockWanted: boolean
}

/* ---- программа ---- */
export interface ProgramDayItem {
  exerciseId: string
  sets: number
  reps?: number | [number, number] | 'max'
  seconds?: number
  restSec?: number
  cue?: string
  fromWeekInPhase?: number        // появляется не с начала фазы
  ladder?: number[]               // лесенка: ступени одного круга, sets = число кругов
  goal?: { kind: 'total-reps'; reps: number }
}
export interface ProgramDay { key: string; title: string; items: ProgramDayItem[] }
export interface ExitCheck {
  kind: 'hold' | 'reps' | 'weighted-reps' | 'manual'
  exerciseId?: string
  seconds?: number
  reps?: number
  addedKg?: number
  text: string
}
export interface ProgramPhase {
  id: string
  title: string
  weeks: [number, number]         // сквозные недели включительно
  goal: string
  idea: string
  days: ProgramDay[]
  rotation: string[]              // порядок ключей дней, продолжается через недели
  exit: ExitCheck[]
  dailyLight?: boolean
}
export interface ProgramCheckpoint { week: number; text: string }
export interface Program {
  id: string
  title: string
  weeks: number
  trainingDaysPerWeek: number
  deloadEveryWeeks: number        // каждая четвёртая неделя: подходы x0.6
  measurement: { exerciseId: string; everyDays: number; rule: string }
  dailyLightTemplateId: string
  phases: ProgramPhase[]
  checkpoints: ProgramCheckpoint[]
  rules: string[]
  stagnation: string[]
}
export interface ProgramProgress {
  programId: string
  startedOn: DateISO              // понедельник первой недели
  trainingWeekdays: number[]      // 0 = понедельник, ровно три, через день
  phaseIndex: number
  phaseStartedWeek: number        // сквозная неделя, с которой идёт текущая фаза
  /* phaseIndex - фаза, в которой день выполнен (ставит completeProgramDay);
     у записей до появления поля его нет, они относятся к фазе по дате. */
  completedDays: { date: DateISO; dayKey: string; sessionId: string; phaseIndex?: number }[]
  measurements: { date: DateISO; reps: number }[]
  exitConfirmedAt?: Millis
  stoppedAt?: Millis
}

/* ---- тесты формы ---- */
export type TestUnit = 'kg' | 'reps' | 'score' | 'cm' | 'sec' | 'ratio' | 'm' | 'bpm'
export interface NormBand {
  upTo?: number; from?: number; label: string   // полуинтервалы [from, upTo)
  flag?: true                     // в интерфейсе красная точка
}
export interface NormTable { ageFrom: number; ageTo: number; bands: NormBand[]; better: 'higher' | 'lower' }
export type DerivedKind = 'vo2max'
export interface FormTest {
  id: string
  title: string
  unit: TestUnit
  fields: { key: string; title: string; unit: TestUnit }[]   // например left, right, attempt1..3
  reduce: 'max' | 'min' | 'first' | 'ratio' | 'bestOfSides'
  howTo: string
  repeatDays: number
  norms: NormTable[]
  reference?: string
  linkedExerciseId?: string       // подтягивания: совместный замер с программой
  pillar: Pillar | null           // null: общее здоровье, не столп
  derived?: DerivedKind           // производная величина, считается из результата
}
export interface TestResult {
  id: string
  testId: string
  date: DateISO
  values: Record<string, number>
  result: number
  note?: string
}

/* ---- настройки и состояние ---- */
export interface WeeklyGoals {
  strengthSets: number; strengthDays: number
  zone2Minutes: number
  intervalSessions: number; intervalHardMinutes: number
  mobilityMinutes: number; mobilityDays: number
  balanceMinutes: number; balanceDays: number
}
export type SoundMode = 'silent' | 'ambient' | 'playback'
export interface Settings {
  birthYear: number | null
  bodyWeightKg: number | null
  maxHrMode: 'formula' | 'manual'
  maxHrManual: number | null
  restingHr: number | null
  restingHrManual: boolean        // пульс покоя введён руками: автообновление его не трогает
  goals: WeeklyGoals
  homeEquipment: Equipment[]
  defaultRestSec: number
  sound: SoundMode
  keepAwake: boolean
  healthShortcutName: string
  onboardingDone: boolean
}
/* Всё, что нужно подсчётам недели от настроек: только цели. */
export type GoalsSource = Pick<Settings, 'goals'>
export interface AppState {
  version: number
  settings: Settings
  sessions: Record<string, Session>           // только завершённые
  customExercises: Record<string, Exercise>
  customTemplates: Record<string, Template>
  programs: Record<string, ProgramProgress>   // ключ programId
  testResults: TestResult[]
  bodyWeights: { date: DateISO; kg: number }[]
  meta: { lastBackupAt: Millis | null; sessionsSinceBackup: number; installedAt: Millis }
}

/* ---- контракт хранилища ---- */
/* Три реализации (IndexedDB, localStorage, память) отдают одну форму, поэтому
   остальной код не знает, где лежат данные. Значение всегда строка JSON. */
export interface StorageDriver {
  name: 'idb' | 'local' | 'memory'
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  /** Ключи приложения на этом носителе, начинающиеся с prefix (без него -
      все), по возрастанию. Префикс носителя (stolpy: у localStorage) в
      ответ не входит: ключи те же, что принимают get, set и remove. */
  keys(prefix?: string): Promise<string[]>
}

/* ---- результаты подсчёта недели (раздел 4 плана) ---- */
export type PillarUnit = 'sets' | 'minutes' | 'sessions'

export interface PillarSecondary { value: number; target: number }

export interface PillarProgress {
  pillar: Pillar
  value: number                   // сделано за неделю в единицах unit
  target: number                  // цель недели
  minimum: number                 // минимальная отметка зачёта
  unit: PillarUnit
  ratio: number                   // value / target, без ограничения сверху
  done: boolean                   // столп выполнен: цель и вторичный показатель достигнуты
  reachedMinimum: boolean        // value не меньше minimum
  secondary?: PillarSecondary     // вторичный индикатор (дни, тяжёлые минуты)
  detail?: string                 // готовая подпись под шкалой
}

export interface WeekSummary {
  weekStart: DateISO              // понедельник недели
  pillars: Record<Pillar, PillarProgress>
  allDone: boolean                // все пять столпов выполнены
}

/* ---- занятия вне приложения (данные в src/data/activities.ts) ---- */
export interface ExternalActivity {
  id: string
  title: string
  splitPer60: Split               // минуты по столпам на 60 минут занятия, сумма 60
}
