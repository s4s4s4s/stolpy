import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  addItem, customProtocol, externalSession, finishSession, hasLoggedWork, idFactory, isItemEmpty,
  itemFromExercise, logHold, logSet, missingExerciseIds, newSession, prefillFor, removeHold, removeItem,
  removeSet, saveAsTemplate, sessionFromTemplate, sessionMinutes, sessionSummary, setItemNote,
  setRestSec, setSessionNote, updateCardio, updateIntervals, updateSet, DEFAULT_REST_SEC,
  type IdFactory,
} from '../src/core/session.ts'
import type {
  CardioItem, Exercise, HoldItem, IntervalItem, IntervalProtocol, Session, StrengthItem, Template,
} from '../src/core/types.ts'

function ex(partial: Partial<Exercise> & Pick<Exercise, 'id' | 'pillar' | 'input'>): Exercise {
  return { title: partial.id, equipment: ['bodyweight'], defaults: { sets: 3 }, technique: '-', ...partial }
}

const LIBRARY: Exercise[] = [
  ex({ id: 'pullup', pillar: 'strength', input: 'reps', defaults: { sets: 3, reps: [5, 8] } }),
  ex({ id: 'bench', pillar: 'strength', input: 'weight-reps', defaults: { sets: 3, reps: [5, 8] } }),
  ex({ id: 'row', pillar: 'strength', input: 'weight-reps', defaults: { sets: 3, reps: [10, 12], perSide: true } }),
  ex({ id: 'plank', pillar: 'strength', input: 'time', defaults: { sets: 3, seconds: [20, 30] } }),
  ex({ id: 'stance', pillar: 'balance', input: 'time-side', defaults: { sets: 2, seconds: [30, 30], perSide: true } }),
  ex({ id: 'stretch', pillar: 'mobility', input: 'time', zone: 'hips', defaults: { sets: 2, seconds: [45, 45] } }),
  ex({ id: 'bike', pillar: 'zone2', input: 'distance-time', cardioMode: 'bike', defaults: { sets: 1, minutes: 45 } }),
  ex({ id: 'hiit', pillar: 'intervals', input: 'time', cardioMode: 'bike', defaults: { sets: 1, protocolId: 'n4x4' } }),
  ex({ id: 'balance-rdl', pillar: 'balance', input: 'reps', defaults: { sets: 2, reps: [8, 8], perSide: true } }),
]

const PROTOCOLS: IntervalProtocol[] = [
  { id: 'n4x4', title: '4x4', workSec: 240, restSec: 180, rounds: 4, warmupSec: 600, cooldownSec: 300, note: '', source: 'test' },
  { id: 'tabata', title: 'Табата', workSec: 20, restSec: 10, rounds: 8, warmupSec: 300, cooldownSec: 180, note: '', source: 'test' },
  { id: 'custom', title: 'Свой', workSec: 30, restSec: 30, rounds: 10, warmupSec: 0, cooldownSec: 0, note: '', source: 'test' },
]

function counter(): IdFactory {
  let n = 0
  return prefix => `${prefix}-${++n}`
}

const T0 = new Date(2026, 9, 14, 12, 0, 0).getTime()   // среда, полдень по местному времени
const MIN = 60_000

function strength(session: Session, id: string): StrengthItem {
  const item = session.items.find(i => i.id === id)
  assert(item !== undefined && item.type === 'strength', `силовой элемент ${id}`)
  return item
}

function throwsRange(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof RangeError
  }
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const v of Object.values(value)) freeze(v)
  }
  return value
}

const TEMPLATE: Template = {
  id: 'tpl-a', title: 'Дом: сила A', place: 'home', pillars: ['strength', 'balance'], estMinutes: 50,
  items: [
    { exerciseId: 'pullup', sets: 3, reps: [5, 8], restSec: 120, cue: 'до подбородка' },
    { exerciseId: 'row', sets: 2, reps: [10, 12], perSide: true },
    { exerciseId: 'plank', sets: 2, seconds: 40 },
    { exerciseId: 'stance', sets: 2, seconds: 30 },
    { exerciseId: 'bike', minutes: 45 },
    { exerciseId: 'hiit', protocolId: 'tabata' },
    { exerciseId: 'ghost', sets: 3 },
  ],
}

group('newSession: дата, время, чистые поля', () => {
  const s = newSession({ place: 'gym', title: 'Зал', now: T0, ids: counter() })
  assertEqual(s, { id: 'sess-1', date: '2026-10-14', startedAt: T0, place: 'gym', title: 'Зал', items: [] }, 'пустая сессия')
  const late = newSession({ place: 'home', title: 'Ночь', now: new Date(2026, 9, 14, 23, 59).getTime(), ids: counter(), excludeFromWeek: true, templateId: 'daily-light' })
  assertEqual(late.date, '2026-10-14', 'местная дата, а не UTC')
  assertEqual(late.excludeFromWeek, true, 'флаг недели')
  assertEqual(late.templateId, 'daily-light', 'шаблон')
  assert(!('programRef' in s) && !('excludeFromWeek' in s), 'пустых полей нет')
  assert(throwsRange(() => newSession({ place: 'home', title: 'x', now: Number.NaN, ids: counter() })), 'NaN время')
})

