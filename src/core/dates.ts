import type { DateISO } from './types'

/* Даты приложения - строки 'YYYY-MM-DD' в местном времени. Вся арифметика
   идёт по календарным компонентам (год, месяц, день) через Date.UTC, поэтому
   переход на летнее время и часовой пояс на результат не влияют. */

export const WEEKDAY_NAMES = [
  'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье',
] as const

export const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const

const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const

const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
] as const

const MS_PER_DAY = 86_400_000
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0')
}

/* Разбор с проверкой календаря: '2026-02-30' - не дата. */
function parts(date: DateISO): { y: number; m: number; d: number } {
  const match = ISO_RE.exec(date)
  if (match) {
    const y = Number(match[1])
    const m = Number(match[2])
    const d = Number(match[3])
    const check = new Date(Date.UTC(y, m - 1, d))
    if (check.getUTCFullYear() === y && check.getUTCMonth() === m - 1 && check.getUTCDate() === d) {
      return { y, m, d }
    }
  }
  throw new RangeError(`Некорректная дата: ${JSON.stringify(date)}`)
}

/* Количество суток от начала эпохи до календарного дня (в UTC-календаре). */
function dayNumber(date: DateISO): number {
  const { y, m, d } = parts(date)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

function fromDayNumber(day: number): DateISO {
  const dt = new Date(day * MS_PER_DAY)
  return `${pad(dt.getUTCFullYear(), 4)}-${pad(dt.getUTCMonth() + 1, 2)}-${pad(dt.getUTCDate(), 2)}`
}

export function isDateISO(value: unknown): value is DateISO {
  if (typeof value !== 'string') return false
  try {
    parts(value)
    return true
  } catch {
    return false
  }
}

/* Местная дата момента now (по умолчанию - сейчас). */
export function todayLocal(now: Date = new Date()): DateISO {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`
}

/* 0 = понедельник ... 6 = воскресенье. */
export function weekdayIndexMon(date: DateISO): number {
  const { y, m, d } = parts(date)
  const sundayBased = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return (sundayBased + 6) % 7
}

export function addDays(date: DateISO, n: number): DateISO {
  if (!Number.isInteger(n)) throw new RangeError(`Число дней должно быть целым: ${n}`)
  return fromDayNumber(dayNumber(date) + n)
}

/* Сколько суток от a до b: положительное, если b позже. */
export function daysBetween(a: DateISO, b: DateISO): number {
  return dayNumber(b) - dayNumber(a)
}

/* Понедельник недели, в которую попадает дата. */
export function weekStartOf(date: DateISO): DateISO {
  return addDays(date, -weekdayIndexMon(date))
}

/* Семь дат недели, начиная с понедельника weekStart. */
export function weekDays(weekStart: DateISO): DateISO[] {
  const start = weekStartOf(weekStart)
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/* «17 окт» */
export function formatDateShort(date: DateISO): string {
  const { m, d } = parts(date)
  return `${d} ${MONTHS_SHORT[m - 1]}`
}

/* «суббота, 17 октября 2026» */
export function formatDateFull(date: DateISO): string {
  const { y, m, d } = parts(date)
  return `${WEEKDAY_NAMES[weekdayIndexMon(date)]}, ${d} ${MONTHS_GENITIVE[m - 1]} ${y}`
}
