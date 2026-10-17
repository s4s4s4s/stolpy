import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  CARDIO_MODE_TITLE, EQUIPMENT_TITLE, EXERCISES, MOBILITY_ZONE_TITLE, MUSCLE_GROUP_TITLE,
} from '../src/data/exercises.ts'
import {
  ALL_EQUIPMENT, CUSTOM_TITLE_MAX, GYM_EQUIPMENT, OUTSIDE_EQUIPMENT, buildLibrary, canDoHere, equipmentFor,
  filterLibrary, isEquipment, libraryList, newCustomExercise, validateCustomExercise,
} from '../src/core/library.ts'
import type { CustomExerciseInput } from '../src/core/library.ts'
import { PILLARS } from '../src/core/pillars.ts'
import type { Equipment, Exercise } from '../src/core/types.ts'

/* Слова, которых не должно быть в текстах приложения. */
const FORBIDDEN = ['травм', 'запяст', 'осторожн', 'врач']

const byId = (id: string): Exercise => {
  const found = EXERCISES.find(e => e.id === id)
  if (!found) throw new Error(`нет упражнения ${id}`)
  return found
}

group('состав библиотеки: все строки раздела 3.2', () => {
  assertEqual(EXERCISES.length, 91, 'число упражнений')
  const count = (p: string): number => EXERCISES.filter(e => e.pillar === p).length
  assertEqual(
    { strength: count('strength'), zone2: count('zone2'), intervals: count('intervals'), mobility: count('mobility'), balance: count('balance') },
    { strength: 55, zone2: 7, intervals: 7, mobility: 14, balance: 8 },
    'упражнений по столпам',
  )
  for (const p of PILLARS) assert(count(p) > 0, `у столпа ${p} есть упражнения`)
})

group('id уникальны и записаны kebab-регистром', () => {
  const ids = EXERCISES.map(e => e.id)
  assertEqual(new Set(ids).size, ids.length, 'повторяющиеся id')
  for (const id of ids) assert(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id), `id в kebab-case: ${id}`)
  const titles = EXERCISES.map(e => e.title)
  assertEqual(new Set(titles).size, titles.length, 'повторяющиеся названия')
})

group('инвентарь только из списка и словари полные', () => {
  for (const e of EXERCISES) {
    assert(e.equipment.length > 0, `${e.id}: инвентарь не пуст`)
    for (const item of e.equipment) assert(isEquipment(item), `${e.id}: неизвестный инвентарь ${item}`)
    assertEqual(new Set(e.equipment).size, e.equipment.length, `${e.id}: инвентарь без повторов`)
  }
  assertEqual(Object.keys(EQUIPMENT_TITLE).sort(), [...ALL_EQUIPMENT].sort(), 'EQUIPMENT_TITLE покрывает весь инвентарь')
  assertEqual(Object.keys(MUSCLE_GROUP_TITLE).length, 5, 'группы мышц')
  assertEqual(Object.keys(MOBILITY_ZONE_TITLE).length, 5, 'зоны мобильности')
  assertEqual(Object.keys(CARDIO_MODE_TITLE).length, 10, 'виды кардио')
  for (const dict of [EQUIPMENT_TITLE, MUSCLE_GROUP_TITLE, MOBILITY_ZONE_TITLE, CARDIO_MODE_TITLE]) {
    for (const [key, title] of Object.entries(dict)) assert(title.trim().length > 0, `пустая подпись ${key}`)
  }
})

group('поля столпа: группы, зона, вид кардио', () => {
  for (const e of EXERCISES) {
    if (e.pillar === 'strength') {
      assert(!!e.groups && e.groups.length >= 1 && e.groups.length <= 2, `${e.id}: одна-две группы`)
      assert(e.zone === undefined && e.cardioMode === undefined, `${e.id}: чужих полей нет`)
      for (const g of e.groups ?? []) assert(g in MUSCLE_GROUP_TITLE, `${e.id}: группа ${g}`)
    } else if (e.pillar === 'mobility') {
      assert(!!e.zone && e.zone in MOBILITY_ZONE_TITLE, `${e.id}: зона мобильности`)
      assert(e.groups === undefined && e.cardioMode === undefined, `${e.id}: чужих полей нет`)
    } else if (e.pillar === 'zone2' || e.pillar === 'intervals') {
      assert(!!e.cardioMode && e.cardioMode in CARDIO_MODE_TITLE, `${e.id}: вид кардио`)
      assert(e.groups === undefined && e.zone === undefined, `${e.id}: чужих полей нет`)
    } else {
      assert(e.groups === undefined && e.zone === undefined && e.cardioMode === undefined, `${e.id}: у баланса нет групп, зоны и вида`)
    }
    assert(e.custom === undefined, `${e.id}: встроенное не помечено custom`)
  }
  assertEqual(byId('deep-squat-hold').zone, 'hips', 'deep-squat-hold: зона hips')
  assertEqual(byId('hiit-battle-ropes').equipment, ['gym-machines'], 'боевые канаты только в зале')
})

