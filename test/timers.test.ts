import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  BACKGROUND_GAP_MS, adjustRest, advanceHold, clampProtocol, holdDoneSec, holdSteps, holdView,
  intervalPhases, intervalSignalPlan, intervalView, pauseHold, pauseInterval, pauseStopwatch,
  protocolDurationSec, restSignalDue, restView, resumeHold, resumeInterval, resumeStopwatch,
  runElapsedMs, signalsDue, startHold, startInterval, startRest, startStopwatch,
  stopwatchDurationSec, stopwatchElapsedMs,
} from '../src/core/timers.ts'
import type { IntervalProtocol } from '../src/core/types.ts'
import { CUSTOM_PROTOCOL_LIMITS } from '../src/data/protocols.ts'

/* Образец: разминка 10, работа 20, отдых 10, работа 20, заминка 5 = 65 с.
   Фазы: warmup [0,10), work1 [10,30), rest1 [30,40), work2 [40,60), cooldown [60,65). */
const P: IntervalProtocol = {
  id: 'test', title: 'Тест', workSec: 20, restSec: 10, rounds: 2, warmupSec: 10, cooldownSec: 5, note: '', source: '',
}
const T0 = 1_000_000

group('отдых: старт, вид, граница', () => {
  const rest = startRest('i1', T0, 90)
  assertEqual(rest, { itemId: 'i1', startedAt: T0, endsAt: T0 + 90_000 }, 'метки')
  const mid = restView(rest, T0 + 30_000)
  assertEqual([mid.remainingSec, mid.overdueSec, mid.expired], [60, 0, false], 'на 30-й секунде')
  assert(Math.abs(mid.fraction - 1 / 3) < 1e-9, 'доля трети')
  assertEqual(restView(rest, T0 + 30_001).remainingSec, 60, 'остаток округляется вверх')
  const edge = restView(rest, T0 + 90_000)
  assertEqual([edge.remainingSec, edge.expired, edge.fraction], [0, true, 1], 'ровно в нуле истёк')
  const late = restView(rest, T0 + 100_500)
  assertEqual([late.remainingSec, late.overdueSec, late.expired, late.fraction], [0, 10, true, 1], 'просрочка 10 с')
  assertEqual(restView(rest, T0 - 5_000).fraction, 0, 'часы назад: доля не меньше нуля')
})

group('отдых: мусор на входе', () => {
  assertEqual(startRest('i', T0, -5).endsAt, T0, 'отрицательное в ноль')
  assertEqual(startRest('i', T0, NaN).endsAt, T0, 'NaN в ноль')
  assertEqual(startRest('i', T0, Infinity).endsAt, T0, 'Infinity в ноль')
  assertEqual(startRest('i', T0, 1.6).endsAt, T0 + 2000, 'дробное округляется')
  const zero = restView(startRest('i', T0, 0), T0)
  assertEqual([zero.expired, zero.fraction, zero.remainingSec], [true, 1, 0], 'нулевой отдых истёк сразу')
})

group('отдых: +-15 с', () => {
  const rest = startRest('i', T0, 60)
  assertEqual(adjustRest(rest, 15, T0 + 10_000).endsAt, T0 + 75_000, '+15')
  assertEqual(adjustRest(rest, -15, T0 + 10_000).endsAt, T0 + 45_000, '-15')
  assertEqual(adjustRest(startRest('i', T0, 10), -15, T0 + 1000).endsAt, T0, '-15 не раньше старта')
  const expired = adjustRest(rest, 15, T0 + 100_000)
  assertEqual([expired.startedAt, expired.endsAt], [T0 + 100_000, T0 + 115_000], '+15 после конца считается от now')
  assertEqual(adjustRest(rest, NaN, T0).endsAt, rest.endsAt, 'NaN не двигает')
})

group('отдых: сигнал один раз, в фоне нет', () => {
  const rest = startRest('i', T0, 60)
  const end = T0 + 60_000
  assert(restSignalDue(end - 200, end + 50, rest), 'пересечение обычным тиком')
  assert(!restSignalDue(end - 400, end - 150, rest), 'до нуля нет')
  assert(!restSignalDue(end + 50, end + 300, rest), 'после нуля повторно нет')
  assert(restSignalDue(end - 1, end, rest), 'ровно на нуле есть')
  assert(!restSignalDue(end - 30_000, end + 5000, rest), 'пересечение в фоне: без сигнала')
})

