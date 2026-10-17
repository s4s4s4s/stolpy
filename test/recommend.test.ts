import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  DAILY_LIGHT_PHASES, EVENING_HOUR, programToday, recentlyTrainedGroups, whatToday,
} from '../src/core/recommend.ts'
import type { ActiveProgram, WhatTodayInput } from '../src/core/recommend.ts'
import type { AppState, Program, ProgramPhase, ProgramProgress, Session, Template } from '../src/core/types.ts'
import {
  FRI, LIBRARY, MON, SAT, SUN, THU, TUE, WED, baseState, cardio, fullWeek, hold, intervals, session,
  stateOf, strength, template,
} from './_week-fixtures.ts'

/* Шаблоны: ротация силы A, B, C, по одному на остальные столпы. */
const STR_A = template('str-a', ['strength'], ['squat', 'lunge'])      // ноги, кор
const STR_B = template('str-b', ['strength'], ['row', 'bench'])        // спина, руки, грудь
const STR_C = template('str-c', ['strength'], ['squat', 'row'])        // ноги, спина, руки
const Z2 = template('z2', ['zone2'], ['z2-bike'], { place: 'any' })
const HIIT = template('hiit', ['intervals'], ['hiit'])
const MOB = template('mob', ['mobility'], ['stretch-hip'], { place: 'any' })
const BAL = template('bal', ['balance'], ['sls'], { place: 'any' })
const TEMPLATES: Template[] = [STR_A, STR_B, STR_C, Z2, HIIT, MOB, BAL]

function input(state: AppState, today: string, localHour = 10, extra: Partial<WhatTodayInput> = {}): WhatTodayInput {
  return { state, today, localHour, library: LIBRARY, templates: TEMPLATES, ...extra }
}

const ids = (r: ReturnType<typeof whatToday>) => [r.primary, ...r.alternatives].map(s => s.templateId ?? `${s.kind}:${s.pillar}`)

/* Три силовых дня по 14 подходов (понедельник, вторник, четверг): сила 42 из 50, дней 3. */
const strengthMostly = (): Session[] =>
  [MON, TUE, THU].map(d => session(d, [strength('squat', 7), strength('row', 7)]))

group('константы плана', () => {
  assertEqual(EVENING_HOUR, 20, 'вечер с 20:00')
  assertEqual(DAILY_LIGHT_PHASES, ['f0', 'f1', 'f2'], 'ежедневная мелочь в фазах f0-f2')
})

group('пустая неделя, понедельник: давление равное, сила первой, тяжёлый слот один', () => {
  const r = whatToday(input(baseState(), MON))
  assertEqual(r.daysLeft, 7, 'до воскресенья 7 дней')
  assertEqual(r.primary.kind, 'template', 'шаблон')
  assertEqual(r.primary.templateId, 'str-a', 'первая в ротации')
  assertEqual(r.primary.pillar, 'strength', 'сила')
  assertEqual(ids(r), ['str-a', 'z2', 'mob'], 'основная и две запасные: лёгкие столпы, интервалы отложены')
  assertEqual(r.primary.reason, 'Сила: осталось 50 подходов и 3 дня, до конца недели 7 дней.', 'причина для экрана')
  assertEqual(r.alternatives.length, 2, 'запасных не больше двух')
  assertEqual(r.dailyLight, null, 'без программы мелочи нет')
  assertEqual(r.programToday, null, 'без программы дня нет')
})

group('давление: больше всего не хватает - первым, с учётом дней до воскресенья', () => {
  const state = stateOf(...fullWeek(MON, ['zone2', 'strength']), ...strengthMostly())
  const r = whatToday(input(state, SAT))
  assertEqual(r.daysLeft, 2, 'суббота: 2 дня')
  assertEqual(r.primary.templateId, 'z2', 'зона 2 с полной нехваткой впереди силы с нехваткой 16 процентов')
  assertEqual(r.primary.reason, 'Зона 2: осталось 150 минут, до конца недели 2 дня.', 'причина')
  assertEqual(r.alternatives[0].pillar, 'strength', 'сила второй')
  assertEqual(r.alternatives[0].kind, 'template', 'шаблоном')
})