group('умолчания согласованы с видом ввода', () => {
  const rangeOk = (r: [number, number] | undefined): boolean =>
    !!r && Number.isInteger(r[0]) && Number.isInteger(r[1]) && r[0] >= 1 && r[0] <= r[1]
  for (const e of EXERCISES) {
    const d = e.defaults
    assert(Number.isInteger(d.sets) && d.sets >= 1, `${e.id}: подходов от 1`)
    switch (e.input) {
      case 'weight-reps':
      case 'reps':
        assert(rangeOk(d.reps) && d.seconds === undefined, `${e.id}: ввод по повторам, диапазон повторов`)
        break
      case 'time':
      case 'time-side':
        if (e.pillar === 'intervals') {
          assert(typeof d.protocolId === 'string' && d.protocolId.length > 0, `${e.id}: у интервалов протокол`)
          assert(d.reps === undefined && d.seconds === undefined, `${e.id}: у интервалов нет повторов и секунд`)
        } else {
          assert(rangeOk(d.seconds) && d.reps === undefined, `${e.id}: ввод по времени, диапазон секунд`)
        }
        break
      case 'distance-time':
        assert(e.pillar === 'zone2', `${e.id}: дистанция и время только в зоне 2`)
        assert(typeof d.minutes === 'number' && d.minutes >= 40 && d.minutes <= 60, `${e.id}: минуты зоны 2 в пределах 40-60`)
        break
    }
    if (e.input === 'time-side') assertEqual(d.perSide, true, `${e.id}: время на сторону значит perSide`)
    if (e.pillar !== 'zone2') assert(d.minutes === undefined, `${e.id}: минуты только у зоны 2`)
    if (e.pillar !== 'intervals') assert(d.protocolId === undefined, `${e.id}: протокол только у интервалов`)
  }
  assertEqual(byId('pullup').defaults, { sets: 3, reps: [5, 8] }, 'pullup 3 x 5-8')
  assertEqual(byId('hang-false-grip').defaults, { sets: 4, seconds: [15, 15] }, 'вис ложным хватом 4 x 15 с')
  assertEqual(byId('pullup-negative').defaults, { sets: 5, reps: [1, 1] }, 'негативы 5 x 1')
  assertEqual(byId('side-plank').defaults, { sets: 2, seconds: [20, 30], perSide: true }, 'боковая планка на сторону')
})

group('пометки «на ногу» и «на сторону» стали perSide', () => {
  const perSide = EXERCISES.filter(e => e.defaults.perSide).map(e => e.id).sort()
  assertEqual(
    perSide,
    [
      'ankle-knee-to-wall', 'bird-dog', 'bulgarian-split-squat', 'couch-stretch', 'db-row', 'finger-extensor',
      'grip-trainer', 'pigeon', 'shoulder-stretch', 'side-plank', 'single-leg-rdl', 'single-leg-stance',
      'single-leg-stance-eyes-closed', 'single-leg-toe-touch', 'soft-surface-stance', 'step-up',
      'stretch-hamstring', 'stretch-hip-flexor', 'tree-pose', 'worlds-greatest-stretch',
    ],
    'упражнения с perSide',
  )
})

group('техника непустая, слова из запрета не встречаются', () => {
  for (const e of EXERCISES) {
    assert(e.technique.trim().length >= 10, `${e.id}: техника заполнена`)
    assert(e.technique.length <= 280, `${e.id}: техника не длиннее 280 знаков`)
    assert(e.technique === e.technique.trim(), `${e.id}: техника без пробелов по краям`)
    const text = `${e.title} ${e.technique}`.toLowerCase()
    for (const word of FORBIDDEN) assert(!text.includes(word), `${e.id}: запрещённое слово «${word}»`)
  }
  for (const dict of [EQUIPMENT_TITLE, MUSCLE_GROUP_TITLE, MOBILITY_ZONE_TITLE, CARDIO_MODE_TITLE]) {
    for (const title of Object.values(dict)) {
      for (const word of FORBIDDEN) assert(!title.toLowerCase().includes(word), `подпись «${title}»: запрещённое слово`)
    }
  }
})

