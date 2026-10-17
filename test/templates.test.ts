import { assert, assertEqual, finish, group } from './_harness.ts'
import { EXERCISES } from '../src/data/exercises.ts'
import { TEMPLATES } from '../src/data/templates.ts'
import { INTERVAL_PROTOCOLS } from '../src/data/protocols.ts'
import { ALL_EQUIPMENT, GYM_EQUIPMENT, OUTSIDE_EQUIPMENT, buildLibrary, canDoHere, equipmentFor } from '../src/core/library.ts'
import { lastUsedAt, missingExercises, templateCoverage, templatesFor } from '../src/core/templates.ts'
import { PILLARS } from '../src/core/pillars.ts'
import type { Equipment, Session, Template } from '../src/core/types.ts'

const FORBIDDEN = ['травм', 'запяст', 'осторожн', 'врач']
const library = buildLibrary(EXERCISES)

/* Полный домашний инвентарь: всё, кроме стационарного оборудования зала. */
const GYM_FIXTURES: Equipment[] = ['gym-machines', 'treadmill', 'rower', 'elliptical']
const HOME_FULL: Equipment[] = ALL_EQUIPMENT.filter(e => !GYM_FIXTURES.includes(e))

const byId = (id: string): Template => {
  const found = TEMPLATES.find(t => t.id === id)
  if (!found) throw new Error(`нет шаблона ${id}`)
  return found
}
const doable = (t: Template, equipment: readonly Equipment[]): boolean =>
  t.items.every(i => canDoHere(library[i.exerciseId]!, equipment))

group('состав: все 21 шаблон раздела 3.3', () => {
  assertEqual(TEMPLATES.length, 21, 'число шаблонов')
  assertEqual(
    TEMPLATES.map(t => t.id),
    [
      'home-strength-a', 'home-strength-b', 'home-strength-c', 'home-grip', 'home-zone2-bike', 'home-zone2-walk',
      'home-intervals-4x4', 'home-intervals-rope', 'home-intervals-burpee', 'home-mobility-10', 'home-balance-10',
      'daily-light', 'gym-strength-a', 'gym-strength-b', 'gym-strength-c', 'gym-zone2', 'gym-intervals-4x4',
      'johnson-monday', 'johnson-tuesday', 'johnson-thursday', 'johnson-friday',
    ],
    'id в порядке плана',
  )
  assertEqual(new Set(TEMPLATES.map(t => t.id)).size, 21, 'id уникальны')
  assertEqual(
    TEMPLATES.map(t => t.estMinutes),
    [50, 50, 50, 10, 55, 45, 50, 12, 10, 11, 10, 5, 55, 55, 55, 55, 40, 60, 10, 40, 50],
    'минуты шаблонов по плану',
  )
  assertEqual(
    TEMPLATES.map(t => t.place),
    ['home', 'home', 'home', 'home', 'home', 'any', 'home', 'home', 'home', 'any', 'any', 'home',
      'gym', 'gym', 'gym', 'gym', 'gym', 'any', 'any', 'any', 'any'],
    'места по плану',
  )
  const light = byId('daily-light')
  assertEqual([light.excludeFromWeek, light.source], [true, 'program'], 'daily-light: вне недели, источник program')
  assert(TEMPLATES.filter(t => t.excludeFromWeek).length === 1, 'вне недели только daily-light')
  assert(TEMPLATES.every(t => t.custom === undefined && t.createdAt === undefined), 'встроенные не помечены custom')
  assert(TEMPLATES.filter(t => t.source === 'johnson').length === 4, 'четыре шаблона Джонсона')
})

group('каждая ссылка на упражнение разрешается', () => {
  for (const t of TEMPLATES) {
    assert(t.items.length > 0, `${t.id}: есть элементы`)
    assertEqual(missingExercises(t, library), [], `${t.id}: все упражнения есть в библиотеке`)
  }
})

