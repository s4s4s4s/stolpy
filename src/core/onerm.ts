/* Оценка одноповторного максимума (1ПМ) по рабочему подходу. Основная формула
   Эпли, Бжицки - второе число в детализации. Обе функции честно возвращают
   null там, где оценка не выводится, и не выдумывают число. */

/* Эпли применяется до этого числа повторов включительно: дальше формула
   заметно завышает. */
export const EPLEY_MAX_REPS = 10
/* У Бжицки в знаменателе 37 - r, поэтому с 37 повторов формула не определена. */
export const BRZYCKI_REPS_LIMIT = 37

function validInput(weightKg: number, reps: number): boolean {
  return Number.isFinite(weightKg) && weightKg > 0 && Number.isInteger(reps) && reps >= 1
}

/* r = 1 -> вес как есть; 2..10 -> w * (1 + r / 30); больше 10 -> null. */
export function epley(weightKg: number, reps: number): number | null {
  if (!validInput(weightKg, reps) || reps > EPLEY_MAX_REPS) return null
  if (reps === 1) return weightKg
  return weightKg * (1 + reps / 30)
}

/* w * 36 / (37 - r); с 37 повторов null. */
export function brzycki(weightKg: number, reps: number): number | null {
  if (!validInput(weightKg, reps) || reps >= BRZYCKI_REPS_LIMIT) return null
  return (weightKg * 36) / (BRZYCKI_REPS_LIMIT - reps)
}

/* Округление до 0,1 кг: цифра для экрана и для сравнения рекордов без
   шума плавающей точки. */
export function roundKg(kg: number): number {
  return Math.round(kg * 10) / 10
}

/* Основная оценка 1ПМ (Эпли), округлённая до 0,1 кг; null, если не выводится. */
export function estimate1rm(weightKg: number, reps: number): number | null {
  const value = epley(weightKg, reps)
  return value === null ? null : roundKg(value)
}
