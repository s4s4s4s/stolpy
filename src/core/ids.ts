import type { Millis } from './types'

const SUFFIX_LENGTH = 6
const SUFFIX_SPACE = 36 ** SUFFIX_LENGTH

/* Идентификатор вида «sess-lk3j9a2-0f4k2x»: префикс, время в base36, случайный
   хвост из шести знаков. Время и источник случайности передаются снаружи,
   поэтому при одинаковых now и random результат один и тот же.
   random - функция, возвращающая число в [0, 1), как Math.random. */
export function makeId(
  prefix: string,
  now: Millis = Date.now(),
  random: () => number = Math.random,
): string {
  if (!/^[a-z][a-z0-9]*$/.test(prefix)) {
    throw new RangeError(`Префикс идентификатора: латиница в нижнем регистре и цифры, получено ${JSON.stringify(prefix)}`)
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError(`Время идентификатора: неотрицательное целое, получено ${now}`)
  }
  const r = random()
  if (!Number.isFinite(r) || r < 0 || r >= 1) {
    throw new RangeError(`random() должен вернуть число в [0, 1), получено ${r}`)
  }
  const suffix = Math.floor(r * SUFFIX_SPACE).toString(36).padStart(SUFFIX_LENGTH, '0')
  return `${prefix}-${now.toString(36)}-${suffix}`
}
