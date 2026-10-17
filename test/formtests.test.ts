import { assert, assertEqual, finish, group } from './_harness.ts'
import { FORM_TESTS, FORM_TESTS_BY_ID } from '../src/data/formtests.ts'
import {
  RESTING_HR_TEST_ID, ageBand, ageFromBirthYear, applyRestingHr, bandIndex, daysUntilDue, dueStatus,
  evaluateTest, latestResult, nextDue, normsForAge, sideGap, testSeries,
} from '../src/core/formtests.ts'
import type { FormBand, FormTestDef } from '../src/core/formtests.ts'
import type { Settings, TestResult } from '../src/core/types.ts'

const T = (id: string): FormTestDef => {
  const t = FORM_TESTS_BY_ID[id]
  assert(t, `нет теста ${id}`)
  return t
}

function result(testId: string, date: string, value: number, id = `${testId}-${date}`): TestResult {
  return { id, testId, date, values: {}, result: value }
}

function settings(over: Partial<Settings> = {}): Settings {
  return {
    birthYear: 2007, bodyWeightKg: null, maxHrMode: 'formula', maxHrManual: null, restingHr: null,
    restingHrManual: false,
    goals: {
      strengthSets: 50, strengthDays: 3, zone2Minutes: 150, intervalSessions: 1, intervalHardMinutes: 4,
      mobilityMinutes: 30, mobilityDays: 3, balanceMinutes: 30, balanceDays: 3,
    },
    homeEquipment: [], defaultRestSec: 90, sound: 'silent', keepAwake: true, healthShortcutName: '',
    onboardingDone: false, ...over,
  }
}

function labelOf(id: string, values: Record<string, number>, age: number | null): string | null {
  const e = evaluateTest(T(id), values, age)
  assert(e.ok, `оценка ${id} не удалась`)
  return e.band ? e.band.label : null
}

group('данные: состав набора и поля', () => {
  assertEqual(FORM_TESTS.map(t => t.id), [
    'grip', 'pushups', 'pullups', 'sit-rise', 'sit-reach', 'single-leg-stance-closed', 'waist-height', 'cooper', 'resting-hr',
  ], 'девять тестов раздела 3.6 по порядку')
  assertEqual(new Set(FORM_TESTS.map(t => t.id)).size, FORM_TESTS.length, 'id уникальны')
  for (const t of FORM_TESTS) {
    assert(t.title.length > 0 && t.howTo.length > 0, `${t.id}: заголовок и howTo`)
    assert(Number.isInteger(t.repeatDays) && t.repeatDays > 0, `${t.id}: срок повтора`)
    assert(t.fields.length > 0, `${t.id}: есть поля`)
    assertEqual(new Set(t.fields.map(f => f.key)).size, t.fields.length, `${t.id}: ключи полей уникальны`)
  }
  assertEqual(FORM_TESTS.map(t => t.repeatDays), [42, 42, 14, 35, 35, 35, 42, 49, 7], 'сроки повтора')
  assertEqual(T('pullups').linkedExerciseId, 'pullup', 'подтягивания связаны с упражнением')
  assertEqual(T('pullups').norms, [], 'у подтягиваний норм нет')
  assertEqual(T('grip').reduce, 'bestOfSides', 'свёртка хвата')
  assertEqual(T('sit-reach').reduce, 'max', 'свёртка наклона')
  assertEqual(T('single-leg-stance-closed').reduce, 'min', 'свёртка стойки')
  assertEqual(T('waist-height').reduce, 'ratio', 'свёртка талии')
})

group('данные: полосы непрерывны, без дыр и наложений', () => {
  for (const t of FORM_TESTS) {
    for (const table of t.norms) {
      const where = `${t.id} ${table.ageFrom}-${table.ageTo}`
      const b = table.bands
      assert(b.length >= 2, `${where}: минимум две полосы`)
      assertEqual(b[0].from, undefined, `${where}: первая полоса без from`)
      assertEqual(b[b.length - 1].upTo, undefined, `${where}: последняя без upTo`)
      for (let i = 0; i < b.length; i++) {
        if (i > 0) assertEqual(b[i].from, b[i - 1].upTo, `${where}: полоса ${i} начинается там, где кончилась предыдущая`)
        if (i > 0 && i < b.length - 1) {
          assert(b[i].from !== undefined && b[i].upTo !== undefined && b[i].from! < b[i].upTo!, `${where}: средняя полоса ${i} непуста`)
        }
        assert(b[i].label.length > 0, `${where}: подпись полосы ${i}`)
      }
      /* Каждая точка сетки попадает ровно в одну полосу. */
      for (let v = 0; v <= 3000; v += 0.05) {
        const value = Math.round(v * 100) / 100
        const hits = b.filter(x => (x.from === undefined || value >= x.from) && (x.upTo === undefined || value < x.upTo)).length
        if (hits !== 1) { assertEqual(hits, 1, `${where}: значение ${value} попало в ${hits} полос`); break }
      }
    }
  }
})

