import type { Program } from '../core/types'

/* Программа «От одного до выхода»: 56 недель, пять фаз. Только данные, функций
   нет. Календарных дат здесь нет: недели считаются от даты старта человека
   (core/program.ts). Питания и веса в программе нет.

   Условные обозначения:
   - reps 'max' - столько, сколько получится без срыва техники; у виса это
     «до отказа хвата не доводить», у отжиманий cue уточняет;
   - fromWeekInPhase - неделя фазы, с которой элемент появляется; если N больше
     единицы, элемент заменяет предыдущий в списке дня (негатив -> полное
     упражнение), см. visibleItems в core/program.ts;
   - ladder - ступени одного круга, sets - число кругов;
   - значения отдыха и подходов, которых нет в источнике, - умолчания
     планировщика (раздел 3.5 плана). */

export const PROGRAM_MUSCLEUP: Program = {
  id: 'muscleup-56',
  title: 'От одного до выхода',
  weeks: 56,
  trainingDaysPerWeek: 3,
  deloadEveryWeeks: 4,
  measurement: {
    exerciseId: 'pullup',
    everyDays: 14,
    rule: 'Один подход в начале тренировки на свежих мышцах, на максимум чистых повторений. Единственное исключение из правила «никогда до отказа». Замер - не тренировка и в подходы недели не идёт.',
  },
  dailyLightTemplateId: 'daily-light',
  phases: [
    {
      id: 'f0',
      title: 'Подвес',
      weeks: [1, 3],
      goal: 'Поставить работу лопаткой и набрать базу виса.',
      idea: 'Начинающие проваливают подтягивание в первые 5 см: сначала лопатка, потом локти.',
      dailyLight: true,
      rotation: ['A'],
      days: [
        {
          key: 'A',
          title: 'Комплекс',
          items: [
            { exerciseId: 'hang', sets: 3, reps: 'max', restSec: 120, cue: 'Плечи не в ушах. Остановиться до срыва хвата, не после.' },
            { exerciseId: 'scap-pullup', sets: 3, reps: 8, restSec: 90, cue: 'Руки прямые, тело поднимается на 5-8 см за счёт лопаток.' },
            { exerciseId: 'row-table', sets: 3, reps: [8, 10], restSec: 90, cue: 'Под столом или низким турником, тело прямое.' },
            { exerciseId: 'pushup', sets: 3, reps: 'max', restSec: 90, cue: 'На два повторения меньше максимума.' },
            { exerciseId: 'hollow-hold', sets: 3, seconds: 20, restSec: 60, cue: 'Поясница прижата к полу.' },
          ],
        },
      ],
      exit: [
        { kind: 'hold', exerciseId: 'hang', seconds: 45, text: 'Вис на прямых руках 45 секунд' },
        { kind: 'reps', exerciseId: 'scap-pullup', reps: 8, text: '8 чистых подтягиваний лопатками' },
      ],
    },
    {
      id: 'f1',
      title: 'Первые пять',
      weeks: [4, 14],
      goal: '5 чистых подтягиваний подряд из виса, без рывка ногами.',
      idea: 'Набирать объём негативами, резиной и австралийскими подтягиваниями: угол тела регулирует нагрузку.',
      dailyLight: true,
      rotation: ['A', 'B'],
      days: [
        {
          key: 'A',
          title: 'День A: сила',
          items: [
            { exerciseId: 'pullup-negative', sets: 5, reps: 1, restSec: 180, cue: 'Встать в верхнюю точку со стула, не запрыгивать. Опускаться 5 секунд, к концу фазы 8 секунд.' },
            { exerciseId: 'row-table', sets: 3, reps: 10, restSec: 120, cue: 'Усложнять углом: ноги выше, тело ближе к горизонтали.' },
            { exerciseId: 'scap-pullup', sets: 3, reps: 8, restSec: 90, cue: 'Как разминка, не как основное.' },
            { exerciseId: 'pushup-close', sets: 3, reps: 8, restSec: 90, cue: 'Локти вдоль корпуса.' },
            { exerciseId: 'hollow-hold', sets: 3, seconds: 30, restSec: 60 },
          ],
        },
        {
          key: 'B',
          title: 'День B: объём',
          items: [
            { exerciseId: 'pullup-band', sets: 5, reps: 5, restSec: 120, cue: 'Ни один подход не до отказа. Получилось 5x5 чисто - взять резину тоньше.' },
            { exerciseId: 'row-table', sets: 4, reps: 12, restSec: 90 },
            { exerciseId: 'hang', sets: 3, reps: 'max', restSec: 90, cue: 'Хват отстаёт от спины, тянуть отдельно.' },
            { exerciseId: 'pushup', sets: 4, reps: 10, restSec: 90 },
            { exerciseId: 'hollow-rocks', sets: 3, reps: 15, restSec: 60 },
          ],
        },
      ],
      exit: [
        { kind: 'reps', exerciseId: 'pullup', reps: 5, text: '5 чистых подтягиваний подряд из виса без рывка ногами' },
      ],
    },
    {
      id: 'f2',
      title: 'До десяти',
      weeks: [15, 30],
      goal: '10 чистых подтягиваний и 10 отжиманий на прямой перекладине.',
      idea: 'Подтягивание становится основным упражнением. Два инструмента: лесенка и плотность. Отжимания на перекладине вводятся с середины фазы, сначала негативами.',
      dailyLight: true,
      rotation: ['A', 'B', 'C'],
      days: [
        {
          key: 'A',
          title: 'День A: лесенка',
          items: [
            { exerciseId: 'pullup', sets: 4, ladder: [1, 2, 3, 2, 1], restSec: 0, cue: 'Отдых между лесенками равен времени лесенки. Легко - добавить ступень.' },
            { exerciseId: 'bar-dip-negative', sets: 4, reps: 1, restSec: 120, cue: 'Опускаться 8 секунд до груди у трубы.' },
            { exerciseId: 'bar-dip', sets: 4, reps: 5, restSec: 120, fromWeekInPhase: 9, cue: 'Из упора на прямой перекладине, полная амплитуда.' },
            { exerciseId: 'row-table', sets: 3, reps: 12, restSec: 90 },
            { exerciseId: 'hollow-hold', sets: 3, seconds: 40, restSec: 60 },
          ],
        },
        {
          key: 'B',
          title: 'День B: плотность',
          items: [
            {
              exerciseId: 'pullup',
              sets: 1,
              restSec: 0,
              goal: { kind: 'total-reps', reps: 25 },
              cue: '25 повторений за минимальное число подходов. Записать число подходов: это график прогресса фазы. Отдых по самочувствию.',
            },
            { exerciseId: 'bar-dip-negative', sets: 4, reps: 1, restSec: 120, cue: 'Опускаться 8 секунд до груди у трубы.' },
            { exerciseId: 'hang', sets: 3, reps: 'max', restSec: 90 },
          ],
        },
        {
          key: 'C',
          title: 'День C: грудь к перекладине',
          items: [
            { exerciseId: 'pullup-chest', sets: 5, reps: 3, restSec: 150, fromWeekInPhase: 1, cue: 'Вводить при 6 чистых обычных. Тянуть до низа груди, не до подбородка.' },
            { exerciseId: 'bar-dip-negative', sets: 4, reps: 2, restSec: 120, cue: 'Опускаться 8 секунд до груди у трубы.' },
            { exerciseId: 'bar-dip', sets: 4, reps: 6, restSec: 120, fromWeekInPhase: 9, cue: 'Из упора на прямой перекладине, полная амплитуда.' },
            { exerciseId: 'hollow-rocks', sets: 3, reps: 20, restSec: 60 },
          ],
        },
      ],
      exit: [
        { kind: 'reps', exerciseId: 'pullup', reps: 10, text: '10 чистых подтягиваний' },
        { kind: 'reps', exerciseId: 'bar-dip', reps: 10, text: '10 отжиманий на прямой перекладине' },
      ],
    },
    {
      id: 'f3',
      title: 'Взрыв и верх',
      weeks: [31, 44],
      goal: 'Мощность, чтобы выбросить себя достаточно высоко и успеть провернуть кисти.',
      idea: 'Разница между десятью подтягиваниями и выходом - мощность, а не сила.',
      rotation: ['A'],
      days: [
        {
          key: 'A',
          title: 'Комплекс',
          items: [
            { exerciseId: 'pullup-explosive', sets: 5, reps: 3, restSec: 180, cue: 'К груди, затем к солнечному сплетению, затем к пупку. Скорость важнее числа.' },
            { exerciseId: 'pullup-weighted', sets: 5, reps: 5, restSec: 180, cue: 'Рюкзак: +5 кг, затем +10 кг.' },
            { exerciseId: 'bar-dip', sets: 4, reps: [8, 12], restSec: 120, cue: 'Полная амплитуда, грудь к трубе.' },
            { exerciseId: 'hang-false-grip', sets: 4, seconds: 15, restSec: 90 },
            { exerciseId: 'pullup', sets: 2, reps: 'max', restSec: 180, cue: 'Поддержание базы в конце тренировки, с запасом 1-2 повторения.' },
          ],
        },
      ],
      exit: [
        { kind: 'manual', text: 'Взрывное подтягивание до низа груди' },
        { kind: 'reps', exerciseId: 'bar-dip', reps: 12, text: '12 отжиманий на перекладине' },
        { kind: 'weighted-reps', exerciseId: 'pullup-weighted', reps: 5, addedKg: 10, text: 'Подтягивание с +10 кг на 5 раз' },
      ],
    },
    {
      id: 'f4',
      title: 'Сборка',
      weeks: [45, 56],
      goal: 'Один чистый выход силой на две руки.',
      idea: 'Сила уже есть, осталась техника перехода. Порядок разучивания от конца к началу: негатив, переход с резиной, выход с подъёмом ног, строгий выход.',
      rotation: ['A'],
      days: [
        {
          key: 'A',
          title: 'Комплекс',
          items: [
            { exerciseId: 'muscleup-negative', sets: 3, reps: 2, restSec: 180, cue: 'Из упора медленно через переход в вис. Готовность: 5 контролируемых повторений.' },
            { exerciseId: 'muscleup-transition-band', sets: 3, reps: 3, restSec: 180, cue: 'Готовность: 3x3 на тонкой резине.' },
            { exerciseId: 'muscleup-kip', sets: 3, reps: 1, restSec: 180, cue: 'Первый выход обычно приходит с добросом ног.' },
            { exerciseId: 'muscleup-strict', sets: 3, reps: 1, restSec: 180, cue: 'Из мёртвого виса, без раскачки.' },
            { exerciseId: 'pullup', sets: 2, reps: 'max', restSec: 180, cue: 'Поддержание, с запасом 1-2 повторения.' },
            { exerciseId: 'bar-dip', sets: 3, reps: 8, restSec: 120, cue: 'Поддержание.' },
          ],
        },
      ],
      exit: [
        { kind: 'manual', text: 'Один чистый выход силой на две руки' },
      ],
    },
  ],
  checkpoints: [
    { week: 5, text: '2 чистых подтягивания' },
    { week: 14, text: '5 чистых подтягиваний' },
    { week: 22, text: '8 подтягиваний и 5 отжиманий на перекладине' },
    { week: 30, text: '12 подтягиваний, 10 отжиманий, грудь к перекладине' },
    { week: 44, text: 'Подтягивание к пупку и +10 кг на 5 раз' },
    { week: 48, text: 'Недели 48-56: первый выход силой, сначала с добросом ног, строгий через 4-6 недель' },
  ],
  rules: [
    'Никогда до отказа: оставлять 1-2 повторения в запасе. Исключение - двухнедельный замер.',
    'Замер - не тренировка.',
    'Каждая 4-я неделя разгрузочная: объём минус 40 процентов, интенсивность та же.',
    'Ровно 3 тяжёлые тренировки в неделю через день плюс ежедневная лёгкая мелочь.',
    'Сон семь часов и меньше срезает силовой прогресс примерно на треть при том же объёме.',
    'Вес тела - второй рычаг: каждый лишний килограмм отнимает повторения.',
  ],
  stagnation: [
    'Контрольная точка не взята в срок с запасом в три недели: дело не в упорстве, а в программе. Разбирать программу, а не дожимать.',
    'Плато на 7-8 повторениях: проверить, не пропущена ли разгрузочная неделя.',
    'Ежедневная проверка максимума запрещена: число гуляет на плюс-минус 2, а попытки выжать максимум ломают восстановление.',
  ],
}
