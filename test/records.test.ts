import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  EMPTY_RECORDS, bestE1rm, detectPr, exerciseRecords, exerciseSeries, isBodyweight, recordsOfSets,
} from '../src/core/records.ts'
import type { Session, SessionItem, StrengthSet } from '../src/core/types.ts'

function set(kind: StrengthSet['kind'], weightKg: number | undefined, reps: number | undefined, extra: Partial<StrengthSet> = {}): StrengthSet {
  return { kind, weightKg, reps, doneAt: 1, ...extra }
}

function strengthItem(exerciseId: string, sets: StrengthSet[]): SessionItem {
  return { id: `i-${exerciseId}`, type: 'strength', exerciseId, unit: 'reps', planned: [], sets, restSec: 90 }
}

function session(id: string, date: string, startedAt: number, items: SessionItem[]): Session {
  return { id, date, startedAt, endedAt: startedAt + 3_600_000, place: 'gym', title: 'T', items }
}

group('bestE1rm: разминки и длинные подходы не считаются', () => {
  assertEqual(bestE1rm([]), null, 'пусто')
  assertEqual(bestE1rm([set('warmup', 200, 1)]), null, 'только разминка')
  assertEqual(bestE1rm([set('work', 100, 15)]), null, '15 повторов - оценки нет')
  assertEqual(bestE1rm([set('work', undefined, 8)]), null, 'без веса')
  assertEqual(bestE1rm([set('work', 0, 8)]), null, 'нулевой вес')
  assertEqual(bestE1rm([set('work', 60, 5), set('work', 80, 3)]), 88, 'максимум по подходам')
  assertEqual(bestE1rm([set('work', 60, 5), set('warmup', 150, 2)]), 70, 'разминка тяжелее не мешает')
  assertEqual(bestE1rm([set('failure', 50, 10)]), 66.7, 'до отказа считается')
  assertEqual(bestE1rm([set('work', 60, 5, { assistKg: 10 })]), null, 'подход с помощью не рекорд')
})

group('recordsOfSets: набор рекордов', () => {
  const r = recordsOfSets([
    set('warmup', 20, 10),
    set('work', 60, 5),
    set('work', 70, 3),
    set('failure', 50, 12),
    { kind: 'work', seconds: 40, doneAt: 1 },
  ])
  assertEqual(r.bestWeight, 70, 'вес')
  assertEqual(r.bestReps, 12, 'повторы при любом весе')
  assertEqual(r.bestVolumeSet, 600, '50 x 12 = 600 больше 70 x 3 = 210')
  assertEqual(r.bestSeconds, 40, 'секунды')
  assertEqual(r.bestE1rm, 77, '70 x 3 = 77')
  assertEqual(r.bestDistanceKm, null, 'дистанции в подходах нет')
  assertEqual(recordsOfSets([]), EMPTY_RECORDS, 'пусто')
})

group('recordsOfSets: свой вес', () => {
  const r = recordsOfSets([set('work', undefined, 8), set('work', undefined, 10)], { bodyweight: true })
  assertEqual(r.bestReps, 10, 'повторы - главный рекорд')
  assertEqual(r.bestE1rm, null, '1ПМ не считается')
  const weighted = recordsOfSets([set('work', 10, 5)], { bodyweight: true })
  assertEqual(weighted.bestE1rm, null, '1ПМ не считается и с добавочным весом')
  assertEqual(weighted.bestWeight, 10, 'добавочный вес запоминается')
  assert(isBodyweight({ input: 'reps' }), 'ввод reps - свой вес')
  assert(isBodyweight({ input: 'time' }), 'ввод time - не гири')
  assert(!isBodyweight({ input: 'weight-reps' }), 'weight-reps - гири')
})

group('recordsOfSets: мусор в данных', () => {
  const r = recordsOfSets([
    set('work', Number.NaN, 5),
    set('work', -10, 5),
    set('work', 50, 0),
    set('work', 50, 2.5),
    { kind: 'work', seconds: -5, doneAt: 1 },
  ])
  assertEqual(r, EMPTY_RECORDS, 'ни одного допустимого значения')
})

