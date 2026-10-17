import { assert, assertEqual, finish, group } from './_harness.ts'
import { suggestSplit, validateSplit } from '../src/core/external.ts'
import type { ExternalActivity } from '../src/core/types.ts'

const KICK: ExternalActivity = { id: 'kickboxing', title: 'Кикбоксинг', splitPer60: { intervals: 20, zone2: 30, mobility: 10 } }
const YOGA: ExternalActivity = { id: 'yoga', title: 'Йога', splitPer60: { mobility: 45, balance: 15 } }
const SWIM: ExternalActivity = { id: 'swimming', title: 'Плавание', splitPer60: { zone2: 60 } }
const CLIMB: ExternalActivity = { id: 'climbing', title: 'Скалолазание', splitPer60: { strength: 40, mobility: 20 } }
const EMPTY: ExternalActivity = { id: 'none', title: 'Пусто', splitPer60: {} }

function sum(split: Partial<Record<string, number>>): number {
  return Object.values(split).reduce<number>((s, v) => s + (v ?? 0), 0)
}

group('suggestSplit: 60 минут - таблица как есть', () => {
  assertEqual(suggestSplit(KICK, 60), { intervals: 20, zone2: 30, mobility: 10 }, 'кикбоксинг')
  assertEqual(suggestSplit(YOGA, 60), { mobility: 45, balance: 15 }, 'йога')
  assertEqual(suggestSplit(CLIMB, 60), { strength: 40, mobility: 20 }, 'силовые минуты остаются силой')
})

group('suggestSplit: масштаб и округление до 5 минут', () => {
  assertEqual(suggestSplit(KICK, 90), { intervals: 30, zone2: 45, mobility: 15 }, '90 минут')
  assertEqual(suggestSplit(KICK, 30), { intervals: 10, zone2: 15, mobility: 5 }, '30 минут')
  assertEqual(suggestSplit(KICK, 120), { intervals: 40, zone2: 60, mobility: 20 }, '120 минут')
  assertEqual(suggestSplit(SWIM, 47), { zone2: 47 }, 'один столп получает всё')
})

group('suggestSplit: остаток отдаётся первому столпу', () => {
  // 50 минут: 16,7 -> 15; 25 -> 25; 8,3 -> 10; сумма 50
  assertEqual(suggestSplit(KICK, 50), { intervals: 15, zone2: 25, mobility: 10 }, '50 минут сходится сам');
  // 47 минут: 15,67 -> 15; 23,5 -> 25; 7,83 -> 10; сумма 50, лишних 3 снимаются с первого
  const s47 = suggestSplit(KICK, 47)
  assertEqual(s47, { intervals: 12, zone2: 25, mobility: 10 }, '47 минут: лишнее снимается с первого')
  assertEqual(sum(s47), 47, 'сумма 47')
  // 61 минута: 20,3 -> 20; 30,5 -> 30; 10,2 -> 10; сумма 60, остаток 1 первому
  assertEqual(suggestSplit(KICK, 61), { intervals: 21, zone2: 30, mobility: 10 }, '61 минута: остаток первому')
})

group('suggestSplit: сумма всегда равна длительности', () => {
  for (const activity of [KICK, YOGA, SWIM, CLIMB]) {
    for (let d = 1; d <= 180; d++) {
      const split = suggestSplit(activity, d)
      assertEqual(sum(split), d, `${activity.id} ${d} мин`)
      assert(validateSplit(split, d).ok, `${activity.id} ${d} мин проходит проверку`)
    }
  }
})

group('suggestSplit: короткое занятие, нет отрицательных долей', () => {
  // 10 минут: йога 7,5 -> 10 (round(1,5) = 2), 2,5 -> 5 (round(0,5) = 1): сумма 15, лишних 5 с первого
  const s = suggestSplit(YOGA, 10)
  assertEqual(sum(s), 10, 'сумма 10')
  for (const v of Object.values(s)) assert((v ?? 0) > 0, 'нулевые доли не попадают в результат')
  const s1 = suggestSplit(KICK, 1)
  assertEqual(sum(s1), 1, '1 минута')
  assertEqual(s1, { intervals: 1 }, '1 минута целиком первому')
})

group('suggestSplit: мусор на входе', () => {
  assertEqual(suggestSplit(KICK, 0), {}, 'ноль минут')
  assertEqual(suggestSplit(KICK, -30), {}, 'отрицательная длительность')
  assertEqual(suggestSplit(KICK, Number.NaN), {}, 'NaN')
  assertEqual(suggestSplit(KICK, Number.POSITIVE_INFINITY), {}, 'бесконечность')
  assertEqual(suggestSplit(EMPTY, 60), {}, 'занятие без долей')
  assertEqual(suggestSplit(KICK, 59.6), suggestSplit(KICK, 60), 'дробные минуты округляются')
  const dirty = { id: 'x', title: 'X', splitPer60: { zone2: -10, mobility: Number.NaN, balance: 60 } } as ExternalActivity
  assertEqual(suggestSplit(dirty, 60), { balance: 60 }, 'битые доли отбрасываются')
})

group('validateSplit: сумма равна длительности', () => {
  assertEqual(validateSplit({ zone2: 45, mobility: 15 }, 60), { ok: true }, 'сошлось')
  assertEqual(validateSplit({ strength: 60 }, 60), { ok: true }, 'вся сила')
  assertEqual(validateSplit({ zone2: 40, mobility: 5 }, 60), { ok: false, error: 'Не распределено 15 минут', diffMin: 15 }, 'не хватает')
  assertEqual(validateSplit({ zone2: 60, mobility: 6 }, 60), { ok: false, error: 'Лишних 6 минут', diffMin: -6 }, 'лишнее')
  assertEqual(validateSplit({ zone2: 59 }, 60), { ok: false, error: 'Не распределено 1 минута', diffMin: 1 }, 'склонение: 1 минута')
  assertEqual(validateSplit({ zone2: 62 }, 60), { ok: false, error: 'Лишних 2 минуты', diffMin: -2 }, 'склонение: 2 минуты')
  assertEqual(validateSplit({}, 45), { ok: false, error: 'Не распределено 45 минут', diffMin: 45 }, 'пустое распределение')
})

group('validateSplit: мусор', () => {
  assert(!validateSplit({ zone2: 70, mobility: -10 }, 60).ok, 'отрицательные минуты при верной сумме')
  assert(!validateSplit({ zone2: 30.5, mobility: 29.5 }, 60).ok, 'дробные минуты')
  assert(!validateSplit({ zone2: Number.NaN }, 60).ok, 'NaN')
  assert(!validateSplit({ zone2: 60 }, 0).ok, 'нулевая длительность')
  assert(!validateSplit({ zone2: 60 }, -60).ok, 'отрицательная длительность')
  assert(!validateSplit({ zone2: 60 }, 59.5).ok, 'дробная длительность')
  assert(!validateSplit({ zone2: 60 }, Number.NaN).ok, 'NaN длительность')
  assert(!validateSplit({ swimming: 60 } as never, 60).ok, 'неизвестный столп')
  assertEqual(validateSplit({ zone2: 60, mobility: undefined }, 60), { ok: true }, 'undefined пропускается')
})

finish()