group('sessionFromTemplate: типы элементов и план', () => {
  const s = sessionFromTemplate(TEMPLATE, LIBRARY, PROTOCOLS, T0, counter())
  assertEqual(s.title, 'Дом: сила A', 'название')
  assertEqual(s.place, 'home', 'место')
  assertEqual(s.templateId, 'tpl-a', 'ссылка на шаблон')
  assertEqual(s.items.map(i => i.type), ['strength', 'strength', 'strength', 'hold', 'cardio', 'intervals'], 'типы; ghost пропущен')

  const pull = s.items[0] as StrengthItem
  assertEqual(pull.planned, [{ kind: 'work', reps: 5 }, { kind: 'work', reps: 5 }, { kind: 'work', reps: 5 }], 'диапазон 5-8 дал нижнюю границу')
  assertEqual(pull.restSec, 120, 'отдых из шаблона')
  assertEqual(pull.note, 'до подбородка', 'подсказка шаблона')
  assertEqual(pull.unit, 'reps', 'единица')

  const row = s.items[1] as StrengthItem
  assertEqual(row.planned.map(p => p.side), ['left', 'right', 'left', 'right'], 'perSide: левая и правая на каждый подход')
  assertEqual(row.restSec, DEFAULT_REST_SEC, 'отдых по умолчанию')

  const plank = s.items[2] as StrengthItem
  assertEqual(plank.unit, 'seconds', 'время - секунды')
  assertEqual(plank.planned[0], { kind: 'work', seconds: 40 }, 'секунды из шаблона')

  const hold = s.items[3] as HoldItem
  assertEqual({ perSide: hold.perSide, sets: hold.plannedSets, sec: hold.plannedSeconds, holds: hold.holds }, { perSide: true, sets: 2, sec: 30, holds: [] }, 'удержание')

  const cardio = s.items[4] as CardioItem
  assertEqual({ mode: cardio.mode, dur: cardio.durationSec }, { mode: 'bike', dur: 0 }, 'кардио')

  const hiit = s.items[5] as IntervalItem
  assertEqual(hiit.protocol.id, 'tabata', 'протокол шаблона важнее протокола упражнения')
  assertEqual(hiit.roundsDone, 0, 'раундов нет')
  assertEqual(new Set(s.items.map(i => i.id)).size, s.items.length, 'id элементов уникальны')
})

group('sessionFromTemplate: снимок протокола, место, ссылки на упражнения', () => {
  const protocols = structuredClone(PROTOCOLS)
  const s = sessionFromTemplate({ ...TEMPLATE, items: [{ exerciseId: 'hiit' }] }, LIBRARY, protocols, T0, counter())
  protocols[0].workSec = 999
  assertEqual((s.items[0] as IntervalItem).protocol.workSec, 240, 'правка источника не меняет снимок')
  assertEqual((s.items[0] as IntervalItem).protocol.id, 'n4x4', 'протокол упражнения по умолчанию')

  assertEqual(sessionFromTemplate({ ...TEMPLATE, place: 'any' }, LIBRARY, PROTOCOLS, T0, counter()).place, 'home', 'any -> home')
  assertEqual(sessionFromTemplate({ ...TEMPLATE, place: 'any' }, LIBRARY, PROTOCOLS, T0, counter(), 'outside').place, 'outside', 'явное место')
  assertEqual(sessionFromTemplate({ ...TEMPLATE, excludeFromWeek: true }, LIBRARY, PROTOCOLS, T0, counter()).excludeFromWeek, true, 'excludeFromWeek')

  const dict = Object.fromEntries(LIBRARY.map(e => [e.id, e]))
  const protoDict = Object.fromEntries(PROTOCOLS.map(p => [p.id, p]))
  const a = sessionFromTemplate(TEMPLATE, dict, protoDict, T0, counter())
  const b = sessionFromTemplate(TEMPLATE, LIBRARY, PROTOCOLS, T0, counter())
  assertEqual(a, b, 'словарь и массив дают одно и то же')

  assertEqual(missingExerciseIds(TEMPLATE, LIBRARY), ['ghost'], 'список недостающих упражнений')
  assertEqual(missingExerciseIds(TEMPLATE, dict), ['ghost'], 'то же для словаря')
  const none = sessionFromTemplate({ ...TEMPLATE, items: [{ exerciseId: 'ghost' }] }, LIBRARY, PROTOCOLS, T0, counter())
  assertEqual(none.items, [], 'все упражнения пропали - пустая сессия')
  assert(throwsRange(() => sessionFromTemplate({ ...TEMPLATE, items: [{ exerciseId: 'hiit', protocolId: 'nope' }] }, LIBRARY, PROTOCOLS, T0, counter())), 'неизвестный протокол - ошибка данных')
  assert(throwsRange(() => sessionFromTemplate({ ...TEMPLATE, items: [{ exerciseId: 'hiit' }] }, LIBRARY, [], T0, counter())), 'нет протоколов - ошибка данных')
  assert(throwsRange(() => sessionFromTemplate({ ...TEMPLATE, items: [{ exerciseId: 'pullup', sets: 0 }] }, LIBRARY, PROTOCOLS, T0, counter())), 'ноль подходов - ошибка данных')
})

