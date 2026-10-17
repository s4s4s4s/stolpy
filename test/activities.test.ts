import { assert, assertEqual, finish, group } from './_harness.ts'
import { EXTERNAL_ACTIVITIES } from '../src/data/activities.ts'
import { PILLARS } from '../src/core/pillars.ts'
import type { Pillar } from '../src/core/types.ts'

const FORBIDDEN = ['травм', 'запяст', 'осторожн', 'врач']
const byId = (id: string) => {
  const found = EXTERNAL_ACTIVITIES.find(a => a.id === id)
  if (!found) throw new Error(`нет занятия ${id}`)
  return found
}

group('состав: 16 занятий раздела 3.7, id уникальны', () => {
  assertEqual(EXTERNAL_ACTIVITIES.length, 16, 'число занятий')
  assertEqual(
    EXTERNAL_ACTIVITIES.map(a => a.id),
    [
      'kickboxing', 'boxing', 'grappling', 'yoga', 'pilates', 'football', 'basketball', 'volleyball', 'tennis',
      'swimming', 'cycling', 'hiking', 'easy-run', 'dancing', 'climbing', 'other',
    ],
    'id в порядке плана',
  )
  assertEqual(new Set(EXTERNAL_ACTIVITIES.map(a => a.id)).size, 16, 'id уникальны')
  assertEqual(EXTERNAL_ACTIVITIES.at(-1)?.id, 'other', '«Другое» последним: ExternalItem.activityId = other')
  for (const a of EXTERNAL_ACTIVITIES) {
    assert(a.title.trim().length > 0 && a.title === a.title.trim(), `${a.id}: название заполнено`)
    for (const word of FORBIDDEN) assert(!a.title.toLowerCase().includes(word), `${a.id}: запрещённое слово «${word}»`)
  }
})

group('распределение на 60 минут: сумма ровно 60, доли целые и положительные', () => {
  for (const a of EXTERNAL_ACTIVITIES) {
    const entries = Object.entries(a.splitPer60) as [Pillar, number][]
    assert(entries.length > 0, `${a.id}: есть доли`)
    let sum = 0
    for (const [pillar, minutes] of entries) {
      assert(PILLARS.includes(pillar), `${a.id}: неизвестный столп ${pillar}`)
      assert(Number.isInteger(minutes) && minutes > 0, `${a.id}/${pillar}: доля целая и больше нуля`)
      assert(minutes % 5 === 0, `${a.id}/${pillar}: доля кратна 5 минутам`)
      sum += minutes
    }
    assertEqual(sum, 60, `${a.id}: сумма долей`)
  }
})

group('значения из плана', () => {
  assertEqual(byId('kickboxing').splitPer60, { intervals: 20, zone2: 30, mobility: 10 }, 'кикбоксинг')
  assertEqual(byId('boxing').splitPer60, byId('kickboxing').splitPer60, 'бокс как кикбоксинг')
  assertEqual(byId('grappling').splitPer60, byId('kickboxing').splitPer60, 'борьба как кикбоксинг')
  assertEqual(byId('yoga').splitPer60, { mobility: 45, balance: 15 }, 'йога')
  assertEqual(byId('pilates').splitPer60, { mobility: 30, balance: 15, strength: 15 }, 'пилатес')
  for (const id of ['football', 'basketball', 'volleyball', 'tennis']) {
    assertEqual(byId(id).splitPer60, { zone2: 40, intervals: 20 }, `${id}: игровые виды`)
  }
  for (const id of ['swimming', 'cycling', 'hiking', 'easy-run', 'other']) {
    assertEqual(byId(id).splitPer60, { zone2: 60 }, `${id}: целиком зона 2`)
  }
  assertEqual(byId('dancing').splitPer60, { zone2: 45, mobility: 15 }, 'танцы')
  assertEqual(byId('climbing').splitPer60, { strength: 40, mobility: 20 }, 'скалолазание')
  assertEqual(byId('hiking').title, 'Поход, долгая ходьба', 'название с запятой из плана')
})

finish()
