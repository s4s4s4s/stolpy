import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  customProtocol, finishSession, itemFromExercise, logHold, logSet, newSession, saveAsTemplate, sessionFromTemplate,
  setRestSec, updateCardio, updateIntervals, updateSet,
} from '../src/core/session.ts'
import { completeProgramDay } from '../src/core/program.ts'
import { LOAD_MAX_KG, REST_MAX_SEC } from '../src/core/limits.ts'
import type {
  ActiveSession, AppState, CardioItem, Exercise, ExerciseLibrary, HoldItem, IdFactory, IntervalItem, IntervalProtocol,
  ProgramProgress, Session, StrengthItem,
} from '../src/core/types.ts'
import {
  CURRENT_VERSION, defaultState, deserialize, deserializeActive, sanitizeProgramProgress, serialize, serializeActive,
} from '../src/state/storage.ts'

/* Контракт ввода и хранения: всё, что приняли функции записи ядра
   (session.ts), переживает serialize -> deserialize без изменений и с
   dropped = 0. Иначе запись молча выпадает при следующей загрузке. */

function ex(partial: Partial<Exercise> & Pick<Exercise, 'id' | 'pillar' | 'input'>): Exercise {
  return { title: partial.id, equipment: ['bodyweight'], defaults: { sets: 3 }, technique: '-', ...partial }
}

const LIB: ExerciseLibrary = Object.fromEntries([
  ex({ id: 'bench', pillar: 'strength', input: 'weight-reps', defaults: { sets: 3, reps: [5, 8] } }),
  ex({ id: 'plank', pillar: 'strength', input: 'time', defaults: { sets: 3, seconds: [20, 30] } }),
  ex({ id: 'stance', pillar: 'balance', input: 'time-side', defaults: { sets: 2, seconds: [30, 30], perSide: true } }),
  ex({ id: 'bike', pillar: 'zone2', input: 'distance-time', cardioMode: 'bike', defaults: { sets: 1, minutes: 45 } }),
  ex({ id: 'hiit', pillar: 'intervals', input: 'time', cardioMode: 'bike', defaults: { sets: 1, protocolId: 'tabata' } }),
].map(e => [e.id, e]))

const PROTOCOLS: IntervalProtocol[] = [
  { id: 'tabata', title: 'Табата', workSec: 20, restSec: 10, rounds: 8, warmupSec: 300, cooldownSec: 180, note: '', source: 'test' },
  { id: 'custom', title: 'Свой', workSec: 30, restSec: 30, rounds: 8, warmupSec: 0, cooldownSec: 0, note: '', source: 'test' },
]

const T0 = new Date(2026, 9, 14, 18, 0, 0).getTime()

function counter(): IdFactory {
  let n = 0
  return prefix => `${prefix}-${++n}`
}

function throwsRange(fn: () => unknown): boolean {
  try {
    fn()
    return false
  } catch (e) {
    return e instanceof RangeError
  }
}

function itemOf<T extends Session['items'][number]['type']>(s: Session, id: string, type: T): Extract<Session['items'][number], { type: T }> {
  const item = s.items.find(i => i.id === id)
  assert(item !== undefined && item.type === type, `элемент ${id} типа ${type}`)
  return item as Extract<Session['items'][number], { type: T }>
}

/* Сессия со значениями, на которых разбор раньше ронял записи: дробные
   секунды подхода, удержания и кардио, дробный отдых, дробный пульс, отдых
   и вес на верхней границе. */
function edgeSession(): { session: Session; ids: Record<'bench' | 'plank' | 'stance' | 'bike' | 'hiit', string> } {
  const next = counter()
  let s = newSession({ place: 'home', title: 'Граница', now: T0, ids: next })
  const add = (id: string) => {
    const item = itemFromExercise(LIB[id], PROTOCOLS, next)
    s = { ...s, items: [...s.items, item] }
    return item.id
  }
  const ids = { bench: add('bench'), plank: add('plank'), stance: add('stance'), bike: add('bike'), hiit: add('hiit') }
  s = logSet(s, ids.bench, { kind: 'work', weightKg: 62.5, reps: 5, rir: 2 }, T0 + 60_000)
  s = logSet(s, ids.bench, { kind: 'work', weightKg: LOAD_MAX_KG, reps: 1 }, T0 + 120_000)
  s = setRestSec(s, ids.bench, 90.5)
  s = logSet(s, ids.plank, { kind: 'work', seconds: 45.5 }, T0 + 180_000)
  s = setRestSec(s, ids.plank, REST_MAX_SEC)
  s = logHold(s, ids.stance, { seconds: 12.5, side: 'left' }, T0 + 240_000)
  s = logHold(s, ids.stance, { seconds: 30, side: 'right', eyesClosed: true }, T0 + 270_000)
  s = updateCardio(s, ids.bike, { durationSec: 1800.5, distanceKm: 5.25, avgHr: 141.6, talkTest: true })
  s = updateIntervals(s, ids.hiit, {
    protocol: customProtocol({ workSec: 40, restSec: 20, rounds: 6, warmupSec: 120, cooldownSec: 60 }),
    roundsDone: 6,
    peakHr: 171.4,
  })
  return { session: s, ids }
}

