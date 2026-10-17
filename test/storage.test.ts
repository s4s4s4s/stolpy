import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, assertEqual, finish, group } from './_harness.ts'
import type { ActiveSession, AppState, Session } from '../src/core/types.ts'
import {
  CURRENT_VERSION, DEFAULT_GOALS, defaultSettings, defaultState, deserialize, deserializeActive, migrate, parseVersion,
  sanitizeBodyWeights, sanitizeCardioItem, sanitizeExercise, sanitizeExternalItem, sanitizeHoldItem, sanitizeIntervalItem,
  sanitizeMeta, sanitizeProgramProgress, sanitizeSession, sanitizeSettings, sanitizeStrengthItem, sanitizeStrengthSet,
  sanitizeTemplate, sanitizeTestResult, serialize, serializeActive,
} from '../src/state/storage.ts'

const NOW = Date.UTC(2026, 9, 17, 9, 0)
const FIXTURE_TEXT = readFileSync(join(process.cwd(), 'test', 'fixtures', 'state-v1.json'), 'utf8')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function fixtureState(): AppState {
  return JSON.parse(FIXTURE_TEXT) as AppState
}

function minimalSession(over: Partial<Session> = {}): Session {
  return { id: 's1', date: '2026-10-12', startedAt: 1000, place: 'home', title: 'Дома', items: [], ...over }
}

group('defaultState: значения по умолчанию из плана, installedAt = now', () => {
  const s = defaultState(NOW)
  assertEqual(s.version, CURRENT_VERSION, 'версия текущая')
  assertEqual(CURRENT_VERSION, 1, 'первая версия формата')
  assertEqual(s.settings.goals, {
    strengthSets: 50, strengthDays: 3, zone2Minutes: 150, intervalSessions: 2, intervalHardMinutes: 32,
    mobilityMinutes: 30, mobilityDays: 3, balanceMinutes: 30, balanceDays: 3,
  }, 'цели недели')
  assertEqual(s.settings.homeEquipment, ['bodyweight', 'mat'], 'инвентарь')
  assertEqual(s.settings.defaultRestSec, 90, 'отдых')
  assertEqual(s.settings.sound, 'ambient', 'звук')
  assertEqual(s.settings.keepAwake, true, 'экран')
  assertEqual(s.settings.onboardingDone, false, 'первый запуск')
  assertEqual(s.settings.restingHrManual, false, 'пульс покоя не ручной')
  assertEqual(s.meta, { lastBackupAt: null, sessionsSinceBackup: 0, installedAt: NOW }, 'meta')
  assertEqual([s.sessions, s.customExercises, s.customTemplates, s.programs], [{}, {}, {}, {}], 'пустые словари')
  assertEqual([s.testResults, s.bodyWeights], [[], []], 'пустые списки')
  const a = defaultState(NOW)
  a.settings.goals.zone2Minutes = 1
  a.settings.homeEquipment.push('bench')
  assertEqual(defaultState(NOW).settings.goals.zone2Minutes, 150, 'цели не разделяются между вызовами')
  assertEqual(DEFAULT_GOALS.zone2Minutes, 150, 'константа целей не мутирована')
  assertEqual(defaultState(NOW).settings.homeEquipment, ['bodyweight', 'mat'], 'инвентарь не разделяется')
})

group('фикстура state-v1.json: читается без потерь и тождественна по кругу', () => {
  const r = deserialize(FIXTURE_TEXT, NOW)
  assertEqual(r.source, 'stored', 'source')
  assertEqual(r.dropped, 0, 'dropped 0')
  assertEqual(r.state, fixtureState(), 'состояние совпадает с файлом')
  assertEqual(serialize(r.state), JSON.stringify(JSON.parse(FIXTURE_TEXT)), 'serialize даёт тот же текст, порядок ключей тот же')
  const again = deserialize(serialize(r.state), NOW + 1)
  assertEqual(again.state, r.state, 'второй круг тождественен')
  assertEqual(again.dropped, 0, 'второй круг без потерь')
})

