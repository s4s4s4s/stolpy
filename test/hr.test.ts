import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  ageOn, checkPeak, checkZone2, maxHrFromSettings, maxHrTanaka, zoneBounds,
  PEAK_VERDICT_TEXT, ZONE2_VERDICT_TEXT,
} from '../src/core/hr.ts'

group('ageOn: календарный год', () => {
  assertEqual(ageOn(2007, '2026-10-17'), 19, 'год минус год рождения')
  assertEqual(ageOn(2007, '2026-01-01'), 19, 'начало года тот же возраст')
  assertEqual(ageOn(1990, '2026-12-31'), 36, 'конец года')
  assertEqual(ageOn(null, '2026-10-17'), null, 'нет года рождения')
  assertEqual(ageOn(undefined, '2026-10-17'), null, 'undefined')
  assertEqual(ageOn(2026, '2026-10-17'), null, 'возраст 0 не принимается')
  assertEqual(ageOn(2030, '2026-10-17'), null, 'год из будущего')
  assertEqual(ageOn(1850, '2026-10-17'), null, 'слишком давно')
  assertEqual(ageOn(1990.5, '2026-10-17'), null, 'дробный год')
  assertEqual(ageOn(Number.NaN, '2026-10-17'), null, 'NaN')
  assertEqual(ageOn(2000, 'вчера'), null, 'мусор вместо даты')
})

group('maxHrTanaka', () => {
  assertEqual(maxHrTanaka(19), 195, '208 - 13,3 = 194,7 -> 195')
  assertEqual(maxHrTanaka(40), 180, '40 лет')
  assertEqual(maxHrTanaka(30), 187, '208 - 21 = 187')
  assertEqual(maxHrTanaka(null), null, 'нет возраста')
  assertEqual(maxHrTanaka(Number.NaN), null, 'NaN')
  assertEqual(maxHrTanaka(-4), null, 'отрицательный возраст')
  assertEqual(maxHrTanaka(200), null, 'нереальный возраст')
})

group('maxHrFromSettings: ручной максимум перекрывает формулу', () => {
  const base = { birthYear: 2007, maxHrMode: 'formula' as const, maxHrManual: null }
  assertEqual(maxHrFromSettings(base, '2026-10-17'), 195, 'формула по возрасту')
  assertEqual(maxHrFromSettings({ ...base, maxHrMode: 'manual', maxHrManual: 201 }, '2026-10-17'), 201, 'ручной')
  assertEqual(maxHrFromSettings({ ...base, maxHrMode: 'formula', maxHrManual: 201 }, '2026-10-17'), 195, 'режим формулы решает')
  assertEqual(maxHrFromSettings({ ...base, maxHrMode: 'manual', maxHrManual: null }, '2026-10-17'), 195, 'ручной режим без значения - формула')
  assertEqual(maxHrFromSettings({ ...base, maxHrMode: 'manual', maxHrManual: 20 }, '2026-10-17'), 195, 'негодное ручное значение игнорируется')
  assertEqual(maxHrFromSettings({ birthYear: null, maxHrMode: 'formula', maxHrManual: null }, '2026-10-17'), null, 'нет возраста и ручного')
  assertEqual(maxHrFromSettings({ birthYear: null, maxHrMode: 'manual', maxHrManual: 190 }, '2026-10-17'), 190, 'ручной без возраста')
})

group('zoneBounds: проценты максимума', () => {
  const b = zoneBounds(200)
  assert(b !== null, 'границы есть')
  assertEqual(b.zone2, { min: 120, max: 140 }, 'зона 2: 60-70 %')
  assertEqual(b.hard, { min: 170, max: 190 }, 'тяжёлая: 85-95 %')
  assertEqual(b.fourByFour, { min: 180, max: 190 }, '4x4: 90-95 %')
  assertEqual(b.restBetween, 140, 'отдых между интервалами 70 %')
  assertEqual(b.peakMin, 170, 'порог пика 85 %')
  assertEqual(b.restingHr, null, 'пульс покоя не использован')
})

group('zoneBounds: Карвонен при известном пульсе покоя', () => {
  const b = zoneBounds(200, 60)
  assert(b !== null, 'границы есть')
  assertEqual(b.zone2, { min: 144, max: 158 }, '60 + 140 * 0,6 и 0,7')
  assertEqual(b.hard, { min: 170, max: 190 }, 'тяжёлая зона не зависит от покоя')
  assertEqual(b.restingHr, 60, 'покой запомнен')
})

group('zoneBounds: мусор', () => {
  assertEqual(zoneBounds(null), null, 'нет максимума')
  assertEqual(zoneBounds(undefined), null, 'undefined')
  assertEqual(zoneBounds(Number.NaN), null, 'NaN')
  assertEqual(zoneBounds(40), null, 'нереально низкий максимум')
  assertEqual(zoneBounds(400), null, 'нереально высокий максимум')
  assertEqual(zoneBounds(200, 220)?.zone2, { min: 120, max: 140 }, 'покой выше максимума игнорируется')
  assertEqual(zoneBounds(200, 200)?.restingHr, null, 'покой равен максимуму игнорируется')
  assertEqual(zoneBounds(200, 5)?.restingHr, null, 'нереальный покой игнорируется')
  assertEqual(zoneBounds(200, Number.NaN)?.restingHr, null, 'NaN покой')
  assertEqual(zoneBounds(200, null)?.restingHr, null, 'null покой')
})

group('checkZone2: границы включительно, допуск 5 ударов', () => {
  const b = zoneBounds(200)
  assertEqual(checkZone2(119, b), 'below', 'на удар ниже')
  assertEqual(checkZone2(120, b), 'in', 'нижняя граница')
  assertEqual(checkZone2(130, b), 'in', 'середина')
  assertEqual(checkZone2(140, b), 'in', 'верхняя граница')
  assertEqual(checkZone2(141, b), 'above-but-ok', 'на удар выше')
  assertEqual(checkZone2(145, b), 'above-but-ok', 'ровно +5')
  assertEqual(checkZone2(146, b), 'above', '+6')
  assertEqual(checkZone2(null, b), null, 'нет пульса')
  assertEqual(checkZone2(0, b), null, 'нулевой пульс')
  assertEqual(checkZone2(Number.NaN, b), null, 'NaN')
  assertEqual(checkZone2(130, null), null, 'нет границ')
})

group('checkPeak: от 85 % включительно', () => {
  const b = zoneBounds(200)
  assertEqual(checkPeak(169, b), 'below', 'на удар ниже')
  assertEqual(checkPeak(170, b), 'reached', 'ровно 85 %')
  assertEqual(checkPeak(199, b), 'reached', 'выше максимума тоже достигнут')
  assertEqual(checkPeak(undefined, b), null, 'нет пика')
  assertEqual(checkPeak(-5, b), null, 'отрицательный пульс')
  assertEqual(checkPeak(180, null), null, 'нет границ')
})

group('тексты вердиктов', () => {
  assertEqual(ZONE2_VERDICT_TEXT.below, 'ниже зоны', 'below')
  assertEqual(ZONE2_VERDICT_TEXT.in, 'в зоне', 'in')
  assertEqual(ZONE2_VERDICT_TEXT['above-but-ok'], 'чуть выше', 'above-but-ok')
  assertEqual(ZONE2_VERDICT_TEXT.above, 'выше зоны', 'above')
  assert(PEAK_VERDICT_TEXT.reached.length > 0 && PEAK_VERDICT_TEXT.below.length > 0, 'тексты пика заданы')
})

finish()