group('секундомер: пауза и возобновление', () => {
  let sw = startStopwatch('z2', T0)
  assertEqual(stopwatchElapsedMs(sw, T0 + 10_000), 10_000, 'идёт')
  sw = pauseStopwatch(sw, T0 + 10_000)
  assertEqual(stopwatchElapsedMs(sw, T0 + 99_000), 10_000, 'в паузе заморожен')
  assertEqual(pauseStopwatch(sw, T0 + 50_000), sw, 'повторная пауза ничего не меняет')
  sw = resumeStopwatch(sw, T0 + 40_000)
  assertEqual(sw.pausedTotalMs, 30_000, 'накоплена пауза')
  assert(sw.pausedAt === undefined, 'pausedAt снят')
  assertEqual(stopwatchElapsedMs(sw, T0 + 45_000), 15_000, 'после возобновления')
  assertEqual(resumeStopwatch(sw, T0 + 46_000), sw, 'возобновление без паузы ничего не меняет')
  assertEqual(stopwatchDurationSec(sw, T0 + 45_999), 15, 'итог в секундах вниз')
  sw = pauseStopwatch(sw, T0 + 50_000)
  sw = resumeStopwatch(sw, T0 + 60_000)
  assertEqual(sw.pausedTotalMs, 40_000, 'вторая пауза складывается')
  assertEqual(stopwatchElapsedMs(startStopwatch('z', T0), T0 - 1000), 0, 'часы назад: ноль')
  assertEqual(runElapsedMs({ startedAt: T0, pausedTotalMs: -5 }, T0 + 1000), 1000, 'отрицательная пауза игнорируется')
})

group('фазы интервалов', () => {
  assertEqual(intervalPhases(P), [
    { kind: 'warmup', sec: 10, startSec: 0 },
    { kind: 'work', sec: 20, round: 1, startSec: 10 },
    { kind: 'rest', sec: 10, round: 1, startSec: 30 },
    { kind: 'work', sec: 20, round: 2, startSec: 40 },
    { kind: 'cooldown', sec: 5, startSec: 60 },
  ], 'порядок и метки, последнего отдыха нет')
  assertEqual(protocolDurationSec(P), 65, 'длительность')
  const bare = intervalPhases({ ...P, warmupSec: 0, cooldownSec: 0, restSec: 0 })
  assertEqual(bare.map(p => p.kind), ['work', 'work'], 'нулевые фазы пропущены')
  assertEqual(intervalPhases({ ...P, rounds: 1 }).map(p => p.kind), ['warmup', 'work', 'cooldown'], 'один раунд без отдыха')
  assertEqual(intervalPhases({ ...P, rounds: 0 }).map(p => p.kind), ['warmup', 'cooldown'], 'ноль раундов')
  assertEqual(intervalPhases({ ...P, rounds: NaN, workSec: -3 }).map(p => p.kind), ['warmup', 'cooldown'], 'мусор не ломает')
})

group('вид интервалов по границам фаз', () => {
  const run = startInterval('iv', T0)
  const at = (sec: number) => intervalView(run, P, T0 + sec * 1000)

  const v0 = at(0)
  assertEqual([v0.phase?.kind, v0.remainingSec, v0.roundsCompleted, v0.totalRemainingSec, v0.finished], ['warmup', 10, 0, 65, false], 'старт')
  const v9 = at(9.5)
  assertEqual([v9.phase?.kind, v9.remainingSec], ['warmup', 1], 'конец разминки')
  const v10 = at(10)
  assertEqual([v10.phase?.kind, v10.phase?.round, v10.remainingSec, v10.phaseIndex], ['work', 1, 20, 1], 'ровно на границе уже работа')
  assertEqual(at(29.999).roundsCompleted, 0, 'до конца работы раунд не засчитан')
  const v30 = at(30)
  assertEqual([v30.phase?.kind, v30.roundsCompleted], ['rest', 1], 'граница работа-отдых')
  assertEqual(at(40).phase?.round, 2, 'второй раунд')
  assertEqual(at(60).roundsCompleted, 2, 'обе работы засчитаны')
  assertEqual(at(60).phase?.kind, 'cooldown', 'заминка')
  const v64 = at(64.9)
  assertEqual([v64.finished, v64.remainingSec, v64.totalRemainingSec], [false, 1, 1], 'за мгновение до конца последней фазы')
  const v65 = at(65)
  assertEqual([v65.finished, v65.phase, v65.remainingSec, v65.totalRemainingSec, v65.roundsCompleted, v65.phaseFraction], [true, null, 0, 0, 2, 1], 'ровно в конце')
  const v500 = at(500)
  assertEqual([v500.finished, v500.elapsedMs, v500.roundsCompleted], [true, 65_000, 2], 'далеко после конца')
  assertEqual(at(-5).phase?.kind, 'warmup', 'часы назад: начало')
  assert(Math.abs(at(20).phaseFraction - 0.5) < 1e-9, 'доля фазы')
})

