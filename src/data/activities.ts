import type { ExternalActivity } from '../core/types'

/* Занятия вне приложения, раздел 3.7 плана. splitPer60 - подсказка, как 60
   минут занятия делятся по столпам; сумма каждой строки ровно 60. Человек
   правит доли руками, масштабирование на длительность делает ядро. */

export const EXTERNAL_ACTIVITIES: ExternalActivity[] = [
  { id: 'kickboxing', title: 'Кикбоксинг', splitPer60: { intervals: 20, zone2: 30, mobility: 10 } },
  { id: 'boxing', title: 'Бокс', splitPer60: { intervals: 20, zone2: 30, mobility: 10 } },
  { id: 'grappling', title: 'Борьба, грэпплинг', splitPer60: { intervals: 20, zone2: 30, mobility: 10 } },
  { id: 'yoga', title: 'Йога', splitPer60: { mobility: 45, balance: 15 } },
  { id: 'pilates', title: 'Пилатес', splitPer60: { mobility: 30, balance: 15, strength: 15 } },
  { id: 'football', title: 'Футбол', splitPer60: { zone2: 40, intervals: 20 } },
  { id: 'basketball', title: 'Баскетбол', splitPer60: { zone2: 40, intervals: 20 } },
  { id: 'volleyball', title: 'Волейбол', splitPer60: { zone2: 40, intervals: 20 } },
  { id: 'tennis', title: 'Теннис, падел', splitPer60: { zone2: 40, intervals: 20 } },
  { id: 'swimming', title: 'Плавание', splitPer60: { zone2: 60 } },
  { id: 'cycling', title: 'Велосипед на улице', splitPer60: { zone2: 60 } },
  { id: 'hiking', title: 'Поход, долгая ходьба', splitPer60: { zone2: 60 } },
  { id: 'easy-run', title: 'Лёгкий бег', splitPer60: { zone2: 60 } },
  { id: 'dancing', title: 'Танцы', splitPer60: { zone2: 45, mobility: 15 } },
  { id: 'climbing', title: 'Скалолазание', splitPer60: { strength: 40, mobility: 20 } },
  { id: 'other', title: 'Другое', splitPer60: { zone2: 60 } },
]