group('данные: возрастные строки не пересекаются, границы строк', () => {
  for (const t of FORM_TESTS) {
    const rows = [...t.norms].sort((a, b) => a.ageFrom - b.ageFrom)
    for (let i = 0; i < rows.length; i++) {
      assert(rows[i].ageFrom <= rows[i].ageTo, `${t.id}: строка ${i} не пуста`)
      if (i > 0) assert(rows[i].ageFrom > rows[i - 1].ageTo, `${t.id}: строки ${i - 1} и ${i} не пересекаются`)
    }
  }
  assertEqual(T('sit-reach').norms.map(n => [n.ageFrom, n.ageTo]), [[18, 25], [26, 35]], 'sit-reach: две строки')
  assertEqual(T('grip').norms.map(n => [n.ageFrom, n.ageTo]), [[18, 19], [20, 24], [25, 29]], 'grip: три строки')
})

group('ageBand, normsForAge, ageFromBirthYear', () => {
  const sr = T('sit-reach')
  assertEqual(ageBand(sr.norms, 18)?.ageTo, 25, '18 лет: первая строка')
  assertEqual(ageBand(sr.norms, 25)?.ageTo, 25, '25 лет: граница первой строки включительно')
  assertEqual(ageBand(sr.norms, 26)?.ageTo, 35, '26 лет: вторая строка')
  assertEqual(ageBand(sr.norms, 35)?.ageTo, 35, '35 лет: граница второй строки')
  assertEqual(ageBand(sr.norms, 17), null, 'младше строк')
  assertEqual(ageBand(sr.norms, 36), null, 'старше строк')
  assertEqual(ageBand(sr.norms, null), null, 'возраст неизвестен')
  assertEqual(ageBand(sr.norms, NaN), null, 'возраст NaN')
  assertEqual(ageBand([], 20), null, 'пустая таблица')
  assertEqual(normsForAge(T('grip'), 21)[0].upTo, 36.8, 'нормы хвата 20-24')
  assertEqual(normsForAge(T('grip'), 40), [], 'нет строки: пустые нормы')
  assertEqual(normsForAge(T('grip'), null), [], 'нет возраста: пустые нормы')
  assertEqual(normsForAge(T('pullups'), 20), [], 'подтягивания: норм нет')

  assertEqual(ageFromBirthYear(2007, '2026-10-17'), 19, 'возраст по календарному году')
  assertEqual(ageFromBirthYear(2007, '2026-01-01'), 19, 'не зависит от дня рождения')
  assertEqual(ageFromBirthYear(null, '2026-10-17'), null, 'год не задан')
  assertEqual(ageFromBirthYear(2030, '2026-10-17'), null, 'год из будущего')
  assertEqual(ageFromBirthYear(1800, '2026-10-17'), null, 'нелепый год')
  assertEqual(ageFromBirthYear(2000.5, '2026-10-17'), null, 'нецелый год')
  assertEqual(ageFromBirthYear(2026, '2026-10-17'), 0, 'родился в этом году')
})

group('bandIndex: границы полуинтервалов', () => {
  const bands = T('grip').norms[0].bands
  assertEqual(bandIndex(bands, 0), 0, 'ноль: нижняя полоса')
  assertEqual(bandIndex(bands, 35.6), 0, 'чуть ниже границы')
  assertEqual(bandIndex(bands, 35.7), 1, 'граница относится к верхней полосе')
  assertEqual(bandIndex(bands, 55.5), 2, 'вторая граница')
  assertEqual(bandIndex(bands, 1000), 2, 'очень много')
  assertEqual(bandIndex(bands, NaN), -1, 'NaN')
  assertEqual(bandIndex(bands, Infinity), -1, 'бесконечность')
  assertEqual(bandIndex([], 5), -1, 'нет полос')
})