group('exerciseRecords: по сессиям, массив и словарь', () => {
  const s1 = session('a', '2026-10-05', 1000, [
    strengthItem('squat', [set('work', 100, 5)]),
    strengthItem('bench', [set('work', 60, 8)]),
  ])
  const s2 = session('b', '2026-10-12', 2000, [
    strengthItem('squat', [set('work', 110, 3), set('warmup', 200, 1)]),
    { id: 'c', type: 'cardio', exerciseId: 'z2', mode: 'bike', durationSec: 2700, distanceKm: 18.5 },
    { id: 'e', type: 'external', activityId: 'squat', activityTitle: 'Йога', durationMin: 60, split: { mobility: 60 } },
  ])
  const list = [s1, s2]
  const rec = exerciseRecords(list, 'squat')
  assertEqual(rec.bestWeight, 110, 'вес по двум сессиям')
  assertEqual(rec.bestE1rm, 121, '110 x 3 = 121 против 100 x 5 = 116,7')
  assertEqual(exerciseRecords({ a: s1, b: s2 }, 'squat'), rec, 'словарь даёт то же')
  assertEqual(exerciseRecords(list, 'z2').bestDistanceKm, 18.5, 'дистанция кардио')
  assertEqual(exerciseRecords(list, 'nothing'), EMPTY_RECORDS, 'неизвестное упражнение')
  assertEqual(exerciseRecords([], 'squat'), EMPTY_RECORDS, 'нет сессий')
})

group('exerciseRecords: удержания', () => {
  const s = session('h', '2026-10-05', 1, [
    { id: 'h1', type: 'hold', exerciseId: 'stance', perSide: true, plannedSets: 2, plannedSeconds: 30,
      holds: [{ seconds: 25, side: 'left', doneAt: 1 }, { seconds: 41, side: 'right', eyesClosed: true, doneAt: 2 }] },
  ])
  assertEqual(exerciseRecords([s], 'stance').bestSeconds, 41, 'лучшее удержание')
})

group('detectPr: только что записанный подход', () => {
  const prev = recordsOfSets([set('work', 100, 5), set('work', 90, 8)])
  assertEqual(detectPr(prev, set('work', 100, 5)), [], 'равное не рекорд')
  assertEqual(detectPr(prev, set('work', 100, 6)), ['e1rm'], 'больше повторов с тем же весом, объём 600 ниже 720')
  assertEqual(detectPr(prev, set('work', 90, 9)), ['e1rm', 'volume'], 'объём 810 выше 720')
  assertEqual(detectPr(prev, set('work', 105, 3)), ['weight'], 'вес выше, оценка ниже')
  assertEqual(detectPr(prev, set('work', 105, 5)), ['e1rm', 'weight'], 'оценка и вес сразу')
  assertEqual(detectPr(prev, set('warmup', 200, 5)), [], 'разминка не рекорд')
  assertEqual(detectPr(prev, set('work', 120, 1, { assistKg: 5 })), [], 'с помощью не рекорд')
  assertEqual(detectPr(prev, set('work', undefined, 12)), ['reps'], 'повторы без веса')
  assertEqual(detectPr(prev, set('work', 50, 12)), [], 'повторы с весом рекордом повторов не считаются')
  assertEqual(detectPr(prev, set('work', 60, undefined)), [], 'без повторов')
  assertEqual(detectPr(prev, { kind: 'work', seconds: 30 }), [], 'секунды без рекорда по секундам')
})

group('detectPr: первая запись и свой вес', () => {
  assertEqual(detectPr(EMPTY_RECORDS, set('work', 100, 5)), [], 'нет истории - нет рекорда')
  const prev = recordsOfSets([set('work', undefined, 8)], { bodyweight: true })
  assertEqual(detectPr(prev, set('work', undefined, 9), { bodyweight: true }), ['reps'], 'повторы')
  assertEqual(detectPr(prev, set('work', undefined, 8), { bodyweight: true }), [], 'равное')
  const held = recordsOfSets([{ kind: 'work', seconds: 30 }])
  assertEqual(detectPr(held, { seconds: 31 }), ['seconds'], 'удержание без kind')
})

group('exerciseSeries: график', () => {
  const s1 = session('a', '2026-10-05', 1000, [strengthItem('squat', [set('work', 100, 5), set('work', 100, 4), set('warmup', 40, 10)])])
  const s2 = session('b', '2026-10-12', 3000, [strengthItem('squat', [set('work', 110, 3)])])
  const s3 = session('c', '2026-10-08', 2000, [strengthItem('bench', [set('work', 60, 8)])])
  const s4 = session('d', '2026-10-09', 2500, [strengthItem('squat', [set('warmup', 40, 10)])])
  const series = exerciseSeries([s2, s3, s1, s4], 'squat')
  assertEqual(series.length, 2, 'сессии без рабочих подходов пропущены')
  assertEqual(series[0], { date: '2026-10-05', e1rm: 116.7, topWeight: 100, totalReps: 9, topSeconds: null }, 'первая точка')
  assertEqual(series[1], { date: '2026-10-12', e1rm: 121, topWeight: 110, totalReps: 3, topSeconds: null }, 'вторая точка')
  assertEqual(exerciseSeries([], 'squat'), [], 'пусто')
  assertEqual(exerciseSeries([s1], 'bench'), [], 'нет упражнения')
})

finish()