group('константы мест', () => {
  assertEqual(
    [...GYM_EQUIPMENT].sort(),
    ALL_EQUIPMENT.filter(e => !['outdoors', 'finger-extensor', 'grip-trainer'].includes(e)).sort(),
    'зал: всё, кроме улицы и хвата',
  )
  assertEqual([...OUTSIDE_EQUIPMENT], ['bodyweight', 'outdoors', 'jump-rope'], 'улица')
  assertEqual(ALL_EQUIPMENT.length, 18, 'всего видов инвентаря')
})

group('equipmentFor: дом, зал, улица', () => {
  assertEqual(equipmentFor('gym', { homeEquipment: [] }), [...GYM_EQUIPMENT], 'зал не зависит от настроек')
  assertEqual(equipmentFor('outside', { homeEquipment: ['mat'] }), [...OUTSIDE_EQUIPMENT], 'улица не зависит от настроек')
  assertEqual(equipmentFor('home', { homeEquipment: ['mat', 'bands'] }), ['mat', 'bands', 'bodyweight'], 'дом: настройки плюс свой вес')
  assertEqual(equipmentFor('home', { homeEquipment: [] }), ['bodyweight'], 'пустой дом: только свой вес')
  assertEqual(equipmentFor('home', { homeEquipment: ['mat', 'bodyweight', 'mat'] }), ['mat', 'bodyweight'], 'дубли убраны')
  const dirty = { homeEquipment: ['mat', 'не-инвентарь'] as unknown as Equipment[] }
  assertEqual(equipmentFor('home', dirty), ['mat', 'bodyweight'], 'мусор в настройках отбрасывается')
  const gym = equipmentFor('gym', { homeEquipment: [] })
  gym.push('mat')
  assertEqual(GYM_EQUIPMENT.length, ALL_EQUIPMENT.length - 3, 'результат не делит память с константой')
})

group('canDoHere: достаточно одного из списка', () => {
  const pullupBand = byId('pullup-band')
  assert(canDoHere(pullupBand, ['pullup-bar']), 'любой один из списка')
  assert(canDoHere(pullupBand, ['bands']), 'любой один из списка (резина)')
  assert(!canDoHere(pullupBand, ['mat', 'dumbbells']), 'ни одного из списка')
  assert(!canDoHere(pullupBand, []), 'пустой инвентарь')
  assert(canDoHere({ equipment: [] }, []), 'пустой список требований значит «ничего не нужно»')
  assert(canDoHere(byId('z2-walk'), OUTSIDE_EQUIPMENT), 'ходьба на улице')
  assert(!canDoHere(byId('hiit-bike'), OUTSIDE_EQUIPMENT), 'велотренажёр не на улице')
  assert(canDoHere(byId('hiit-bike'), GYM_EQUIPMENT), 'велотренажёр в зале')
  assert(!canDoHere(byId('grip-trainer'), GYM_EQUIPMENT), 'эспандера в зале по умолчанию нет')
})

group('buildLibrary: слияние встроенных и своих', () => {
  const custom: Exercise = {
    id: 'ex-1', title: 'Своё', pillar: 'balance', equipment: ['mat'], input: 'time',
    defaults: { sets: 1, seconds: [30, 30] }, technique: '', custom: true,
  }
  const lib = buildLibrary(EXERCISES, { 'ex-1': custom })
  assertEqual(libraryList(lib).length, EXERCISES.length + 1, 'встроенные плюс одно своё')
  assertEqual(libraryList(lib).map(e => e.id).slice(0, 3), EXERCISES.slice(0, 3).map(e => e.id), 'порядок: встроенные первыми')
  assertEqual(libraryList(lib).at(-1)?.id, 'ex-1', 'своё в конце')
  assertEqual(lib['pullup']?.id, 'pullup', 'поиск по id')
  assertEqual(lib['нет-такого'], undefined, 'неизвестный id')
  assertEqual(lib['constructor'], undefined, 'id из прототипа не находится')
  assertEqual(libraryList(buildLibrary(EXERCISES)).length, EXERCISES.length, 'без своих')
  assertEqual(libraryList(buildLibrary([], {})).length, 0, 'пустая библиотека')

  const clash = { ...byId('pullup'), id: 'pullup', title: 'Подделка', custom: true as const }
  const merged = buildLibrary(EXERCISES, { pullup: clash })
  assertEqual(merged['pullup']?.title, 'Подтягивания', 'при совпадении id побеждает встроенное')
  assertEqual(libraryList(merged).length, EXERCISES.length, 'дубль не добавляется')
})

