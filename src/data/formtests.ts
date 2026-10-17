/* Тесты формы (раздел 3.6 плана): поля, способ свёртки, нормы по возрастным
   строкам, как выполнять, срок повтора и источник. Данные, не код.

   Нормы взяты для мужчин. Полосы - полуинтервалы [from, upTo): значение на
   границе относится к верхней полосе. Целочисленные пороги источника вида
   «норма 2200-2399 м» записаны границей 2400, потому что значения целые
   (метры, секунды, удары в минуту, повторы).

   Возрастные строки: ageFrom и ageTo включительно. Вне строк нормы нет, и
   интерфейс показывает только личную динамику. */

import { AGE_ANY_TO } from '../core/formtests.ts'
import type { FormTest } from '../core/types.ts'

const ANY_AGE = { ageFrom: 0, ageTo: AGE_ANY_TO } as const

export const FORM_TESTS: FormTest[] = [
  {
    id: 'grip',
    title: 'Хват (динамометр)',
    pillar: 'strength',
    unit: 'kg',
    fields: [
      { key: 'left', title: 'Левая рука', unit: 'kg' },
      { key: 'right', title: 'Правая рука', unit: 'kg' },
    ],
    reduce: 'bestOfSides',
    howTo:
      'Стоя, рука вдоль тела, динамометр сжимать на максимум 3-5 секунд. Три попытки на каждую руку, ' +
      'вносится лучшая из трёх. Результатом считается лучшая рука, разница рук показывается отдельно. ' +
      'Справка по возрасту 20 лет (Dodds 2014): p10 30, p25 35, p50 40, p75 46, p90 52 кг.',
    repeatDays: 42,
    norms: [
      {
        ageFrom: 18, ageTo: 19, better: 'higher',
        bands: [{ upTo: 35.7, label: 'слабо' }, { from: 35.7, upTo: 55.5, label: 'норма' }, { from: 55.5, label: 'сильно' }],
      },
      {
        ageFrom: 20, ageTo: 24, better: 'higher',
        bands: [{ upTo: 36.8, label: 'слабо' }, { from: 36.8, upTo: 56.6, label: 'норма' }, { from: 56.6, label: 'сильно' }],
      },
      {
        ageFrom: 25, ageTo: 29, better: 'higher',
        bands: [{ upTo: 37.7, label: 'слабо' }, { from: 37.7, upTo: 57.5, label: 'норма' }, { from: 57.5, label: 'сильно' }],
      },
    ],
    reference:
      'Нормы блога тестов T, фунты переведены в кг (делитель 2,2046). Справка: Dodds 2014, ' +
      'https://pmc.ncbi.nlm.nih.gov/articles/PMC4256164/',
  },
  {
    id: 'pushups',
    title: 'Отжимания подряд',
    pillar: 'strength',
    unit: 'reps',
    fields: [{ key: 'reps', title: 'Повторы', unit: 'reps' }],
    reduce: 'first',
    howTo:
      'Грудь касается пола, тело прямое, пауза вверху не дольше 3 секунд. Без отдыха, до первого ' +
      'нарушения техники. Вносится число засчитанных повторов.',
    repeatDays: 42,
    norms: [
      {
        ageFrom: 13, ageTo: 19, better: 'higher',
        bands: [
          { upTo: 14, label: 'низко' },
          { from: 14, upTo: 26, label: 'ниже среднего' },
          { from: 26, upTo: 30, label: 'средне' },
          { from: 30, upTo: 45, label: 'хорошо' },
          { from: 45, label: 'отлично' },
        ],
      },
      {
        ageFrom: 20, ageTo: 29, better: 'higher',
        bands: [
          { upTo: 12, label: 'низко' },
          { from: 12, upTo: 22, label: 'ниже среднего' },
          { from: 22, upTo: 26, label: 'средне' },
          { from: 26, upTo: 39, label: 'хорошо' },
          { from: 39, label: 'отлично' },
        ],
      },
    ],
    reference:
      'Нормы блога тестов T. Разрывы источника (36-38 для 20-29 лет, 42-44 для подростков) закрыты ' +
      'в сторону «хорошо», решение планировщика.',
  },
  {
    id: 'pullups',
    title: 'Подтягивания строгие, максимум',
    pillar: 'strength',
    unit: 'reps',
    fields: [{ key: 'reps', title: 'Повторы', unit: 'reps' }],
    reduce: 'first',
    howTo:
      'Из полного виса, подбородок над перекладиной, без рывка и маха ногами. Максимум подряд. ' +
      'Запись результата создаёт замер программы, замер программы создаёт запись теста.',
    repeatDays: 14,
    norms: [],
    reference: 'Возрастных норм нет, только личная динамика.',
    linkedExerciseId: 'pullup',
  },
  {
    id: 'sit-rise',
    title: 'Тест «сесть-встать»',
    pillar: 'mobility',
    unit: 'score',
    fields: [{ key: 'score', title: 'Баллы (0-10)', unit: 'score' }],
    reduce: 'first',
    howTo:
      'Сесть на пол, скрестив ноги, и встать без помощи рук, коленей и предплечий. Максимум 10 баллов: ' +
      'минус 1 за каждое касание опоры, минус 0,5 за потерю устойчивости. Шаг ввода 0,5. ' +
      'Результат 8 и больше считается отличным.',
    repeatDays: 35,
    norms: [
      {
        ageFrom: 16, ageTo: 20, better: 'higher',
        bands: [{ upTo: 8, label: 'ниже среднего' }, { from: 8, upTo: 10, label: 'норма' }, { from: 10, label: 'выше среднего' }],
      },
      {
        ageFrom: 21, ageTo: 25, better: 'higher',
        bands: [{ upTo: 8.5, label: 'ниже среднего' }, { from: 8.5, upTo: 10, label: 'норма' }, { from: 10, label: 'выше среднего' }],
      },
      {
        ageFrom: 26, ageTo: 30, better: 'higher',
        bands: [{ upTo: 8.5, label: 'ниже среднего' }, { from: 8.5, upTo: 9.5, label: 'норма' }, { from: 9.5, label: 'выше среднего' }],
      },
    ],
    reference: 'Нормы блога тестов T: первый и третий квартили по возрастным группам, допуск 0,5 балла.',
  },
  {
    id: 'sit-reach',
    title: 'Наклон вперёд сидя (YMCA)',
    pillar: 'mobility',
    unit: 'cm',
    fields: [
      { key: 'attempt1', title: 'Попытка 1', unit: 'cm' },
      { key: 'attempt2', title: 'Попытка 2', unit: 'cm' },
    ],
    reduce: 'max',
    howTo:
      'Сидя на полу, ноги вытянуты, стопы упираются в отметку 15 дюймов (38 см) линейки. Медленно ' +
      'тянуться вперёд двумя руками и удержать 1-2 секунды. Вносится дистанция в см от нулевой отметки, ' +
      'лучшая из двух попыток. Справка CSEP для 20-29 лет (коробка, пятки на 26 см): от 40 отлично, ' +
      '34-39 очень хорошо, 29-33 хорошо, 25-28 удовлетворительно, 24 и меньше требует улучшения. ' +
      'Шкалы YMCA и CSEP не смешивать.',
    repeatDays: 35,
    norms: [
      {
        /* Перцентили YMCA в см: p40 38,1; p70 48,3. */
        ageFrom: 18, ageTo: 25, better: 'higher',
        bands: [{ upTo: 38.1, label: 'ниже среднего' }, { from: 38.1, upTo: 48.3, label: 'норма' }, { from: 48.3, label: 'выше среднего' }],
      },
      {
        /* Перцентили YMCA в см: p40 35,6; p70 43,2. */
        ageFrom: 26, ageTo: 35, better: 'higher',
        bands: [{ upTo: 35.6, label: 'ниже среднего' }, { from: 35.6, upTo: 43.2, label: 'норма' }, { from: 43.2, label: 'выше среднего' }],
      },
    ],
    reference:
      'Нормы YMCA в дюймах переведены в см. Перцентиль 70 и выше - выше среднего, 40-69 - норма, ' +
      'ниже 40 - ниже среднего.',
  },
  {
    id: 'single-leg-stance-closed',
    title: 'Стойка на одной ноге с закрытыми глазами',
    pillar: 'balance',
    unit: 'sec',
    fields: [
      { key: 'left', title: 'Левая нога, с', unit: 'sec' },
      { key: 'right', title: 'Правая нога, с', unit: 'sec' },
    ],
    reduce: 'min',
    howTo:
      'Босиком, руки на поясе, стопа поднята к голени, глаза закрыты. Время до касания пола или ' +
      'открытия глаз, предел 45 секунд: при достижении предела попытка останавливается. Три попытки на ' +
      'каждую ногу, вносится лучшая из трёх, целые секунды. Оценку определяет слабая сторона.',
    repeatDays: 35,
    norms: [
      {
        ...ANY_AGE, better: 'higher',
        bands: [{ upTo: 17, label: 'ниже среднего' }, { from: 17, upTo: 36, label: 'норма' }, { from: 36, label: 'выше среднего' }],
      },
    ],
    reference:
      'Мужчины 20-39 лет: диапазон 19,3-34,8 с (T); лучшая из трёх в среднем 16,9 с (Springer 2007, ' +
      'https://pubmed.ncbi.nlm.nih.gov/19839175/). Порог 10 секунд из популярных источников описан для ' +
      '51-75 лет и в расчёт не берётся.',
  },
  {
    id: 'waist-height',
    title: 'Талия к росту',
    pillar: null,
    unit: 'ratio',
    fields: [
      { key: 'waistCm', title: 'Талия, см', unit: 'cm' },
      { key: 'heightCm', title: 'Рост, см', unit: 'cm' },
    ],
    reduce: 'ratio',
    howTo: 'Сантиметр на уровне пупка, выдох, лента не давит, рост без обуви. Результат: талия делить на рост, два знака.',
    repeatDays: 42,
    norms: [
      {
        ...ANY_AGE, better: 'lower',
        bands: [
          { upTo: 0.51, label: 'здоровое соотношение' },
          { from: 0.51, upTo: 0.58, label: 'повышенное' },
          { from: 0.58, label: 'высокое', flag: true },
        ],
      },
    ],
    reference: 'Здоровая зона до 0,50, 0,51-0,57 повышенный риск, цель менее 0,5 (блог тестов T).',
  },
  {
    id: 'cooper',
    title: 'Тест Купера 12 минут',
    pillar: 'zone2',
    unit: 'm',
    fields: [{ key: 'distanceM', title: 'Дистанция, м', unit: 'm' }],
    reduce: 'first',
    howTo:
      'Ровная трасса или дорожка, 12 минут максимально ровного бега, фиксируется дистанция в метрах. ' +
      'Перед тестом разминка 5 минут. Справка FRIEND 2015 (мужчины 20-29, VO2max мл/кг/мин): p5 29,0; ' +
      'p10 32,1; p25 40,1; p50 48,0; p75 55,2; p90 61,8; p95 66,3. Оценка VO2max по Куперу грубая: ' +
      'годится для личной динамики, не как точное значение.',
    repeatDays: 49,
    norms: [
      {
        ...ANY_AGE, better: 'higher',
        bands: [
          { upTo: 2200, label: 'ниже среднего' },
          { from: 2200, upTo: 2400, label: 'средне' },
          { from: 2400, upTo: 2801, label: 'хорошо' },
          { from: 2801, label: 'отлично' },
        ],
      },
    ],
    derived: 'vo2max',
    reference:
      'VO2max = 22,351 x км - 11,288; https://www.topendsports.com/testing/tests/cooper.htm. ' +
      'FRIEND 2015: https://pubmed.ncbi.nlm.nih.gov/26455884/',
  },
  {
    id: 'resting-hr',
    title: 'Пульс покоя',
    pillar: null,
    unit: 'bpm',
    fields: [{ key: 'bpm', title: 'Удары в минуту', unit: 'bpm' }],
    reduce: 'first',
    howTo: 'Утром до подъёма, минута по секундомеру на запястье или шее. Целое число ударов.',
    repeatDays: 7,
    norms: [
      {
        ...ANY_AGE, better: 'lower',
        bands: [
          { upTo: 40, label: 'проверить измерение' },
          { from: 40, upTo: 60, label: 'тренированный' },
          { from: 60, upTo: 101, label: 'норма' },
          { from: 101, label: 'высокий', flag: true },
        ],
      },
    ],
    reference: 'Норма взрослых 60-100, у тренированных 40-60: https://medlineplus.gov/ency/article/003399.htm',
  },
]

export const FORM_TESTS_BY_ID: Record<string, FormTest> =
  Object.fromEntries(FORM_TESTS.map(t => [t.id, t]))