group('фикстура представительна: все виды элементов и записей', () => {
  const s = fixtureState()
  const items = Object.values(s.sessions).flatMap(x => x.items)
  const types = new Set(items.map(i => i.type))
  for (const t of ['strength', 'cardio', 'intervals', 'hold', 'external']) assert(types.has(t as never), `есть элемент ${t}`)
  const sets = items.flatMap(i => (i.type === 'strength' ? i.sets : []))
  assert(sets.some(x => x.kind === 'warmup'), 'есть разминочный подход')
  assert(sets.some(x => x.rir !== undefined), 'есть RIR')
  assert(sets.some(x => x.assistKg !== undefined), 'есть помощь')
  assert(sets.some(x => x.side === 'left') && sets.some(x => x.side === 'right'), 'есть подходы по сторонам')
  const holds = items.flatMap(i => (i.type === 'hold' ? i.holds : []))
  assert(holds.some(h => h.side === 'left') && holds.some(h => h.side === 'right'), 'удержания по сторонам')
  assert(Object.keys(s.programs).length > 0, 'программа')
  assert(s.testResults.length > 0, 'тесты формы')
  assert(s.bodyWeights.length > 0, 'вес')
  assert(Object.keys(s.customExercises).length > 0 && Object.keys(s.customTemplates).length > 0, 'свои упражнения и шаблоны')
  assert(Object.values(s.sessions).some(x => x.programRef), 'сессия программы')
})

group('serialize -> deserialize: состояние по умолчанию по кругу', () => {
  const s = defaultState(NOW)
  const r = deserialize(serialize(s), NOW + 5)
  assertEqual(r, { state: s, source: 'stored', dropped: 0 }, 'круг')
})

group('deserialize: пусто и мусор не роняют', () => {
  for (const text of [null, '', '   ', 'null']) {
    const r = deserialize(text, NOW)
    assertEqual([r.source, r.dropped], ['default', 0], `default для ${JSON.stringify(text)}`)
    assertEqual(r.state, defaultState(NOW), `дефолт для ${JSON.stringify(text)}`)
  }
  for (const text of ['{', 'не json', '[1,2]', '42', '"строка"', 'true', '{"version":1,'])  {
    const r = deserialize(text, NOW)
    assertEqual([r.source, r.dropped], ['corrupt', 0], `corrupt для ${text}`)
    assertEqual(r.state, defaultState(NOW), `дефолт для ${text}`)
  }
})

group('deserialize: пустой объект и объект без версии мигрируют как старые', () => {
  const r = deserialize('{}', NOW)
  assertEqual(r, { state: defaultState(NOW), source: 'stored', dropped: 0 }, 'пустой объект')
  const st = fixtureState() as unknown as Record<string, unknown>
  delete st.version
  const r2 = deserialize(JSON.stringify(st), NOW)
  assertEqual([r2.source, r2.dropped], ['stored', 0], 'без версии читается')
  assertEqual(r2.state, fixtureState(), 'и ничего не теряет')
})

group('deserialize: более новая версия отдаёт newer-version и дефолт', () => {
  for (const v of [2, 1.5, 999]) {
    const r = deserialize(JSON.stringify({ ...fixtureState(), version: v }), NOW)
    assertEqual([r.source, r.dropped], ['newer-version', 0], `версия ${v}`)
    assertEqual(r.state, defaultState(NOW), `дефолт для версии ${v}`)
  }
})

group('parseVersion: число больше текущей - как есть, мусор - 0', () => {
  assertEqual(parseVersion(1), 1, '1')
  assertEqual(parseVersion(0), 0, '0')
  assertEqual(parseVersion(5), 5, '5')
  assertEqual(parseVersion(-1), 0, 'отрицательная')
  assertEqual(parseVersion(0.5), 0, 'дробная меньше текущей')
  assertEqual(parseVersion('2'), 0, 'строка')
  assertEqual(parseVersion(null), 0, 'null')
  assertEqual(parseVersion(Number.NaN), 0, 'NaN')
})

group('migrate: поля верхнего уровня не того типа считаются потерей', () => {
  const r = migrate({ sessions: [], customExercises: 'x', customTemplates: 1, programs: true, testResults: {}, bodyWeights: 'x', settings: 5, meta: [] }, 1, NOW)
  assertEqual(r.state, defaultState(NOW), 'дефолт')
  assertEqual(r.dropped, 8, 'по одному на каждое поле')
  const empty = migrate({ sessions: null, testResults: null }, 1, NOW)
  assertEqual(empty.dropped, 0, 'null - отсутствие, не потеря')
})