group('filterLibrary: столп, место, запрос', () => {
  const lib = buildLibrary(EXERCISES)
  assertEqual(filterLibrary(lib).length, EXERCISES.length, 'без фильтра всё')
  assertEqual(filterLibrary(lib, {}).length, EXERCISES.length, 'пустой фильтр')
  assertEqual(filterLibrary(lib, { pillar: 'zone2' }).length, 7, 'столп zone2')
  assert(filterLibrary(lib, { pillar: 'balance' }).every(e => e.pillar === 'balance'), 'только баланс')

  const outside = filterLibrary(lib, { place: 'outside' })
  assert(outside.length > 0 && outside.every(e => canDoHere(e, OUTSIDE_EQUIPMENT)), 'улица: только выполнимое')
  assert(outside.some(e => e.id === 'z2-walk') && !outside.some(e => e.id === 'hiit-bike'), 'улица: ходьба есть, велотренажёра нет')
  const gym = filterLibrary(lib, { place: 'gym' })
  assert(gym.some(e => e.id === 'back-squat') && !gym.some(e => e.id === 'grip-trainer'), 'зал: штанга есть, эспандера нет')

  const homeAny = filterLibrary(lib, { place: 'home' })
  assertEqual(homeAny.length, EXERCISES.length, 'дом без инвентаря не фильтруется')
  const home = filterLibrary(lib, { place: 'home', equipment: equipmentFor('home', { homeEquipment: ['mat'] }) })
  assert(home.every(e => canDoHere(e, ['mat', 'bodyweight'])), 'дом с инвентарём')
  assert(home.some(e => e.id === 'plank') && !home.some(e => e.id === 'pullup'), 'дом: планка есть, подтягиваний нет')
  const override = filterLibrary(lib, { place: 'gym', equipment: ['bands'] })
  assert(override.every(e => canDoHere(e, ['bands'])), 'equipment перекрывает место')
  assertEqual(filterLibrary(lib, { equipment: [] }).filter(e => e.equipment.length > 0).length, 0, 'пустой инвентарь не оставляет ничего')

  const combo = filterLibrary(lib, { pillar: 'strength', place: 'outside' })
  assertEqual(combo.map(e => e.id).includes('pushup'), true, 'столп вместе с местом')
  assert(combo.every(e => e.pillar === 'strength' && canDoHere(e, OUTSIDE_EQUIPMENT)), 'условия вместе')
})

group('filterLibrary: поиск', () => {
  const lib = buildLibrary(EXERCISES)
  const ids = (q: string): string[] => filterLibrary(lib, { query: q }).map(e => e.id)
  assert(ids('подтяг').includes('pullup') && ids('подтяг').includes('chinup'), 'подстрока названия')
  assertEqual(ids('ПОДТЯГ'), ids('подтяг'), 'регистр не важен')
  assertEqual(ids('  подтяг  '), ids('подтяг'), 'пробелы по краям')
  assertEqual(ids('подтягивания обратным').join(), 'chinup', 'несколько слов, все должны встретиться')
  assertEqual(ids('обратным подтягивания').join(), 'chinup', 'порядок слов не важен')
  assert(ids('жзщ').length === 0, 'нет совпадений')
  assert(ids('растяжка').length >= 5, 'слово из нескольких названий')
  assertEqual(ids('nordic').sort(), ['nordic-curl', 'reverse-nordic'], 'латиница в названии')
  assertEqual(ids('couch-stretch'), ['couch-stretch'], 'поиск по id')
  assertEqual(ids('').length, EXERCISES.length, 'пустой запрос не фильтрует')
  assertEqual(ids('   ').length, EXERCISES.length, 'запрос из пробелов не фильтрует')

  const yo = buildLibrary([], {
    a: { id: 'a', title: 'Ёлочка', pillar: 'balance', equipment: ['mat'], input: 'time', defaults: { sets: 1, seconds: [5, 5] }, technique: '' },
  })
  assertEqual(filterLibrary(yo, { query: 'елочка' }).length, 1, 'е находит ё')
  assertEqual(filterLibrary(yo, { query: 'ЁЛОЧ' }).length, 1, 'ё находит ё')
})

