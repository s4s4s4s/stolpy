import { assert, assertEqual, finish, group } from './_harness.ts'
import { PROGRAM_MUSCLEUP as P } from '../src/data/program-muscleup.ts'
import { addDays, weekdayIndexMon } from '../src/core/dates.ts'
import {
  addMeasurement, advancePhase, calendarPhaseIndex, completeProgramDay, dayKeyFor, exitChecklistComplete,
  isDayCompleted, isDeloadWeek, isLastPhase, isProgramActive, isTrainingDay, measurementDue, overdueWeeks,
  phaseFor, programDayTemplate, programPosition, programWeek, stagnationHint, startProgram, stopProgram,
  validateTrainingWeekdays, visibleItems, weekStartDate,
} from '../src/core/program.ts'
import type { DateISO, ProgramProgress } from '../src/core/types.ts'

function throwsRange(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof RangeError
  }
}

const START: DateISO = '2026-10-12'          // понедельник
const MWF = [0, 2, 4]

function fresh(): ProgramProgress {
  return startProgram(P, START, MWF)
}

/* Прогресс внутри фазы index, которая началась на сквозной неделе startedWeek. */
function inPhase(index: number, startedWeek: number): ProgramProgress {
  return { ...fresh(), phaseIndex: index, phaseStartedWeek: startedWeek }
}

/* Понедельник сквозной недели week плюс сдвиг в днях. */
function on(week: number, offset = 0): DateISO {
  return addDays(START, (week - 1) * 7 + offset)
}

function done(progress: ProgramProgress, n: number, from = 0): ProgramProgress {
  let p = progress
  for (let i = 0; i < n; i++) {
    p = completeProgramDay(p, { date: addDays(START, from + i * 2), dayKey: 'x', sessionId: `s${from}-${i}` })
  }
  return p
}

group('данные: фазы покрывают недели 1-56 без дыр и наложений', () => {
  assertEqual(P.id, 'muscleup-56', 'id')
  assertEqual(P.weeks, 56, 'недель')
  assertEqual(P.phases.map(p => p.id), ['f0', 'f1', 'f2', 'f3', 'f4'], 'пять фаз')
  assertEqual(P.phases[0].weeks[0], 1, 'первая фаза с недели 1')
  assertEqual(P.phases[P.phases.length - 1].weeks[1], 56, 'последняя фаза до недели 56')
  for (let i = 1; i < P.phases.length; i++) {
    assertEqual(P.phases[i].weeks[0], P.phases[i - 1].weeks[1] + 1, `фаза ${P.phases[i].id} начинается сразу за предыдущей`)
  }
  const covered = new Array<number>(57).fill(0)
  for (const ph of P.phases) {
    assert(ph.weeks[0] <= ph.weeks[1], `${ph.id}: начало не позже конца`)
    for (let w = ph.weeks[0]; w <= ph.weeks[1]; w++) covered[w]++
  }
  for (let w = 1; w <= 56; w++) assertEqual(covered[w], 1, `неделя ${w} покрыта ровно одной фазой`)
  assertEqual(P.phases.map(p => p.weeks), [[1, 3], [4, 14], [15, 30], [31, 44], [45, 56]], 'сетка недель')
})