group('элементы согласованы с упражнениями', () => {
  for (const t of TEMPLATES) {
    for (const item of t.items) {
      const e = library[item.exerciseId]!
      const where = `${t.id}/${item.exerciseId}`
      if (e.pillar === 'zone2') {
        assert(typeof item.minutes === 'number' && item.minutes > 0, `${where}: минуты зоны 2`)
        assert(item.sets === undefined && item.reps === undefined && item.seconds === undefined, `${where}: у кардио нет подходов`)
      } else if (e.pillar === 'intervals') {
        assert(typeof item.protocolId === 'string' && item.protocolId.length > 0, `${where}: протокол`)
        assert(item.sets === undefined && item.minutes === undefined, `${where}: у интервалов нет подходов и минут`)
      } else {
        assert(Number.isInteger(item.sets) && (item.sets ?? 0) >= 1, `${where}: подходов от 1`)
        assert(item.minutes === undefined && item.protocolId === undefined, `${where}: чужих полей нет`)
        const timed = e.input === 'time' || e.input === 'time-side'
        if (timed) {
          assert(typeof item.seconds === 'number' && item.seconds > 0, `${where}: секунды`)
          assert(item.reps === undefined, `${where}: у удержания нет повторов`)
          const [lo, hi] = e.defaults.seconds!
          assert((item.seconds ?? 0) >= lo && (item.seconds ?? 0) <= hi + 30, `${where}: секунды рядом с умолчанием упражнения`)
        } else {
          assert(item.reps !== undefined && item.seconds === undefined, `${where}: повторы`)
          if (Array.isArray(item.reps)) assert(item.reps[0] >= 1 && item.reps[0] <= item.reps[1], `${where}: диапазон повторов`)
          if (typeof item.reps === 'number') assert(item.reps >= 1, `${where}: повторы от 1`)
        }
        if (e.defaults.perSide) assertEqual(item.perSide, true, `${where}: упражнение на сторону, элемент тоже`)
        if (!e.defaults.perSide) assert(item.perSide !== true, `${where}: перекос perSide`)
      }
      if (item.restSec !== undefined) assert(Number.isInteger(item.restSec) && item.restSec >= 15 && item.restSec <= 300, `${where}: отдых 15-300 с`)
    }
  }
})

group('значения из плана: подходы, повторы, отдых', () => {
  const [first] = byId('home-strength-a').items
  assertEqual(first, { exerciseId: 'goblet-squat', sets: 3, reps: [10, 15], restSec: 90 }, 'goblet-squat 3 x 10-15 (90)')
  const row = byId('home-strength-a').items[2]
  assertEqual(row, { exerciseId: 'db-row', sets: 3, reps: [10, 12], perSide: true, restSec: 90 }, 'db-row на сторону')
  assertEqual(byId('gym-strength-a').items[0]?.restSec, 150, 'присед с отдыхом 150')
  assertEqual(byId('gym-strength-a').items[0]?.cue, 'Или жим ногами.', 'cue к приседу')
  assertEqual(byId('johnson-monday').items.at(-1), { exerciseId: 'z2-walk', minutes: 25 }, 'johnson-monday: 25 минут ходьбы')
  assertEqual(byId('johnson-monday').items.length, 8, 'johnson-monday: восемь элементов')
  assertEqual(byId('johnson-friday').items.length, 7, 'johnson-friday: семь элементов')
  assertEqual(byId('home-zone2-bike').items[0], { exerciseId: 'z2-bike', minutes: 45 }, 'зона 2 на велотренажёре 45 минут')
  assertEqual(byId('home-mobility-10').items.map(i => i.seconds), [45, 45, 45, 45, 45], 'мобильность: по 45 секунд')
  assertEqual(byId('johnson-tuesday').items[0]?.protocolId, 'johnson-8x20-20', 'HIIT 8 x 20/20')
  assert(byId('johnson-tuesday').items[0]?.cue?.includes('johnson-8x20-40') === true, 'cue про протокол для новичков')
  assertEqual(byId('daily-light').items.map(i => i.exerciseId), ['hang', 'scap-pullup', 'pullup'], 'daily-light: состав')
  assertEqual(byId('daily-light').items[2]?.reps, 'max', 'daily-light: подтягивания от максимума')
})

group('тексты шаблонов без слов из запрета', () => {
  for (const t of TEMPLATES) {
    const text = [t.title, ...t.items.map(i => i.cue ?? '')].join(' ').toLowerCase()
    for (const word of FORBIDDEN) assert(!text.includes(word), `${t.id}: запрещённое слово «${word}»`)
    for (const i of t.items) {
      if (i.cue !== undefined) assert(i.cue.trim().length > 0 && i.cue === i.cue.trim(), `${t.id}/${i.exerciseId}: cue без пустоты`)
    }
  }
})

