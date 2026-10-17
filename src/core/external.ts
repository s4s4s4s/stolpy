/* Занятия вне приложения: подсказка распределения минут по столпам и
   проверка правки. Минуты столпа силы остаются в ExternalItem.split.strength
   и в подходы не переводятся. */

import { minutesWord } from './plural'
import { PILLARS } from './pillars'
import type { ExternalActivity, Pillar } from './types'

export type Split = Partial<Record<Pillar, number>>

export type SplitValidation =
  | { ok: true }
  | { ok: false; error: string; diffMin: number }   // diffMin > 0: не хватает, < 0: лишнее

/* Шаг округления подсказки, минуты. */
export const SPLIT_STEP_MIN = 5
const BASE_MIN = 60

/* Подсказка: каждая доля splitPer60 умножается на duration / 60 и округляется
   до 5 минут. Остаток до длительности отдаётся первому столпу в списке
   занятия; если округление дало лишнее, оно снимается с первого столпа и,
   когда его не хватает, со следующих по порядку. Нулевые доли не попадают в
   результат. Длительность округляется до целых минут; не больше нуля и
   занятие без долей дают пустое распределение. */
export function suggestSplit(activity: ExternalActivity, durationMin: number): Split {
  if (!Number.isFinite(durationMin)) return {}
  const total = Math.round(durationMin)
  if (total <= 0) return {}
  const entries = (Object.entries(activity.splitPer60) as [Pillar, number][])
    .filter(([pillar, share]) => (PILLARS as readonly string[]).includes(pillar) && Number.isFinite(share) && share > 0)
  if (entries.length === 0) return {}

  const minutes = entries.map(([, share]) => Math.round((share * total) / BASE_MIN / SPLIT_STEP_MIN) * SPLIT_STEP_MIN)
  let remainder = total - minutes.reduce((sum, m) => sum + m, 0)
  if (remainder >= 0) {
    minutes[0] += remainder
  } else {
    for (let i = 0; i < minutes.length && remainder < 0; i++) {
      const take = Math.min(minutes[i], -remainder)
      minutes[i] -= take
      remainder += take
    }
  }

  const result: Split = {}
  entries.forEach(([pillar], i) => {
    if (minutes[i] > 0) result[pillar] = minutes[i]
  })
  return result
}

function minutesPhrase(n: number): string {
  return `${n} ${minutesWord(n)}`
}

/* Правка человека допустима, когда все доли целые неотрицательные минуты
   столпов и их сумма равна длительности. Иначе текст для подписи под
   неактивной кнопкой «Записать». */
export function validateSplit(split: Split, durationMin: number): SplitValidation {
  if (!Number.isInteger(durationMin) || durationMin <= 0) {
    return { ok: false, error: 'Длительность должна быть целым числом минут больше нуля', diffMin: 0 }
  }
  let sum = 0
  for (const [pillar, value] of Object.entries(split)) {
    if (!(PILLARS as readonly string[]).includes(pillar)) {
      return { ok: false, error: `Неизвестный столп: ${pillar}`, diffMin: 0 }
    }
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, error: 'Минуты столпа должны быть целым числом не меньше нуля', diffMin: 0 }
    }
    sum += value
  }
  const diff = durationMin - sum
  if (diff > 0) return { ok: false, error: `Не распределено ${minutesPhrase(diff)}`, diffMin: diff }
  if (diff < 0) return { ok: false, error: `Лишних ${minutesPhrase(-diff)}`, diffMin: diff }
  return { ok: true }
}