group('sanitizeSettings: битое поле заменяется по одному и считается', () => {
  const r = sanitizeSettings({
    birthYear: 1800, bodyWeightKg: 74, maxHrMode: 'auto', maxHrManual: 190, restingHr: 'x', restingHrManual: true,
    goals: { strengthSets: -1, zone2Minutes: 180, mobilityDays: 2.5 }, homeEquipment: ['mat', 'laser', 'mat', 'bench'],
    defaultRestSec: 4000, sound: 'silent', keepAwake: 'yes', healthShortcutName: 7, onboardingDone: true,
  })
  const def = defaultSettings()
  assertEqual(r.value.birthYear, null, 'год вне диапазона')
  assertEqual(r.value.bodyWeightKg, 74, 'вес выжил')
  assertEqual(r.value.maxHrMode, 'formula', 'неизвестный режим')
  assertEqual(r.value.maxHrManual, 190, 'пульс выжил')
  assertEqual(r.value.restingHr, null, 'строка вместо пульса')
  assertEqual(r.value.restingHrManual, true, 'флаг выжил')
  assertEqual(r.value.goals, { ...def.goals, zone2Minutes: 180 }, 'цели по одной')
  assertEqual(r.value.homeEquipment, ['mat', 'bench'], 'инвентарь: чужое и повтор выпали')
  assertEqual(r.value.defaultRestSec, 90, 'отдых больше часа')
  assertEqual(r.value.sound, 'silent', 'звук выжил')
  assertEqual(r.value.keepAwake, true, 'строка вместо флага')
  assertEqual(r.value.healthShortcutName, '', 'число вместо имени')
  assertEqual(r.value.onboardingDone, true, 'флаг выжил')
  assertEqual(r.dropped, 10, 'посчитаны все десять замен: год, режим, пульс, две цели, два элемента инвентаря, отдых, экран, имя')
  assertEqual(sanitizeSettings(undefined), { value: def, dropped: 0 }, 'нет настроек')
  assertEqual(sanitizeSettings({}), { value: def, dropped: 0 }, 'пустые настройки без потерь')
  assertEqual(sanitizeSettings({ birthYear: null, bodyWeightKg: null }).dropped, 0, 'null в nullable - не потеря')
  assertEqual(sanitizeSettings({ homeEquipment: [] }).value.homeEquipment, [], 'пустой инвентарь сохраняется пустым')
  assertEqual(sanitizeSettings({ goals: { strengthSets: 0 } }).value.goals.strengthSets, 0, 'нулевая цель допустима')
})

group('sanitizeStrengthSet: границы полей', () => {
  const ok = { kind: 'work', weightKg: 60, reps: 8, rir: 2, doneAt: 5 }
  assertEqual(sanitizeStrengthSet(ok), ok, 'валидный')
  assertEqual(sanitizeStrengthSet({ kind: 'work', seconds: 0, doneAt: 0 }), { kind: 'work', seconds: 0, doneAt: 0 }, 'ноль секунд и время 0')
  assertEqual(sanitizeStrengthSet({ ...ok, rir: null }), { kind: 'work', weightKg: 60, reps: 8, doneAt: 5 }, 'rir null - нет поля')
  const bad: [string, unknown][] = [
    ['вес 0', { ...ok, weightKg: 0 }], ['вес отрицательный', { ...ok, weightKg: -5 }], ['вес бесконечный', { ...ok, weightKg: 1e9 }],
    ['помощь 0', { ...ok, assistKg: 0 }], ['повторы дробные', { ...ok, reps: 2.5 }], ['повторы -1', { ...ok, reps: -1 }],
    ['rir 6', { ...ok, rir: 6 }], ['rir дробный', { ...ok, rir: 1.5 }], ['rir -1', { ...ok, rir: -1 }],
    ['сторона чужая', { ...ok, side: 'up' }], ['вид чужой', { ...ok, kind: 'drop' }], ['нет doneAt', { ...ok, doneAt: undefined }],
    ['ни повторов, ни секунд', { kind: 'work', weightKg: 60, doneAt: 1 }], ['не объект', 7], ['null', null],
    ['вес строкой', { ...ok, weightKg: '60' }],
  ]
  for (const [name, v] of bad) assertEqual(sanitizeStrengthSet(v), null, name)
  assertEqual(sanitizeStrengthSet({ ...ok, rir: 0 })?.rir, 0, 'rir 0 допустим')
  assertEqual(sanitizeStrengthSet({ ...ok, rir: 5 })?.rir, 5, 'rir 5 допустим')
  assertEqual(sanitizeStrengthSet({ ...ok, extra: 1 }), ok, 'лишние поля не переносятся')
})