group('шаблоны дома выполнимы домашним полным инвентарём', () => {
  for (const t of TEMPLATES.filter(x => x.place === 'home')) {
    assert(doable(t, equipmentFor('home', { homeEquipment: HOME_FULL })), `${t.id}: выполним дома с полным инвентарём`)
  }
  assert(!doable(byId('home-strength-b'), equipmentFor('home', { homeEquipment: ['mat'] })), 'без турника сила B недоступна')
  assert(doable(byId('home-balance-10'), equipmentFor('home', { homeEquipment: ['mat'] })), 'баланс 10 минут нужен только коврик')
  assert(!doable(byId('home-intervals-4x4'), equipmentFor('home', { homeEquipment: [] })), 'без велотренажёра 4x4 недоступно')
})

group('шаблоны зала выполнимы залом', () => {
  for (const t of TEMPLATES.filter(x => x.place === 'gym')) {
    assert(doable(t, GYM_EQUIPMENT), `${t.id}: выполним в зале`)
  }
  assert(doable(byId('gym-intervals-4x4'), GYM_EQUIPMENT), 'зал: 4x4 на велосипеде')
})

group('шаблоны на любое место выполнимы хотя бы в одном месте', () => {
  const places: Equipment[][] = [HOME_FULL, [...GYM_EQUIPMENT], [...OUTSIDE_EQUIPMENT]]
  for (const t of TEMPLATES.filter(x => x.place === 'any')) {
    assert(places.some(eq => doable(t, eq)), `${t.id}: найдётся место`)
  }
  assert(doable(byId('home-zone2-walk'), OUTSIDE_EQUIPMENT), 'прогулка выполнима на улице')
})

group('templatesFor: фильтр по месту и инвентарю', () => {
  const ids = (place: 'home' | 'gym' | 'outside', eq: readonly Equipment[]): string[] =>
    templatesFor(TEMPLATES, place, eq, library).map(t => t.id)

  const gym = ids('gym', GYM_EQUIPMENT)
  assert(gym.includes('gym-strength-a') && !gym.some(id => id.startsWith('home-strength')), 'зал: свои шаблоны, домашней силы нет')
  assert(gym.includes('johnson-thursday') && gym.includes('home-mobility-10'), 'зал: шаблоны на любое место')
  assert(!gym.includes('daily-light') && !gym.includes('home-grip'), 'зал: шаблоны дома не показываются')

  const outside = ids('outside', OUTSIDE_EQUIPMENT)
  assertEqual(outside, ['home-zone2-walk'], 'улица: только прогулка (mat, гантелей и велотренажёра нет)')

  const homeFull = ids('home', equipmentFor('home', { homeEquipment: HOME_FULL }))
  assertEqual(homeFull.filter(id => id.startsWith('gym-')), [], 'дом: шаблонов зала нет')
  assertEqual(homeFull.length, 16, 'дом с полным инвентарём: 9 домашних и 7 на любое место')
})

group('templatesFor: краевые случаи', () => {
  assertEqual(templatesFor([], 'home', HOME_FULL, library), [], 'нет шаблонов')
  assertEqual(templatesFor(TEMPLATES, 'home', [], library).map(t => t.id), [], 'пустой инвентарь: ничего не выполнимо')

  const orphan: Template = {
    id: 'custom-orphan', title: 'Со ссылкой в никуда', place: 'any', pillars: ['strength'], estMinutes: 5, custom: true,
    items: [{ exerciseId: 'deleted-exercise', sets: 1, reps: 5 }, { exerciseId: 'pushup', sets: 1, reps: 5 }],
  }
  assertEqual(
    templatesFor([orphan], 'gym', GYM_EQUIPMENT, library).map(t => t.id),
    ['custom-orphan'],
    'шаблон с удалённым упражнением остаётся в списке для пометки',
  )
  assertEqual(missingExercises(orphan, library), ['deleted-exercise'], 'удалённое упражнение найдено')
  assertEqual(templatesFor([orphan], 'home', [], library).length, 0, 'но оставшееся упражнение проверяется по инвентарю')

  const input = [byId('gym-zone2'), byId('home-grip')]
  const before = JSON.stringify(input)
  templatesFor(input, 'gym', GYM_EQUIPMENT, library)
  assertEqual(JSON.stringify(input), before, 'вход не изменён')
})