group('данные: структура дней, ротации, критериев, текстов', () => {
  assertEqual(P.trainingDaysPerWeek, 3, 'три тяжёлых дня')
  assertEqual(P.deloadEveryWeeks, 4, 'разгрузка каждую четвёртую')
  assertEqual(P.measurement, { exerciseId: 'pullup', everyDays: 14, rule: P.measurement.rule }, 'замер: подтягивания раз в 14 дней')
  assert(P.measurement.rule.length > 0, 'правило замера непустое')
  assertEqual(P.dailyLightTemplateId, 'daily-light', 'шаблон мелочи')
  assertEqual(P.phases.map(p => p.dailyLight === true), [true, true, true, false, false], 'мелочь только в f0-f2')
  assertEqual(P.phases.map(p => p.rotation), [['A'], ['A', 'B'], ['A', 'B', 'C'], ['A'], ['A']], 'ротации')
  for (const ph of P.phases) {
    const keys = ph.days.map(d => d.key)
    assertEqual(new Set(keys).size, keys.length, `${ph.id}: ключи дней уникальны`)
    for (const k of ph.rotation) assert(keys.includes(k), `${ph.id}: день ${k} из ротации описан`)
    for (const k of keys) assert(ph.rotation.includes(k), `${ph.id}: день ${k} входит в ротацию`)
    assert(ph.exit.length > 0, `${ph.id}: есть критерии выхода`)
    assert(ph.goal.length > 0 && ph.idea.length > 0 && ph.title.length > 0, `${ph.id}: тексты фазы`)
    const phaseWeeks = ph.weeks[1] - ph.weeks[0] + 1
    for (const d of ph.days) {
      assert(d.items.length > 0, `${ph.id}/${d.key}: есть упражнения`)
      for (const it of d.items) {
        assert(Number.isInteger(it.sets) && it.sets >= 1, `${ph.id}/${d.key}/${it.exerciseId}: подходы целые >= 1`)
        if (it.fromWeekInPhase !== undefined) {
          assert(it.fromWeekInPhase >= 1 && it.fromWeekInPhase <= phaseWeeks, `${ph.id}/${d.key}/${it.exerciseId}: fromWeekInPhase внутри фазы`)
        }
        if (it.ladder) assert(it.ladder.length > 0 && it.ladder.every(s => Number.isInteger(s) && s > 0), 'ступени лесенки положительные')
        if (it.restSec !== undefined) assert(it.restSec >= 0, 'отдых неотрицательный')
        assert(it.reps !== undefined || it.seconds !== undefined || it.ladder !== undefined || it.goal !== undefined,
          `${ph.id}/${d.key}/${it.exerciseId}: задан объём`)
      }
    }
  }
  assertEqual(P.rules.length, 6, 'шесть правил')
  assertEqual(P.checkpoints.map(c => c.week), [5, 14, 22, 30, 44, 48], 'контрольные точки по неделям')
  for (const c of P.checkpoints) assert(c.week >= 1 && c.week <= 56 && c.text.length > 0, `точка ${c.week}`)
  assert(P.stagnation.length >= 3 && P.stagnation.every(s => s.length > 0), 'тексты застоя')
  const text = JSON.stringify(P)
  assert(!/ккал|белок|калор|питани/i.test(text), 'питания в программе нет')
  assert(!text.includes(String.fromCharCode(0x2013)) && !text.includes(String.fromCharCode(0x2014)), 'тире в программе нет')
})

group('данные: лесенка, плотность и появление упражнений', () => {
  const f2 = P.phases[2]
  const a = f2.days.find(d => d.key === 'A')!
  assertEqual(a.items[0].ladder, [1, 2, 3, 2, 1], 'лесенка 1-2-3-2-1')
  assertEqual(a.items[0].sets, 4, 'четыре круга')
  assertEqual(a.items[0].restSec, 0, 'внутри круга отдыха нет')
  const b = f2.days.find(d => d.key === 'B')!
  assertEqual(b.items[0].goal, { kind: 'total-reps', reps: 25 }, 'плотность: 25 повторений')
  const c = f2.days.find(d => d.key === 'C')!
  assertEqual(c.items[0].exerciseId, 'pullup-chest', 'день C начинается с подтягиваний грудью')
  assertEqual(c.items[0].fromWeekInPhase, 1, 'грудью с первой недели')
  assertEqual(a.items.find(i => i.exerciseId === 'bar-dip')?.fromWeekInPhase, 9, 'отжимания на перекладине с недели 9')
  assertEqual(c.items.find(i => i.exerciseId === 'bar-dip')?.fromWeekInPhase, 9, 'то же в дне C')
  const f3 = P.phases[3]
  assertEqual(f3.exit.map(e => e.kind), ['manual', 'reps', 'weighted-reps'], 'выход f3')
  assertEqual(f3.exit[2], { kind: 'weighted-reps', exerciseId: 'pullup-weighted', reps: 5, addedKg: 10, text: f3.exit[2].text }, 'вес +10 кг на 5')
  assertEqual(P.phases[0].exit[0], { kind: 'hold', exerciseId: 'hang', seconds: 45, text: P.phases[0].exit[0].text }, 'вис 45 с')
  assertEqual(P.phases[4].exit.map(e => e.kind), ['manual'], 'выход f4 вручную')
})