group('itemFromExercise: значения упражнения по умолчанию', () => {
  const ids = counter()
  const bench = itemFromExercise(LIBRARY[1], PROTOCOLS, ids) as StrengthItem
  assertEqual(bench.planned.length, 3, 'три подхода')
  assertEqual(bench.planned[0].reps, 5, 'нижняя граница из упражнения')
  assertEqual(bench.note, undefined, 'без подсказки нет заметки')
  const maxed = itemFromExercise(LIBRARY[0], PROTOCOLS, ids, { reps: 'max', sets: 1 }) as StrengthItem
  assertEqual(maxed.planned, [{ kind: 'work', reps: 'max' }], 'reps max')
  const noReps = itemFromExercise(ex({ id: 'free', pillar: 'strength', input: 'reps' }), PROTOCOLS, ids) as StrengthItem
  assertEqual(noReps.planned[0], { kind: 'work' }, 'без плана повторов строка пустая')
  const rdl = itemFromExercise(LIBRARY[8], PROTOCOLS, ids) as StrengthItem
  assertEqual({ type: rdl.type, n: rdl.planned.length }, { type: 'strength', n: 4 }, 'баланс с повторами - силовой элемент')
  const hold = itemFromExercise(LIBRARY[5], PROTOCOLS, ids) as HoldItem
  assertEqual({ perSide: hold.perSide, sec: hold.plannedSeconds }, { perSide: false, sec: 45 }, 'мобильность - удержание')
  const bare = itemFromExercise(ex({ id: 'bare', pillar: 'mobility', input: 'time' }), PROTOCOLS, ids) as HoldItem
  assertEqual(bare.plannedSeconds, 30, 'длительность удержания по умолчанию')
})

group('addItem, removeItem, заметки: без мутации', () => {
  const base = freeze(newSession({ place: 'home', title: 'T', now: T0, ids: counter() }))
  const item = freeze(itemFromExercise(LIBRARY[0], PROTOCOLS, counter()))
  const one = addItem(base, item)
  assertEqual(base.items.length, 0, 'вход не изменён')
  assertEqual(one.items.length, 1, 'элемент добавлен')
  assert(throwsRange(() => addItem(one, item)), 'повтор id отклоняется')
  const noted = setItemNote(one, item.id, '  держать локти  ')
  assertEqual(noted.items[0].note, 'держать локти', 'заметка обрезается')
  assertEqual('note' in setItemNote(noted, item.id, '   ').items[0], false, 'пустая заметка убирает поле')
  assertEqual(setSessionNote(one, 'хорошо').note, 'хорошо', 'заметка сессии')
  assertEqual('note' in setSessionNote(setSessionNote(one, 'x'), undefined), false, 'заметку сессии можно убрать')
  assertEqual(removeItem(one, item.id).items, [], 'элемент удалён')
  assert(throwsRange(() => removeItem(one, 'nope')), 'удаление неизвестного')
  assert(throwsRange(() => setItemNote(one, 'nope', 'x')), 'заметка неизвестному')
})

group('logSet: запись подхода', () => {
  const ids = counter()
  let s = newSession({ place: 'gym', title: 'T', now: T0, ids })
  const item = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  s = freeze(addItem(s, item))
  const s1 = logSet(s, item.id, { kind: 'work', weightKg: 60, reps: 5, rir: 2 }, T0 + 1000)
  assertEqual(strength(s, item.id).sets.length, 0, 'вход не изменён')
  assertEqual(strength(s1, item.id).sets, [{ kind: 'work', weightKg: 60, reps: 5, rir: 2, doneAt: T0 + 1000 }], 'подход записан')
  assertEqual(strength(s1, item.id).planned.length, 3, 'план не тронут')
  const s2 = logSet(s1, item.id, { kind: 'warmup', weightKg: undefined, reps: 10 }, T0 + 2000)
  assertEqual(strength(s2, item.id).sets[1], { kind: 'warmup', reps: 10, doneAt: T0 + 2000 }, 'undefined-поля не сохраняются')
  const timed = logSet(s, item.id, { kind: 'failure', seconds: 45 }, T0)
  assertEqual(strength(timed, item.id).sets[0].seconds, 45, 'подход на время')
  const assisted = logSet(s, item.id, { kind: 'work', assistKg: 20, reps: 6, side: 'left' }, T0)
  assertEqual(strength(assisted, item.id).sets[0], { kind: 'work', assistKg: 20, reps: 6, side: 'left', doneAt: T0 }, 'помощь и сторона')
})

group('logSet: мусор отклоняется', () => {
  const ids = counter()
  let s = newSession({ place: 'gym', title: 'T', now: T0, ids })
  const item = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  const hold = itemFromExercise(LIBRARY[4], PROTOCOLS, ids)
  s = addItem(addItem(s, item), hold)
  const bad = (input: Parameters<typeof logSet>[2]): boolean => throwsRange(() => logSet(s, item.id, input, T0))
  assert(bad({ kind: 'work', weightKg: 0, reps: 5 }), 'нулевой вес')
  assert(bad({ kind: 'work', weightKg: -5, reps: 5 }), 'отрицательный вес')
  assert(bad({ kind: 'work', weightKg: Number.NaN, reps: 5 }), 'NaN вес')
  assert(bad({ kind: 'work', assistKg: 0, reps: 5 }), 'нулевая помощь')
  assert(bad({ kind: 'work', reps: -1 }), 'отрицательные повторы')
  assert(bad({ kind: 'work', reps: 2.5 }), 'дробные повторы')
  assert(bad({ kind: 'work', seconds: -3 }), 'отрицательные секунды')
  assert(bad({ kind: 'work', weightKg: 50 }), 'ни повторов, ни секунд')
  assert(bad({ kind: 'work', reps: 5, rir: 6 }), 'RIR выше 5')
  assert(bad({ kind: 'work', reps: 5, rir: -1 }), 'RIR ниже 0')
  assert(bad({ kind: 'work', reps: 5, rir: 1.5 }), 'RIR дробный')
  assert(bad({ kind: 'strong' as never, reps: 5 }), 'неизвестный вид')
  assert(bad({ kind: 'work', reps: 5, side: 'up' as never }), 'неизвестная сторона')
  assert(throwsRange(() => logSet(s, 'nope', { kind: 'work', reps: 5 }, T0)), 'неизвестный элемент')
  assert(throwsRange(() => logSet(s, hold.id, { kind: 'work', reps: 5 }, T0)), 'подход в удержание')
  assert(throwsRange(() => logSet(s, item.id, { kind: 'work', reps: 5 }, Number.NaN)), 'NaN время')
  assertEqual(strength(logSet(s, item.id, { kind: 'work', reps: 0 }, T0), item.id).sets.length, 1, 'ноль повторов допустим (неудачная попытка)')
})

