import { assert, assertEqual, finish, group } from './_harness.ts'
import { makeId } from '../src/core/ids.ts'

function throws(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof RangeError
  }
}

group('makeId: детерминизм', () => {
  const a = makeId('sess', 1_760_000_000_000, () => 0.5)
  const b = makeId('sess', 1_760_000_000_000, () => 0.5)
  assertEqual(a, b, 'те же now и random дают тот же id')
  assertEqual(makeId('sess', 0, () => 0), 'sess-0-000000', 'нулевые входы')
  assertEqual(makeId('x', 35, () => 0), 'x-z-000000', 'время в base36')
  assertEqual(makeId('x', 36, () => 0), 'x-10-000000', 'перенос разряда')
  assertEqual(makeId('x', 1, () => 1 - Number.EPSILON / 2), 'x-1-zzzzzz', 'верхняя граница хвоста')
})

group('makeId: различимость', () => {
  const t = 1_760_000_000_000
  assert(makeId('sess', t, () => 0.1) !== makeId('sess', t, () => 0.2), 'разный random')
  assert(makeId('sess', t, () => 0.1) !== makeId('sess', t + 1, () => 0.1), 'разное время')
  assert(makeId('sess', t, () => 0.1) !== makeId('item', t, () => 0.1), 'разный префикс')
  const ids = new Set<string>()
  for (let i = 0; i < 1000; i++) ids.add(makeId('it', t))
  assertEqual(ids.size, 1000, 'тысяча id за одну миллисекунду на настоящем random без повторов')
})

group('makeId: формат и значения по умолчанию', () => {
  assert(/^sess-[0-9a-z]+-[0-9a-z]{6}$/.test(makeId('sess')), 'формат без аргументов')
})

group('makeId: неверные входы', () => {
  assert(throws(() => makeId('', 1, () => 0)), 'пустой префикс')
  assert(throws(() => makeId('Sess', 1, () => 0)), 'заглавные в префиксе')
  assert(throws(() => makeId('a-b', 1, () => 0)), 'дефис в префиксе')
  assert(throws(() => makeId('a', -1, () => 0)), 'отрицательное время')
  assert(throws(() => makeId('a', 1.5, () => 0)), 'дробное время')
  assert(throws(() => makeId('a', 1, () => 1)), 'random = 1')
  assert(throws(() => makeId('a', 1, () => -0.1)), 'random < 0')
  assert(throws(() => makeId('a', 1, () => NaN)), 'random NaN')
})

finish()