group('validateTrainingWeekdays: ровно три, не подряд', () => {
  assertEqual(validateTrainingWeekdays([0, 2, 4]), null, 'пн-ср-пт')
  assertEqual(validateTrainingWeekdays([4, 0, 2]), null, 'порядок не важен')
  assertEqual(validateTrainingWeekdays([1, 3, 5]), null, 'вт-чт-сб')
  assertEqual(validateTrainingWeekdays([0, 2, 5]), null, 'пн-ср-сб')
  assertEqual(validateTrainingWeekdays([0, 3, 5]), null, 'пн-чт-сб')
  assertEqual(validateTrainingWeekdays([2, 4, 6]), null, 'ср-пт-вс')
  assert(validateTrainingWeekdays([0, 2]) !== null, 'два дня')
  assert(validateTrainingWeekdays([0, 2, 4, 5]) !== null, 'четыре дня')
  assert(validateTrainingWeekdays([]) !== null, 'пусто')
  assert(validateTrainingWeekdays([0, 1, 4]) !== null, 'пн-вт подряд')
  assert(validateTrainingWeekdays([0, 2, 3]) !== null, 'ср-чт подряд')
  assert(validateTrainingWeekdays([0, 3, 6]) !== null, 'вс и пн соседние через границу недели')
  assert(validateTrainingWeekdays([2, 2, 4]) !== null, 'повтор дня')
  assert(validateTrainingWeekdays([0, 2, 7]) !== null, 'день 7 вне диапазона')
  assert(validateTrainingWeekdays([-1, 2, 4]) !== null, 'отрицательный день')
  assert(validateTrainingWeekdays([0, 2, 4.5]) !== null, 'дробный день')
  assert(validateTrainingWeekdays([0, 2, NaN]) !== null, 'NaN')
  assert(validateTrainingWeekdays(null as unknown as number[]) !== null, 'не массив')
})

group('startProgram: старт с понедельника недели, проверка дней', () => {
  const p = startProgram(P, '2026-10-15', [4, 0, 2])        // четверг
  assertEqual(p, {
    programId: 'muscleup-56', startedOn: '2026-10-12', trainingWeekdays: [0, 2, 4],
    phaseIndex: 0, phaseStartedWeek: 1, completedDays: [], measurements: [],
  }, 'начальный прогресс')
  assertEqual(startProgram(P, '2026-10-12', MWF).startedOn, '2026-10-12', 'понедельник остаётся')
  assertEqual(startProgram(P, '2026-10-18', MWF).startedOn, '2026-10-12', 'воскресенье той же недели')
  const days = [0, 2, 4]
  startProgram(P, START, days)
  assertEqual(days, [0, 2, 4], 'входной массив не изменён')
  assert(throwsRange(() => startProgram(P, START, [0, 1, 4])), 'подряд')
  assert(throwsRange(() => startProgram(P, START, [0, 2])), 'два дня')
  assert(throwsRange(() => startProgram(P, '2026-02-30', MWF)), 'несуществующая дата')
  assert(throwsRange(() => startProgram({ ...P, phases: [] }, START, MWF)), 'программа без фаз')
})

group('programWeek: сквозная неделя и границы', () => {
  const p = fresh()
  assertEqual(programWeek(p, '2026-10-11'), 0, 'воскресенье до старта')
  assertEqual(programWeek(p, '2026-10-12'), 1, 'первый день')
  assertEqual(programWeek(p, '2026-10-18'), 1, 'воскресенье первой недели')
  assertEqual(programWeek(p, '2026-10-19'), 2, 'понедельник второй недели')
  assertEqual(programWeek(p, on(56, 6)), 56, 'последний день 56-й недели')
  assertEqual(programWeek(p, on(57)), 57, 'за сеткой счёт продолжается')
  assertEqual(programWeek(p, '2027-10-04'), 52, 'через год, через границу года')
})

group('isDeloadWeek: каждая четвёртая', () => {
  const weeks = [1, 2, 3, 4, 5, 8, 12, 16, 20, 56].map(w => isDeloadWeek(P, w))
  assertEqual(weeks, [false, false, false, true, false, true, true, true, true, true], 'недели 4, 8, 12, ...')
  assert(!isDeloadWeek(P, 0), 'ноль не разгрузка')
  assert(!isDeloadWeek(P, -4), 'отрицательная неделя')
  assert(!isDeloadWeek(P, 4.5), 'дробная неделя')
  assert(!isDeloadWeek({ ...P, deloadEveryWeeks: 0 }, 4), 'период 0 отключает разгрузку')
  assertEqual(programPosition(P, fresh(), on(4)).deload, true, 'позиция знает разгрузку')
})