group('updateSet, removeSet, setRestSec', () => {
  const ids = counter()
  let s = newSession({ place: 'gym', title: 'T', now: T0, ids })
  const item = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  s = addItem(s, item)
  s = logSet(s, item.id, { kind: 'work', weightKg: 60, reps: 5 }, T0 + 1)
  s = logSet(s, item.id, { kind: 'work', weightKg: 60, reps: 4 }, T0 + 2)
  s = logSet(s, item.id, { kind: 'work', weightKg: 60, reps: 3 }, T0 + 3)
  const fixed = updateSet(freeze(s), item.id, 1, { weightKg: 62.5, rir: 1 })
  assertEqual(strength(fixed, item.id).sets[1], { kind: 'work', weightKg: 62.5, reps: 4, rir: 1, doneAt: T0 + 2 }, 'правка с сохранением времени')
  assertEqual(strength(updateSet(s, item.id, 0, { weightKg: undefined }), item.id).sets[0], { kind: 'work', reps: 5, doneAt: T0 + 1 }, 'undefined стирает поле')
  assert(throwsRange(() => updateSet(s, item.id, 3, { reps: 1 })), 'нет такого подхода')
  assert(throwsRange(() => updateSet(s, item.id, 0, { weightKg: -1 })), 'мусор в правке')

  const removed = removeSet(freeze(s), item.id, 1)
  assertEqual(strength(removed, item.id).sets.map(x => x.reps), [5, 3], 'средний подход удалён')
  assertEqual(strength(s, item.id).sets.length, 3, 'вход не изменён')
  assert(throwsRange(() => removeSet(s, item.id, -1)), 'отрицательный индекс')
  assert(throwsRange(() => removeSet(s, item.id, 3)), 'индекс за пределом')
  assert(throwsRange(() => removeSet(s, item.id, 0.5)), 'дробный индекс')
  assertEqual(strength(removeSet(removeSet(removeSet(s, item.id, 0), item.id, 0), item.id, 0), item.id).sets, [], 'можно удалить все')

  assertEqual(strength(setRestSec(s, item.id, 105), item.id).restSec, 105, 'отдых')
  assert(throwsRange(() => setRestSec(s, item.id, -15)), 'отрицательный отдых')
})

group('logHold, removeHold', () => {
  const ids = counter()
  let s = newSession({ place: 'home', title: 'T', now: T0, ids })
  const sided = itemFromExercise(LIBRARY[4], PROTOCOLS, ids)
  const plain = itemFromExercise(LIBRARY[5], PROTOCOLS, ids)
  s = addItem(addItem(s, sided), plain)
  const a = logHold(freeze(s), sided.id, { seconds: 31, side: 'left', eyesClosed: true }, T0 + 5)
  assertEqual((a.items[0] as HoldItem).holds, [{ seconds: 31, side: 'left', eyesClosed: true, doneAt: T0 + 5 }], 'удержание на сторону')
  const b = logHold(s, plain.id, { seconds: 45, side: 'right' }, T0 + 6)
  assertEqual((b.items[1] as HoldItem).holds, [{ seconds: 45, doneAt: T0 + 6 }], 'без perSide сторона не пишется')
  assert(throwsRange(() => logHold(s, sided.id, { seconds: 30 }, T0)), 'perSide без стороны')
  assert(throwsRange(() => logHold(s, plain.id, { seconds: 0 }, T0)), 'нулевая длительность')
  assert(throwsRange(() => logHold(s, plain.id, { seconds: Number.NaN }, T0)), 'NaN')
  assert(throwsRange(() => logHold(s, plain.id, { seconds: 30, side: 'up' as never }, T0)), 'мусорная сторона')
  assert(throwsRange(() => logHold(s, 'nope', { seconds: 30 }, T0)), 'нет элемента')
  assertEqual((removeHold(a, sided.id, 0).items[0] as HoldItem).holds, [], 'удалено')
  assert(throwsRange(() => removeHold(a, sided.id, 1)), 'нет такой позиции')
})