const validInput = (): CustomExerciseInput => ({
  title: '  Подъём на стул  ',
  pillar: 'strength',
  groups: ['legs'],
  equipment: ['bench', 'bench'],
  input: 'reps',
  defaults: { sets: 3, reps: [8, 12] },
  technique: ' Медленно. ',
})

group('newCustomExercise: корректный ввод', () => {
  const rng = () => 0.5
  const e = newCustomExercise(validInput(), 1_000_000, rng)
  assert(/^ex-[0-9a-z]+-[0-9a-z]{6}$/.test(e.id), `формат id: ${e.id}`)
  assertEqual(e.title, 'Подъём на стул', 'название обрезано')
  assertEqual(e.equipment, ['bench'], 'дубли инвентаря убраны')
  assertEqual(e.technique, 'Медленно.', 'техника обрезана')
  assertEqual(e.custom, true, 'метка custom')
  assertEqual(e.groups, ['legs'], 'группы')
  assertEqual(newCustomExercise(validInput(), 1_000_000, rng).id, e.id, 'время и random заданы: id детерминирован')
  assert(newCustomExercise(validInput(), 1_000_001, rng).id !== e.id, 'другое время даёт другой id')

  const input = validInput()
  newCustomExercise(input, 1, rng)
  assertEqual(input.title, '  Подъём на стул  ', 'вход не изменён')
  const copy = newCustomExercise(input, 1, rng)
  copy.equipment.push('mat')
  assertEqual(input.equipment, ['bench', 'bench'], 'результат не делит массивы со входом')

  const noTech = newCustomExercise({ ...validInput(), technique: undefined }, 1, rng)
  assertEqual(noTech.technique, '', 'техника необязательна')

  const side = newCustomExercise(
    { title: 'Стойка', pillar: 'balance', equipment: ['mat'], input: 'time-side', defaults: { sets: 2, seconds: [20, 40] } }, 1, rng,
  )
  assertEqual(side.defaults.perSide, true, 'time-side ставит perSide')

  const mob = newCustomExercise(
    { title: 'Поза', pillar: 'mobility', zone: 'hips', equipment: ['mat'], input: 'time', defaults: { sets: 1, seconds: [30, 60] } }, 1, rng,
  )
  assertEqual(mob.zone, 'hips', 'зона мобильности')
  assertEqual(mob.groups, undefined, 'у мобильности нет групп')

  const z2 = newCustomExercise(
    { title: 'Лыжи', pillar: 'zone2', cardioMode: 'other', equipment: ['outdoors'], input: 'distance-time', defaults: { sets: 1, minutes: 50 } }, 1, rng,
  )
  assertEqual([z2.cardioMode, z2.defaults.minutes], ['other', 50], 'зона 2: вид и минуты')

  const hi = newCustomExercise(
    { title: 'Спринты', pillar: 'intervals', cardioMode: 'run', equipment: ['outdoors'], input: 'time', defaults: { sets: 1, protocolId: ' tabata-20-10 ' } }, 1, rng,
  )
  assertEqual(hi.defaults.protocolId, 'tabata-20-10', 'протокол обрезан')
})