group('давление: последний день недели', () => {
  const state = stateOf(...fullWeek(MON, ['zone2']))
  const r = whatToday(input(state, SUN))
  assertEqual(r.daysLeft, 1, 'воскресенье: 1 день')
  assertEqual(r.primary.reason, 'Зона 2: осталось 150 минут, сегодня последний день недели.', 'причина')
})

group('давление: частичное выполнение сокращает остаток, нехватка по дням тоже считается', () => {
  const state = stateOf(...fullWeek(MON, ['zone2']), session(MON, [cardio(100)], { hour: 6 }))
  assertEqual(whatToday(input(state, SAT)).primary.reason, 'Зона 2: осталось 50 минут, до конца недели 2 дня.', 'остаток минут')
  const oneDay = stateOf(...fullWeek(MON, ['mobility']), session(MON, [hold('stretch-hip', [1800])]))
  const r = whatToday(input(oneDay, SAT))
  assertEqual(r.primary.pillar, 'mobility', 'минуты набраны, но дней 1 из 3')
  assertEqual(r.primary.reason, 'Мобильность: осталось 2 дня, до конца недели 2 дня.', 'нехватка только по дням')
})

group('один тяжёлый столп в день: побеждает больший недобор, второй переносится', () => {
  // интервалов нет совсем, сила почти набрана: интервалы тяжелее по давлению
  const intervalsFirst = stateOf(...fullWeek(MON, ['intervals', 'strength']), ...strengthMostly())
  const a = whatToday(input(intervalsFirst, SAT))
  assertEqual(a.primary.templateId, 'hiit', 'интервалы первыми')
  assertEqual(a.alternatives[0].kind, 'rest', 'сила перенесена')
  assertEqual(a.alternatives[0].pillar, 'strength', 'это сила')
  assert(a.alternatives[0].reason.includes('Силу лучше завтра'), 'текст про завтра')

  // силы совсем нет, интервальная сессия одна из двух
  const strengthFirst = stateOf(...fullWeek(MON, ['intervals', 'strength']), session(THU, [intervals(4)]))
  const b = whatToday(input(strengthFirst, SAT))
  assertEqual(b.primary.templateId, 'str-a', 'сила первой')
  assertEqual(b.alternatives[0].pillar, 'intervals', 'интервалы отложены')
  assertEqual(b.alternatives[0].kind, 'rest', 'как подсказка отдыха')
  assert(b.alternatives[0].reason.includes('Интервалы лучше завтра'), 'интервалы лучше завтра')
})

group('легкие столпы идут вместе с тяжёлым', () => {
  const r = whatToday(input(baseState(), MON))
  const pillars = [r.primary, ...r.alternatives].map(s => s.pillar)
  assert(pillars.includes('zone2') && pillars.includes('mobility'), 'зона 2 и мобильность рядом с силой')
})

group('тяжёлая нагрузка уже была сегодня: второй тяжёлой нет', () => {
  const state = stateOf(...fullWeek(MON, ['intervals', 'zone2']), session(SAT, [strength('bench', 8)], { hour: 8 }))
  const r = whatToday(input(state, SAT, 18))
  const intervalsNote = [r.primary, ...r.alternatives].find(s => s.pillar === 'intervals')
  assertEqual(intervalsNote?.kind, 'rest', 'интервалы не предлагаются')
  assert(intervalsNote!.reason.includes('завтра'), 'на завтра')
  assertEqual(r.primary.templateId, 'z2', 'остаётся зона 2')
})

group('восстановление: шаблон с занятыми группами пропускается, ротация идёт дальше', () => {
  // вчера 8 подходов на ноги: A (ноги, кор) заблокирован наполовину и больше, B свободен, C занят на треть
  const state = stateOf(...fullWeek(MON, ['strength']), session(FRI, [strength('squat', 8)]))
  const groups = recentlyTrainedGroups(state, SAT, LIBRARY)
  assertEqual([...groups], ['legs'], 'занята только группа ног')
  const r = whatToday(input(state, SAT, 10, { place: 'home' }))
  assertEqual(r.primary.templateId, 'str-b', 'A пропущен, B подходит')
})