group('sanitizeStrengthItem: битый подход выпадает один и считается', () => {
  const item = fixtureState().sessions['s-strength'].items[0]
  const raw = clone(item) as unknown as { sets: unknown[]; planned: unknown[] }
  raw.sets.splice(1, 0, { kind: 'work', weightKg: -1, reps: 5, doneAt: 1 })
  raw.planned.push({ kind: 'nope' })
  const r = sanitizeStrengthItem(raw)
  assertEqual(r.value, item, 'остальное цело')
  assertEqual(r.dropped, 2, 'подход и план')
  assertEqual(sanitizeStrengthItem({ ...clone(item), unit: 'kg' }).value, null, 'чужая единица')
  assertEqual(sanitizeStrengthItem({ ...clone(item), restSec: -1 }).value, null, 'отрицательный отдых')
  assertEqual(sanitizeStrengthItem({ ...clone(item), goal: { kind: 'total-reps', reps: 0 } }).value, null, 'цель 0')
  assertEqual(sanitizeStrengthItem({ ...clone(item), sets: 'x' }).dropped, 1, 'sets не массив - потеря')
})

group('sanitizeCardioItem и sanitizeIntervalItem', () => {
  const s = fixtureState().sessions['s-cardio']
  const cardio = s.items[0]
  const interval = s.items[1]
  assertEqual(sanitizeCardioItem(clone(cardio)), cardio, 'кардио цело')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), durationSec: 0, distanceKm: undefined, avgHr: undefined, talkTest: undefined }),
    { id: 'c1', exerciseId: 'zone2-walk-incline', type: 'cardio', mode: 'incline-walk', durationSec: 0 }, 'ноль секунд, без необязательных')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), avgHr: 400 }), null, 'пульс 400')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), distanceKm: 0 }), null, 'дистанция 0')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), mode: 'fly' }), null, 'чужой режим')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), durationSec: -1 }), null, 'отрицательная длительность')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), id: '' }), null, 'пустой id')
  assertEqual(sanitizeCardioItem({ ...clone(cardio), id: '   ' }), null, 'id из пробелов')

  assertEqual(sanitizeIntervalItem(clone(interval)), interval, 'интервалы целы')
  assertEqual(sanitizeIntervalItem({ ...clone(interval), roundsDone: 0 })?.roundsDone, 0, 'ноль раундов')
  assertEqual(sanitizeIntervalItem({ ...clone(interval), roundsDone: 4 })?.roundsDone, 4, 'ровно rounds')
  assertEqual(sanitizeIntervalItem({ ...clone(interval), roundsDone: 5 }), null, 'больше rounds')
  assertEqual(sanitizeIntervalItem({ ...clone(interval), roundsDone: 1.5 }), null, 'дробные раунды')
  if (interval.type !== 'intervals') throw new Error('фикстура: второй элемент не интервалы')
  for (const field of ['id', 'title', 'workSec', 'restSec', 'rounds', 'warmupSec', 'cooldownSec', 'note', 'source'] as const) {
    const p = clone(interval.protocol) as unknown as Record<string, unknown>
    delete p[field]
    assertEqual(sanitizeIntervalItem({ ...clone(interval), protocol: p }), null, `протокол без ${field}`)
  }
  assertEqual(sanitizeIntervalItem({ ...clone(interval), protocol: { ...interval.protocol, workSec: 0 } }), null, 'работа 0 секунд')
})

group('sanitizeHoldItem: удержания по сторонам, битое выпадает и считается', () => {
  const item = fixtureState().sessions['s-balance'].items[0]
  const raw = clone(item) as unknown as { holds: unknown[] }
  raw.holds.push({ seconds: -3, doneAt: 1 }, { seconds: 10, side: 'middle', doneAt: 1 }, { seconds: 10, eyesClosed: 'да', doneAt: 1 })
  const r = sanitizeHoldItem(raw)
  assertEqual(r.value, item, 'валидные удержания целы')
  assertEqual(r.dropped, 3, 'три битых')
  assertEqual(sanitizeHoldItem({ ...clone(item), perSide: 1 }).value, null, 'perSide не флаг')
  assertEqual(sanitizeHoldItem({ ...clone(item), holds: [] }).value?.holds, [], 'без удержаний - пустой список')
})