group('missingExercises', () => {
  const t: Template = {
    id: 't', title: 't', place: 'any', pillars: [], estMinutes: 1,
    items: [
      { exerciseId: 'gone-a', sets: 1 }, { exerciseId: 'pushup', sets: 1, reps: 5 },
      { exerciseId: 'gone-b', sets: 1 }, { exerciseId: 'gone-a', sets: 1 },
    ],
  }
  assertEqual(missingExercises(t, library), ['gone-a', 'gone-b'], 'без повторов, в порядке шаблона')
  assertEqual(missingExercises({ ...t, items: [] }, library), [], 'пустой шаблон')
  assertEqual(missingExercises(t, buildLibrary([])), ['gone-a', 'pushup', 'gone-b'], 'пустая библиотека')
  assertEqual(missingExercises({ ...t, items: [{ exerciseId: 'constructor' }] }, library), ['constructor'], 'id из прототипа не считается найденным')
})

group('lastUsedAt', () => {
  const session = (id: string, templateId: string | undefined, startedAt: number, endedAt?: number): Session => ({
    id, date: '2026-10-12', startedAt, ...(endedAt !== undefined ? { endedAt } : {}), place: 'home', title: id, items: [],
    ...(templateId ? { templateId } : {}),
  })
  const state = {
    sessions: {
      a: session('a', 'home-strength-a', 1000, 5000),
      b: session('b', 'home-strength-a', 9000, 12000),
      c: session('c', 'home-strength-b', 20000, 30000),
      d: session('d', undefined, 40000, 50000),
      e: session('e', 'home-grip', 60000),
    },
  }
  assertEqual(lastUsedAt(state, 'home-strength-a'), 12000, 'самая свежая по окончанию')
  assertEqual(lastUsedAt(state, 'home-strength-b'), 30000, 'единственная')
  assertEqual(lastUsedAt(state, 'home-grip'), 60000, 'без окончания берётся начало')
  assertEqual(lastUsedAt(state, 'gym-zone2'), null, 'не запускали')
  assertEqual(lastUsedAt({ sessions: {} }, 'home-strength-a'), null, 'нет тренировок')
  assertEqual(lastUsedAt(state, ''), null, 'пустой id не совпадает с тренировкой без шаблона')
})