group('восстановление: группа занята от шести подходов суммарно за вчера и сегодня', () => {
  const five = stateOf(session(FRI, [strength('squat', 5)]))
  assertEqual(recentlyTrainedGroups(five, SAT, LIBRARY).size, 0, 'пять - не занята')
  const split = stateOf(session(FRI, [strength('squat', 3)]), session(SAT, [strength('squat', 3)], { hour: 8 }))
  assertEqual([...recentlyTrainedGroups(split, SAT, LIBRARY)], ['legs'], '3 вчера + 3 сегодня')
  const old = stateOf(session(THU, [strength('squat', 9)]))
  assertEqual(recentlyTrainedGroups(old, SAT, LIBRARY).size, 0, 'позавчера не считается')
  const warm = stateOf(session(FRI, [strength('squat', 0, Array.from({ length: 8 }, () => ({ kind: 'warmup' as const, doneAt: 1 })))]))
  assertEqual(recentlyTrainedGroups(warm, SAT, LIBRARY).size, 0, 'разминки не нагрузка')
})

group('восстановление: все силовые шаблоны заняты - отдых вместо силы', () => {
  const state = stateOf(
    ...fullWeek(MON, ['strength']),
    session(FRI, [strength('squat', 6), strength('lunge', 6), strength('row', 6), strength('bench', 6)]),
  )
  const r = whatToday(input(state, SAT))
  assertEqual(r.primary.kind, 'rest', 'отдых')
  assertEqual(r.primary.pillar, 'strength', 'про силу')
  assert(r.primary.reason.includes('Отдых после вчерашнего'), 'вчерашнего')

  const today = stateOf(
    ...fullWeek(MON, ['strength']),
    session(SAT, [strength('squat', 6), strength('lunge', 6), strength('row', 6), strength('bench', 6)], { hour: 8 }),
  )
  assert(whatToday(input(today, SAT, 18)).primary.reason.includes('сегодняшней'), 'после сегодняшней')
})

group('восстановление: интервалы вчера блокируют интервалы', () => {
  const state = stateOf(...fullWeek(MON, ['intervals']), session(FRI, [intervals(4)]))
  const r = whatToday(input(state, SAT))
  assertEqual(r.primary.kind, 'rest', 'отдых')
  assertEqual(r.primary.pillar, 'intervals', 'про интервалы')
  assert(r.primary.reason.includes('вчера'), 'объяснение про вчера')
  const earlier = stateOf(...fullWeek(MON, ['intervals']), session(THU, [intervals(4)]))
  assertEqual(whatToday(input(earlier, SAT)).primary.templateId, 'hiit', 'позавчера - можно')
})

group('заблокированный столп уходит в конец списка, хотя давление у него больше', () => {
  // баланс: 20 минут из 30 и 3 дня (нехватка треть), интервалы: 1 сессия из 2 (нехватка половина), но были вчера
  const balance = [MON, WED, FRI].map(d => session(d, [hold('sls', [400])]))
  const state = stateOf(...fullWeek(MON, ['intervals', 'balance']), ...balance, session(FRI, [intervals(2)]))
  const r = whatToday(input(state, SAT))
  assertEqual(r.primary.pillar, 'balance', 'баланс первым')
  assertEqual(r.alternatives[0].pillar, 'intervals', 'интервалы следом')
  assertEqual(r.alternatives[0].kind, 'rest', 'как отдых')
})

group('вечер: после 20:00 интервалы не предлагаются', () => {
  const only = stateOf(...fullWeek(MON, ['intervals']))
  const evening = whatToday(input(only, SAT, 21))
  assertEqual(evening.primary.kind, 'rest', 'интервалы не предложены')
  assert(evening.primary.reason.includes('лучше завтра'), 'если зона 2 уже выполнена - лучше завтра')

  const withZone2 = stateOf(...fullWeek(MON, ['intervals', 'zone2']))
  const r = whatToday(input(withZone2, SAT, 21))
  assertEqual(r.primary.templateId, 'z2', 'зона 2 вместо интервалов')
  const note = r.alternatives.find(s => s.pillar === 'intervals')
  assert(note!.reason.includes('перед сном лучше зона 2'), 'причина про сон')

  assertEqual(whatToday(input(only, SAT, 19)).primary.templateId, 'hiit', '19:00 - ещё день')
  assertEqual(whatToday(input(only, SAT, 20)).primary.kind, 'rest', 'ровно 20:00 - уже вечер')
  assertEqual(whatToday(input(only, SAT, Number.NaN)).primary.templateId, 'hiit', 'мусорный час не вечер')
})

