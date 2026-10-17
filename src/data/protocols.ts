import type { IntervalProtocol } from '../core/types'
import type { CustomProtocolLimits } from '../core/timers'

/* Интервальные протоколы (раздел 3.4 плана). Только данные, без функций.
   Времена в секундах. Последний отдых в расписании опускается (см.
   intervalPhases), поэтому полная длительность считается формулой
   protocolDurationSec, а не как rounds * (work + rest). */

export const CUSTOM_PROTOCOL_ID = 'custom'

/** Пределы значений своего протокола. */
export const CUSTOM_PROTOCOL_LIMITS: CustomProtocolLimits = {
  workSec: { min: 5, max: 600 },
  restSec: { min: 0, max: 600 },
  rounds: { min: 1, max: 30 },
  warmupSec: { min: 0, max: 900 },
  cooldownSec: { min: 0, max: 600 },
}

export const INTERVAL_PROTOCOLS: IntervalProtocol[] = [
  {
    id: 'norwegian-4x4',
    title: 'Норвежское 4x4',
    workSec: 240, restSec: 180, rounds: 4, warmupSec: 600, cooldownSec: 300,
    note: 'Работа на 90-95 процентах максимума пульса, отдых активно, около 70 процентов.',
    source: 'Helgerud 2007; Джонсон',
  },
  {
    id: 'interval-15-15',
    title: '15/15',
    workSec: 15, restSec: 15, rounds: 20, warmupSec: 600, cooldownSec: 300,
    note: 'Короткие отрезки с равным отдыхом. Число циклов 20 - решение планировщика.',
    source: 'Helgerud',
  },
  {
    id: 'interval-30-30',
    title: '30/30',
    workSec: 30, restSec: 30, rounds: 10, warmupSec: 600, cooldownSec: 300,
    note: 'Тридцать секунд работы, тридцать отдыха. Число циклов 10 - решение планировщика.',
    source: 'pubmed 10638376',
  },
  {
    id: 'tabata-20-10',
    title: 'Табата 20/10',
    workSec: 20, restSec: 10, rounds: 8, warmupSec: 300, cooldownSec: 180,
    note: 'Дома воспроизводится приближённо. Разминка и заминка - решение планировщика.',
    source: 'Tabata 1996',
  },
  {
    id: 'sit-3x20',
    title: 'Спринты SIT 3 x 20 с',
    workSec: 20, restSec: 120, rounds: 3, warmupSec: 120, cooldownSec: 120,
    note: 'Велосипед, максимальное усилие. Всего около 10 минут.',
    source: 'pubmed 27115137',
  },
  {
    id: 'noequip-8x20-10',
    title: 'Без оборудования 8 x 20/10',
    workSec: 20, restSec: 10, rounds: 8, warmupSec: 180, cooldownSec: 120,
    note: 'Берпи, звёздочка, скалолаз, упор-присед.',
    source: 'pubmed 22994393',
  },
  {
    id: 'johnson-8x20-20',
    title: 'Джонсон 8 x 20/20',
    workSec: 20, restSec: 20, rounds: 8, warmupSec: 180, cooldownSec: 120,
    note: 'Двадцать секунд работы, двадцать отдыха.',
    source: 'блог 2026-10-14',
  },
  {
    id: 'johnson-8x20-40',
    title: 'Джонсон 8 x 20/40 (новичкам)',
    workSec: 20, restSec: 40, rounds: 8, warmupSec: 180, cooldownSec: 120,
    note: 'Облегчённый вариант: отдых вдвое длиннее работы.',
    source: 'блог 2026-10-14',
  },
  {
    id: 'johnson-30s',
    title: 'Джонсон 30 с x 5',
    workSec: 30, restSec: 60, rounds: 5, warmupSec: 300, cooldownSec: 180,
    note: 'В блоге 4-6 повторов, отдых не указан; 60 с - решение планировщика.',
    source: 'блог 2026-10-14',
  },
  {
    id: CUSTOM_PROTOCOL_ID,
    title: 'Свой протокол',
    workSec: 30, restSec: 30, rounds: 8, warmupSec: 300, cooldownSec: 120,
    note: 'Значения задаёт человек в пределах CUSTOM_PROTOCOL_LIMITS; здесь стартовые.',
    source: 'свой',
  },
]
