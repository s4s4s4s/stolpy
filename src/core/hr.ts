/* Пульс: возраст, максимум, границы зон и вердикты. Без возраста и ручного
   максимума функции возвращают null, а не подставляют среднее. */

import type { DateISO, Settings } from './types'

const MIN_AGE = 5
const MAX_AGE = 110
const MIN_BIRTH_YEAR = 1900
/* Правдоподобные пределы максимума и пульса покоя, в ударах в минуту. */
const MIN_MAX_HR = 100
const MAX_MAX_HR = 250
const MIN_RESTING_HR = 25

/* Допуск «чуть выше зоны 2»: до +5 ударов над верхней границей. */
export const ZONE2_TOLERANCE_BPM = 5

export interface HrRange { min: number; max: number }

export interface ZoneBounds {
  maxHr: number
  restingHr: number | null          // использован ли пульс покоя (Карвонен)
  zone2: HrRange                    // 60-70 % максимума или резерва
  hard: HrRange                     // тяжёлые интервалы, 85-95 %
  fourByFour: HrRange               // норвежское 4x4, 90-95 %
  restBetween: number               // активный отдых между интервалами, 70 %
  peakMin: number                   // порог «достиг пика», 85 %
}

export type Zone2Verdict = 'below' | 'in' | 'above-but-ok' | 'above'
export type PeakVerdict = 'reached' | 'below'

export const ZONE2_VERDICT_TEXT: Record<Zone2Verdict, string> = {
  below: 'ниже зоны',
  in: 'в зоне',
  'above-but-ok': 'чуть выше',
  above: 'выше зоны',
}

export const PEAK_VERDICT_TEXT: Record<PeakVerdict, string> = {
  reached: 'пик достигнут',
  below: 'пик ниже 85 % максимума',
}

/* Возраст по календарному году: год даты минус год рождения. Некорректный
   год рождения или дата, возраст вне 5..110 дают null. */
export function ageOn(birthYear: number | null | undefined, date: DateISO): number | null {
  if (birthYear === null || birthYear === undefined) return null
  if (!Number.isInteger(birthYear) || birthYear < MIN_BIRTH_YEAR) return null
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(date)
  if (!match) return null
  const age = Number(match[1]) - birthYear
  return age >= MIN_AGE && age <= MAX_AGE ? age : null
}

/* Формула Танаки: 208 - 0,7 * возраст, округление до целого. */
export function maxHrTanaka(age: number | null | undefined): number | null {
  if (age === null || age === undefined || !Number.isFinite(age)) return null
  if (age < MIN_AGE || age > MAX_AGE) return null
  return Math.round(208 - 0.7 * age)
}

function validManualMax(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_MAX_HR && value <= MAX_MAX_HR
}

/* Максимум пульса по настройкам. Режим 'manual' с допустимым введённым
   значением перекрывает формулу; режим 'manual' без значения и режим
   'formula' считают по формуле, если известен возраст; иначе null. */
export function maxHrFromSettings(
  settings: Pick<Settings, 'birthYear' | 'maxHrMode' | 'maxHrManual'>,
  date: DateISO,
): number | null {
  if (settings.maxHrMode === 'manual' && validManualMax(settings.maxHrManual)) {
    return Math.round(settings.maxHrManual)
  }
  return maxHrTanaka(ageOn(settings.birthYear, date))
}

/* Границы зон. Зона 2 при известном пульсе покоя считается по Карвонену:
   rest + (max - rest) * k; остальные зоны всегда доли максимума. Границы
   округляются до целых ударов. Негодный максимум даёт null; негодный пульс
   покоя (меньше 25 или не ниже максимума) игнорируется. */
export function zoneBounds(maxHr: number | null | undefined, restingHr?: number | null): ZoneBounds | null {
  if (typeof maxHr !== 'number' || !Number.isFinite(maxHr) || maxHr < MIN_MAX_HR || maxHr > MAX_MAX_HR) return null
  const rest = typeof restingHr === 'number' && Number.isFinite(restingHr) && restingHr >= MIN_RESTING_HR && restingHr < maxHr
    ? restingHr
    : null
  const pct = (k: number): number => Math.round(maxHr * k)
  const reserve = (k: number): number => Math.round(rest! + (maxHr - rest!) * k)
  return {
    maxHr,
    restingHr: rest,
    zone2: rest === null ? { min: pct(0.6), max: pct(0.7) } : { min: reserve(0.6), max: reserve(0.7) },
    hard: { min: pct(0.85), max: pct(0.95) },
    fourByFour: { min: pct(0.9), max: pct(0.95) },
    restBetween: pct(0.7),
    peakMin: pct(0.85),
  }
}

function validHr(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/* Вердикт по среднему пульсу кардио. Нет пульса или границ - null. */
export function checkZone2(avgHr: number | null | undefined, bounds: ZoneBounds | null): Zone2Verdict | null {
  if (!validHr(avgHr) || bounds === null) return null
  const { min, max } = bounds.zone2
  if (avgHr < min) return 'below'
  if (avgHr <= max) return 'in'
  if (avgHr <= max + ZONE2_TOLERANCE_BPM) return 'above-but-ok'
  return 'above'
}

/* Достигнут ли пик интервалов: от 85 % максимума включительно. */
export function checkPeak(peakHr: number | null | undefined, bounds: ZoneBounds | null): PeakVerdict | null {
  if (!validHr(peakHr) || bounds === null) return null
  return peakHr >= bounds.peakMin ? 'reached' : 'below'
}
