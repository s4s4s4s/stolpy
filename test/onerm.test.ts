import { assert, assertEqual, finish, group } from './_harness.ts'
import { brzycki, epley, estimate1rm, roundKg } from '../src/core/onerm.ts'

function near(a: number | null, b: number, eps = 1e-9): boolean {
  return a !== null && Math.abs(a - b) < eps
}

group('epley: границы повторов', () => {
  assertEqual(epley(100, 1), 100, 'один повтор - сам вес')
  assert(near(epley(60, 5), 70), '60 x 5 = 70')
  assert(near(epley(100, 10), 100 * (1 + 10 / 30)), '10 повторов ещё считаются')
  assertEqual(epley(100, 11), null, '11 повторов - оценки нет')
  assertEqual(epley(100, 30), null, '30 повторов - оценки нет')
})

group('epley: мусор на входе', () => {
  assertEqual(epley(0, 5), null, 'нулевой вес')
  assertEqual(epley(-20, 5), null, 'отрицательный вес')
  assertEqual(epley(100, 0), null, 'ноль повторов')
  assertEqual(epley(100, -3), null, 'отрицательные повторы')
  assertEqual(epley(100, 2.5), null, 'дробные повторы')
  assertEqual(epley(Number.NaN, 5), null, 'NaN вес')
  assertEqual(epley(100, Number.NaN), null, 'NaN повторы')
  assertEqual(epley(Number.POSITIVE_INFINITY, 5), null, 'бесконечный вес')
})

group('brzycki: границы', () => {
  assert(near(brzycki(100, 1), 100), 'один повтор - сам вес')
  assert(near(brzycki(100, 10), (100 * 36) / 27), '10 повторов')
  assert(near(brzycki(50, 20), (50 * 36) / 17), '20 повторов ещё считаются')
  assert(near(brzycki(50, 36), 50 * 36), '36 повторов - последняя допустимая точка')
  assertEqual(brzycki(50, 37), null, '37 повторов - защита знаменателя')
  assertEqual(brzycki(50, 40), null, '40 повторов')
  assertEqual(brzycki(0, 5), null, 'нулевой вес')
  assertEqual(brzycki(50, 0), null, 'ноль повторов')
  assertEqual(brzycki(50, 1.5), null, 'дробные повторы')
  assertEqual(brzycki(Number.NaN, 5), null, 'NaN')
})

group('estimate1rm: основная формула Эпли с округлением до 0,1', () => {
  assertEqual(estimate1rm(60, 5), 70, 'целое значение')
  assertEqual(estimate1rm(80, 8), 101.3, '80 x 8 = 101,33 -> 101,3')
  assertEqual(estimate1rm(62.5, 1), 62.5, 'один повтор')
  assertEqual(estimate1rm(60, 12), null, 'больше 10 повторов')
  assertEqual(estimate1rm(0, 5), null, 'нет веса')
})

group('roundKg: шаг 0,1', () => {
  assertEqual(roundKg(101.333), 101.3, 'вниз')
  assertEqual(roundKg(101.36), 101.4, 'вверх')
  assertEqual(roundKg(0), 0, 'ноль')
})

finish()