group('newCustomExercise: проверка полей', () => {
  const bad = (patch: Partial<CustomExerciseInput>): string[] => validateCustomExercise({ ...validInput(), ...patch })
  assertEqual(validateCustomExercise(validInput()), [], 'исходный ввод чист')
  assert(bad({ title: '' }).length > 0, 'пустое название')
  assert(bad({ title: '   ' }).length > 0, 'название из пробелов')
  assert(bad({ title: 'я'.repeat(CUSTOM_TITLE_MAX + 1) }).length > 0, 'слишком длинное название')
  assertEqual(bad({ title: 'я'.repeat(CUSTOM_TITLE_MAX) }), [], 'название ровно в предел')
  assert(bad({ pillar: 'nope' as never }).length > 0, 'неизвестный столп')
  assert(bad({ equipment: [] }).length > 0, 'пустой инвентарь')
  assert(bad({ equipment: ['лопата' as never] }).length > 0, 'неизвестный инвентарь')
  assert(bad({ groups: [] }).length > 0, 'сила без групп')
  assert(bad({ groups: undefined }).length > 0, 'сила без групп (undefined)')
  assert(bad({ groups: ['legs', 'back', 'core'] }).length > 0, 'три группы')
  assert(bad({ groups: ['legs', 'legs'] }).length > 0, 'повтор группы')
  assert(bad({ groups: ['ноги' as never] }).length > 0, 'неизвестная группа')
  assert(bad({ zone: 'hips' }).length > 0, 'зона у силы')
  assert(bad({ cardioMode: 'run' }).length > 0, 'вид кардио у силы')
  assert(bad({ input: 'distance-time' }).length > 0, 'ввод не подходит столпу')
  assert(bad({ defaults: { sets: 0, reps: [8, 12] } }).length > 0, 'ноль подходов')
  assert(bad({ defaults: { sets: 2.5, reps: [8, 12] } }).length > 0, 'дробные подходы')
  assert(bad({ defaults: { sets: 21, reps: [8, 12] } }).length > 0, 'слишком много подходов')
  assert(bad({ defaults: { sets: 3 } }).length > 0, 'нет повторов')
  assert(bad({ defaults: { sets: 3, reps: [12, 8] } }).length > 0, 'перевёрнутый диапазон')
  assert(bad({ defaults: { sets: 3, reps: [0, 8] } }).length > 0, 'ноль повторов')
  assert(bad({ defaults: { sets: 3, reps: [Number.NaN, 8] } }).length > 0, 'NaN в диапазоне')
  assert(bad({ defaults: { sets: 3, reps: [8, 12], seconds: [20, 30] } }).length > 0, 'секунды при вводе по повторам')
  assert(bad({ input: 'time', defaults: { sets: 2, seconds: [20, 30], reps: [5, 6] } }).length > 0, 'повторы при вводе по времени')
  assert(bad({ input: 'time', defaults: { sets: 2, reps: [5, 6] } }).length > 0, 'ввод по времени без секунд')
  assert(bad({ input: 'time-side', defaults: { sets: 2, seconds: [20, 30], perSide: false } }).length > 0, 'time-side с perSide false')
  assert(bad({ technique: 'я'.repeat(281) }).length > 0, 'слишком длинная техника')
  assert(bad({ defaults: undefined as never }).length > 0, 'нет умолчаний')

  const mob = (patch: Partial<CustomExerciseInput>): string[] =>
    validateCustomExercise({ title: 'Поза', pillar: 'mobility', equipment: ['mat'], input: 'time', defaults: { sets: 1, seconds: [30, 60] }, ...patch })
  assert(mob({}).length > 0, 'мобильность без зоны')
  assert(mob({ zone: 'knees' as never }).length > 0, 'неизвестная зона')
  assertEqual(mob({ zone: 'spine' }), [], 'мобильность с зоной')
  assert(mob({ zone: 'spine', groups: ['legs'] }).length > 0, 'группы у мобильности')

  const z2 = (patch: Partial<CustomExerciseInput>): string[] =>
    validateCustomExercise({ title: 'Лыжи', pillar: 'zone2', cardioMode: 'other', equipment: ['outdoors'], input: 'distance-time', defaults: { sets: 1, minutes: 50 }, ...patch })
  assertEqual(z2({}), [], 'зона 2 корректна')
  assert(z2({ cardioMode: undefined }).length > 0, 'зона 2 без вида')
  assert(z2({ defaults: { sets: 1 } }).length > 0, 'зона 2 без минут')
  assert(z2({ defaults: { sets: 1, minutes: 0 } }).length > 0, 'зона 2 с нулём минут')

  const hi = (patch: Partial<CustomExerciseInput>): string[] =>
    validateCustomExercise({ title: 'Спринты', pillar: 'intervals', cardioMode: 'run', equipment: ['outdoors'], input: 'time', defaults: { sets: 1, protocolId: 'tabata-20-10' }, ...patch })
  assertEqual(hi({}), [], 'интервалы корректны')
  assert(hi({ defaults: { sets: 1 } }).length > 0, 'интервалы без протокола')
  assert(hi({ defaults: { sets: 1, protocolId: '  ' } }).length > 0, 'интервалы с пустым протоколом')

  let thrown: unknown
  try {
    newCustomExercise({ ...validInput(), title: '' })
  } catch (err) {
    thrown = err
  }
  assert(thrown instanceof RangeError, 'некорректный ввод бросает RangeError')
})

finish()