group('фаза: подтверждённая и календарная', () => {
  assertEqual(phaseFor(P, fresh()).id, 'f0', 'старт в f0')
  assertEqual(phaseFor(P, inPhase(2, 15)).id, 'f2', 'по phaseIndex')
  assertEqual(phaseFor(P, { ...fresh(), phaseIndex: 99 }).id, 'f4', 'индекс за пределом зажат сверху')
  assertEqual(phaseFor(P, { ...fresh(), phaseIndex: -3 }).id, 'f0', 'отрицательный зажат снизу')
  assertEqual(phaseFor(P, { ...fresh(), phaseIndex: 1.5 }).id, 'f0', 'дробный индекс - мусор, первая фаза')
  assertEqual([1, 3, 4, 14, 15, 30, 31, 44, 45, 56].map(w => calendarPhaseIndex(P, w)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], 'границы календарных фаз')
  assertEqual(calendarPhaseIndex(P, 80), 4, 'за сеткой - последняя')
  assertEqual(calendarPhaseIndex(P, 0), 0, 'до старта - первая')
  assertEqual(programPosition(P, inPhase(1, 6), on(5)).calendarPhaseIndex, 1, 'календарь независим от подтверждения')
})

group('dayKeyFor: ротация сквозным счётчиком, пропуск сетку не сдвигает', () => {
  const f1 = P.phases[1]
  const keys: string[] = []
  let p = inPhase(1, 4)
  for (let i = 0; i < 6; i++) {
    const k = dayKeyFor(p, f1)
    keys.push(k)
    p = completeProgramDay(p, { date: addDays(on(4), i * 2), dayKey: k, sessionId: `s${i}` })
  }
  assertEqual(keys, ['A', 'B', 'A', 'B', 'A', 'B'], 'A-B-A, затем B-A-B продолжается сквозь неделю')

  // Пропуск: календарь прошёл неделю, выполнены два дня - следующий третий по счёту.
  const skipped = done(inPhase(1, 4), 2, 14)
  assertEqual(dayKeyFor(skipped, f1), 'A', 'после двух выполненных снова A, пропущенные не считаются')
  assertEqual(dayKeyFor(inPhase(1, 4), f1), 'A', 'ничего не выполнено - A')
  assertEqual(dayKeyFor(done(inPhase(1, 4), 1), f1), 'B', 'после одного - B')

  const f2 = P.phases[2]
  assertEqual([0, 1, 2, 3, 4, 5, 6].map(n => dayKeyFor(done(inPhase(2, 15), n), f2)), ['A', 'B', 'C', 'A', 'B', 'C', 'A'], 'A-B-C по кругу')
  assertEqual(dayKeyFor(done(fresh(), 5), P.phases[0]), 'A', 'одна клетка ротации')
  const garbage = { ...inPhase(1, 4), completedDays: [{ date: 'мусор', dayKey: 'A', sessionId: 'z' }, { date: on(4), dayKey: 'A', sessionId: 'y' }] }
  assertEqual(dayKeyFor(garbage, f1), 'B', 'запись с битой датой не считается')
  assert(throwsRange(() => dayKeyFor(fresh(), { ...f1, rotation: [] })), 'пустая ротация')
})

group('isTrainingDay и isDayCompleted', () => {
  const p = fresh()
  assertEqual([0, 1, 2, 3, 4, 5, 6].map(i => isTrainingDay(p, addDays(START, i))), [true, false, true, false, true, false, false], 'пн-ср-пт')
  assert(!isTrainingDay(p, '2026-10-09'), 'пятница до старта')
  assert(!isTrainingDay(stopProgram(p, 1), START), 'остановленная программа')
  const d = completeProgramDay(p, { date: START, dayKey: 'A', sessionId: 's1' })
  assert(isDayCompleted(d, START), 'день отмечен')
  assert(!isDayCompleted(d, '2026-10-14'), 'другой день не отмечен')
  assertEqual(completeProgramDay(d, { date: START, dayKey: 'A', sessionId: 's1' }), d, 'повтор того же сеанса игнорируется')
  assertEqual(d.completedDays.length, 1, 'одна запись')
  assertEqual(p.completedDays.length, 0, 'исходный прогресс не изменён')
  assert(throwsRange(() => completeProgramDay(p, { date: 'xx', dayKey: 'A', sessionId: 's' })), 'битая дата')
})