group('sanitizeExternalItem: разбивка больше длительности обнуляется, элемент остаётся', () => {
  const item = fixtureState().sessions['s-external'].items[0]
  assertEqual(sanitizeExternalItem(clone(item)), { value: item, dropped: 0 }, 'валидное цело')
  const over = sanitizeExternalItem({ ...clone(item), split: { zone2: 60, intervals: 31 } })
  assertEqual(over.value && over.value.type === 'external' ? over.value.split : 'нет', {}, 'сумма 91 > 90 - обнулена')
  assertEqual(over.dropped, 1, 'обнуление посчитано')
  const exact = sanitizeExternalItem({ ...clone(item), split: { zone2: 60, intervals: 30 } })
  assertEqual(exact.dropped, 0, 'сумма ровно 90 допустима')
  const foreign = sanitizeExternalItem({ ...clone(item), split: { cardio: 10 } })
  assertEqual(foreign.dropped, 1, 'чужой столп обнуляет разбивку')
  const neg = sanitizeExternalItem({ ...clone(item), split: { zone2: -5 } })
  assertEqual(neg.dropped, 1, 'отрицательные минуты обнуляют разбивку')
  const notObj = sanitizeExternalItem({ ...clone(item), split: 'x' })
  assertEqual([notObj.value !== null, notObj.dropped], [true, 1], 'разбивка не объект')
  assertEqual(sanitizeExternalItem({ ...clone(item), split: {} }).dropped, 0, 'пустая разбивка не потеря')
  const legacy = sanitizeExternalItem({ ...clone(item), exerciseId: 'football' })
  assert(legacy.value !== null && !('exerciseId' in legacy.value), 'чужой exerciseId у внешнего занятия не переносится')
  assertEqual(sanitizeExternalItem({ ...clone(item), durationMin: 0 }).value, null, 'длительность 0')
  assertEqual(sanitizeExternalItem({ ...clone(item), rpe: 11 }).value, null, 'rpe 11')
  assertEqual(sanitizeExternalItem({ ...clone(item), rpe: 0 }).value, null, 'rpe 0')
  assertEqual(sanitizeExternalItem({ ...clone(item), activityId: '' }).value, null, 'пустой activityId')
})

group('sanitizeSession: обязательные поля и элементы по одному', () => {
  const base = minimalSession()
  assertEqual(sanitizeSession(base), { value: base, dropped: 0 }, 'минимальная сессия')
  const bad: [string, unknown][] = [
    ['нет id', { ...base, id: undefined }], ['дата не ISO', { ...base, date: '12.10.2026' }],
    ['несуществующая дата', { ...base, date: '2026-02-30' }], ['startedAt строкой', { ...base, startedAt: '1000' }],
    ['startedAt отрицательный', { ...base, startedAt: -1 }], ['место чужое', { ...base, place: 'pool' }],
    ['items не массив', { ...base, items: {} }], ['не объект', 'x'],
  ]
  for (const [name, v] of bad) assertEqual(sanitizeSession(v).value, null, name)

  const items = [
    { id: 'a', exerciseId: 'x', type: 'cardio', mode: 'walk', durationSec: 60 },
    { id: 'b', exerciseId: 'x', type: 'teleport' },
    { id: 'a', exerciseId: 'y', type: 'cardio', mode: 'run', durationSec: 30 },
    null,
    { id: 'c', exerciseId: 'x', type: 'cardio', mode: 'walk', durationSec: 60 },
  ]
  const r = sanitizeSession({ ...base, items })
  assertEqual(r.value?.items.map(i => i.id), ['a', 'c'], 'неизвестный тип, повтор id и null выпали')
  const first = r.value?.items[0]
  assertEqual(first?.type === 'cardio' ? first.exerciseId : undefined, 'x', 'повтор id: остаётся первый')
  assertEqual(r.dropped, 3, 'три потери')

  const opt = sanitizeSession({ ...base, endedAt: 500, title: 5, templateId: '', note: 3, excludeFromWeek: 'no', health: { sentAt: 1 }, programRef: { programId: 'p' } })
  assertEqual(opt.value, { ...base, title: '' }, 'битые необязательные поля сняты, сессия жива')
  assertEqual(opt.dropped, 7, 'каждое снятое поле посчитано')
  assertEqual(sanitizeSession({ ...base, endedAt: 1000 }).value?.endedAt, 1000, 'endedAt = startedAt допустим')
  assertEqual(sanitizeSession({ ...base, energyKcal: 320 }), { value: { ...base, energyKcal: 320 }, dropped: 0 }, 'калории сохраняются')
  for (const bad of [0, -5, NaN, Infinity, '300']) {
    const r = sanitizeSession({ ...base, energyKcal: bad })
    assertEqual([r.value, r.dropped], [base, 1], `калории ${String(bad)} выпадают и считаются`)
  }
  assertEqual(sanitizeSession({ ...base, energyKcal: undefined }).dropped, 0, 'нет калорий не потеря')
  assertEqual(sanitizeSession({ ...base, title: undefined }).value?.title, '', 'нет названия - пустое, без потери')
  assertEqual(sanitizeSession({ ...base, title: undefined }).dropped, 0, 'отсутствие названия не потеря')
})

