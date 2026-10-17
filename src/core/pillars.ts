import { PILLARS } from './types'
import type { Pillar, PillarUnit } from './types'

export { PILLARS }

export const PILLAR_TITLE: Record<Pillar, string> = {
  strength: 'Сила',
  zone2: 'Зона 2',
  intervals: 'Интервалы',
  mobility: 'Мобильность',
  balance: 'Баланс',
}

/* Единица, в которой столп измеряется на шкале недели. */
export const PILLAR_UNIT: Record<Pillar, PillarUnit> = {
  strength: 'sets',
  zone2: 'minutes',
  intervals: 'sessions',
  mobility: 'minutes',
  balance: 'minutes',
}

/* Цвет столпа: имя переменной из tokens.css, без обёртки var(). */
export const PILLAR_CSS_VAR: Record<Pillar, string> = {
  strength: '--cat-2',
  zone2: '--cat-5',
  intervals: '--cat-3',
  mobility: '--cat-1',
  balance: '--cat-4',
}

/* Короткая доза столпа для экрана: цель по умолчанию из раздела 4 плана. */
export const PILLAR_DOSE: Record<Pillar, string> = {
  strength: '50 рабочих подходов и 3 силовых дня, запас до трёх повторов',
  zone2: '150 минут в темпе, когда можно говорить фразами',
  intervals: '2 сессии, около 32 тяжёлых минут',
  mobility: '30 минут и 3 дня, по 10 минут на ограничивающую зону',
  balance: '30 минут и 3 дня, стойка на каждую сторону',
}
