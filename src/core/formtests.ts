/* Тесты формы: свёртка полей в один результат, полоса нормы по возрасту,
   сроки повтора и побочный эффект пульса покоя. Чистые функции: возраст и
   сегодняшняя дата приходят параметрами, данные тестов (src/data/formtests.ts)
   сюда тоже приходят параметрами.

   Полосы NormBand - полуинтервалы [from, upTo): значение на границе относится
   к верхней полосе. Первая полоса без from, последняя без upTo. */

import { addDays, daysBetween } from './dates.ts'
import { formatKg } from './format.ts'
import type {
  DateISO, FormTest, NormBand, NormTable, Pillar, Settings, TestResult,
} from './types.ts'

/* Расширения контракта FormTest (types.ts менять нельзя): пометка красной
   точки у полосы, столп теста и признак производной величины. */
export interface FormBand extends NormBand {
  flag?: true                     // в интерфейсе красная точка
}
export interface FormNormTable extends NormTable {
  bands: FormBand[]
}
export type DerivedKind = 'vo2max'
export interface FormTestDef extends FormTest {
  pillar: Pillar | null           // null: общее здоровье, не столп
  norms: FormNormTable[]
  derived?: DerivedKind
}

export const RESTING_HR_TEST_ID = 'resting-hr'
export const SOON_DAYS = 5
const PLAUSIBLE_AGE_MAX = 120

/* ---- возраст и нормы ---- */

/* Возраст по календарному году рождения. null, если год не задан или нелеп. */
export function ageFromBirthYear(birthYear: number | null, today: DateISO): number | null {
  if (birthYear === null || !Number.isInteger(birthYear)) return null
  const year = Number(today.slice(0, 4))
  const age = year - birthYear
  return age >= 0 && age <= PLAUSIBLE_AGE_MAX ? age : null
}

/* Строка, не зависящая от возраста: ageFrom 0, ageTo не меньше AGE_ANY_TO. */
export const AGE_ANY_TO = 120
const isAgeFree = (n: NormTable): boolean => n.ageFrom === 0 && n.ageTo >= AGE_ANY_TO

/* Возрастная строка таблицы норм, в которую попадает возраст (границы
   включительно). Возраст неизвестен: подходит только строка, не зависящая
   от возраста. null: ни одна строка не подходит. */
export function ageBand<T extends NormTable>(norms: readonly T[], age: number | null): T | null {
  if (age === null || !Number.isFinite(age)) return norms.find(isAgeFree) ?? null
  return norms.find(n => age >= n.ageFrom && age <= n.ageTo) ?? null
}

/* Полосы нормы для возраста; пустой список, если норм для него нет. */
export function normsForAge(test: FormTestDef, age: number | null): FormBand[] {
  return ageBand(test.norms, age)?.bands ?? []
}

/* Индекс полосы, куда попадает значение, или -1. */
export function bandIndex(bands: readonly NormBand[], value: number): number {
  if (!Number.isFinite(value)) return -1
  return bands.findIndex(b => (b.from === undefined || value >= b.from) && (b.upTo === undefined || value < b.upTo))
}

/* ---- свёртка и оценка ---- */

export interface BandInfo {
  index: number
  label: string
  flag: boolean
  from?: number
  upTo?: number
}
export interface DerivedValue {
  kind: DerivedKind
  value: number
  text: string
}
export type EvaluateFailure = 'missing-field' | 'invalid-number' | 'zero-denominator'
export type Evaluation =
  | { ok: true; result: number; band: BandInfo | null; better: 'higher' | 'lower' | null; derived?: DerivedValue }
  | { ok: false; reason: EvaluateFailure; field?: string }

const round = (n: number, digits: number): number => {
  const k = 10 ** digits
  return Math.round(n * k) / k
}

const isValid = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

type Reduced = { ok: true; result: number } | { ok: false; reason: EvaluateFailure; field?: string }

function reduceValues(test: FormTestDef, values: Record<string, number>): Reduced {
  const keys = test.fields.map(f => f.key)
  if (keys.length === 0) return { ok: false, reason: 'missing-field' }
  const present = keys.filter(k => values[k] !== undefined && values[k] !== null)
  const bad = present.find(k => !isValid(values[k]))
  if (bad !== undefined) return { ok: false, reason: 'invalid-number', field: bad }

  switch (test.reduce) {
    case 'first': {
      const first = keys[0]
      if (!present.includes(first)) return { ok: false, reason: 'missing-field', field: first }
      return { ok: true, result: values[first] }
    }
    case 'max':
    case 'bestOfSides': {
      if (present.length === 0) return { ok: false, reason: 'missing-field', field: keys[0] }
      return { ok: true, result: Math.max(...present.map(k => values[k])) }
    }
    case 'min': {
      const absent = keys.find(k => !present.includes(k))
      if (absent !== undefined) return { ok: false, reason: 'missing-field', field: absent }
      return { ok: true, result: Math.min(...keys.map(k => values[k])) }
    }
    case 'ratio': {
      if (keys.length < 2) return { ok: false, reason: 'missing-field' }
      const [num, den] = keys
      if (!present.includes(num)) return { ok: false, reason: 'missing-field', field: num }
      if (!present.includes(den)) return { ok: false, reason: 'missing-field', field: den }
      if (values[den] === 0) return { ok: false, reason: 'zero-denominator', field: den }
      return { ok: true, result: round(values[num] / values[den], 2) }
    }
  }
}