group('неделя закрыта: отдых', () => {
  const state = stateOf(...fullWeek(MON))
  const r = whatToday(input(state, SAT))
  assertEqual(r.primary.kind, 'rest', 'rest')
  assertEqual(r.primary.pillar, null, 'без столпа')
  assertEqual(r.primary.title, 'Неделя закрыта', 'заголовок')
  assertEqual(r.alternatives, [], 'запасных нет')
  assertEqual(r.summary.allDone, true, 'summary')
})

group('ротация A, B, C по давности использования', () => {
  const used = (id: string, date: string) => session(date, [strength('squat', 2)], { templateId: id })
  const pick = (...sessions: Session[]) => whatToday(input(stateOf(...sessions), MON, 10, { place: 'home' })).primary.templateId
  assertEqual(pick(), 'str-a', 'ничего не использовано - порядок входа')
  assertEqual(pick(used('str-a', '2026-09-28')), 'str-b', 'после A - B')
  assertEqual(pick(used('str-a', '2026-09-28'), used('str-b', '2026-10-01')), 'str-c', 'после A и B - C')
  assertEqual(pick(used('str-a', '2026-09-28'), used('str-b', '2026-10-01'), used('str-c', '2026-10-05')), 'str-a', 'круг замкнулся')
  assertEqual(pick(used('str-c', '2026-09-28'), used('str-b', '2026-10-01'), used('str-a', '2026-10-05')), 'str-c', 'самый давний первым')
})

group('место: фильтр по входу, по последней сессии и шаблоны any', () => {
  const gym = template('gym-str', ['strength'], ['squat'], { place: 'gym' })
  const list = [STR_A, gym, Z2]
  const base = (extra: Partial<WhatTodayInput>, state = baseState()) =>
    whatToday({ ...input(state, MON), templates: list, ...extra })
  assertEqual(base({ place: 'gym' }).primary.templateId, 'gym-str', 'явное место')
  assertEqual(base({ place: 'home' }).primary.templateId, 'str-a', 'дом')
  const lastGym = stateOf(session('2026-10-05', [strength('squat', 1)], { place: 'gym' }))
  assertEqual(base({}, lastGym).primary.templateId, 'gym-str', 'место последней сессии')
  assertEqual(base({ place: 'gym' }).alternatives[0].templateId, 'z2', 'шаблон any подходит везде')
  const lastHome = stateOf(
    session('2026-10-01', [strength('squat', 1)], { place: 'gym' }),
    session('2026-10-05', [strength('squat', 1)], { place: 'home' }),
  )
  assertEqual(base({}, lastHome).primary.templateId, 'str-a', 'последняя - дом')
})

group('шаблоны: главный столп предпочтительнее, excludeFromWeek не предлагается', () => {
  const mix = template('mix', ['strength', 'balance'], ['squat', 'sls'])
  const light = template('daily-light', ['strength'], ['squat'], { excludeFromWeek: true })
  const state = stateOf(...fullWeek(MON, ['balance']))
  const withBal = whatToday({ ...input(state, SAT), templates: [mix, BAL] })
  assertEqual(withBal.primary.templateId, 'bal', 'у bal баланс главный, хотя mix первый')
  const onlyMix = whatToday({ ...input(state, SAT), templates: [mix] })
  assertEqual(onlyMix.primary.templateId, 'mix', 'иного нет - подходит составной')
  const lightOnly = whatToday({ ...input(baseState(), MON), templates: [light, Z2] })
  assertEqual(lightOnly.primary.kind, 'external', 'ежедневная мелочь силой не считается: шаблона нет')
})

group('нет шаблона под столп - запись занятия вне приложения', () => {
  const r = whatToday({ ...input(stateOf(...fullWeek(MON, ['zone2'])), SAT), templates: [] })
  assertEqual(r.primary.kind, 'external', 'external')
  assertEqual(r.primary.pillar, 'zone2', 'зона 2')
  assertEqual(r.primary.templateId, undefined, 'шаблона нет')
})

/* ---- программа ---- */