group('programDayTemplate: f0 неделя 1', () => {
  const p = fresh()
  assertEqual(weekdayIndexMon(START), 0, 'старт - понедельник')
  const t = programDayTemplate(P, p, START)
  assertEqual(t.programRef, { programId: 'muscleup-56', phaseId: 'f0', dayKey: 'A', week: 1, deload: false }, 'ссылка на программу')
  assertEqual(t.id, 'muscleup-56-f0-a', 'id')
  assertEqual(t.title, 'Подвес: Комплекс', 'название')
  assertEqual(t.source, 'program', 'источник')
  assertEqual(t.pillars, ['strength'], 'столп')
  assertEqual(t.place, 'any', 'место')
  assert(t.excludeFromWeek !== true, 'тяжёлый день идёт в неделю')
  assertEqual(t.items.map(i => i.exerciseId), ['hang', 'scap-pullup', 'row-table', 'pushup', 'hollow-hold'], 'состав f0')
  assertEqual(t.items[0], { exerciseId: 'hang', sets: 3, reps: 'max', restSec: 120, cue: t.items[0].cue }, 'вис 3 x max')
  assertEqual(t.items[2].reps, [8, 10], 'диапазон повторов')
  assertEqual(t.items[4], { exerciseId: 'hollow-hold', sets: 3, seconds: 20, restSec: 60, cue: t.items[4].cue }, 'планка 20 с')
  assertEqual(t.goals, {}, 'целей плотности нет')
  assert(t.estMinutes >= 10 && t.estMinutes <= 60, `оценка длительности правдоподобна: ${t.estMinutes}`)
  // Копия данных: правка шаблона не портит программу.
  ;(t.items[2].reps as number[])[0] = 99
  assertEqual(P.phases[0].days[0].items[2].reps, [8, 10], 'данные программы не изменились')
  assert(throwsRange(() => programDayTemplate(P, p, '2026-10-11')), 'до старта')
  assert(throwsRange(() => programDayTemplate(P, stopProgram(p, 1), START)), 'остановлена')
  assert(throwsRange(() => programDayTemplate(P, { ...p, programId: 'other' }, START)), 'чужая программа')
})

group('programDayTemplate: разгрузка x0,6, минимум 1', () => {
  const t = programDayTemplate(P, inPhase(1, 4), on(4))
  assert(t.programRef.deload, 'неделя 4 - разгрузка')
  assertEqual(t.programRef.week, 4, 'сквозная неделя в ссылке')
  assertEqual(t.title, 'Первые пять: День A: сила (разгрузка)', 'пометка в названии')
  assertEqual(t.items.map(i => i.sets), [3, 2, 2, 2, 2], '5->3, 3->2')
  assertEqual(t.items[0].reps, 1, 'повторы те же')
  assertEqual(t.items[0].restSec, 180, 'отдых тот же')
  const normal = programDayTemplate(P, inPhase(1, 4), on(5))
  assertEqual(normal.items.map(i => i.sets), [5, 3, 3, 3, 3], 'обычная неделя без изменений')
  assert(!normal.programRef.deload, 'неделя 5 без разгрузки')
  // B-день на разгрузке: 5 x 5 -> 3, 4 -> 2, 3 -> 2
  const b = programDayTemplate(P, done(inPhase(1, 4), 1, 14), on(8))
  assertEqual(b.programRef.dayKey, 'B', 'день B')
  assertEqual(b.items.map(i => i.sets), [3, 2, 2, 2, 2], 'B на разгрузке')
  // минимум 1 для малых подходов: f4 pullup 2 -> 1, muscleup-strict 3 -> 2
  const f4 = programDayTemplate(P, inPhase(4, 45), on(48))
  assert(f4.programRef.deload, 'неделя 48 - разгрузка')
  assertEqual(f4.items.map(i => i.sets), [2, 2, 2, 2, 1, 2], 'f4 на разгрузке')
  const tiny = { ...P, phases: [{ ...P.phases[0], days: [{ key: 'A', title: 'T', items: [{ exerciseId: 'hang', sets: 1, reps: 'max' as const }] }] }, ...P.phases.slice(1)] }
  assertEqual(programDayTemplate(tiny, fresh(), on(4)).items[0].sets, 1, 'один подход остаётся одним')
})

