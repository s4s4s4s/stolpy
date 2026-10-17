import type {
  HoldItem, HoldRun, IntervalProtocol, IntervalRun, Millis, RestTimer, Side, Stopwatch,
} from './types'

/* Таймеры идущей тренировки (раздел 5 плана). Правило: ни один таймер не
   хранит «осталось секунд». Хранятся метки (startedAt, endsAt, pausedAt,
   pausedTotalMs), любое представление считается из now. Функции чистые: время
   приходит параметром, ничего не читает Date.now. */

const MS = 1000

/* ---------------------------------------------------------------- сигналы */

/** short - одиночный короткий, long - смена фазы, triple - предупреждение за WARN_LEAD_SEC до конца. */
export type SignalKind = 'short' | 'long' | 'triple'

/** За сколько секунд до конца фазы звучит тройной сигнал. */
export const WARN_LEAD_SEC = 3

/** Разрыв между двумя тиками, после которого считаем, что приложение было в фоне.
    Обычный тик 250 мс; фоновые вкладки браузеры замедляют до 1 с и реже. */
export const BACKGROUND_GAP_MS = 1500

export interface IntervalSignal {
  kind: SignalKind
  /** Момент сигнала в миллисекундах от начала интервальной работы (без пауз). */
  atMs: number
  /** Индекс фазы в intervalPhases, к которой относится сигнал. */
  phaseIndex: number
}

/* ------------------------------------------------------- общие метки пауз */