group('updateCardio и updateIntervals', () => {
  const ids = counter()
  let s = newSession({ place: 'home', title: 'T', now: T0, ids })
  const bike = itemFromExercise(LIBRARY[6], PROTOCOLS, ids)
  const hiit = itemFromExercise(LIBRARY[7], PROTOCOLS, ids)
  s = freeze(addItem(addItem(s, bike), hiit))
  const c = updateCardio(s, bike.id, { durationSec: 2700, distanceKm: 18.2, avgHr: 128, talkTest: true })
  assertEqual(c.items[0], { id: bike.id, exerciseId: 'bike', type: 'cardio', mode: 'bike', durationSec: 2700, distanceKm: 18.2, avgHr: 128, talkTest: true }, 'кардио заполнено')
  const cleared = updateCardio(c, bike.id, { avgHr: undefined, mode: 'row' })
  assertEqual(cleared.items[0], { id: bike.id, exerciseId: 'bike', type: 'cardio', mode: 'row', durationSec: 2700, distanceKm: 18.2, talkTest: true }, 'undefined стирает, режим меняется')
  assert(throwsRange(() => updateCardio(s, bike.id, { durationSec: -1 })), 'отрицательная длительность')
  assert(throwsRange(() => updateCardio(s, bike.id, { distanceKm: 0 })), 'нулевая дистанция')
  assert(throwsRange(() => updateCardio(s, bike.id, { avgHr: 10 })), 'нереальный пульс')
  assert(throwsRange(() => updateCardio(s, bike.id, { avgHr: Number.NaN })), 'NaN пульс')
  assert(throwsRange(() => updateCardio(s, hiit.id, { durationSec: 5 })), 'не тот тип')

  const i = updateIntervals(s, hiit.id, { roundsDone: 4, peakHr: 182 })
  assertEqual({ r: (i.items[1] as IntervalItem).roundsDone, p: (i.items[1] as IntervalItem).peakHr }, { r: 4, p: 182 }, 'раунды и пик')
  assert(throwsRange(() => updateIntervals(s, hiit.id, { roundsDone: 5 })), 'раундов больше протокола')
  assert(throwsRange(() => updateIntervals(s, hiit.id, { roundsDone: -1 })), 'отрицательные раунды')
  assert(throwsRange(() => updateIntervals(s, hiit.id, { roundsDone: 1.5 })), 'дробные раунды')
  assert(throwsRange(() => updateIntervals(s, hiit.id, { peakHr: 400 })), 'нереальный пик')
  const swapped = updateIntervals(s, hiit.id, { protocol: PROTOCOLS[1], roundsDone: 8 })
  assertEqual((swapped.items[1] as IntervalItem).protocol.id, 'tabata', 'смена протокола')
  assert(throwsRange(() => updateIntervals(i, hiit.id, { protocol: PROTOCOLS[1] })) === false, '4 раунда помещаются в табату')
  assert(throwsRange(() => updateIntervals(swapped, hiit.id, { protocol: PROTOCOLS[0] })), 'смена протокола с 8 раундами на 4 отклоняется')
  const custom = customProtocol({ workSec: 45, restSec: 15, rounds: 6, warmupSec: 120, cooldownSec: 60 })
  assertEqual(custom.id, 'custom', 'id своего протокола')
  assertEqual(custom.workSec, 45, 'значения')
  const withCustom = updateIntervals(s, hiit.id, { protocol: custom })
  assertEqual((withCustom.items[1] as IntervalItem).protocol, custom, 'свой протокол в элементе')
  assert(throwsRange(() => customProtocol({ workSec: 4, restSec: 15, rounds: 6, warmupSec: 0, cooldownSec: 0 })), 'работа меньше 5 с')
  assert(throwsRange(() => customProtocol({ workSec: 601, restSec: 15, rounds: 6, warmupSec: 0, cooldownSec: 0 })), 'работа больше 600 с')
  assert(throwsRange(() => customProtocol({ workSec: 30, restSec: -1, rounds: 6, warmupSec: 0, cooldownSec: 0 })), 'отрицательный отдых')
  assert(throwsRange(() => customProtocol({ workSec: 30, restSec: 15, rounds: 0, warmupSec: 0, cooldownSec: 0 })), 'ноль раундов')
  assert(throwsRange(() => customProtocol({ workSec: 30, restSec: 15, rounds: 31, warmupSec: 0, cooldownSec: 0 })), '31 раунд')
  assert(throwsRange(() => customProtocol({ workSec: 30, restSec: 15, rounds: 6, warmupSec: 901, cooldownSec: 0 })), 'разминка больше 900')
  assert(throwsRange(() => customProtocol({ workSec: 30, restSec: 15, rounds: 6, warmupSec: 0, cooldownSec: 601 })), 'заминка больше 600')
  assert(throwsRange(() => customProtocol({ workSec: 30.5, restSec: 15, rounds: 6, warmupSec: 0, cooldownSec: 0 })), 'дробные секунды')
  assert(throwsRange(() => updateIntervals(s, hiit.id, { protocol: { ...custom, rounds: 99 } })), 'свой протокол в патче проверяется')
  assertEqual(customProtocol({ workSec: 5, restSec: 0, rounds: 1, warmupSec: 0, cooldownSec: 0 }).rounds, 1, 'нижние границы допустимы')
  assertEqual(customProtocol({ workSec: 600, restSec: 600, rounds: 30, warmupSec: 900, cooldownSec: 600 }).rounds, 30, 'верхние границы допустимы')
})

group('finishSession', () => {
  const ids = counter()
  let s = newSession({ place: 'gym', title: 'T', now: T0, ids })
  const a = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  const b = itemFromExercise(LIBRARY[0], PROTOCOLS, ids)
  const c = itemFromExercise(LIBRARY[6], PROTOCOLS, ids)
  const d = itemFromExercise(LIBRARY[7], PROTOCOLS, ids)
  const e = itemFromExercise(LIBRARY[4], PROTOCOLS, ids)
  for (const item of [a, b, c, d, e]) s = addItem(s, item)
  s = logSet(s, a.id, { kind: 'work', weightKg: 60, reps: 5 }, T0 + 1)
  assert(hasLoggedWork(s), 'работа есть')
  assert(isItemEmpty(s.items[1]) && isItemEmpty(s.items[2]) && isItemEmpty(s.items[3]) && isItemEmpty(s.items[4]), 'остальные пусты')
  assert(!isItemEmpty(s.items[0]), 'первый не пуст')

  const done = finishSession(freeze(s), T0 + 50 * MIN, { note: ' ок ' })
  assertEqual(done.endedAt, T0 + 50 * MIN, 'endedAt')
  assertEqual(done.items.map(i => i.id), [a.id], 'пустые убраны')
  assertEqual(done.note, 'ок', 'заметка')
  assertEqual(s.endedAt, undefined, 'вход не изменён')
  assertEqual(s.items.length, 5, 'вход сохранил элементы')
  assertEqual(finishSession(s, T0 + MIN, { pruneEmpty: false }).items.length, 5, 'pruneEmpty: false оставляет всё')
  assertEqual(finishSession(done, T0 + 99 * MIN).endedAt, T0 + 50 * MIN, 'повторное завершение не двигает время')
  assertEqual(finishSession(s, T0 - 5000).endedAt, T0, 'время не раньше начала')
  assert(throwsRange(() => finishSession(s, Number.NaN)), 'NaN')
  const empty = finishSession(newSession({ place: 'home', title: 'T', now: T0, ids }), T0 + MIN)
  assert(!hasLoggedWork(empty), 'пустая сессия без работы')
  const ext = externalSession({ activityId: 'yoga', activityTitle: 'Йога', durationMin: 30, split: { mobility: 30 }, date: '2026-10-14' }, T0, ids)
  assert(hasLoggedWork(ext) && !isItemEmpty(ext.items[0]), 'внешнее занятие не пустое')
})