group('programDayTemplate: fromWeekInPhase заменяет негатив полным упражнением', () => {
  // f2 начинается на сквозной неделе 15; неделя 22 - 8-я неделя фазы, 23 - 9-я.
  const w8 = programDayTemplate(P, inPhase(2, 15), on(22))
  assertEqual(w8.items.map(i => i.exerciseId), ['pullup', 'bar-dip-negative', 'row-table', 'hollow-hold'], 'неделя фазы 8: негативы')
  const w9 = programDayTemplate(P, inPhase(2, 15), on(23))
  assertEqual(w9.items.map(i => i.exerciseId), ['pullup', 'bar-dip', 'row-table', 'hollow-hold'], 'неделя фазы 9: полные')
  assertEqual(w9.items[1].reps, 5, 'bar-dip 4 x 5')
  const w1 = programDayTemplate(P, inPhase(2, 15), on(15))
  assertEqual(w1.items.map(i => i.exerciseId), ['pullup', 'bar-dip-negative', 'row-table', 'hollow-hold'], 'неделя фазы 1')
  // День C: подтягивания грудью с недели 1, bar-dip 4 x 6 с недели 9.
  const c8 = programDayTemplate(P, done(inPhase(2, 15), 2, 28), on(22))
  assertEqual(c8.programRef.dayKey, 'C', 'день C')
  assertEqual(c8.items.map(i => i.exerciseId), ['pullup-chest', 'bar-dip-negative', 'hollow-rocks'], 'C до недели 9')
  assertEqual(c8.items[1].reps, 2, 'негатив 4 x 2')
  const c9 = programDayTemplate(P, done(inPhase(2, 15), 2, 28), on(23))
  assertEqual(c9.items.map(i => i.exerciseId), ['pullup-chest', 'bar-dip', 'hollow-rocks'], 'C с недели 9')
  assertEqual(c9.items[1].reps, 6, 'bar-dip 4 x 6')
  // Неделя фазы считается от подтверждённого начала, а не от календаря.
  const late = programDayTemplate(P, inPhase(2, 17), on(23))
  assertEqual(late.items[1].exerciseId, 'bar-dip-negative', 'фаза началась позже - негативы дольше')

  const day = P.phases[2].days[0].items
  assertEqual(visibleItems(day, 1).length, 4, 'visibleItems: неделя 1')
  assertEqual(visibleItems(day, 9).length, 4, 'visibleItems: неделя 9')
  assertEqual(visibleItems(day, 100).map(i => i.exerciseId), ['pullup', 'bar-dip', 'row-table', 'hollow-hold'], 'visibleItems: далеко за планом')
  assertEqual(visibleItems([], 3), [], 'visibleItems: пусто')
})

group('programDayTemplate: лесенка и плотность', () => {
  const a = programDayTemplate(P, inPhase(2, 15), on(15))
  assertEqual(a.items[0].sets, 4, 'четыре круга')
  assertEqual(a.items[0].reps, 9, 'круг 1+2+3+2+1 = 9 повторений одним подходом')
  assertEqual(a.items[0].restSec, 0, 'таймер отдыха внутри круга не нужен')
  assert(a.items[0].cue !== undefined && a.items[0].cue.startsWith('Круг лесенки 1-2-3-2-1 (9 повторений)'), 'подсказка описывает лесенку')
  assert(a.items[0].cue!.includes('Отдых между лесенками'), 'правило отдыха сохранено')

  const b = programDayTemplate(P, done(inPhase(2, 15), 1, 14), on(17))
  assertEqual(b.programRef.dayKey, 'B', 'день B')
  assertEqual(b.goals, { 0: { kind: 'total-reps', reps: 25 } }, 'цель плотности по индексу элемента')
  assertEqual(b.items[0].sets, 1, 'один подход как отправная точка')
  assertEqual(b.items[0].reps, undefined, 'число повторений в подходе не задано')
  assert(b.items[0].cue!.includes('минимальное число подходов'), 'cue плотности')

  // Разгрузка: круги лесенки 4->2, цель плотности 25->15.
  const aD = programDayTemplate(P, inPhase(2, 15), on(20))
  assert(aD.programRef.deload, 'неделя 20 - разгрузка')
  assertEqual(aD.items[0].sets, 2, 'круги лесенки x0,6')
  assertEqual(aD.items[0].reps, 9, 'ступени те же')
  const bD = programDayTemplate(P, done(inPhase(2, 15), 1, 14), on(20))
  assertEqual(bD.goals[0], { kind: 'total-reps', reps: 15 }, 'цель плотности x0,6')
})