group('свёртка first: отжимания, подтягивания, Купер', () => {
  const p = evaluateTest(T('pushups'), { reps: 30 }, 20)
  assert(p.ok, 'отжимания считаются')
  assertEqual(p.result, 30, 'результат')
  assertEqual(p.band?.label, 'хорошо', '30 в 20-29: хорошо')
  assertEqual(p.better, 'higher', 'больше лучше')
  assertEqual(labelOf('pushups', { reps: 0 }, 20), 'низко', 'ноль допустим')
  assertEqual(labelOf('pushups', { reps: 11 }, 20), 'низко', '11')
  assertEqual(labelOf('pushups', { reps: 12 }, 20), 'ниже среднего', 'граница 12')
  assertEqual(labelOf('pushups', { reps: 21 }, 20), 'ниже среднего', '21')
  assertEqual(labelOf('pushups', { reps: 22 }, 20), 'средне', '22')
  assertEqual(labelOf('pushups', { reps: 25 }, 20), 'средне', '25')
  assertEqual(labelOf('pushups', { reps: 26 }, 20), 'хорошо', '26')
  assertEqual(labelOf('pushups', { reps: 37 }, 20), 'хорошо', '37: бывший разрыв источника')
  assertEqual(labelOf('pushups', { reps: 38 }, 20), 'хорошо', '38: бывший разрыв источника')
  assertEqual(labelOf('pushups', { reps: 39 }, 20), 'отлично', '39')
  assertEqual(labelOf('pushups', { reps: 44 }, 18), 'хорошо', 'подростки: 44')
  assertEqual(labelOf('pushups', { reps: 45 }, 18), 'отлично', 'подростки: 45')
  assertEqual(labelOf('pushups', { reps: 13 }, 18), 'низко', 'подростки: 13')
  assertEqual(labelOf('pushups', { reps: 29 }, 18), 'средне', 'подростки: 29')

  const pu = evaluateTest(T('pullups'), { reps: 7 }, 19)
  assert(pu.ok, 'подтягивания считаются')
  assertEqual(pu.band, null, 'нормы нет, полосы нет')
  assertEqual(pu.better, null, 'нет таблицы: направление неизвестно')
  assertEqual(pu.result, 7, 'результат есть')

  /* Лишние ключи значений игнорируются, нужное поле только первое. */
  const extra = evaluateTest(T('pushups'), { reps: 5, junk: -3 }, 20)
  assert(extra.ok && extra.result === 5, 'лишний ключ не мешает')
})

group('свёртка max: наклон вперёд', () => {
  const both = evaluateTest(T('sit-reach'), { attempt1: 40, attempt2: 45 }, 20)
  assert(both.ok, 'две попытки')
  assertEqual(both.result, 45, 'берётся большая')
  const swapped = evaluateTest(T('sit-reach'), { attempt1: 45, attempt2: 40 }, 20)
  assert(swapped.ok && swapped.result === 45, 'порядок попыток не важен')
  const one = evaluateTest(T('sit-reach'), { attempt1: 38 }, 20)
  assert(one.ok && one.result === 38, 'одна попытка допустима')
  const zero = evaluateTest(T('sit-reach'), { attempt1: 0, attempt2: 0 }, 20)
  assert(zero.ok && zero.result === 0, 'нули допустимы')
  assertEqual(zero.ok && zero.band?.label, 'ниже среднего', 'ноль: нижняя полоса')
  const none = evaluateTest(T('sit-reach'), {}, 20)
  assertEqual(none, { ok: false, reason: 'missing-field', field: 'attempt1' }, 'нет ни одной попытки')
  assertEqual(labelOf('sit-reach', { attempt1: 38 }, 20), 'ниже среднего', '38 < 38,1')
  assertEqual(labelOf('sit-reach', { attempt1: 38.1 }, 20), 'норма', '38,1: p40')
  assertEqual(labelOf('sit-reach', { attempt1: 48.2 }, 20), 'норма', '48,2')
  assertEqual(labelOf('sit-reach', { attempt1: 48.3 }, 20), 'выше среднего', '48,3: p70')
  assertEqual(labelOf('sit-reach', { attempt1: 43.2 }, 30), 'выше среднего', '26-35: 43,2 это p70')
  assertEqual(labelOf('sit-reach', { attempt1: 35.5 }, 30), 'ниже среднего', '26-35: 35,5')
  assertEqual(labelOf('sit-reach', { attempt1: 40 }, 30), 'норма', '26-35: 40')
  assertEqual(labelOf('sit-reach', { attempt1: 38 }, 25), 'ниже среднего', '25 лет по строке 18-25')
  assertEqual(labelOf('sit-reach', { attempt1: 38 }, 26), 'норма', '26 лет по строке 26-35')
})