group('ввод приводит измеренное к точности хранения', () => {
  const { session: s, ids } = edgeSession()
  assertEqual(itemOf(s, ids.plank, 'strength').sets[0].seconds, 46, 'секунды подхода целые')
  assertEqual(itemOf(s, ids.bench, 'strength').restSec, 91, 'отдых целый')
  assertEqual(itemOf(s, ids.plank, 'strength').restSec, REST_MAX_SEC, 'отдых на верхней границе')
  assertEqual(itemOf(s, ids.stance, 'hold').holds.map(h => h.seconds), [13, 30], 'секунды удержания целые')
  const bike = itemOf(s, ids.bike, 'cardio')
  assertEqual([bike.durationSec, bike.avgHr, bike.distanceKm], [1801, 142, 5.25], 'кардио: секунды и пульс целые, дистанция как есть')
  assertEqual(itemOf(s, ids.hiit, 'intervals').peakHr, 171, 'пиковый пульс целый')
  const edited = updateSet(s, ids.plank, 0, { seconds: 50.4 })
  assertEqual(itemOf(edited, ids.plank, 'strength').sets[0].seconds, 50, 'правка подхода округляет так же')
  const cleared = updateCardio(s, ids.bike, { avgHr: undefined })
  assert(!('avgHr' in itemOf(cleared, ids.bike, 'cardio')), 'undefined по-прежнему стирает пульс')
})

group('ввод отклоняет то, что разбор не примет', () => {
  const { session: s, ids } = edgeSession()
  assert(throwsRange(() => logSet(s, ids.bench, { kind: 'work', weightKg: LOAD_MAX_KG + 1, reps: 1 }, T0)), 'вес больше предела')
  assert(throwsRange(() => logSet(s, ids.bench, { kind: 'work', weightKg: 60, assistKg: 1200, reps: 1 }, T0)), 'помощь больше предела')
  assert(throwsRange(() => setRestSec(s, ids.bench, REST_MAX_SEC + 1)), 'отдых больше часа')
  assert(throwsRange(() => setRestSec(s, ids.bench, 4000)), 'отдых 4000 с')
  assert(throwsRange(() => logHold(s, ids.stance, { seconds: 0.3, side: 'left' }, T0)), 'удержание меньше секунды')
  assert(throwsRange(() => logSet(s, ids.bench, { kind: 'work', reps: 5 }, -1)), 'время подхода до эпохи')
  assert(throwsRange(() => newSession({ place: 'home', title: 'x', now: -5, ids: counter() })), 'время начала до эпохи')
  assert(throwsRange(() => updateIntervals(s, ids.hiit, { protocol: { ...PROTOCOLS[0], workSec: 20.5 } })), 'дробный снимок протокола')
  assert(throwsRange(() => updateIntervals(s, ids.hiit, { protocol: { ...PROTOCOLS[0], rounds: 0 } })), 'протокол без раундов')
})

group('контракт: идущая тренировка (черновик) переживает запись и чтение', () => {
  const { session: s } = edgeSession()
  const active: ActiveSession = { version: CURRENT_VERSION, session: s, wakeLockWanted: true }
  const loaded = deserializeActive(serializeActive(active))
  assertEqual(loaded.source, 'stored', 'черновик прочитан')
  assertEqual(loaded.dropped, 0, 'ничего не выпало')
  assertEqual(loaded.active, active, 'черновик без изменений')
})