group('deserialize: сессия под чужим ключом и битая сессия выпадают, соседи живы', () => {
  const st = fixtureState()
  const raw = clone(st) as unknown as { sessions: Record<string, unknown> }
  raw.sessions['чужой'] = clone(st.sessions['s-cardio'])
  raw.sessions['битая'] = { id: 'битая', date: 'вчера' }
  raw.sessions['s-balance'] = { ...clone(st.sessions['s-balance']), items: [...clone(st.sessions['s-balance']).items, { type: 'hold' }] }
  const r = deserialize(JSON.stringify(raw), NOW)
  assertEqual(r.source, 'stored', 'stored')
  assertEqual(r.dropped, 3, 'чужой ключ, битая, битый элемент')
  assertEqual(r.state.sessions, st.sessions, 'остальные сессии целы')
})

group('sanitizeExercise: группы, инвентарь, диапазоны', () => {
  const ex = fixtureState().customExercises['ex-towel-row']
  assertEqual(sanitizeExercise(clone(ex)), ex, 'цело')
  assertEqual(sanitizeExercise({ ...clone(ex), groups: ['back', 'arms', 'legs'] }), null, 'три группы')
  assertEqual(sanitizeExercise({ ...clone(ex), groups: ['back', 'back'] }), null, 'повтор группы')
  assertEqual(sanitizeExercise({ ...clone(ex), groups: ['wings'] }), null, 'чужая группа')
  assertEqual(sanitizeExercise({ ...clone(ex), equipment: [] }), null, 'пустой инвентарь')
  assertEqual(sanitizeExercise({ ...clone(ex), equipment: ['bodyweight', 'jetpack'] }), null, 'чужой инвентарь')
  assertEqual(sanitizeExercise({ ...clone(ex), defaults: { sets: 3, reps: [12, 8] } }), null, 'диапазон наоборот')
  assertEqual(sanitizeExercise({ ...clone(ex), defaults: { sets: 3, reps: [8] } }), null, 'диапазон из одного')
  assertEqual(sanitizeExercise({ ...clone(ex), custom: false }), null, 'custom только true')
  assertEqual(sanitizeExercise({ ...clone(ex), input: 'voice' }), null, 'чужой ввод')
  assertEqual(sanitizeExercise({ ...clone(ex), pillar: 'sleep' }), null, 'чужой столп')
  assertEqual(sanitizeExercise({ ...clone(ex), defaults: { sets: 3, reps: [8, 8] } })?.defaults.reps, [8, 8], 'вырожденный диапазон допустим')
})