group('свёртка min: слабая сторона в стойке на одной ноге', () => {
  const e = evaluateTest(T('single-leg-stance-closed'), { left: 40, right: 20 }, 19)
  assert(e.ok, 'считается')
  assertEqual(e.result, 20, 'результат: меньшая нога')
  assertEqual(e.band?.label, 'норма', '20 с: норма')
  assertEqual(labelOf('single-leg-stance-closed', { left: 45, right: 45 }, 19), 'выше среднего', 'предел 45 обеих ног')
  assertEqual(labelOf('single-leg-stance-closed', { left: 16, right: 45 }, 19), 'ниже среднего', 'слабая нога тянет вниз')
  assertEqual(labelOf('single-leg-stance-closed', { left: 17, right: 30 }, 19), 'норма', 'граница 17')
  assertEqual(labelOf('single-leg-stance-closed', { left: 35, right: 35 }, 19), 'норма', '35 включительно в норме')
  assertEqual(labelOf('single-leg-stance-closed', { left: 36, right: 36 }, 19), 'выше среднего', '36')
  assertEqual(labelOf('single-leg-stance-closed', { left: 20, right: 20 }, null), 'норма', 'возраст не нужен')
  assertEqual(
    evaluateTest(T('single-leg-stance-closed'), { left: 20 }, 19),
    { ok: false, reason: 'missing-field', field: 'right' },
    'одной ноги не хватает: min без обеих сторон не считается',
  )
  const zero = evaluateTest(T('single-leg-stance-closed'), { left: 0, right: 30 }, 19)
  assert(zero.ok && zero.result === 0, 'ноль секунд допустим')
})

group('свёртка bestOfSides: хват, разница рук', () => {
  const e = evaluateTest(T('grip'), { left: 38, right: 45 }, 21)
  assert(e.ok, 'считается')
  assertEqual(e.result, 45, 'результат: лучшая рука')
  assertEqual(e.band?.label, 'норма', '45 кг в 20-24: норма')
  assertEqual(labelOf('grip', { left: 36.7, right: 30 }, 21), 'слабо', 'ниже 36,8')
  assertEqual(labelOf('grip', { left: 36.8 }, 21), 'норма', 'одна рука: граница')
  assertEqual(labelOf('grip', { left: 56.6, right: 50 }, 21), 'сильно', 'граница сильно')
  assertEqual(labelOf('grip', { left: 36, right: 36 }, 19), 'норма', '18-19: 36 уже норма')
  assertEqual(labelOf('grip', { left: 36, right: 36 }, 25), 'слабо', '25-29: 36 ещё слабо')
  assertEqual(labelOf('grip', { left: 36, right: 36 }, 30), null, '30 лет: нет строки')
  assertEqual(evaluateTest(T('grip'), {}, 21), { ok: false, reason: 'missing-field', field: 'left' }, 'нет рук')

  assertEqual(sideGap({ left: 38, right: 45 }), { weaker: 'left', gap: 7 }, 'левая отстаёт на 7')
  assertEqual(sideGap({ left: 45, right: 42.5 }), { weaker: 'right', gap: 2.5 }, 'правая отстаёт на 2,5')
  assertEqual(sideGap({ left: 40, right: 40 }), null, 'руки равны')
  assertEqual(sideGap({ left: 40 }), null, 'одной руки нет')
  assertEqual(sideGap({ left: -1, right: 40 }), null, 'мусор')
  assertEqual(sideGap({ left: 40.1, right: 40.3 }), { weaker: 'left', gap: 0.2 }, 'плавающая точка округлена')
})