group('контракт: завершённая тренировка в состоянии переживает запись и чтение', () => {
  const { session: s } = edgeSession()
  const done = finishSession(s, T0 + 50 * 60_000)
  const state: AppState = { ...defaultState(T0), sessions: { [done.id]: done } }
  const loaded = deserialize(serialize(state), T0 + 60 * 60_000)
  assertEqual(loaded.source, 'stored', 'состояние прочитано')
  assertEqual(loaded.dropped, 0, 'ничего не выпало')
  assertEqual(loaded.state.sessions[done.id], done, 'тренировка без изменений')
  const items = loaded.state.sessions[done.id].items
  assertEqual(items.length, 5, 'все пять элементов на месте')
  assertEqual((items[0] as StrengthItem).sets.length, 2, 'подходы жима на месте')
  assertEqual((items[2] as HoldItem).holds.length, 2, 'удержания на месте')
  assertEqual((items[3] as CardioItem).distanceKm, 5.25, 'кардио с дистанцией на месте')
  assertEqual((items[4] as IntervalItem).protocol.workSec, 40, 'свой протокол на месте')
})

group('свой протокол: шаблон из тренировки хранит значения и запускает их', () => {
  const { session: s } = edgeSession()
  const done = finishSession(s, T0 + 50 * 60_000)
  const tpl = saveAsTemplate(done, LIB, 'Свой HIIT', T0 + 51 * 60_000, counter())
  assert(tpl !== null, 'шаблон создан')
  const hiitSpec = tpl.items.find(i => i.exerciseId === 'hiit')
  assertEqual(hiitSpec, {
    exerciseId: 'hiit', protocolId: 'custom',
    customProtocol: { workSec: 40, restSec: 20, rounds: 6, warmupSec: 120, cooldownSec: 60 },
  }, 'значения своего протокола в строке шаблона')

  const state: AppState = { ...defaultState(T0), customTemplates: { [tpl.id]: tpl } }
  const loaded = deserialize(serialize(state), T0)
  assertEqual(loaded.dropped, 0, 'шаблон прочитан без потерь')
  assertEqual(loaded.state.customTemplates[tpl.id], tpl, 'шаблон без изменений')

  const again = sessionFromTemplate(loaded.state.customTemplates[tpl.id], LIB, PROTOCOLS, T0 + 86_400_000, counter())
  const hiit = again.items.find(i => i.type === 'intervals') as IntervalItem
  assertEqual(
    [hiit.protocol.id, hiit.protocol.workSec, hiit.protocol.restSec, hiit.protocol.rounds, hiit.protocol.warmupSec, hiit.protocol.cooldownSec],
    ['custom', 40, 20, 6, 120, 60],
    'запуск шаблона берёт сохранённые 40/20 x 6, а не стартовые 30/30 x 8',
  )

  const library = saveAsTemplate(finishSession(updateIntervals(s, s.items[4].id, { protocol: PROTOCOLS[0], roundsDone: 4 }), T0 + 60_000), LIB, 'Т', T0, counter())
  assertEqual(library?.items.find(i => i.exerciseId === 'hiit'), { exerciseId: 'hiit', protocolId: 'tabata' }, 'протокол из библиотеки - только id')

  const broken = { ...tpl, items: tpl.items.map(i => (i.exerciseId === 'hiit' ? { ...i, customProtocol: { ...i.customProtocol, rounds: 99 } } : i)) }
  const brokenLoaded = deserialize(serialize({ ...defaultState(T0), customTemplates: { [tpl.id]: broken } } as AppState), T0)
  assertEqual(brokenLoaded.dropped, 1, 'свой протокол вне пределов - битая строка шаблона')
})

group('программа: фаза выполненного дня переживает запись и чтение', () => {
  let p: ProgramProgress = {
    programId: 'muscleup', startedOn: '2026-10-12', trainingWeekdays: [0, 2, 4], phaseIndex: 0, phaseStartedWeek: 1,
    completedDays: [], measurements: [],
  }
  p = completeProgramDay(p, { date: '2026-10-12', dayKey: 'A', sessionId: 's1' })
  const sanitized = sanitizeProgramProgress(JSON.parse(JSON.stringify(p)))
  assertEqual(sanitized.dropped, 0, 'ничего не выпало')
  assertEqual(sanitized.value?.completedDays, [{ date: '2026-10-12', dayKey: 'A', sessionId: 's1', phaseIndex: 0 }], 'phaseIndex сохранён')
  const legacy = sanitizeProgramProgress({ ...p, completedDays: [{ date: '2026-10-12', dayKey: 'A', sessionId: 's1' }] })
  assertEqual(legacy.value?.completedDays, [{ date: '2026-10-12', dayKey: 'A', sessionId: 's1' }], 'запись без phaseIndex читается как есть')
  const bad = sanitizeProgramProgress({ ...p, completedDays: [{ date: '2026-10-12', dayKey: 'A', sessionId: 's1', phaseIndex: -1 }] })
  assertEqual([bad.value?.completedDays.length, bad.dropped], [0, 1], 'битый phaseIndex - запись выпадает и считается')
})

finish()
