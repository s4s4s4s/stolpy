import { assertEqual, finish, group } from './_harness.ts'
import { formatClock, formatKg, formatMinutes, parseDecimal } from '../src/core/format.ts'

group('formatKg', () => {
  assertEqual(formatKg(60), '60', 'целое без нулей')
  assertEqual(formatKg(62.5), '62,5', 'запятая')
  assertEqual(formatKg(62.50), '62,5', 'хвостовой ноль')
  assertEqual(formatKg(2.25), '2,25', 'два знака')
  assertEqual(formatKg(2.255), '2,26', 'округление до сотых')
  assertEqual(formatKg(0.1 + 0.2), '0,3', 'артефакт плавающей точки')
  assertEqual(formatKg(0), '0', 'ноль')
  assertEqual(formatKg(-0.001), '0', 'минус ноль не печатается')
  assertEqual(formatKg(1000), '1000', 'тысяча без разделителей')
  assertEqual(formatKg(NaN), '-', 'NaN')
  assertEqual(formatKg(Infinity), '-', 'бесконечность')
})

group('formatMinutes', () => {
  assertEqual(formatMinutes(0), '0 мин', 'ноль')
  assertEqual(formatMinutes(45), '45 мин', 'меньше часа')
  assertEqual(formatMinutes(60), '1 ч', 'ровно час')
  assertEqual(formatMinutes(65), '1 ч 05 мин', 'час и минуты с нулём')
  assertEqual(formatMinutes(150), '2 ч 30 мин', 'цель зоны 2')
  assertEqual(formatMinutes(119.6), '2 ч', 'округление')
  assertEqual(formatMinutes(-1), '-', 'отрицательное')
  assertEqual(formatMinutes(NaN), '-', 'NaN')
})

group('formatClock', () => {
  assertEqual(formatClock(0), '0:00', 'ноль')
  assertEqual(formatClock(999), '0:00', 'доли секунды отбрасываются')
  assertEqual(formatClock(1000), '0:01', 'секунда')
  assertEqual(formatClock(59_000), '0:59', '59 секунд')
  assertEqual(formatClock(60_000), '1:00', 'минута')
  assertEqual(formatClock(90_000), '1:30', 'отдых по умолчанию')
  assertEqual(formatClock(599_000), '9:59', 'до десяти минут')
  assertEqual(formatClock(3_599_000), '59:59', 'перед часом')
  assertEqual(formatClock(3_600_000), '1:00:00', 'час')
  assertEqual(formatClock(3_725_000), '1:02:05', 'час, минуты, секунды с нулями')
  assertEqual(formatClock(36_000_000), '10:00:00', 'десять часов')
  assertEqual(formatClock(-5000), '0:00', 'отрицательное')
  assertEqual(formatClock(NaN), '0:00', 'NaN')
})

group('parseDecimal: числа', () => {
  assertEqual(parseDecimal('62,5'), 62.5, 'запятая')
  assertEqual(parseDecimal('62.5'), 62.5, 'точка')
  assertEqual(parseDecimal('  80 '), 80, 'пробелы по краям')
  assertEqual(parseDecimal('0'), 0, 'ноль')
  assertEqual(parseDecimal('0,25'), 0.25, 'дробь')
  assertEqual(parseDecimal(',5'), 0.5, 'без целой части')
  assertEqual(parseDecimal('62,'), 62, 'запятая в конце при наборе')
  assertEqual(parseDecimal('-3,5'), -3.5, 'знак минус')
})

group('parseDecimal: пустое и мусор', () => {
  for (const bad of ['', '   ', 'abc', '-', ',', '.', '1,2,3', '1.2.3', '12 кг', '1e5', '0x10', 'Infinity', 'NaN', '1 000', '--1']) {
    assertEqual(parseDecimal(bad), null, `«${bad}»`)
  }
})

finish()