group('интервалы: пауза замораживает фазы', () => {
  let run = startInterval('iv', T0)
  run = pauseInterval(run, T0 + 15_000)
  const frozen = intervalView(run, P, T0 + 900_000)
  assertEqual([frozen.phase?.kind, frozen.remainingSec, frozen.paused, frozen.finished], ['work', 15, true, false], 'в паузе стоит')
  run = resumeInterval(run, T0 + 100_000)
  assertEqual(run.pausedTotalMs, 85_000, 'накопленная пауза')
  const after = intervalView(run, P, T0 + 100_000 + 15_000)
  assertEqual([after.phase?.kind, after.phase?.round, after.paused], ['rest', 1, false], 'продолжение с места паузы')
  assertEqual(intervalView(startInterval('i', T0), { ...P, rounds: 0, warmupSec: 0, cooldownSec: 0 }, T0).finished, true, 'пустой протокол сразу закончен')
})

group('план сигналов', () => {
  const plan = intervalSignalPlan(P).map(s => `${s.kind}@${s.atMs / 1000}`)
  assertEqual(plan, [
    'triple@7', 'long@10', 'triple@27', 'long@30', 'triple@37', 'long@40', 'triple@57', 'long@60', 'triple@62', 'long@65',
  ], 'тройной за 3 с до конца, длинный на конце, в том числе на финише')
  const short = intervalSignalPlan({ ...P, rounds: 1, warmupSec: 0, cooldownSec: 0, workSec: 3 })
  assertEqual(short.map(s => s.kind), ['long'], 'фаза не длиннее 3 с без тройного')
})

group('signalsDue: обычный тик', () => {
  const run = startInterval('iv', T0)
  const due = (a: number, b: number) => signalsDue(T0 + a, T0 + b, run, P).map(s => `${s.kind}@${s.atMs / 1000}`)
  assertEqual(due(6_900, 7_100), ['triple@7'], 'предупреждение')
  assertEqual(due(7_000, 7_250), [], 'левая граница исключена')
  assertEqual(due(6_750, 7_000), ['triple@7'], 'правая граница включена')
  assertEqual(due(9_900, 10_100), ['long@10'], 'смена фазы')
  assertEqual(due(0, 250), [], 'старт без сигнала')
  assertEqual(due(64_900, 65_100), ['long@65'], 'финиш')
  assertEqual(due(65_100, 65_350), [], 'после финиша тишина')
  assertEqual(due(10_000, 10_000), [], 'нулевой шаг')
  assertEqual(due(20_000, 19_000), [], 'часы назад')
})

group('signalsDue: возврат из фона отдаёт только последний', () => {
  /* разминка 2 (длинный на 2), работа 4 (тройной на 3, длинный на 6), без заминки */
  const P2: IntervalProtocol = { ...P, warmupSec: 2, workSec: 4, rounds: 1, cooldownSec: 0 }
  const run = startInterval('iv', T0)
  const fmt = (a: number, b: number) => signalsDue(T0 + a, T0 + b, run, P2).map(s => `${s.kind}@${s.atMs / 1000}`)
  assertEqual(fmt(1_900, 1_900 + BACKGROUND_GAP_MS), ['long@2', 'triple@3'], 'ровно на пороге разрыва: обычный тик, оба')
  assertEqual(fmt(1_900, 1_900 + BACKGROUND_GAP_MS + 1), ['triple@3'], 'за порогом: только последний')
  assertEqual(fmt(0, 60_000), ['long@6'], 'минута в фоне: один сигнал')
  assertEqual(fmt(0, 2_900), ['long@2'], 'фон, в промежутке один')
  assertEqual(signalsDue(T0 + 1_000, T0 + 2_900, run, P), [], 'фон без сигналов в промежутке')
})

group('signalsDue: пауза', () => {
  const run = pauseInterval(startInterval('iv', T0), T0 + 8_000)
  assertEqual(signalsDue(T0 + 8_000, T0 + 40_000, run, P), [], 'в паузе сигналов нет')
  const before = signalsDue(T0 + 6_500, T0 + 20_000, run, P)
  assertEqual(before.map(s => `${s.kind}@${s.atMs / 1000}`), ['triple@7'], 'до паузы сигнал успел')
  const resumed = resumeInterval(run, T0 + 28_000)
  assertEqual(signalsDue(T0 + 29_000, T0 + 30_100, resumed, P).map(s => s.kind), ['long'], 'после возобновления время продолжается')
})