function phase(id: string, extra: Partial<ProgramPhase> = {}): ProgramPhase {
  return {
    id, title: `Фаза ${id}`, weeks: [1, 3], goal: 'цель', idea: 'идея',
    days: [{ key: 'A', title: 'День A', items: [] }, { key: 'B', title: 'День B', items: [] }],
    rotation: ['A'], exit: [], ...extra,
  }
}

const PROGRAM: Program = {
  id: 'p', title: 'Программа', weeks: 56, trainingDaysPerWeek: 3, deloadEveryWeeks: 4,
  measurement: { exerciseId: 'pullup', everyDays: 14, rule: '' }, dailyLightTemplateId: 'daily-light',
  phases: [phase('f0'), phase('f1', { rotation: ['A', 'B'] }), phase('f3', { rotation: ['A'] })],
  checkpoints: [], rules: [], stagnation: [],
}

function active(progress: Partial<ProgramProgress> = {}, program: Program = PROGRAM): ActiveProgram {
  return {
    program,
    progress: {
      programId: 'p', startedOn: MON, trainingWeekdays: [0, 2, 4], phaseIndex: 0, phaseStartedWeek: 1,
      completedDays: [], measurements: [], ...progress,
    },
  }
}

const LIGHT = template('daily-light', ['strength'], ['squat'], { excludeFromWeek: true })

group('программа: день программы первой подсказкой, силовой слот занят', () => {
  const r = whatToday(input(baseState(), MON, 10, { program: active(), templates: [...TEMPLATES, LIGHT] }))
  assertEqual(r.primary.kind, 'program', 'программа')
  assertEqual(r.primary.title, 'День программы: неделя 1, день 1', 'заголовок')
  assertEqual(r.primary.programDayKey, 'A', 'ключ дня')
  assertEqual(r.primary.reason, 'День A, фаза «Фаза f0».', 'причина')
  assertEqual(r.programToday?.week, 1, 'неделя 1')
  assertEqual(ids(r), ['program:strength', 'z2', 'mob'], 'отдельного силового шаблона нет, интервалы отложены')
  const second = whatToday(input(baseState(), WED, 10, { program: active() }))
  assertEqual(second.primary.title, 'День программы: неделя 1, день 2', 'среда - второй день')
  assertEqual(whatToday(input(baseState(), FRI, 10, { program: active() })).programToday?.dayNumber, 3, 'пятница - третий')
})

group('программа: не тренировочный день, отмеченный день, остановка, срок', () => {
  assertEqual(programToday(active(), TUE), null, 'вторник не тренировочный')
  assertEqual(programToday(active({ completedDays: [{ date: MON, dayKey: 'A', sessionId: 's' }] }), MON), null, 'день уже отмечен')
  assertEqual(programToday(active({ stoppedAt: 1 }), MON), null, 'программа остановлена')
  assertEqual(programToday(active({ startedOn: '2026-10-19' }), MON), null, 'ещё не началась')
  assertEqual(programToday(active({ startedOn: '2025-01-06' }), MON), null, 'срок 56 недель вышел')
  assertEqual(programToday(active({ phaseIndex: 9 }), MON), null, 'нет такой фазы')
  assertEqual(programToday(null, MON), null, 'нет программы')
  assertEqual(programToday(undefined, MON), null, 'программа не передана')
  const noDay = { ...PROGRAM, phases: [phase('f0', { rotation: ['Z'] })] }
  assertEqual(programToday(active({}, noDay), MON), null, 'ключа дня нет в фазе')
  const empty = { ...PROGRAM, phases: [phase('f0', { rotation: [], days: [] })] }
  assertEqual(programToday(active({}, empty), MON), null, 'в фазе нет дней')
  const r = whatToday(input(baseState(), TUE, 10, { program: active() }))
  assert(r.primary.kind !== 'program', 'во вторник программы нет в подсказках')
})