group('свёртка ratio: талия к росту и флаг', () => {
  const e = evaluateTest(T('waist-height'), { waistCm: 80, heightCm: 180 }, null)
  assert(e.ok, 'считается без возраста: норма не зависит от возраста')
  assertEqual(e.result, 0.44, '80 / 180 = 0,44')
  assertEqual(e.band?.label, 'здоровое соотношение', 'здоровая зона')
  assertEqual(e.band?.flag, false, 'без флага')
  assertEqual(e.better, 'lower', 'меньше лучше')
  assertEqual(labelOf('waist-height', { waistCm: 90, heightCm: 180 }, 19), 'здоровое соотношение', '0,50 включительно здорово')
  assertEqual(labelOf('waist-height', { waistCm: 91, heightCm: 180 }, 19), 'повышенное', '0,51')
  assertEqual(labelOf('waist-height', { waistCm: 102, heightCm: 180 }, 19), 'повышенное', '0,57')
  const high = evaluateTest(T('waist-height'), { waistCm: 105, heightCm: 180 }, 19)
  assert(high.ok, 'высокое считается')
  assertEqual(high.result, 0.58, '105 / 180 округляется до 0,58')
  assertEqual(high.band?.label, 'высокое', '0,58 и выше: высокое')
  assertEqual(high.band?.flag, true, 'красная точка')
  assertEqual(
    evaluateTest(T('waist-height'), { waistCm: 80, heightCm: 0 }, 19),
    { ok: false, reason: 'zero-denominator', field: 'heightCm' },
    'рост ноль',
  )
  assertEqual(
    evaluateTest(T('waist-height'), { waistCm: 80 }, 19),
    { ok: false, reason: 'missing-field', field: 'heightCm' },
    'нет роста',
  )
  assertEqual(
    evaluateTest(T('waist-height'), { heightCm: 180 }, 19),
    { ok: false, reason: 'missing-field', field: 'waistCm' },
    'нет талии',
  )
  const zeroWaist = evaluateTest(T('waist-height'), { waistCm: 0, heightCm: 180 }, 19)
  assert(zeroWaist.ok && zeroWaist.result === 0, 'нулевая талия считается нулём, не ошибкой')
})

group('Купер: полосы и производная VO2max', () => {
  const e = evaluateTest(T('cooper'), { distanceM: 2400 }, 19)
  assert(e.ok, 'считается')
  assertEqual(e.band?.label, 'хорошо', '2400 м: хорошо')
  assertEqual(e.derived?.kind, 'vo2max', 'есть производная')
  assertEqual(e.derived?.value, 42.4, '2400 м даёт 42,4')
  assertEqual(e.derived?.text, 'VO2max около 42,4 мл/кг/мин', 'текст с запятой')
  const e2 = evaluateTest(T('cooper'), { distanceM: 2200 }, 19)
  assert(e2.ok && e2.derived?.value === 37.9, '2200 м даёт 37,9')
  const e3 = evaluateTest(T('cooper'), { distanceM: 2800 }, 19)
  assert(e3.ok && e3.derived?.value === 51.3, '2800 м даёт 51,3')
  assertEqual(labelOf('cooper', { distanceM: 2199 }, 19), 'ниже среднего', '2199')
  assertEqual(labelOf('cooper', { distanceM: 2200 }, 19), 'средне', '2200')
  assertEqual(labelOf('cooper', { distanceM: 2399 }, 19), 'средне', '2399')
  assertEqual(labelOf('cooper', { distanceM: 2400 }, 19), 'хорошо', '2400')
  assertEqual(labelOf('cooper', { distanceM: 2800 }, 19), 'хорошо', '2800 включительно хорошо')
  assertEqual(labelOf('cooper', { distanceM: 2801 }, 19), 'отлично', '2801')
  const none = evaluateTest(T('pushups'), { reps: 10 }, 19)
  assert(none.ok && none.derived === undefined, 'у других тестов производной нет')
  const zero = evaluateTest(T('cooper'), { distanceM: 0 }, 19)
  assert(zero.ok && zero.band?.label === 'ниже среднего', 'ноль метров допустим')
})

group('пульс покоя: полосы и флаг', () => {
  assertEqual(labelOf('resting-hr', { bpm: 39 }, 19), 'проверить измерение', '39')
  assertEqual(labelOf('resting-hr', { bpm: 40 }, 19), 'тренированный', '40')
  assertEqual(labelOf('resting-hr', { bpm: 59 }, 19), 'тренированный', '59')
  assertEqual(labelOf('resting-hr', { bpm: 60 }, 19), 'норма', '60')
  assertEqual(labelOf('resting-hr', { bpm: 100 }, 19), 'норма', '100 включительно норма')
  const high = evaluateTest(T('resting-hr'), { bpm: 101 }, null)
  assert(high.ok, 'считается без возраста')
  assertEqual(high.band?.label, 'высокий', '101')
  assertEqual(high.band?.flag, true, 'флаг у высокого')
  const low = evaluateTest(T('resting-hr'), { bpm: 35 }, 19)
  assert(low.ok && low.band?.flag === false, 'флага у низкого нет')
})