group('sessionSummary: минуты, подходы, тоннаж, по столпам', () => {
  const ids = counter()
  let s = newSession({ place: 'gym', title: 'T', now: T0, ids })
  const bench = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  const pull = itemFromExercise(LIBRARY[0], PROTOCOLS, ids)
  const rdl = itemFromExercise(LIBRARY[8], PROTOCOLS, ids)
  const stance = itemFromExercise(LIBRARY[4], PROTOCOLS, ids)
  const bike = itemFromExercise(LIBRARY[6], PROTOCOLS, ids)
  const hiit = itemFromExercise(LIBRARY[7], PROTOCOLS, ids)
  for (const item of [bench, pull, rdl, stance, bike, hiit]) s = addItem(s, item)
  s = logSet(s, bench.id, { kind: 'warmup', weightKg: 20, reps: 10 }, T0 + 1)
  s = logSet(s, bench.id, { kind: 'work', weightKg: 60, reps: 5 }, T0 + 2)
  s = logSet(s, bench.id, { kind: 'failure', weightKg: 62.5, reps: 3 }, T0 + 3)
  s = logSet(s, pull.id, { kind: 'work', reps: 8 }, T0 + 4)
  s = logSet(s, rdl.id, { kind: 'work', reps: 8, side: 'left' }, T0 + 5)
  s = logHold(s, stance.id, { seconds: 30, side: 'left' }, T0 + 6)
  s = logHold(s, stance.id, { seconds: 45, side: 'right' }, T0 + 7)
  s = updateCardio(s, bike.id, { durationSec: 1800 })
  s = updateIntervals(s, hiit.id, { roundsDone: 4 })
  s = finishSession(s, T0 + 61 * MIN + 20_000)
  const sum = sessionSummary(freeze(s), LIBRARY, T0 + 999 * MIN)
  assertEqual(sum.minutes, 61, 'минуты завершённой сессии, now игнорируется')
  assertEqual(sum.sets, 4, 'разминка не считается: жим 2, подтягивания 1, rdl 1')
  assertEqual(sum.tonnageKg, 487.5, '60x5 + 62.5x3 = 487,5; без веса не тоннаж')
  assertEqual(sum.byPillar.strength, { sets: 3, minutes: 0 }, 'сила')
  assertEqual(sum.byPillar.balance, { sets: 3, minutes: 1.25 }, 'баланс: rdl подход + 2 удержания, 75 с')
  assertEqual(sum.byPillar.zone2, { sets: 0, minutes: 30 }, 'зона 2')
  assertEqual(sum.byPillar.intervals, { sets: 4, minutes: 16 }, 'интервалы: 4 x 240 с')
  assertEqual(sum.byPillar.mobility, { sets: 0, minutes: 0 }, 'мобильность')
  const running = sessionSummary({ ...s, endedAt: undefined }, LIBRARY, T0 + 10 * MIN)
  assertEqual(running.minutes, 10, 'идущая считается до now')
  const unknown = sessionSummary(s, [], T0)
  assertEqual(unknown.byPillar.strength.sets, 4, 'без библиотеки силовые подходы относятся к силе')
  assertEqual(unknown.byPillar.mobility.minutes, 1.25, 'без библиотеки удержания относятся к мобильности')
  assertEqual(sessionSummary(newSession({ place: 'home', title: 'T', now: T0, ids }), LIBRARY, T0 - 5 * MIN).minutes, 0, 'время до начала даёт 0')
})

group('sessionSummary: внешнее занятие', () => {
  const s = externalSession(
    { activityId: 'climbing', activityTitle: 'Скалолазание', durationMin: 90, split: { strength: 60, mobility: 30 }, date: '2026-10-14', rpe: 7 },
    T0, counter(),
  )
  const sum = sessionSummary(s, LIBRARY, T0)
  assertEqual(sum.minutes, 90, 'минуты по времени сессии')
  assertEqual(sum.sets, 0, 'силовые минуты в подходы не переводятся')
  assertEqual(sum.byPillar.strength.minutes, 60, 'силовые минуты хранятся минутами')
  assertEqual(sum.byPillar.mobility.minutes, 30, 'мобильность')
})