group('sanitizeTemplate: битый пункт выпадает, ссылка на упражнение не проверяется', () => {
  const t = fixtureState().customTemplates['tpl-short']
  assertEqual(sanitizeTemplate(clone(t)), { value: t, dropped: 0 }, 'цел')
  const raw = clone(t) as unknown as { items: unknown[] }
  raw.items.push({ exerciseId: '' }, { exerciseId: 'x', reps: 'много' }, { exerciseId: 'нет-такого' })
  const r = sanitizeTemplate(raw)
  assertEqual(r.value?.items.length, 4, 'ссылка на несуществующее упражнение осталась')
  assertEqual(r.dropped, 2, 'два битых пункта')
  assertEqual(sanitizeTemplate({ ...clone(t), place: 'moon' }).value, null, 'чужое место')
  assertEqual(sanitizeTemplate({ ...clone(t), place: 'any' }).value?.place, 'any', 'любое место')
  assertEqual(sanitizeTemplate({ ...clone(t), pillars: [] }).value, null, 'без столпов')
  assertEqual(sanitizeTemplate({ ...clone(t), source: 'web' }).value, null, 'чужой источник')
  assertEqual(sanitizeTemplate({ ...clone(t), items: [] }).value?.items, [], 'пустой шаблон допустим')
})

group('sanitizeProgramProgress: ровно три разных дня 0..6', () => {
  const p = fixtureState().programs.muscleup
  assertEqual(sanitizeProgramProgress(clone(p)), { value: p, dropped: 0 }, 'цел')
  for (const days of [[0, 2], [0, 2, 4, 6], [0, 0, 2], [0, 2, 7], [-1, 2, 4], [0, 2, 4.5], 'пн'] as unknown[]) {
    assertEqual(sanitizeProgramProgress({ ...clone(p), trainingWeekdays: days }).value, null, `дни ${JSON.stringify(days)}`)
  }
  assertEqual(sanitizeProgramProgress({ ...clone(p), trainingWeekdays: [6, 1, 3] }).value?.trainingWeekdays, [6, 1, 3], 'порядок не трогается')
  assertEqual(sanitizeProgramProgress({ ...clone(p), phaseStartedWeek: 0 }).value, null, 'неделя с единицы')
  const r = sanitizeProgramProgress({
    ...clone(p),
    completedDays: [...p.completedDays, { date: 'x', dayKey: 'A', sessionId: 's' }],
    measurements: [...p.measurements, { date: '2026-09-20', reps: -1 }],
  })
  assertEqual(r.value, p, 'битые отметки выпали')
  assertEqual(r.dropped, 2, 'и посчитаны')
})

group('sanitizeTestResult, sanitizeBodyWeights, sanitizeMeta', () => {
  const tr = fixtureState().testResults[0]
  assertEqual(sanitizeTestResult(clone(tr)), tr, 'тест цел')
  assertEqual(sanitizeTestResult({ ...clone(tr), values: { left: 'x' } }), null, 'значение строкой')
  assertEqual(sanitizeTestResult({ ...clone(tr), result: Number.NaN }), null, 'NaN')
  assertEqual(sanitizeTestResult({ ...clone(tr), values: {} })?.values, {}, 'без полей допустимо')

  const w = sanitizeBodyWeights([
    { date: '2026-09-14', kg: 74 }, { date: '2026-09-07', kg: 75 }, { date: '2026-09-14', kg: 73.8 },
    { date: '2026-09-21', kg: 0 }, { date: 'x', kg: 70 }, 'мусор',
  ])
  assertEqual(w.value, [{ date: '2026-09-07', kg: 75 }, { date: '2026-09-14', kg: 73.8 }], 'по дате, последняя побеждает')
  assertEqual(w.dropped, 4, 'повтор даты, ноль, битая дата, мусор')
  assertEqual(sanitizeBodyWeights(undefined), { value: [], dropped: 0 }, 'нет поля')

  assertEqual(sanitizeMeta(undefined, NOW), { value: { lastBackupAt: null, sessionsSinceBackup: 0, installedAt: NOW }, dropped: 0 }, 'нет meta')
  const m = sanitizeMeta({ lastBackupAt: 'вчера', sessionsSinceBackup: 2.5, installedAt: 77 }, NOW)
  assertEqual(m, { value: { lastBackupAt: null, sessionsSinceBackup: 0, installedAt: 77 }, dropped: 2 }, 'битые поля meta')
})

group('deserialize: повтор id результата теста выпадает и считается', () => {
  const st = fixtureState()
  const raw = clone(st) as unknown as { testResults: unknown[] }
  raw.testResults.push({ ...clone(st.testResults[0]), result: 1 })
  const r = deserialize(JSON.stringify(raw), NOW)
  assertEqual(r.state.testResults, st.testResults, 'первый остался')
  assertEqual(r.dropped, 1, 'повтор посчитан')
})

