import { assertEqual, finish, group } from './_harness.ts'
import {
  daysWord, minutesWord, pluralRu, repsWord, roundsWord, secondsWord, sessionsWord, setsWord, weeksWord,
} from '../src/core/plural.ts'

group('pluralRu: классы чисел', () => {
  const cases: [number, string][] = [
    [0, 'many'], [1, 'one'], [2, 'few'], [3, 'few'], [4, 'few'], [5, 'many'], [9, 'many'],
    [10, 'many'], [11, 'many'], [12, 'many'], [13, 'many'], [14, 'many'], [15, 'many'],
    [20, 'many'], [21, 'one'], [22, 'few'], [24, 'few'], [25, 'many'],
    [100, 'many'], [101, 'one'], [102, 'few'], [111, 'many'], [112, 'many'], [114, 'many'],
    [121, 'one'], [1001, 'one'], [1012, 'many'],
  ]
  for (const [n, want] of cases) {
    assertEqual(pluralRu(n, 'one', 'few', 'many'), want, `n=${n}`)
  }
})

group('pluralRu: отрицательные и дробные', () => {
  assertEqual(pluralRu(-1, 'one', 'few', 'many'), 'one', '-1')
  assertEqual(pluralRu(-12, 'one', 'few', 'many'), 'many', '-12')
  assertEqual(pluralRu(1.5, 'one', 'few', 'many'), 'few', '1,5')
  assertEqual(pluralRu(0.5, 'one', 'few', 'many'), 'few', '0,5')
})

group('слова столпов и подходов', () => {
  assertEqual(minutesWord(1), 'минута', 'минута')
  assertEqual(minutesWord(2), 'минуты', 'минуты')
  assertEqual(minutesWord(150), 'минут', 'минут')
  assertEqual(setsWord(1), 'подход', 'подход')
  assertEqual(setsWord(3), 'подхода', 'подхода')
  assertEqual(setsWord(11), 'подходов', 'подходов')
  assertEqual(daysWord(1), 'день', 'день')
  assertEqual(daysWord(3), 'дня', 'дня')
  assertEqual(daysWord(7), 'дней', 'дней')
  assertEqual(weeksWord(1), 'неделя', 'неделя')
  assertEqual(weeksWord(4), 'недели', 'недели')
  assertEqual(weeksWord(12), 'недель', 'недель')
  assertEqual(repsWord(21), 'повтор', 'повтор')
  assertEqual(repsWord(23), 'повтора', 'повтора')
  assertEqual(repsWord(25), 'повторов', 'повторов')
  assertEqual(sessionsWord(1), 'тренировка', 'тренировка')
  assertEqual(sessionsWord(2), 'тренировки', 'тренировки')
  assertEqual(sessionsWord(5), 'тренировок', 'тренировок')
  assertEqual(secondsWord(1), 'секунда', 'секунда')
  assertEqual(secondsWord(30), 'секунд', 'секунд')
  assertEqual(secondsWord(32), 'секунды', 'секунды')
  assertEqual(roundsWord(1), 'раунд', 'раунд')
  assertEqual(roundsWord(4), 'раунда', 'раунда')
  assertEqual(roundsWord(8), 'раундов', 'раундов')
})

finish()