group('programDayTemplate: f3 и f4', () => {
  const f3 = programDayTemplate(P, inPhase(3, 31), on(33))
  assertEqual(f3.items.map(i => i.exerciseId), ['pullup-explosive', 'pullup-weighted', 'bar-dip', 'hang-false-grip', 'pullup'], 'состав f3')
  assertEqual(f3.items[2].reps, [8, 12], 'bar-dip 8-12')
  assertEqual(f3.items[3].seconds, 15, 'ложный хват 15 с')
  assertEqual(f3.items[4].reps, 'max', 'поддержание: max')
  assertEqual(f3.programRef.phaseId, 'f3', 'фаза в ссылке')
  const f4 = programDayTemplate(P, inPhase(4, 45), on(46))
  assertEqual(f4.items.map(i => i.exerciseId), ['muscleup-negative', 'muscleup-transition-band', 'muscleup-kip', 'muscleup-strict', 'pullup', 'bar-dip'], 'состав f4')
  assertEqual(f4.items.map(i => i.sets), [3, 3, 3, 3, 2, 3], 'подходы f4')
})

group('measurementDue: каждые 14 дней', () => {
  const p = fresh()
  assert(!measurementDue(p, START), 'в день старта замера нет')
  assert(!measurementDue(p, on(2, 5)), 'на 12-е сутки рано')
  assert(!measurementDue(p, on(2, 6)), 'на 13-е сутки рано')
  assert(measurementDue(p, on(3)), 'на 14-е сутки пора (отсчёт от старта)')
  assert(measurementDue(p, on(10)), 'долго не мерили - пора')
  const m = addMeasurement(p, on(3), 2)
  assert(!measurementDue(m, on(3)), 'в день замера уже не нужен')
  assert(!measurementDue(m, on(4, 6)), '13 суток после замера')
  assert(measurementDue(m, on(5)), '14 суток после замера')
  const two = addMeasurement(addMeasurement(p, on(3), 2), on(1), 1)
  assert(!measurementDue(two, on(4, 6)), 'считается от самого позднего, порядок записей не важен')
  const junk = { ...p, measurements: [{ date: 'мусор', reps: 1 }, { date: on(3), reps: 2 }] }
  assert(!measurementDue(junk, on(4)), 'запись с битой датой игнорируется')
  assert(!measurementDue(stopProgram(p, 1), on(10)), 'остановленная программа')
  assert(!measurementDue(p, '2026-10-01'), 'до старта')
  assert(measurementDue(p, on(2, 2), 7), 'свой интервал 7 суток')
  const future = addMeasurement(p, on(20), 3)
  assert(!measurementDue(future, on(3)), 'замер из будущего (сбой часов) не вызывает напоминания')
  assertEqual(addMeasurement(p, on(1), 0).measurements, [{ date: on(1), reps: 0 }], 'ноль повторений допустим')
  assertEqual(p.measurements.length, 0, 'исходный прогресс не изменён')
  assert(throwsRange(() => addMeasurement(p, on(1), -1)), 'отрицательные повторения')
  assert(throwsRange(() => addMeasurement(p, on(1), 2.5)), 'дробные повторения')
  assert(throwsRange(() => addMeasurement(p, 'xx', 2)), 'битая дата')
})

group('застой: недели сверх плана и подсказка через три недели', () => {
  // f1 началась на неделе 4, план 11 недель: 11-я неделя фазы - сквозная 14.
  const p = inPhase(1, 4)
  assertEqual(overdueWeeks(P, p, on(14)), 0, 'последняя неделя плана')
  assertEqual(programPosition(P, p, on(14)).weekInPhase, 11, 'неделя 11 из 11')
  assertEqual(programPosition(P, p, on(15)).weekInPhase, 12, 'неделя 12 из 11')
  assertEqual(overdueWeeks(P, p, on(15)), 1, 'неделя 12 из 11: одна сверх плана')
  assertEqual(stagnationHint(P, p, on(15)), [], 'через одну неделю подсказки нет')
  assertEqual(stagnationHint(P, p, on(16)), [], 'через две недели подсказки нет')
  assertEqual(overdueWeeks(P, p, on(17)), 3, 'три недели сверх плана')
  assertEqual(stagnationHint(P, p, on(17)), P.stagnation, 'через три недели подсказка есть')
  assertEqual(stagnationHint(P, p, on(30)), P.stagnation, 'и дальше остаётся')
  assertEqual(overdueWeeks(P, fresh(), START), 0, 'в срок - ноль')
  assertEqual(overdueWeeks(P, fresh(), '2026-10-01'), 0, 'до старта - ноль')
  assertEqual(stagnationHint(P, stopProgram(p, 1), on(30)), [], 'остановленная программа не пугает')
  const hint = stagnationHint(P, p, on(17))
  hint.push('x')
  assertEqual(P.stagnation.length, 3, 'подсказка - копия')
  // Поздний переход отодвигает отсчёт: новая фаза считает свои недели с начала.
  assertEqual(overdueWeeks(P, inPhase(2, 20), on(25)), 0, 'f2 началась на неделе 20: неделя фазы 6 из 16')
  assertEqual(overdueWeeks(P, inPhase(4, 60), on(75)), 4, 'последняя фаза тоже: неделя фазы 16 из 12')
})