/** Общая форма секундомера и интервального прогона. */
export interface PausableRun {
  startedAt: Millis
  pausedAt?: Millis
  pausedTotalMs: number
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

/** Прошедшее время в мс без пауз. Пока пауза, время заморожено на её начале;
    момент до начала паузы считается как обычно (нужно signalsDue).
    Часы, ушедшие назад, дают ноль, а не отрицательное число. */
export function runElapsedMs(run: PausableRun, now: Millis): number {
  const end = run.pausedAt === undefined ? now : Math.min(now, run.pausedAt)
  return Math.max(0, end - run.startedAt - Math.max(0, run.pausedTotalMs))
}

function pauseRun<T extends PausableRun>(run: T, now: Millis): T {
  if (run.pausedAt !== undefined) return run
  return { ...run, pausedAt: now }
}

function resumeRun<T extends PausableRun>(run: T, now: Millis): T {
  if (run.pausedAt === undefined) return run
  const { pausedAt, ...rest } = run
  return { ...rest, pausedTotalMs: run.pausedTotalMs + Math.max(0, now - pausedAt) } as T
}

/* ------------------------------------------------------------------ отдых */

export const REST_STEP_SEC = 15

export function startRest(itemId: string, now: Millis, sec: number): RestTimer {
  const ms = Math.max(0, Math.round(finiteOr(sec, 0))) * MS
  return { itemId, startedAt: now, endsAt: now + ms }
}

/** Сдвиг конца отдыха на deltaSec (кнопки +-REST_STEP_SEC). Нижняя граница -
    момент старта. Если отдых уже истёк, прибавка отсчитывается от now, а не
    от давно прошедшего конца. */
export function adjustRest(rest: RestTimer, deltaSec: number, now: Millis): RestTimer {
  const deltaMs = Math.round(finiteOr(deltaSec, 0)) * MS
  if (deltaMs > 0 && now >= rest.endsAt) {
    return { ...rest, startedAt: now, endsAt: now + deltaMs }
  }
  return { ...rest, endsAt: Math.max(rest.startedAt, rest.endsAt + deltaMs) }
}

export interface RestView {
  remainingMs: number
  /** Секунды к показу: округление вверх, 0 только когда истёк. */
  remainingSec: number
  /** Сколько секунд назад отдых закончился (целых), 0 пока не истёк. */
  overdueSec: number
  /** Доля пройденного 0..1 (для шкалы). */
  fraction: number
  expired: boolean
}

export function restView(rest: RestTimer, now: Millis): RestView {
  const total = rest.endsAt - rest.startedAt
  const remainingMs = Math.max(0, rest.endsAt - now)
  const fraction = total <= 0 ? 1 : Math.min(1, Math.max(0, (now - rest.startedAt) / total))
  return {
    remainingMs,
    remainingSec: Math.ceil(remainingMs / MS),
    overdueSec: Math.floor(Math.max(0, now - rest.endsAt) / MS),
    fraction,
    expired: now >= rest.endsAt,
  }
}

/** Нужно ли дать сигнал конца отдыха между двумя тиками. Один раз, в момент
    пересечения нуля; если пересечение пришлось на фон (разрыв больше
    BACKGROUND_GAP_MS), сигнала нет, только текст «закончился N с назад». */
export function restSignalDue(prevNow: Millis, now: Millis, rest: RestTimer): boolean {
  if (now - prevNow > BACKGROUND_GAP_MS) return false
  return prevNow < rest.endsAt && now >= rest.endsAt
}

/* ------------------------------------------------------------- секундомер */

export function startStopwatch(itemId: string, now: Millis): Stopwatch {
  return { itemId, startedAt: now, pausedTotalMs: 0 }
}
export const pauseStopwatch = (sw: Stopwatch, now: Millis): Stopwatch => pauseRun(sw, now)
export const resumeStopwatch = (sw: Stopwatch, now: Millis): Stopwatch => resumeRun(sw, now)
export const stopwatchElapsedMs = (sw: Stopwatch, now: Millis): number => runElapsedMs(sw, now)

/** Итог секундомера в целых секундах (округление вниз). */
export function stopwatchDurationSec(sw: Stopwatch, now: Millis): number {
  return Math.floor(runElapsedMs(sw, now) / MS)
}

/* ------------------------------------------------------------- интервалы */

export type PhaseKind = 'warmup' | 'work' | 'rest' | 'cooldown'

export interface Phase {
  kind: PhaseKind
  sec: number
  /** Номер раунда с единицы, у work и rest. */
  round?: number
  /** Начало фазы в секундах от начала прогона. */
  startSec: number
}

/** Пределы пользовательского протокола (значения лежат в data/protocols.ts). */
export interface CustomProtocolLimits {
  workSec: { min: number; max: number }
  restSec: { min: number; max: number }
  rounds: { min: number; max: number }
  warmupSec: { min: number; max: number }
  cooldownSec: { min: number; max: number }
}

function wholeNonNegative(value: number): number {
  return Math.max(0, Math.floor(finiteOr(value, 0)))
}

/** Приводит пользовательский протокол к пределам: целые, не мусор, внутри min..max. */
export function clampProtocol(p: IntervalProtocol, limits: CustomProtocolLimits): IntervalProtocol {
  const fit = (v: number, l: { min: number; max: number }): number =>
    Math.min(l.max, Math.max(l.min, Math.round(finiteOr(v, l.min))))
  return {
    ...p,
    workSec: fit(p.workSec, limits.workSec),
    restSec: fit(p.restSec, limits.restSec),
    rounds: fit(p.rounds, limits.rounds),
    warmupSec: fit(p.warmupSec, limits.warmupSec),
    cooldownSec: fit(p.cooldownSec, limits.cooldownSec),
  }
}

/** Полная длительность протокола в секундах: последний отдых опущен. */
export function protocolDurationSec(p: IntervalProtocol): number {
  const rounds = wholeNonNegative(p.rounds)
  const rest = rounds > 1 ? (rounds - 1) * wholeNonNegative(p.restSec) : 0
  return wholeNonNegative(p.warmupSec) + rounds * wholeNonNegative(p.workSec) + rest + wholeNonNegative(p.cooldownSec)
}

/** Фазы по порядку: разминка, work и rest на раунд (после последнего work
    отдыха нет), заминка. Фазы нулевой длины пропускаются. */
export function intervalPhases(p: IntervalProtocol): Phase[] {
  const rounds = wholeNonNegative(p.rounds)
  const raw: Omit<Phase, 'startSec'>[] = [{ kind: 'warmup', sec: wholeNonNegative(p.warmupSec) }]
  for (let r = 1; r <= rounds; r++) {
    raw.push({ kind: 'work', sec: wholeNonNegative(p.workSec), round: r })
    if (r < rounds) raw.push({ kind: 'rest', sec: wholeNonNegative(p.restSec), round: r })
  }
  raw.push({ kind: 'cooldown', sec: wholeNonNegative(p.cooldownSec) })

  const phases: Phase[] = []
  let at = 0
  for (const phase of raw) {
    if (phase.sec <= 0) continue
    phases.push({ ...phase, startSec: at })
    at += phase.sec
  }
  return phases
}

export const startInterval = (itemId: string, now: Millis): IntervalRun => ({ itemId, startedAt: now, pausedTotalMs: 0 })
export const pauseInterval = (run: IntervalRun, now: Millis): IntervalRun => pauseRun(run, now)
export const resumeInterval = (run: IntervalRun, now: Millis): IntervalRun => resumeRun(run, now)

export interface IntervalView {
  /** Текущая фаза; null, когда прогон закончен. */
  phase: Phase | null
  phaseIndex: number
  elapsedMs: number
  /** Остаток фазы, секунды вверх. */
  remainingSec: number
  /** Доля пройденного в фазе 0..1. */
  phaseFraction: number
  /** Завершённые рабочие отрезки. */
  roundsCompleted: number
  totalRemainingSec: number
  finished: boolean
  paused: boolean
}

/** Состояние прогона на момент now. Границы полуоткрытые: ровно в конце фазы
    уже идёт следующая; ровно в конце последней фазы прогон закончен. */
export function intervalView(run: IntervalRun, protocol: IntervalProtocol, now: Millis): IntervalView {
  const phases = intervalPhases(protocol)
  const totalMs = phases.reduce((s, ph) => s + ph.sec, 0) * MS
  const elapsedMs = Math.min(runElapsedMs(run, now), totalMs)
  const paused = run.pausedAt !== undefined
  const finished = elapsedMs >= totalMs

  let roundsCompleted = 0
  for (const ph of phases) {
    if (ph.kind === 'work' && (ph.startSec + ph.sec) * MS <= elapsedMs) roundsCompleted++
  }
  const totalRemainingSec = Math.ceil((totalMs - elapsedMs) / MS)

  if (finished) {
    return {
      phase: null, phaseIndex: phases.length, elapsedMs, remainingSec: 0, phaseFraction: 1,
      roundsCompleted, totalRemainingSec: 0, finished: true, paused,
    }
  }
  let phaseIndex = phases.findIndex(ph => elapsedMs < (ph.startSec + ph.sec) * MS)
  if (phaseIndex < 0) phaseIndex = phases.length - 1
  const phase = phases[phaseIndex]
  const intoMs = elapsedMs - phase.startSec * MS
  return {
    phase, phaseIndex, elapsedMs,
    remainingSec: Math.ceil((phase.sec * MS - intoMs) / MS),
    phaseFraction: Math.min(1, Math.max(0, intoMs / (phase.sec * MS))),
    roundsCompleted, totalRemainingSec, finished: false, paused,
  }
}

/** Все сигналы протокола по порядку: triple за WARN_LEAD_SEC до конца фазы
    (если фаза длиннее этого), long в конце каждой фазы, включая последнюю. */
export function intervalSignalPlan(protocol: IntervalProtocol): IntervalSignal[] {
  const plan: IntervalSignal[] = []
  intervalPhases(protocol).forEach((ph, phaseIndex) => {
    const endMs = (ph.startSec + ph.sec) * MS
    if (ph.sec > WARN_LEAD_SEC) plan.push({ kind: 'triple', atMs: endMs - WARN_LEAD_SEC * MS, phaseIndex })
    plan.push({ kind: 'long', atMs: endMs, phaseIndex })
  })
  return plan
}

/** Тик интерфейса: момент и прогон в том виде, в каком он был в этот момент. */
export interface SignalTick {
  now: Millis
  run: IntervalRun
}

function sameRun(a: IntervalRun, b: IntervalRun): boolean {
  return a.itemId === b.itemId && a.startedAt === b.startedAt
}

/** Сигналы, наступившие между двумя тиками: atMs в полуинтервале
    (прошедшее на prev, прошедшее на next]. Прошедшее время каждого тика
    считается по его собственному прогону: если между тиками была пауза
    или возобновление, прогон next уже несёт новую сумму пауз, и пересчёт
    prev по нему занизил бы прошедшее и повторил прозвучавший сигнал.
    Пауза замораживает время, поэтому в паузе сигналов нет. При обычном
    тике отдаются все наступившие; при возврате из фона (разрыв больше
    BACKGROUND_GAP_MS) - только последний, чтобы не проигрывать очередь.
    Новый прогон (другой itemId или startedAt) отсчитывается с нуля. Поле
    atMs позволяет интерфейсу отличить давний сигнал от свежего. */
export function signalsDue(prev: SignalTick, next: SignalTick, protocol: IntervalProtocol): IntervalSignal[] {
  if (next.now <= prev.now) return []
  const from = sameRun(prev.run, next.run) ? runElapsedMs(prev.run, prev.now) : runElapsedMs(next.run, prev.now)
  const to = runElapsedMs(next.run, next.now)
  if (to <= from) return []
  const due = intervalSignalPlan(protocol).filter(s => s.atMs > from && s.atMs <= to)
  if (next.now - prev.now > BACKGROUND_GAP_MS) return due.slice(-1)
  return due
}

/* ------------------------------------------------------------- удержания */

/** Пауза смены сторон и отдых между подходами по умолчанию, секунды. */
export const HOLD_SWITCH_SEC = 5
export const HOLD_SET_REST_SEC = 15

export interface HoldStep {
  kind: 'hold' | 'switch' | 'rest'
  sec: number
  /** Номер подхода с единицы. */
  set: number
  side?: Side
}

export interface HoldStepOptions {
  switchSec?: number
  setRestSec?: number
}

/** Шаги удержаний: подход за подходом, при perSide сначала левая сторона,
    затем пауза смены, затем правая; между подходами отдых. Пауз после
    последнего шага нет. Шаги нулевой длины пропускаются. */
export function holdSteps(
  item: Pick<HoldItem, 'perSide' | 'plannedSets' | 'plannedSeconds'>,
  options: HoldStepOptions = {},
): HoldStep[] {
  const sets = wholeNonNegative(item.plannedSets)
  const sec = wholeNonNegative(item.plannedSeconds)
  const switchSec = wholeNonNegative(options.switchSec ?? HOLD_SWITCH_SEC)
  const setRestSec = wholeNonNegative(options.setRestSec ?? HOLD_SET_REST_SEC)
  if (sec <= 0) return []

  const steps: HoldStep[] = []
  for (let set = 1; set <= sets; set++) {
    if (item.perSide) {
      steps.push({ kind: 'hold', sec, set, side: 'left' })
      if (switchSec > 0) steps.push({ kind: 'switch', sec: switchSec, set })
      steps.push({ kind: 'hold', sec, set, side: 'right' })
    } else {
      steps.push({ kind: 'hold', sec, set })
    }
    if (set < sets && setRestSec > 0) steps.push({ kind: 'rest', sec: setRestSec, set })
  }
  return steps
}

/* Пауза удержания: пока задан HoldRun.pausedAt, время шага заморожено и
   остаток равен stepEndsAt - pausedAt. Возобновление сдвигает обе метки шага
   на длину паузы и снимает pausedAt. */

export function startHold(itemId: string, steps: HoldStep[], now: Millis): HoldRun | null {
  if (steps.length === 0) return null
  return { itemId, stepIndex: 0, stepStartedAt: now, stepEndsAt: now + steps[0].sec * MS }
}

export interface HoldView {
  step: HoldStep
  stepIndex: number
  remainingMs: number
  remainingSec: number
  fraction: number
  /** Время шага вышло (на последнем шаге - упражнение закончено). */
  expired: boolean
  isLast: boolean
  paused: boolean
}

export function holdView(run: HoldRun, steps: HoldStep[], now: Millis): HoldView | null {
  const step = steps[run.stepIndex]
  if (!step) return null
  const paused = run.pausedAt !== undefined
  const remainingMs = Math.max(0, run.stepEndsAt - (run.pausedAt ?? now))
  const totalMs = step.sec * MS
  return {
    step, stepIndex: run.stepIndex, remainingMs,
    remainingSec: Math.ceil(remainingMs / MS),
    fraction: Math.min(1, Math.max(0, 1 - remainingMs / totalMs)),
    expired: remainingMs <= 0,
    isLast: run.stepIndex === steps.length - 1,
    paused,
  }
}

export function pauseHold(run: HoldRun, now: Millis): HoldRun {
  if (run.pausedAt !== undefined) return run
  return { ...run, pausedAt: Math.min(Math.max(now, run.stepStartedAt), run.stepEndsAt) }
}

export function resumeHold(run: HoldRun, now: Millis): HoldRun {
  if (run.pausedAt === undefined) return run
  const { pausedAt, ...rest } = run
  const shift = Math.max(0, now - pausedAt)
  return { ...rest, stepStartedAt: run.stepStartedAt + shift, stepEndsAt: run.stepEndsAt + shift }
}

export interface HoldAdvance {
  run: HoldRun
  /** Сколько границ между шагами пройдено; больше нуля - пора дать один сигнал. */
  crossed: number
  /** Время последнего шага вышло: интерфейс сам даёт финальный сигнал и снимает run. */
  finished: boolean
}

/** Автопереход: каждый следующий шаг стартует с конца предыдущего (по меткам,
    без накопления дрейфа), поэтому после фона догоняет сразу несколько шагов.
    На паузе не двигается. Последний шаг по истечении не покидается:
    finished = true, run остаётся на нём. */
export function advanceHold(run: HoldRun, steps: HoldStep[], now: Millis): HoldAdvance {
  let cur = run
  let crossed = 0
  if (cur.pausedAt === undefined) {
    while (now >= cur.stepEndsAt && cur.stepIndex < steps.length - 1) {
      const next = cur.stepIndex + 1
      cur = { ...cur, stepIndex: next, stepStartedAt: cur.stepEndsAt, stepEndsAt: cur.stepEndsAt + steps[next].sec * MS }
      crossed++
    }
  }
  const finished = cur.pausedAt === undefined && steps.length > 0 && cur.stepIndex === steps.length - 1 && now >= cur.stepEndsAt
  return { run: cur, crossed, finished }
}

/** Фактически выдержанные секунды текущего шага (при ранней остановке меньше плана). */
export function holdDoneSec(run: HoldRun, steps: HoldStep[], now: Millis): number {
  const view = holdView(run, steps, now)
  if (!view || view.step.kind !== 'hold') return 0
  return Math.max(0, Math.min(view.step.sec, Math.round((view.step.sec * MS - view.remainingMs) / MS)))
}