group('externalSession: запись внешнего занятия', () => {
  const s = externalSession(
    { activityId: 'kickboxing', activityTitle: 'Кикбоксинг', durationMin: 60, split: { intervals: 20, zone2: 30, mobility: 10, balance: 0 }, date: '2026-10-12', rpe: 8, note: ' спарринг ' },
    T0, counter(),
  )
  assertEqual(s.date, '2026-10-12', 'выбранная дата')
  assertEqual(s.endedAt, T0, 'конец - now')
  assertEqual(s.startedAt, T0 - 60 * MIN, 'начало отсчитано назад на длительность')
  assertEqual(s.note, 'спарринг', 'заметка')
  assertEqual(s.items.length, 1, 'один элемент')
  const item = s.items[0]
  assertEqual(item.type, 'external', 'тип')
  assertEqual(item.type === 'external' ? item.split : null, { intervals: 20, zone2: 30, mobility: 10 }, 'нулевые доли убраны')
  assertEqual(item.type === 'external' ? item.rpe : null, 8, 'rpe')
  const bad = (patch: Partial<Parameters<typeof externalSession>[0]>): boolean =>
    throwsRange(() => externalSession({ activityId: 'yoga', activityTitle: 'Йога', durationMin: 60, split: { mobility: 60 }, date: '2026-10-14', ...patch }, T0, counter()))
  assert(bad({ split: { mobility: 50 } }), 'не хватает минут')
  assert(bad({ split: { mobility: 70 } }), 'лишние минуты')
  assert(bad({ durationMin: 0, split: {} }), 'нулевая длительность')
  assert(bad({ date: '2026-02-30' }), 'несуществующая дата')
  assert(bad({ date: 'вчера' }), 'мусорная дата')
  assert(bad({ rpe: 0 }), 'RPE 0')
  assert(bad({ rpe: 11 }), 'RPE 11')
  assert(bad({ rpe: 5.5 }), 'RPE дробный')
  assert(!bad({ rpe: 10 }), 'RPE 10 допустим')
  assert(!bad({ rpe: 1 }), 'RPE 1 допустим')
  assertEqual(externalSession({ activityId: 'yoga', activityTitle: 'Йога', durationMin: 60, split: { mobility: 60 }, date: '2026-10-14' }, T0, counter()).note, undefined, 'без заметки нет поля')
})

group('prefillFor: прошлый раз', () => {
  const ids = counter()
  const mk = (id: string, startedAt: number, build: (s: Session, itemId: string) => Session, exerciseIndex = 1): Session => {
    let s = newSession({ place: 'gym', title: id, now: startedAt, ids })
    s = { ...s, id }
    const item = itemFromExercise(LIBRARY[exerciseIndex], PROTOCOLS, ids)
    s = addItem(s, item)
    return finishSession(build(s, item.id), startedAt + 3_600_000)
  }
  const old = mk('old', T0, (s, i) => logSet(logSet(s, i, { kind: 'work', weightKg: 50, reps: 8 }, T0 + 1), i, { kind: 'work', weightKg: 52.5, reps: 6 }, T0 + 2))
  const recent = mk('recent', T0 + 7 * 86_400_000, (s, i) =>
    logSet(logSet(logSet(s, i, { kind: 'work', weightKg: 60, reps: 5, rir: 2 }, T0 + 1), i, { kind: 'failure', weightKg: 62.5, reps: 3 }, T0 + 2), i, { kind: 'warmup', weightKg: 20, reps: 10 }, T0 + 3))
  const state = { sessions: { old, recent } }
  assertEqual(prefillFor(state, 'bench'), { weightKg: 62.5, reps: 3 }, 'последний рабочий подход последней сессии, не разминка, без rir')
  assertEqual(prefillFor({ sessions: { old } }, 'bench'), { weightKg: 52.5, reps: 6 }, 'единственная сессия')
  assertEqual(prefillFor(state, 'pullup'), null, 'нет истории')
  assertEqual(prefillFor({ sessions: {} }, 'bench'), null, 'пустая история')
  const onlyWarmup = mk('w', T0 + 14 * 86_400_000, (s, i) => logSet(s, i, { kind: 'warmup', weightKg: 20, reps: 10 }, T0 + 1))
  assertEqual(prefillFor({ sessions: { old, recent, w: onlyWarmup } }, 'bench'), { weightKg: 62.5, reps: 3 }, 'сессия только с разминкой пропускается')
  const timed = mk('t', T0, (s, i) => logSet(s, i, { kind: 'work', seconds: 40 }, T0 + 1), 3)
  assertEqual(prefillFor({ sessions: { t: timed } }, 'plank'), { seconds: 40 }, 'секунды')
  const assisted = mk('a', T0, (s, i) => logSet(s, i, { kind: 'work', assistKg: 15, reps: 5 }, T0 + 1), 0)
  assertEqual(prefillFor({ sessions: { a: assisted } }, 'pullup'), { assistKg: 15, reps: 5 }, 'помощь')

  let running = newSession({ place: 'gym', title: 'now', now: T0 + 30 * 86_400_000, ids })
  const item = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  running = addItem(running, item)
  assertEqual(prefillFor(state, 'bench', running), { weightKg: 62.5, reps: 3 }, 'в идущей сессии подходов нет - история')
  running = logSet(running, item.id, { kind: 'work', weightKg: 65, reps: 4 }, T0)
  assertEqual(prefillFor(state, 'bench', running), { weightKg: 65, reps: 4 }, 'в идущей сессии уже есть подход - берётся он')
})

