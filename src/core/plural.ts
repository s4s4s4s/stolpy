/* Склонение числительных. Правило то же, что в plural() дизайн-системы:
   1 (кроме 11) - one, 2-4 (кроме 12-14) - few, остальное - many.
   Дробное число склоняется как few: «1,5 минуты», «0,5 часа». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(n)) return few
  const abs = Math.abs(n)
  const a = abs % 10
  const b = abs % 100
  if (a === 1 && b !== 11) return one
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few
  return many
}

export const minutesWord = (n: number): string => pluralRu(n, 'минута', 'минуты', 'минут')
export const setsWord = (n: number): string => pluralRu(n, 'подход', 'подхода', 'подходов')
export const daysWord = (n: number): string => pluralRu(n, 'день', 'дня', 'дней')
export const weeksWord = (n: number): string => pluralRu(n, 'неделя', 'недели', 'недель')
export const repsWord = (n: number): string => pluralRu(n, 'повтор', 'повтора', 'повторов')
export const sessionsWord = (n: number): string => pluralRu(n, 'тренировка', 'тренировки', 'тренировок')
export const secondsWord = (n: number): string => pluralRu(n, 'секунда', 'секунды', 'секунд')
export const roundsWord = (n: number): string => pluralRu(n, 'раунд', 'раунда', 'раундов')