group('holdSteps', () => {
  assertEqual(
    holdSteps({ perSide: true, plannedSets: 2, plannedSeconds: 30 }),
    [
      { kind: 'hold', sec: 30, set: 1, side: 'left' },
      { kind: 'switch', sec: 5, set: 1 },
      { kind: 'hold', sec: 30, set: 1, side: 'right' },
      { kind: 'rest', sec: 15, set: 1 },
      { kind: 'hold', sec: 30, set: 2, side: 'left' },
      { kind: 'switch', sec: 5, set: 2 },
      { kind: 'hold', sec: 30, set: 2, side: 'right' },
    ],
    'по сторонам: левая, смена, правая; отдых только между подходами',
  )
  assertEqual(
    holdSteps({ perSide: false, plannedSets: 2, plannedSeconds: 20 }, { setRestSec: 0 }),
    [{ kind: 'hold', sec: 20, set: 1 }, { kind: 'hold', sec: 20, set: 2 }],
    'без сторон и без отдыха',
  )
  assertEqual(holdSteps({ perSide: true, plannedSets: 1, plannedSeconds: 10 }, { switchSec: 0 }).length, 2, 'без смены две стороны')
  assertEqual(holdSteps({ perSide: true, plannedSets: 0, plannedSeconds: 30 }), [], 'ноль подходов')
  assertEqual(holdSteps({ perSide: true, plannedSets: 3, plannedSeconds: 0 }), [], 'ноль секунд')
  assertEqual(holdSteps({ perSide: false, plannedSets: NaN, plannedSeconds: 30 }), [], 'мусор')
  assertEqual(holdSteps({ perSide: true, plannedSets: 3, plannedSeconds: 30 }).filter(s => s.kind === 'hold').length, 6, 'три подхода по двум сторонам')
})

group('holdView, автопереход, пауза', () => {
  const steps = holdSteps({ perSide: true, plannedSets: 1, plannedSeconds: 10 })   // 10, 5, 10
  assertEqual(startHold('h', [], T0), null, 'нет шагов - нет прогона')
  const run = startHold('h', steps, T0)!
  assertEqual(run.stepEndsAt, T0 + 10_000, 'конец первого шага')
  const v = holdView(run, steps, T0 + 4_000)!
  assertEqual([v.remainingSec, v.step.side, v.expired, v.isLast, v.fraction], [6, 'left', false, false, 0.4], 'вид')
  assertEqual(holdView({ ...run, stepIndex: 9 }, steps, T0), null, 'индекс вне шагов')

  const a1 = advanceHold(run, steps, T0 + 10_200)
  assertEqual([a1.run.stepIndex, a1.crossed, a1.finished, a1.run.stepStartedAt], [1, 1, false, T0 + 10_000], 'шаг стартует с метки конца предыдущего')
  const a2 = advanceHold(run, steps, T0 + 40_000)
  assertEqual([a2.run.stepIndex, a2.crossed, a2.finished], [2, 2, true], 'фон: догнали до последнего, он истёк')
  assertEqual(advanceHold(run, steps, T0 + 5_000), { run, crossed: 0, finished: false }, 'до конца ничего не меняется')

  const paused = pauseHold(run, T0 + 4_000)
  assertEqual(holdView(paused, steps, T0 + 500_000)!.remainingSec, 6, 'пауза держит остаток')
  assertEqual(advanceHold(paused, steps, T0 + 500_000).crossed, 0, 'на паузе не переходит')
  assertEqual(pauseHold(paused, T0 + 9_000), paused, 'повторная пауза')
  const resumed = resumeHold(paused, T0 + 100_000)
  assertEqual([resumed.stepEndsAt, resumed.stepStartedAt, resumed.paused], [T0 + 106_000, T0 + 100_000, undefined], 'возобновление продолжает остаток')
  assertEqual(resumeHold(run, T0), run, 'возобновление без паузы')

  assertEqual(holdDoneSec(run, steps, T0 + 4_000), 4, 'фактически выдержано 4 с')
  assertEqual(holdDoneSec(run, steps, T0 + 99_000), 10, 'не больше плана')
  assertEqual(holdDoneSec({ ...run, stepIndex: 1, stepStartedAt: T0 + 10_000, stepEndsAt: T0 + 15_000 }, steps, T0 + 12_000), 0, 'смена сторон не удержание')
})

group('clampProtocol', () => {
  const c = clampProtocol({ ...P, workSec: 1, restSec: 9999, rounds: 99, warmupSec: -4, cooldownSec: NaN }, CUSTOM_PROTOCOL_LIMITS)
  assertEqual([c.workSec, c.restSec, c.rounds, c.warmupSec, c.cooldownSec], [5, 600, 30, 0, 0], 'пределы')
  assertEqual(clampProtocol({ ...P, workSec: 20.6 }, CUSTOM_PROTOCOL_LIMITS).workSec, 21, 'целые')
  assertEqual(clampProtocol(P, CUSTOM_PROTOCOL_LIMITS), P, 'допустимое не меняется')
})

finish()