/* ---- черновик ---- */

function activeOf(over: Partial<ActiveSession> = {}): ActiveSession {
  const session = clone(fixtureState().sessions['s-strength'])
  delete session.endedAt
  delete session.health
  return {
    version: CURRENT_VERSION,
    session,
    currentItemId: 'i1',
    rest: { itemId: 'i1', startedAt: 100, endsAt: 190 },
    stopwatch: { itemId: 'i3', startedAt: 50, pausedAt: 60, pausedTotalMs: 5 },
    interval: { itemId: 'i2', startedAt: 10, pausedTotalMs: 0 },
    hold: { itemId: 'i3', stepIndex: 1, stepStartedAt: 10, stepEndsAt: 40, pausedAt: 20 },
    wakeLockWanted: true,
    ...over,
  }
}

group('deserializeActive: круг черновика тождественен', () => {
  const a = activeOf()
  const r = deserializeActive(serializeActive(a))
  assertEqual(r, { active: a, source: 'stored', dropped: 0 }, 'круг')
  assertEqual(serializeActive(r.active!), serializeActive(a), 'тот же текст')
})

group('deserializeActive: пусто, мусор, новая версия', () => {
  for (const t of [null, '', 'null']) assertEqual(deserializeActive(t), { active: null, source: 'default', dropped: 0 }, `пусто ${JSON.stringify(t)}`)
  for (const t of ['{', '[]', '5']) assertEqual(deserializeActive(t), { active: null, source: 'corrupt', dropped: 0 }, `мусор ${t}`)
  assertEqual(deserializeActive('{"version":1}'), { active: null, source: 'corrupt', dropped: 0 }, 'нет сессии')
  assertEqual(deserializeActive(JSON.stringify({ ...activeOf(), session: { id: 'x' } })).source, 'corrupt', 'битая сессия')
  assertEqual(deserializeActive(JSON.stringify({ ...activeOf(), version: 2 })), { active: null, source: 'newer-version', dropped: 0 }, 'новая версия')
})

group('deserializeActive: таймер на несуществующий элемент или битый снимается и считается', () => {
  const raw = {
    ...activeOf(),
    currentItemId: 'нет',
    rest: { itemId: 'нет', startedAt: 1, endsAt: 2 },
    stopwatch: { itemId: 'i1', startedAt: 50, pausedAt: 10, pausedTotalMs: 0 },
    interval: 'x',
    hold: { itemId: 'i3', stepIndex: 0, stepStartedAt: 10, stepEndsAt: 5 },
    wakeLockWanted: 'да',
  }
  const r = deserializeActive(JSON.stringify(raw))
  assertEqual(r.source, 'stored', 'черновик жив')
  assertEqual(r.dropped, 6, 'шесть снятых полей')
  assertEqual(r.active, { version: 1, session: activeOf().session, wakeLockWanted: false }, 'осталась сессия')
  const minimal = deserializeActive(JSON.stringify({ session: minimalSession() }))
  assertEqual(minimal, { active: { version: 1, session: minimalSession(), wakeLockWanted: false }, source: 'stored', dropped: 0 }, 'черновик без версии и таймеров')
})

group('deserializeActive: пауза удержания лежит внутри шага', () => {
  const holdWith = (extra: Record<string, unknown>) =>
    deserializeActive(JSON.stringify({ ...activeOf(), hold: { itemId: 'i3', stepIndex: 1, stepStartedAt: 10, stepEndsAt: 40, ...extra } }))
  assertEqual(holdWith({ pausedAt: 10 }).active?.hold?.pausedAt, 10, 'пауза на границе начала')
  assertEqual(holdWith({ pausedAt: 40 }).active?.hold?.pausedAt, 40, 'пауза на границе конца')
  for (const bad of [9, 41, '20', -1]) {
    const r = holdWith({ pausedAt: bad })
    assertEqual([r.active?.hold, r.dropped], [undefined, 1], `pausedAt ${String(bad)} снимает таймер и считается`)
  }
  assertEqual(holdWith({ paused: true }).active?.hold, { itemId: 'i3', stepIndex: 1, stepStartedAt: 10, stepEndsAt: 40 }, 'старое поле paused не переносится')
})

finish()