group('saveAsTemplate: из фактических подходов', () => {
  const ids = counter()
  let s = sessionFromTemplate(TEMPLATE, LIBRARY, PROTOCOLS, T0, ids)
  const [pull, row, plank, stance, bike, hiit] = s.items
  for (const [reps, kind] of [[6, 'work'], [8, 'work'], [5, 'failure'], [12, 'warmup']] as const) {
    s = logSet(s, pull.id, { kind, reps }, T0 + 1)
  }
  s = logSet(s, row.id, { kind: 'work', weightKg: 20, reps: 10, side: 'left' }, T0)
  s = logSet(s, row.id, { kind: 'work', weightKg: 20, reps: 12, side: 'right' }, T0)
  s = logSet(s, row.id, { kind: 'work', weightKg: 20, reps: 10, side: 'left' }, T0)
  s = logSet(s, plank.id, { kind: 'work', seconds: 40 }, T0)
  s = logSet(s, plank.id, { kind: 'work', seconds: 33 }, T0)
  s = logHold(s, stance.id, { seconds: 30, side: 'left' }, T0)
  s = logHold(s, stance.id, { seconds: 41, side: 'right' }, T0)
  s = updateCardio(s, bike.id, { durationSec: 2700 })
  s = updateIntervals(s, hiit.id, { roundsDone: 8 })
  s = finishSession(s, T0 + 55 * MIN)
  const tpl = saveAsTemplate(freeze(s), LIBRARY, '  Моя сила  ', T0 + 99, counter())
  assert(tpl !== null, 'шаблон создан')
  assertEqual(tpl.title, 'Моя сила', 'название обрезано')
  assertEqual(tpl.id, 'tpl-1', 'id из фабрики')
  assertEqual(tpl.place, 'home', 'место')
  assertEqual(tpl.estMinutes, 55, 'минуты')
  assertEqual(tpl.custom, true, 'custom')
  assertEqual(tpl.source, 'custom', 'источник')
  assertEqual(tpl.createdAt, T0 + 99, 'createdAt')
  assertEqual(tpl.pillars, ['strength', 'zone2', 'intervals', 'balance'], 'столпы в порядке PILLARS')
  assertEqual(tpl.items, [
    { exerciseId: 'pullup', sets: 3, restSec: 120, reps: [5, 8] },
    { exerciseId: 'row', sets: 2, restSec: 90, perSide: true, reps: [10, 12] },
    { exerciseId: 'plank', sets: 2, restSec: 90, seconds: 33 },
    { exerciseId: 'stance', sets: 1, seconds: 30, perSide: true },
    { exerciseId: 'bike', minutes: 45 },
    { exerciseId: 'hiit', protocolId: 'tabata' },
  ], 'элементы: подходы без разминки, диапазон повторов, perSide по большей стороне')
  assert(!('excludeFromWeek' in tpl), 'без флага недели')

  const fromTemplate = sessionFromTemplate(tpl, LIBRARY, PROTOCOLS, T0, counter())
  assertEqual(fromTemplate.items.map(i => i.type), ['strength', 'strength', 'strength', 'hold', 'cardio', 'intervals'], 'шаблон снова запускается')

})

group('saveAsTemplate: краевые случаи', () => {
  const ids = counter()
  const base = newSession({ place: 'gym', title: 'Зал', now: T0, ids, excludeFromWeek: true })
  assertEqual(saveAsTemplate(base, LIBRARY, 'X', T0, ids), null, 'пустая сессия - нечего сохранять')
  const item = itemFromExercise(LIBRARY[1], PROTOCOLS, ids)
  let s = addItem(base, item)
  s = logSet(s, item.id, { kind: 'warmup', weightKg: 20, reps: 10 }, T0)
  assertEqual(saveAsTemplate(s, LIBRARY, 'X', T0, ids), null, 'только разминка - нечего сохранять')
  s = logSet(s, item.id, { kind: 'work', weightKg: 60, reps: 5 }, T0)
  const tpl = saveAsTemplate(s, LIBRARY, '   ', T0 + 20 * 1000, ids)
  assert(tpl !== null, 'шаблон создан')
  assertEqual(tpl.title, 'Зал', 'пустое название заменяется названием сессии')
  assertEqual(tpl.items, [{ exerciseId: 'bench', sets: 1, restSec: 90, reps: 5 }], 'одинаковые повторы - число, а не диапазон')
  assertEqual(tpl.estMinutes, 1, 'минимум одна минута')
  assertEqual(tpl.excludeFromWeek, true, 'флаг недели переносится')
  const ext = externalSession({ activityId: 'yoga', activityTitle: 'Йога', durationMin: 30, split: { mobility: 30 }, date: '2026-10-14' }, T0, ids)
  assertEqual(saveAsTemplate(ext, LIBRARY, 'Йога', T0, ids), null, 'внешние занятия в шаблон не идут')
  const unknown = addItem(base, { id: 'z', type: 'strength', exerciseId: 'deleted', unit: 'reps', planned: [], restSec: 60, sets: [{ kind: 'work', reps: 5, doneAt: 1 }] })
  assertEqual(saveAsTemplate(unknown, [], 'U', T0, ids)?.pillars, ['strength'], 'упражнения нет в библиотеке - столп силы')
})

group('sessionMinutes и idFactory', () => {
  const s = newSession({ place: 'home', title: 'T', now: T0, ids: counter() })
  assertEqual(sessionMinutes(s, T0 + 90 * 1000), 2, 'округление 1,5 мин вверх')
  assertEqual(sessionMinutes({ ...s, endedAt: T0 + 10 * MIN }, T0 + 99 * MIN), 10, 'завершённая')
  assertEqual(sessionMinutes(s, T0 - MIN), 0, 'не бывает отрицательных')
  const ids = idFactory(T0, () => 0.25)
  assertEqual(ids('item'), ids('item'), 'при тех же now и random id совпадают (детерминизм)')
  assert(/^sess-[0-9a-z]+-[0-9a-z]{6}$/.test(idFactory(T0)('sess')), 'форма id')
})

finish()