group('advancePhase и чек-лист выхода', () => {
  const p = done(inPhase(0, 1), 3)
  const today = on(3, 4)
  const next = advancePhase(P, p, today, new Date(2026, 9, 30, 18, 0).getTime())
  assertEqual(next.phaseIndex, 1, 'следующая фаза')
  assertEqual(next.phaseStartedWeek, 3, 'новая фаза с текущей недели')
  assertEqual(next.exitConfirmedAt, new Date(2026, 9, 30, 18, 0).getTime(), 'момент подтверждения запомнен')
  assertEqual(p.phaseIndex, 0, 'исходный прогресс не изменён')
  assertEqual(programPosition(P, next, today).weekInPhase, 1, 'неделя 1 новой фазы')
  assertEqual(phaseFor(P, next).id, 'f1', 'фаза f1')

  // Дни до подтверждения в ротацию новой фазы не идут; день после - идёт.
  assertEqual(dayKeyFor(next, phaseFor(P, next)), 'A', 'новая фаза начинается с A')
  const after = completeProgramDay(next, { date: addDays(START, 20), dayKey: 'A', sessionId: 'new1' })
  assertEqual(dayKeyFor(after, phaseFor(P, after)), 'B', 'после первого дня новой фазы - B')
  const sameDay = completeProgramDay(next, { date: '2026-10-30', dayKey: 'A', sessionId: 'old' })
  assertEqual(dayKeyFor(sameDay, phaseFor(P, sameDay)), 'A', 'день подтверждения относится к старой фазе')

  // Цепочка до последней фазы.
  let q = fresh()
  for (let i = 0; i < 4; i++) q = advancePhase(P, q, on(10 + i), 1000 + i)
  assertEqual(q.phaseIndex, 4, 'пятая фаза')
  assert(isLastPhase(P, q), 'последняя фаза')
  assert(!isLastPhase(P, fresh()), 'первая не последняя')
  assert(throwsRange(() => advancePhase(P, q, on(60), 5)), 'из последней фазы перехода нет')
  assert(throwsRange(() => advancePhase(P, stopProgram(fresh(), 1), START, 1)), 'остановленная')
  assert(throwsRange(() => advancePhase(P, fresh(), '2026-10-01', 1)), 'до старта')
  assert(throwsRange(() => advancePhase(P, { ...fresh(), programId: 'other' }, START, 1)), 'чужая программа')

  const f0 = P.phases[0]
  assert(exitChecklistComplete(f0, [true, true]), 'все отмечены')
  assert(!exitChecklistComplete(f0, [true, false]), 'не все отмечены')
  assert(!exitChecklistComplete(f0, [true]), 'короткий список')
  assert(!exitChecklistComplete(f0, [true, true, true]), 'длинный список')
  assert(!exitChecklistComplete(f0, []), 'пустой список')
  assert(!exitChecklistComplete({ ...f0, exit: [] }, []), 'фаза без критериев не проходится сама')
})

group('stopProgram и weekStartDate', () => {
  const p = fresh()
  assert(isProgramActive(p), 'новая программа идёт')
  const s = stopProgram(p, 1234)
  assertEqual(s.stoppedAt, 1234, 'время остановки')
  assert(!isProgramActive(s), 'остановлена')
  assertEqual(stopProgram(s, 9999).stoppedAt, 1234, 'повторная остановка время не меняет')
  assertEqual(p.stoppedAt, undefined, 'исходный прогресс не изменён')
  assertEqual(weekStartDate(p, 1), START, 'неделя 1')
  assertEqual(weekStartDate(p, 5), '2026-11-09', 'неделя 5')
  assertEqual(weekStartDate(p, 12), '2026-12-28', 'неделя 12')
  assertEqual(weekStartDate(p, 13), '2027-01-04', 'через границу года')
})

finish()