group('оценка: мусор на входе и возраст неизвестен', () => {
  for (const bad of [NaN, -1, Infinity, -Infinity]) {
    assertEqual(
      evaluateTest(T('pushups'), { reps: bad }, 20),
      { ok: false, reason: 'invalid-number', field: 'reps' },
      `недопустимое число ${bad}`,
    )
  }
  assertEqual(
    evaluateTest(T('sit-reach'), { attempt1: 40, attempt2: NaN }, 20),
    { ok: false, reason: 'invalid-number', field: 'attempt2' },
    'мусор во второй попытке не прячется за хорошей первой',
  )
  assertEqual(
    evaluateTest(T('pushups'), { reps: '12' as unknown as number }, 20),
    { ok: false, reason: 'invalid-number', field: 'reps' },
    'строка вместо числа',
  )
  assertEqual(
    evaluateTest(T('pushups'), {}, 20),
    { ok: false, reason: 'missing-field', field: 'reps' },
    'пустые значения',
  )
  assertEqual(
    evaluateTest(T('pushups'), { reps: undefined as unknown as number }, 20),
    { ok: false, reason: 'missing-field', field: 'reps' },
    'undefined как отсутствие',
  )
  const noEmpty: FormTestDef = { ...T('pushups'), fields: [] }
  assertEqual(evaluateTest(noEmpty, {}, 20), { ok: false, reason: 'missing-field' }, 'тест без полей')

  /* Возраст неизвестен: результат есть, полосы нет, у возрастно-независимых тестов полоса есть. */
  const e = evaluateTest(T('pushups'), { reps: 30 }, null)
  assert(e.ok, 'результат считается без возраста')
  assertEqual(e.result, 30, 'результат')
  assertEqual(e.band, null, 'полосы нет')
  assertEqual(e.better, null, 'направление неизвестно')
  assertEqual(labelOf('cooper', { distanceM: 3000 }, null), 'отлично', 'Купер не зависит от возраста')
  assertEqual(labelOf('pushups', { reps: 30 }, 45), null, 'возраст вне таблиц: полосы нет')
  assertEqual(labelOf('pushups', { reps: 30 }, 12), null, 'младше таблиц')
})

group('latestResult и testSeries', () => {
  const list: TestResult[] = [
    result('pushups', '2026-09-01', 20),
    result('grip', '2026-09-10', 45),
    result('pushups', '2026-10-01', 25),
    result('pushups', '2026-08-01', 15),
  ]
  assertEqual(latestResult(list, 'pushups')?.result, 25, 'последний по дате, не по порядку записи')
  assertEqual(latestResult(list, 'cooper'), null, 'не делали')
  assertEqual(latestResult([], 'grip'), null, 'пустая история')
  assertEqual(testSeries(list, 'pushups'), [
    { date: '2026-08-01', score: 15 }, { date: '2026-09-01', score: 20 }, { date: '2026-10-01', score: 25 },
  ], 'ряд по возрастанию даты')
  assertEqual(testSeries(list, 'cooper'), [], 'пустой ряд')
  const sameDay = [result('grip', '2026-10-01', 40, 'a'), result('grip', '2026-10-01', 42, 'b')]
  assertEqual(latestResult(sameDay, 'grip')?.id, 'b', 'в один день последняя запись побеждает')
  assertEqual(testSeries(sameDay, 'grip').map(p => p.score), [40, 42], 'ряд сохраняет порядок записи в один день')
  const before = JSON.stringify(list)
  testSeries(list, 'pushups')
  assertEqual(JSON.stringify(list), before, 'входной массив не изменён')
})

