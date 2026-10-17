import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  WEEKDAY_NAMES, addDays, daysBetween, formatDateFull, formatDateShort, isDateISO,
  todayLocal, weekDays, weekStartOf, weekdayIndexMon,
} from '../src/core/dates.ts'

function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof RangeError
  }
}

group('todayLocal: местные компоненты, а не UTC', () => {
  assertEqual(todayLocal(new Date(2026, 9, 17, 0, 5)), '2026-10-17', 'после полуночи');
  assertEqual(todayLocal(new Date(2026, 9, 17, 23, 59)), '2026-10-17', 'перед полуночью');
  assertEqual(todayLocal(new Date(2026, 0, 5, 12)), '2026-01-05', 'ведущие нули');
  assertEqual(todayLocal(new Date(2026, 11, 31, 23, 59)), '2026-12-31', 'последний день года');
  assert(/^\d{4}-\d{2}-\d{2}$/.test(todayLocal()), 'без аргумента: формат')
})

group('weekdayIndexMon', () => {
  assertEqual(weekdayIndexMon('2026-10-12'), 0, 'понедельник')
  assertEqual(weekdayIndexMon('2026-10-17'), 5, 'суббота')
  assertEqual(weekdayIndexMon('2026-10-18'), 6, 'воскресенье')
  assertEqual(WEEKDAY_NAMES[weekdayIndexMon('2026-10-14')], 'среда', 'имя среды')
})

group('weekStartOf: неделя с понедельника', () => {
  assertEqual(weekStartOf('2026-10-12'), '2026-10-12', 'понедельник сам себе начало')
  assertEqual(weekStartOf('2026-10-14'), '2026-10-12', 'среда')
  assertEqual(weekStartOf('2026-10-18'), '2026-10-12', 'воскресенье принадлежит прошлому понедельнику')
  assertEqual(weekStartOf('2026-10-19'), '2026-10-19', 'следующий понедельник')
})

group('weekStartOf: границы года и месяца', () => {
  assertEqual(weekStartOf('2026-01-01'), '2025-12-29', 'четверг 1 января')
  assertEqual(weekStartOf('2024-01-01'), '2024-01-01', 'понедельник 1 января')
  assertEqual(weekStartOf('2023-01-01'), '2022-12-26', 'воскресенье 1 января')
  assertEqual(weekStartOf('2026-03-01'), '2026-02-23', 'начало марта')
  assertEqual(weekStartOf('2024-03-01'), '2024-02-26', 'високосный год')
  assertEqual(weekStartOf('2026-05-03'), '2026-04-27', 'воскресенье 3 мая')
})

group('weekDays', () => {
  const days = weekDays('2025-12-29')
  assertEqual(days.length, 7, 'семь дней')
  assertEqual(days[0], '2025-12-29', 'первый')
  assertEqual(days[3], '2026-01-01', 'через границу года')
  assertEqual(days[6], '2026-01-04', 'последний')
  assertEqual(weekDays('2026-10-15')[0], '2026-10-12', 'из середины недели берётся понедельник')
})

group('addDays и daysBetween', () => {
  assertEqual(addDays('2026-01-31', 1), '2026-02-01', 'конец января')
  assertEqual(addDays('2026-02-28', 1), '2026-03-01', 'февраль не високосный')
  assertEqual(addDays('2024-02-28', 1), '2024-02-29', 'високосный февраль')
  assertEqual(addDays('2026-12-31', 1), '2027-01-01', 'конец года')
  assertEqual(addDays('2026-01-01', -1), '2025-12-31', 'назад через год')
  assertEqual(addDays('2026-10-17', 0), '2026-10-17', 'ноль')
  assertEqual(addDays('2026-01-01', 365), '2027-01-01', 'год вперёд')
  assertEqual(daysBetween('2026-10-12', '2026-10-17'), 5, 'вперёд')
  assertEqual(daysBetween('2026-10-17', '2026-10-12'), -5, 'назад')
  assertEqual(daysBetween('2025-12-31', '2026-01-01'), 1, 'через год')
  assertEqual(daysBetween('2024-02-28', '2024-03-01'), 2, 'високосный')
  assert(throws(() => addDays('2026-10-17', 1.5)), 'дробное число дней отклоняется')
})

group('переход на летнее время не ломает addDays', () => {
  /* Даты проходят через календарные компоненты, часы суток не участвуют:
     сутки перехода в 23 или 25 часов считаются одним днём. */
  const dstDays = [
    ['2026-03-28', '2026-03-29', '2026-03-30'],   // Европа, весна
    ['2026-10-24', '2026-10-25', '2026-10-26'],   // Европа, осень
    ['2026-03-07', '2026-03-08', '2026-03-09'],   // США, весна
    ['2026-10-31', '2026-11-01', '2026-11-02'],   // США, осень
  ]
  for (const [before, at, after] of dstDays) {
    assertEqual(addDays(before, 1), at, `${before} + 1`)
    assertEqual(addDays(at, 1), after, `${at} + 1`)
    assertEqual(daysBetween(before, after), 2, `${before}..${after}`)
    assertEqual(weekDays(weekStartOf(at)).includes(at), true, `${at} внутри своей недели`)
  }
  let cursor = '2026-01-01'
  for (let i = 0; i < 400; i++) cursor = addDays(cursor, 1)
  assertEqual(cursor, '2027-02-05', '400 шагов по одному дню')
  assertEqual(daysBetween('2026-01-01', cursor), 400, 'и обратно в разность')
})

group('форматирование', () => {
  assertEqual(formatDateShort('2026-10-17'), '17 окт', 'коротко')
  assertEqual(formatDateShort('2026-05-03'), '3 мая', 'без ведущего нуля')
  assertEqual(formatDateFull('2026-10-17'), 'суббота, 17 октября 2026', 'полно')
  assertEqual(formatDateFull('2026-01-01'), 'четверг, 1 января 2026', 'январь')
  assertEqual(formatDateFull('2024-02-29'), 'четверг, 29 февраля 2024', 'високосный день')
})

group('некорректные даты', () => {
  assertEqual(isDateISO('2026-10-17'), true, 'верная')
  assertEqual(isDateISO('2026-02-30'), false, '30 февраля')
  assertEqual(isDateISO('2026-13-01'), false, '13-й месяц')
  assertEqual(isDateISO('2026-1-1'), false, 'без нулей')
  assertEqual(isDateISO(''), false, 'пустая')
  assertEqual(isDateISO(20261017), false, 'число')
  assert(throws(() => weekStartOf('мусор')), 'weekStartOf бросает RangeError')
  assert(throws(() => addDays('2026-02-30', 1)), 'addDays бросает RangeError')
  assert(throws(() => formatDateFull('2026-00-10')), 'formatDateFull бросает RangeError')
})

finish()