group('программа: ротация дня продолжается сквозным счётчиком фазы', () => {
  const done = (...dates: string[]) => dates.map((date, i) => ({ date, dayKey: 'A', sessionId: `s${i}` }))
  const wed = '2026-10-14'   // среда недели 1 при старте 12 октября: тренировочный день
  const inF1 = (extra: Partial<ProgramProgress>) => programToday(active({ phaseIndex: 1, ...extra }), wed)
  assertEqual(inF1({})?.dayKey, 'A', 'ничего не сделано - A')
  assertEqual(inF1({ completedDays: done(MON) })?.dayKey, 'B', 'один день - B')
  assertEqual(inF1({ startedOn: '2026-10-05', completedDays: done('2026-10-05', MON) })?.dayKey, 'A', 'два дня - снова A')
  assertEqual(inF1({ phaseStartedWeek: 1, completedDays: done(MON) })?.weekInPhase, 1, 'неделя фазы')
  const wed2 = programToday(active({ phaseIndex: 1, phaseStartedWeek: 2, completedDays: done(MON) }), '2026-10-21')
  assertEqual(wed2?.dayKey, 'A', 'дни прошлой фазы (до недели 2) не считаются')
  assertEqual(wed2?.weekInPhase, 1, 'вторая сквозная неделя - первая недели фазы')
})

group('программа: разгрузочная неделя, неделя фазы', () => {
  const nov2 = '2026-11-02'   // неделя 4 от старта 12 октября
  const t = programToday(active({ phaseStartedWeek: 2 }), nov2)
  assertEqual(t?.week, 4, 'сквозная неделя 4')
  assertEqual(t?.weekInPhase, 3, 'неделя фазы 3')
  assertEqual(t?.deload, true, 'разгрузка')
  assertEqual(programToday(active(), '2026-10-26')?.deload, false, 'неделя 3 - обычная')
  const r = whatToday(input(baseState(), nov2, 10, { program: active() }))
  assert(r.primary.reason.endsWith('Разгрузочная неделя: подходов меньше.'), 'в причине про разгрузку')
  const noDeload = programToday(active({}, { ...PROGRAM, deloadEveryWeeks: 0 }), nov2)
  assertEqual(noDeload?.deload, false, 'разгрузки в программе нет')
})

group('ежедневная мелочь: фазы f0-f2, один раз в день', () => {
  const withLight = (progress: Partial<ProgramProgress>, state = baseState(), day = TUE, program = PROGRAM) =>
    whatToday(input(state, day, 10, { program: active(progress, program), templates: [...TEMPLATES, LIGHT] })).dailyLight
  const f0 = withLight({})
  assertEqual(f0?.kind, 'daily-light', 'f0')
  assertEqual(f0?.templateId, 'daily-light', 'шаблон мелочи')
  assertEqual(f0?.title, 'Шаблон daily-light', 'название из шаблона')
  assertEqual(withLight({ phaseIndex: 1 })?.kind, 'daily-light', 'f1')
  assertEqual(withLight({ phaseIndex: 2 }), null, 'f3 - без мелочи')
  assertEqual(withLight({ stoppedAt: 5 }), null, 'остановлена')
  const flagOff = { ...PROGRAM, phases: [phase('f0', { dailyLight: false })] }
  assertEqual(withLight({}, baseState(), TUE, flagOff), null, 'флаг фазы выключен')
  const flagOn = { ...PROGRAM, phases: [phase('f9', { dailyLight: true })] }
  assertEqual(withLight({}, baseState(), TUE, flagOn)?.kind, 'daily-light', 'флаг фазы включён')
  const done = stateOf(session(TUE, [strength('squat', 1)], { templateId: 'daily-light', excludeFromWeek: true }))
  assertEqual(withLight({}, done), null, 'сегодня уже записана')
  const yesterday = stateOf(session(MON, [strength('squat', 1)], { templateId: 'daily-light', excludeFromWeek: true }))
  assertEqual(withLight({}, yesterday)?.kind, 'daily-light', 'вчерашняя не мешает')
  assertEqual(whatToday(input(baseState(), TUE)).dailyLight, null, 'без программы - нет')
})

group('неделя закрыта, а день программы есть: программа первой, отдых запасным', () => {
  const state = stateOf(...fullWeek(MON))
  const r = whatToday(input(state, WED, 10, { program: active() }))
  assertEqual(r.primary.kind, 'program', 'программа')
  assertEqual(r.alternatives[0].kind, 'rest', 'неделя закрыта')
})

group('сессия, которую ещё не завершили, на рекомендации не влияет', () => {
  const state = stateOf(session(FRI, [strength('squat', 10)], { completed: false }))
  assertEqual(whatToday(input(state, SAT, 10, { place: 'home' })).primary.templateId, 'str-a', 'блокировки нет')
})

finish()