function deriveValue(test: FormTestDef, result: number): DerivedValue | undefined {
  if (test.derived === 'vo2max') {
    /* Формула Купера: дистанция в километрах. */
    const value = round(22.351 * (result / 1000) - 11.288, 1)
    return { kind: 'vo2max', value, text: `VO2max около ${formatKg(value)} мл/кг/мин` }
  }
  return undefined
}

/* Свёртка полей в результат и полоса нормы для возраста. Без возраста или без
   норм для него band = null (результат при этом считается). */
export function evaluateTest(test: FormTestDef, values: Record<string, number>, age: number | null): Evaluation {
  const reduced = reduceValues(test, values)
  if (!reduced.ok) return reduced
  const table = ageBand(test.norms, age)
  let band: BandInfo | null = null
  if (table) {
    const index = bandIndex(table.bands, reduced.result)
    if (index >= 0) {
      const b = table.bands[index]
      band = { index, label: b.label, flag: b.flag === true, from: b.from, upTo: b.upTo }
    }
  }
  const evaluation: Evaluation = { ok: true, result: reduced.result, band, better: table ? table.better : null }
  const derived = deriveValue(test, reduced.result)
  if (derived) evaluation.derived = derived
  return evaluation
}

/* Разница рук у тестов с полями left и right: слабая сторона и отставание.
   null, если одной из сторон нет, значения мусорные или руки равны. */
export interface SideGap { weaker: 'left' | 'right'; gap: number }
export function sideGap(values: Record<string, number>): SideGap | null {
  const { left, right } = values
  if (!isValid(left) || !isValid(right) || left === right) return null
  return left < right
    ? { weaker: 'left', gap: round(right - left, 2) }
    : { weaker: 'right', gap: round(left - right, 2) }
}

/* ---- история и сроки ---- */

/* Результаты теста по возрастанию даты; при равной дате порядок записи. */
function resultsOf(results: readonly TestResult[], testId: string): TestResult[] {
  return results
    .map((r, i) => ({ r, i }))
    .filter(x => x.r.testId === testId)
    .sort((a, b) => (a.r.date < b.r.date ? -1 : a.r.date > b.r.date ? 1 : a.i - b.i))
    .map(x => x.r)
}

export function latestResult(results: readonly TestResult[], testId: string): TestResult | null {
  const list = resultsOf(results, testId)
  return list.length > 0 ? list[list.length - 1] : null
}

export function testSeries(results: readonly TestResult[], testId: string): { date: DateISO; score: number }[] {
  return resultsOf(results, testId).map(r => ({ date: r.date, score: r.result }))
}

/* Дата следующего замера. Если теста ещё не делали, пора сегодня. */
export function nextDue(test: FormTest, results: readonly TestResult[], today: DateISO): DateISO {
  const last = latestResult(results, test.id)
  return last ? addDays(last.date, test.repeatDays) : today
}

/* Дней до срока: 0 и меньше - пора. null, если теста ещё не делали. */
export function daysUntilDue(test: FormTest, results: readonly TestResult[], today: DateISO): number | null {
  const last = latestResult(results, test.id)
  if (!last) return null
  return daysBetween(today, addDays(last.date, test.repeatDays))
}

export type DueStatus = 'never' | 'due' | 'soon' | 'ok'

export function dueStatus(test: FormTest, results: readonly TestResult[], today: DateISO): DueStatus {
  const days = daysUntilDue(test, results, today)
  if (days === null) return 'never'
  if (days <= 0) return 'due'
  return days <= SOON_DAYS ? 'soon' : 'ok'
}

/* ---- побочный эффект пульса покоя ---- */

/* Новые настройки: restingHr берёт результат теста пульса покоя, если он не
   введён руками (restingHrManual). Иначе, для другого теста или мусорного
   результата, возвращает те же настройки (тот же объект). Вызывать для
   самой свежей записи, а не для правки старой. */
export function applyRestingHr(settings: Settings, result: TestResult): Settings {
  if (result.testId !== RESTING_HR_TEST_ID) return settings
  if (settings.restingHrManual) return settings
  if (!Number.isFinite(result.result) || result.result <= 0) return settings
  return { ...settings, restingHr: result.result }
}