group('nextDue и dueStatus: срок и статус', () => {
  const pushups = T('pushups')   // 42 дня
  const done = [result('pushups', '2026-09-01', 20)]
  assertEqual(nextDue(pushups, done, '2026-09-10'), '2026-10-13', 'дата + 42 дня')
  assertEqual(nextDue(pushups, [], '2026-09-10'), '2026-09-10', 'не делали: пора сегодня')
  assertEqual(nextDue(T('resting-hr'), [result('resting-hr', '2026-12-28', 55)], '2026-12-30'), '2027-01-04', 'переход через год')
  assertEqual(nextDue(T('resting-hr'), [result('resting-hr', '2028-02-26', 55)], '2028-02-27'), '2028-03-04', 'високосный февраль')

  assertEqual(dueStatus(pushups, [], '2026-10-01'), 'never', 'не делали')
  assertEqual(dueStatus(pushups, done, '2026-09-02'), 'ok', 'на следующий день')
  assertEqual(dueStatus(pushups, done, '2026-10-07'), 'ok', 'за 6 дней до срока')
  assertEqual(dueStatus(pushups, done, '2026-10-08'), 'soon', 'за 5 дней')
  assertEqual(dueStatus(pushups, done, '2026-10-12'), 'soon', 'за 1 день')
  assertEqual(dueStatus(pushups, done, '2026-10-13'), 'due', 'в день срока')
  assertEqual(dueStatus(pushups, done, '2026-12-01'), 'due', 'просрочен')
  assertEqual(dueStatus(pushups, done, '2026-08-01'), 'ok', 'запись из будущего относительно today')
  assertEqual(dueStatus(pushups, [result('grip', '2026-01-01', 40)], '2026-10-01'), 'never', 'чужой тест не считается')
  assertEqual(daysUntilDue(pushups, done, '2026-10-08'), 5, 'дней до срока')
  assertEqual(daysUntilDue(pushups, done, '2026-10-20'), -7, 'просрочка отрицательна')
  assertEqual(daysUntilDue(pushups, [], '2026-10-20'), null, 'не делали: null')

  /* Срок считается от последней записи, а не от первой. */
  const history = [result('pushups', '2026-01-01', 10), result('pushups', '2026-10-01', 30)]
  assertEqual(dueStatus(pushups, history, '2026-10-02'), 'ok', 'по последней записи')

  /* Недельный пульс покоя: статус по семидневному сроку. */
  const hr = [result('resting-hr', '2026-10-10', 58)]
  assertEqual(dueStatus(T('resting-hr'), hr, '2026-10-11'), 'ok', 'пульс: 6 дней до срока')
  assertEqual(dueStatus(T('resting-hr'), hr, '2026-10-12'), 'soon', 'пульс: 5 дней до срока')
  assertEqual(dueStatus(T('resting-hr'), hr, '2026-10-17'), 'due', 'пульс: срок наступил')
})

group('applyRestingHr: пульс покоя и ручная блокировка', () => {
  const r = result(RESTING_HR_TEST_ID, '2026-10-17', 56)
  const s = settings({ restingHr: 62 })
  const updated = applyRestingHr(s, r)
  assertEqual(updated.restingHr, 56, 'значение записано в настройки')
  assertEqual(s.restingHr, 62, 'исходные настройки не изменены')
  assert(updated !== s, 'возвращён новый объект')
  assertEqual({ ...updated, restingHr: 62 }, s, 'остальные поля не тронуты')

  const fromNull = applyRestingHr(settings({ restingHr: null }), r)
  assertEqual(fromNull.restingHr, 56, 'из пустого значения')

  const manual = settings({ restingHr: 62, restingHrManual: true })
  assert(applyRestingHr(manual, r) === manual, 'ручная блокировка: настройки те же')
  assertEqual(applyRestingHr(manual, r).restingHr, 62, 'ручное значение цело')

  const other = result('pushups', '2026-10-17', 30)
  const s2 = settings({ restingHr: 62 })
  assert(applyRestingHr(s2, other) === s2, 'другой тест не трогает пульс')
  for (const bad of [0, -5, NaN, Infinity]) {
    const s3 = settings({ restingHr: 62 })
    assert(applyRestingHr(s3, result(RESTING_HR_TEST_ID, '2026-10-17', bad)) === s3, `мусорный результат ${bad} игнорируется`)
  }
  /* Сквозной путь: оценка, запись, применение. */
  const ev = evaluateTest(T(RESTING_HR_TEST_ID), { bpm: 54 }, 19)
  assert(ev.ok, 'оценка')
  const applied = applyRestingHr(settings(), { ...r, values: { bpm: 54 }, result: ev.result })
  assertEqual(applied.restingHr, 54, 'сквозной путь')
})

group('flag встречается только там, где задан', () => {
  const flagged: string[] = []
  for (const t of FORM_TESTS) {
    for (const table of t.norms) {
      table.bands.forEach((b: FormBand) => { if (b.flag) flagged.push(`${t.id}:${b.label}`) })
    }
  }
  assertEqual(flagged, ['waist-height:высокое', 'resting-hr:высокий'], 'красные точки')
})

finish()
