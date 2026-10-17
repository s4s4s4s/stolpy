/* Форматирование и разбор чисел для экрана. Десятичный разделитель - запятая. */

const PLACEHOLDER = '-'

/* Вес: до двух знаков после запятой, без лишних нулей. 62.5 -> «62,5», 60 -> «60». */
export function formatKg(kg: number): string {
  if (!Number.isFinite(kg)) return PLACEHOLDER
  const rounded = Math.round(kg * 100) / 100
  const text = String(rounded === 0 ? 0 : rounded)
  return text.replace('.', ',')
}

/* Длительность в минутах: «45 мин», «1 ч 05 мин», «2 ч». */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return PLACEHOLDER
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} мин`
  if (m === 0) return `${h} ч`
  return `${h} ч ${String(m).padStart(2, '0')} мин`
}

/* Часы секундомера: «м:сс» до часа, дальше «ч:мм:сс». Доли секунды отбрасываются.
   Для обратного отсчёта вызывающий код сам округляет вверх (Math.ceil) до секунд. */
export function formatClock(ms: number): string {
  const totalSec = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const ss = String(s).padStart(2, '0')
  if (h === 0) return `${m}:${ss}`
  return `${h}:${String(m).padStart(2, '0')}:${ss}`
}

const DECIMAL_RE = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/

/* Число из поля ввода: «62,5» и «62.5» дают 62.5; пустое, мусор и «1e5» дают null. */
export function parseDecimal(text: string): number | null {
  const trimmed = text.trim()
  if (!DECIMAL_RE.test(trimmed)) return null
  const value = Number(trimmed.replace(',', '.'))
  return Number.isFinite(value) ? value : null
}