group('templateCoverage: точные случаи', () => {
  const t = (items: Template['items'], estMinutes = 30): Template => ({ id: 't', title: 't', place: 'any', pillars: [], estMinutes, items })
  assertEqual(templateCoverage(t([]), library), { pillars: [], minutes: {} }, 'пустой шаблон')
  assertEqual(
    templateCoverage(t([{ exerciseId: 'z2-walk', minutes: 30 }]), library),
    { pillars: ['zone2'], minutes: { zone2: 30 } },
    'зона 2: минуты из элемента',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'z2-walk' }]), library).minutes,
    { zone2: 45 },
    'зона 2 без минут берёт умолчание упражнения',
  )
  // сила: 3 x (10 повторов x 3 с + 60 с отдыха) + 10 с на подготовку = 280 с, около 5 минут
  assertEqual(
    templateCoverage(t([{ exerciseId: 'pushup', sets: 3, reps: 10, restSec: 60 }]), library).minutes,
    { strength: 5 },
    'сила: подходы, повторы, отдых',
  )
  // удержание на сторону: 2 x (45 с x 2 + 5 с перехода) + 10 с = 200 с, около 3 минут
  assertEqual(
    templateCoverage(t([{ exerciseId: 'stretch-hamstring', sets: 2, seconds: 45, perSide: true }]), library).minutes,
    { mobility: 3 },
    'мобильность на сторону',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'single-leg-stance', sets: 1, seconds: 5 }]), library).minutes,
    { balance: 1 },
    'любая работа даёт не меньше минуты',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'pullup', sets: 1, reps: 'max' }]), library).minutes.strength,
    2,
    'max повторов оценивается в 10: 30 с работы, 60 с отдыха, 10 с подготовки',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'ghost', sets: 3, reps: 10 }, { exerciseId: 'z2-walk', minutes: 20 }]), library),
    { pillars: ['zone2'], minutes: { zone2: 20 } },
    'удалённое упражнение пропускается',
  )
  const mixed = templateCoverage(
    t([{ exerciseId: 'z2-walk', minutes: 20 }, { exerciseId: 'pushup', sets: 3, reps: 10, restSec: 60 }, { exerciseId: 'tree-pose', sets: 2, seconds: 30, perSide: true }]),
    library,
  )
  assertEqual(mixed.pillars, ['strength', 'zone2', 'balance'], 'столпы в порядке PILLARS, а не шаблона')

  const protocols = INTERVAL_PROTOCOLS
  const four = protocols.find(p => p.id === 'norwegian-4x4')!
  const expectedMin = Math.round((four.warmupSec + four.rounds * (four.workSec + four.restSec) + four.cooldownSec) / 60)
  assertEqual(
    templateCoverage(t([{ exerciseId: 'hiit-bike', protocolId: 'norwegian-4x4' }], 40), library, protocols).minutes,
    { intervals: expectedMin },
    'интервалы: длительность протокола целиком',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'hiit-bike', protocolId: 'norwegian-4x4' }], 40), library).minutes,
    { intervals: 40 },
    'без протоколов интервалы получают весь estMinutes',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'z2-walk', minutes: 10 }, { exerciseId: 'hiit-bike', protocolId: 'нет-такого' }], 40), library, protocols).minutes,
    { zone2: 10, intervals: 30 },
    'неизвестный протокол: остаток от estMinutes',
  )
  assertEqual(
    templateCoverage(t([{ exerciseId: 'z2-walk', minutes: 60 }, { exerciseId: 'hiit-bike', protocolId: 'нет-такого' }], 40), library).minutes,
    { zone2: 60, intervals: 1 },
    'остаток не уходит в минус',
  )
})

/* Шаблоны, у которых estMinutes из плана заметно ниже времени самих предписанных
   подходов и отдыха. Правится в плане (estMinutes или состав), а не подгонкой оценки.
   home-grip: назван «10 минут», но 2 x 15 на сторону (45 с), 2 x 15-20 на сторону
   (30 с) и вис 3 x 20 с (90 с) дают около 15 минут. */
const PLAN_UNDERESTIMATES: Record<string, number> = { 'home-grip': 1.6 }

group('templateCoverage: встроенные шаблоны', () => {
  for (const t of TEMPLATES) {
    const c = templateCoverage(t, library, INTERVAL_PROTOCOLS)
    const declared = PILLARS.filter(p => t.pillars.includes(p))
    assertEqual(c.pillars, declared, `${t.id}: заявленные столпы равны найденным`)
    assertEqual(t.pillars, declared, `${t.id}: pillars записаны в порядке PILLARS`)
    const total = Object.values(c.minutes).reduce((a, b) => a + b, 0)
    assert(total >= t.estMinutes * 0.5, `${t.id}: оценка ${total} мин не меньше половины estMinutes ${t.estMinutes}`)
    assert(total <= t.estMinutes * (PLAN_UNDERESTIMATES[t.id] ?? 1.25), `${t.id}: оценка ${total} мин не больше estMinutes ${t.estMinutes} более чем на четверть`)
    for (const [p, m] of Object.entries(c.minutes)) assert(Number.isInteger(m) && m >= 1, `${t.id}/${p}: целые минуты от 1`)
  }
  assertEqual(templateCoverage(byId('home-zone2-walk'), library).minutes, { zone2: 45 }, 'прогулка 45 минут')
  assertEqual(templateCoverage(byId('johnson-monday'), library).minutes.zone2, 25, 'johnson-monday: 25 минут зоны 2')
  assertEqual(templateCoverage(byId('home-zone2-bike'), library).minutes.zone2, 45, 'велотренажёр 45 минут зоны 2')
  assert((templateCoverage(byId('home-zone2-bike'), library).minutes.mobility ?? 0) >= 5, 'растяжка после велотренажёра: от 5 минут')
  assert((templateCoverage(byId('home-strength-a'), library).minutes.balance ?? 0) >= 1, 'сила A закрывает и баланс')
})

finish()
