import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  DAY_MIN_MINUTES, DEFAULT_WEEK_GOALS, WEEK_MINIMUMS, dayLoad, isWorkingSet, mobilityByZone, pillarDeficit,
  pillarProgress, strengthDays, weekHistory, weekProgress, workingSetsByGroup,
} from '../src/core/week.ts'
import type { AppState, Exercise, Pillar, WeeklyGoals } from '../src/core/types.ts'
import {
  FRI, LIBRARY, MON, NEXT_MON, PREV_SUN, PROTOCOL_8X20, SAT, SUN, THU, TUE, WED,
  baseState, cardio, external, hold, intervals, session, stateOf, strength, warmup, work,
} from './_week-fixtures.ts'

const week = (state: AppState, start = MON) => weekProgress(state, start, undefined, LIBRARY)
const one = (state: AppState, pillar: Pillar) => week(state).pillars[pillar]

group('WEEK_MINIMUMS и умолчания: числа плана', () => {
  assertEqual(WEEK_MINIMUMS, {
    strengthSets: 20, strengthDays: 2, zone2Minutes: 90, intervalSessions: 1, mobilityMinutes: 10, balanceMinutes: 10,
  }, 'минимумы зачёта')
  assertEqual(DEFAULT_WEEK_GOALS.strengthSets, 50, 'сила 50')
  assertEqual(DEFAULT_WEEK_GOALS.zone2Minutes, 150, 'зона 2 150')
  assertEqual(DAY_MIN_MINUTES, 5, 'день от 5 минут')
})

group('пустое состояние: все столпы по нулям, неделя не выполнена', () => {
  const w = week(baseState())
  assertEqual(w.weekStart, MON, 'weekStart')
  assertEqual(w.allDone, false, 'allDone')
  for (const p of ['strength', 'zone2', 'intervals', 'mobility', 'balance'] as const) {
    assertEqual(w.pillars[p].value, 0, `${p}: значение 0`)
    assertEqual(w.pillars[p].ratio, 0, `${p}: доля 0`)
    assertEqual(w.pillars[p].done, false, `${p}: не выполнен`)
    assertEqual(w.pillars[p].reachedMinimum, false, `${p}: минимум не достигнут`)
  }
  assertEqual(w.pillars.strength.unit, 'sets', 'единица силы')
  assertEqual(w.pillars.zone2.unit, 'minutes', 'единица зоны 2')
  assertEqual(w.pillars.intervals.unit, 'sessions', 'единица интервалов')
})

group('сила: разминки не в счёт', () => {
  const s = session(MON, [strength('squat', 0, [warmup(), warmup(), work(2), work(2)])])
  const p = one(stateOf(s), 'strength')
  assertEqual(p.value, 2, 'только два рабочих')
})

group('сила: RIR больше 3 не в счёт, 3 и пустой в счёт', () => {
  const sets = [work(0), work(3), work(4), work(5), work(), work(1, 'failure')]
  const p = one(stateOf(session(MON, [strength('squat', 0, sets)])), 'strength')
  assertEqual(p.value, 4, 'RIR 0, 3, пустой и отказ; RIR 4 и 5 мимо')
  assert(isWorkingSet(work(3)), 'RIR 3 рабочий')
  assert(!isWorkingSet(work(4)), 'RIR 4 не рабочий')
  assert(!isWorkingSet(warmup()), 'разминка не рабочая')
  assert(isWorkingSet({ kind: 'failure', doneAt: 1, rir: 0 }), 'отказ рабочий')
  assert(isWorkingSet({ kind: 'work', doneAt: 1, rir: Number.NaN }), 'мусорный RIR не выбрасывает подход')
})

group('сила: подход идёт в каждую группу упражнения, а итог не умножается', () => {
  const s = session(MON, [strength('bench', 3), strength('squat', 2), strength('lunge', 1)])
  const state = stateOf(s)
  assertEqual(one(state, 'strength').value, 6, 'шесть подходов')
  assertEqual(workingSetsByGroup(state, MON, LIBRARY), {
    legs: 3, back: 0, 'chest-shoulders': 3, arms: 3, core: 1,
  }, 'по группам: bench=грудь+руки, squat=ноги, lunge=ноги+кор')
})

group('сила: неизвестное упражнение считается силой без групп', () => {
  const state = stateOf(session(MON, [strength('mystery', 4)]))
  assertEqual(one(state, 'strength').value, 4, 'подходы в зачёте')
  assertEqual(Object.values(workingSetsByGroup(state, MON, LIBRARY)).reduce((a, b) => a + b, 0), 0, 'групп нет')
})

group('сила: свои упражнения берутся из state.customExercises', () => {
  const custom: Exercise = {
    id: 'my-curl', title: 'Сгибания', pillar: 'strength', groups: ['arms'], equipment: ['dumbbells'],
    input: 'reps', defaults: { sets: 3 }, technique: 'техника', custom: true,
  }
  const state = stateOf(session(MON, [strength('my-curl', 3)]))
  state.customExercises['my-curl'] = custom
  assertEqual(workingSetsByGroup(state, MON, LIBRARY).arms, 3, 'подходы в руки')
})

group('сила: силовой день от шести подходов, сумма по дате', () => {
  const five = stateOf(session(MON, [strength('squat', 5)]))
  assertEqual(strengthDays(five, MON, LIBRARY), 0, 'пять подходов - не день')
  const six = stateOf(session(MON, [strength('squat', 6)]))
  assertEqual(strengthDays(six, MON, LIBRARY), 1, 'шесть - день')
  const split = stateOf(session(MON, [strength('squat', 3)], { hour: 8 }), session(MON, [strength('row', 3)], { hour: 19 }))
  assertEqual(strengthDays(split, MON, LIBRARY), 1, 'две сессии одной даты складываются')
  const spread = stateOf(session(MON, [strength('squat', 4)]), session(TUE, [strength('squat', 4)]))
  assertEqual(strengthDays(spread, MON, LIBRARY), 0, 'по четыре на разные даты - дней нет')
  const nonCounted = stateOf(session(MON, [strength('squat', 4, [warmup(), warmup(), work(5), work(5), work(2), work(2), work(2)])]))
  assertEqual(strengthDays(nonCounted, MON, LIBRARY), 0, 'разминки и RIR 5 день не делают (три рабочих)')
})

group('сила: выполнен только при подходах и днях одновременно', () => {
  const day = (d: string) => session(d, [strength('squat', 9), strength('row', 9)])
  const full = stateOf(day(MON), day(WED), day(FRI))
  const p = one(full, 'strength')
  assertEqual(p.value, 54, 'подходов 54')
  assertEqual(p.secondary, { value: 3, target: 3 }, 'три дня')
  assertEqual(p.done, true, 'выполнен')
  assertEqual(p.detail, 'силовых дней: 3 из 3', 'подпись')

  const twoDays = stateOf(session(MON, [strength('squat', 13), strength('row', 12)]), session(WED, [strength('squat', 13), strength('row', 12)]))
  const q = one(twoDays, 'strength')
  assertEqual(q.value, 50, 'подходов 50')
  assertEqual(q.ratio, 1, 'доля 1')
  assertEqual(q.secondary?.value, 2, 'дней 2')
  assertEqual(q.done, false, 'без третьего дня не выполнен')
  assertEqual(pillarDeficit(q), 1 / 3, 'нехватка по дням')
})

group('сила: минимум зачёта 20 подходов', () => {
  assertEqual(one(stateOf(session(MON, [strength('squat', 19)])), 'strength').reachedMinimum, false, '19 - ниже')
  const p = one(stateOf(session(MON, [strength('squat', 20)])), 'strength')
  assertEqual(p.reachedMinimum, true, '20 - есть')
  assertEqual(p.minimum, 20, 'отметка 20')
  assertEqual(p.ratio, 0.4, 'доля 20/50')
})

group('сила: внешние минуты силы в шкалу не идут', () => {
  const state = stateOf(session(MON, [external(60, { strength: 60 })]))
  assertEqual(one(state, 'strength').value, 0, 'сила нулевая')
  assertEqual(one(state, 'zone2').value, 0, 'зона 2 нулевая')
})

group('только завершённые сессии', () => {
  const running = session(MON, [strength('squat', 10)], { completed: false })
  assertEqual(one(stateOf(running), 'strength').value, 0, 'идущая не считается')
  assertEqual(strengthDays(stateOf(running), MON, LIBRARY), 0, 'и силовых дней нет')
  assertEqual(dayLoad(stateOf(running), MON, LIBRARY).workingSets, 0, 'и нагрузки дня нет')
})

group('excludeFromWeek: сессия не идёт ни в один столп', () => {
  const light = session(MON, [
    strength('squat', 10), cardio(60), intervals(4), hold('stretch-hip', [300]), external(30, { zone2: 30 }),
  ], { excludeFromWeek: true })
  const w = week(stateOf(light))
  for (const p of ['strength', 'zone2', 'intervals', 'mobility', 'balance'] as const) {
    assertEqual(w.pillars[p].value, 0, `${p}: пусто`)
  }
})

group('неделя определяется по session.date, а не по времени завершения', () => {
  // начата в воскресенье поздно вечером, закончена в понедельник
  const late = session(SUN, [strength('squat', 7)], { hour: 23, endedAt: Date.parse(`${NEXT_MON}T01:00:00Z`) })
  const state = stateOf(late)
  assertEqual(week(state, MON).pillars.strength.value, 7, 'остаётся в своей неделе')
  assertEqual(week(state, NEXT_MON).pillars.strength.value, 0, 'в следующую не попала')
})

group('границы недели: воскресенье - последний день, понедельник - первый', () => {
  const state = stateOf(
    session(PREV_SUN, [strength('squat', 6)]),
    session(MON, [strength('squat', 1)]),
    session(SUN, [strength('squat', 2)]),
    session(NEXT_MON, [strength('squat', 4)]),
  )
  assertEqual(week(state, MON).pillars.strength.value, 3, 'неделя 12-18: понедельник и воскресенье')
  assertEqual(week(state, PREV_SUN).weekStart, '2026-10-05', 'любая дата приводится к понедельнику')
  assertEqual(week(state, PREV_SUN).pillars.strength.value, 6, 'прошлое воскресенье - в прошлой неделе')
  assertEqual(week(state, WED).weekStart, MON, 'среда -> понедельник')
})

group('мусор в сессиях не роняет подсчёт', () => {
  const state = stateOf(session(MON, [strength('squat', 2)]))
  state.sessions['bad-date'] = { ...session(MON, [strength('squat', 5)]), id: 'bad-date', date: 'вчера' }
  state.sessions['no-items'] = { ...session(MON, []), id: 'no-items', items: undefined as never }
  state.sessions['nullish'] = null as never
  assertEqual(one(state, 'strength').value, 2, 'считаются только валидные')
})

group('зона 2: минуты кардио плюс внешние минуты, округление после суммы', () => {
  const state = stateOf(
    session(MON, [cardio(100)]),
    session(TUE, [external(60, { zone2: 30, strength: 30 }), external(30, { zone2: 20 })]),
  )
  const p = one(state, 'zone2')
  assertEqual(p.value, 150, '100 + 30 + 20')
  assertEqual(p.done, true, 'цель 150 достигнута')
  assertEqual(p.ratio, 1, 'доля 1')
  assertEqual(p.detail, '2 тренировки', 'две сессии с зоной 2')

  const frac = stateOf(session(MON, [cardio(10.4)]), session(TUE, [cardio(10.4)]))
  assertEqual(one(frac, 'zone2').value, 21, '10.4 + 10.4 = 20.8 -> 21, а не 10 + 10')
  const below = stateOf(session(MON, [{ ...cardio(0), durationSec: 149.4 * 60 }]))
  assertEqual(one(below, 'zone2').done, false, '149.4 -> 149 ниже цели')
})

group('зона 2: минимум 90, мусорные и отрицательные длительности игнорируются', () => {
  assertEqual(one(stateOf(session(MON, [cardio(89)])), 'zone2').reachedMinimum, false, '89')
  assertEqual(one(stateOf(session(MON, [cardio(90)])), 'zone2').reachedMinimum, true, '90')
  const junk = stateOf(session(MON, [
    { ...cardio(0), durationSec: Number.NaN }, { ...cardio(0), durationSec: -600 }, cardio(10),
  ]))
  assertEqual(one(junk, 'zone2').value, 10, 'считается только валидное')
  assertEqual(one(stateOf(session(MON, [cardio(0)])), 'zone2').detail, '0 тренировок', 'нулевая запись не сессия')
})

group('интервалы: сессия при roundsDone не меньше половины раундов', () => {
  const rounds = (n: number) => one(stateOf(session(MON, [intervals(n)])), 'intervals').value
  assertEqual(rounds(1), 0, '1 из 4 - нет')
  assertEqual(rounds(2), 1, '2 из 4 - да')
  assertEqual(rounds(4), 1, '4 из 4 - да')
  const odd = (n: number) => one(stateOf(session(MON, [intervals(n, { ...PROTOCOL_8X20, rounds: 5 })])), 'intervals').value
  assertEqual(odd(2), 0, '2 из 5 - нет (нужно 3)')
  assertEqual(odd(3), 1, '3 из 5 - да')
  assertEqual(rounds(0), 0, 'ноль раундов не сессия')
  const zeroRounds = one(stateOf(session(MON, [intervals(0, { ...PROTOCOL_8X20, rounds: 0 })])), 'intervals').value
  assertEqual(zeroRounds, 0, 'протокол без раундов не даёт сессию даром')
})

group('интервалы: тяжёлые минуты и внешние занятия', () => {
  const state = stateOf(
    session(MON, [intervals(2)]),                                  // 2 x 240 с = 8 мин
    session(TUE, [intervals(4, PROTOCOL_8X20)]),                   // 4 x 20 с = 1,33 -> 1.3
    session(WED, [external(40, { intervals: 10, strength: 30 })]), // 10 мин и ровно порог: сессия
    session(THU, [external(40, { intervals: 9 })]),                // 9 мин: порог не взят, минуты есть
  )
  const p = one(state, 'intervals')
  assertEqual(p.value, 3, 'сессии: 4x4, 4 из 8, внешнее 10 мин')
  assertEqual(p.secondary?.value, 28.3, 'тяжёлые минуты 8 + 1.3 + 10 + 9')
  assertEqual(p.secondary?.target, 32, 'справочная цель 32')
  assertEqual(p.detail, 'тяжёлых минут: 28.3 из 32', 'подпись')
})

group('интервалы: выполнены по сессиям, тяжёлые минуты шкалу не держат', () => {
  const state = stateOf(session(MON, [intervals(2)]), session(WED, [intervals(2)]))
  const p = one(state, 'intervals')
  assertEqual(p.value, 2, 'две сессии')
  assertEqual(p.done, true, 'выполнен при 16 тяжёлых минутах из 32')
  assertEqual(one(stateOf(session(MON, [intervals(4)])), 'intervals').reachedMinimum, true, 'одна сессия - минимум')
  assertEqual(pillarDeficit(p), 0, 'нехватки нет')
})

group('мобильность: удержания, внешние минуты, дни от пяти минут', () => {
  const state = stateOf(
    session(MON, [hold('stretch-hip', [60, 60, 60]), hold('stretch-ham', [90])]),   // 4,5 мин
    session(TUE, [hold('cat-cow', [300]), external(20, { mobility: 10 })]),          // 15 мин
  )
  const p = one(state, 'mobility')
  assertEqual(p.value, 20, '4,5 + 15 = 19,5 -> 20')
  assertEqual(p.secondary, { value: 1, target: 3 }, 'день один: понедельник 4,5 мин ниже порога')
  assertEqual(p.done, false, 'минуты 20 из 30 и дней 1 из 3')
  assertEqual(p.detail, 'дней: 1 из 3', 'подпись')
})

group('мобильность: ровно пять минут - день, 4:59 - нет', () => {
  const enough = stateOf(session(MON, [hold('stretch-hip', [300])]))
  assertEqual(one(enough, 'mobility').secondary?.value, 1, '300 с')
  const short = stateOf(session(MON, [hold('stretch-hip', [299])]))
  assertEqual(one(short, 'mobility').secondary?.value, 0, '299 с')
  const twoSessions = stateOf(session(MON, [hold('stretch-hip', [150])], { hour: 8 }), session(MON, [hold('stretch-ham', [150])], { hour: 20 }))
  assertEqual(one(twoSessions, 'mobility').secondary?.value, 1, 'две сессии за день складываются')
})

group('мобильность: выполнена при 30 минутах и трёх днях; минимум 10', () => {
  const d = (date: string) => session(date, [hold('stretch-hip', [600])])
  const full = stateOf(d(MON), d(WED), d(FRI))
  assertEqual(one(full, 'mobility').done, true, '30 минут за три дня')
  const oneDay = stateOf(session(MON, [hold('stretch-hip', [1800])]))
  const p = one(oneDay, 'mobility')
  assertEqual(p.value, 30, '30 минут за один день')
  assertEqual(p.done, false, 'дней мало')
  assertEqual(p.reachedMinimum, true, 'минимум есть')
  assertEqual(one(stateOf(session(MON, [hold('stretch-hip', [540])])), 'mobility').reachedMinimum, false, '9 минут')
})

group('мобильность по зонам и удержание неизвестного упражнения', () => {
  const state = stateOf(session(MON, [
    hold('stretch-hip', [600]), hold('stretch-ham', [300]), hold('cat-cow', [120]), hold('unknown', [600]),
  ]))
  assertEqual(mobilityByZone(state, MON, LIBRARY), { hips: 10, spine: 2, ankles: 0, hamstrings: 5, shoulders: 0 }, 'минуты по зонам')
  assertEqual(one(state, 'mobility').value, 17, 'неизвестное удержание в столп не идёт')
  assertEqual(one(state, 'balance').value, 0, 'и в баланс тоже')
})

group('мобильность записана подходами: считаются секунды рабочих подходов', () => {
  const lib = { ...LIBRARY, 'wall-slide': { ...LIBRARY['cat-cow'], id: 'wall-slide', zone: 'shoulders' as const } }
  const sets = [warmup(), { kind: 'work' as const, seconds: 120, doneAt: 1 }]
  sets[0] = { kind: 'warmup', seconds: 600, doneAt: 1 }
  const item = strength('wall-slide', 0, sets)
  const w = weekProgress(stateOf(session(MON, [item])), MON, undefined, lib)
  assertEqual(w.pillars.mobility.value, 2, 'разминка не в счёт, 120 с = 2 мин')
  assertEqual(w.pillars.strength.value, 0, 'силе ничего')
})

group('баланс: минуты, дни, лучшая стойка, внешние минуты', () => {
  const state = stateOf(
    session(MON, [hold('sls', [30, 45, 30, 30])]),                           // 2,25 мин
    session(TUE, [hold('sls', [300]), external(30, { balance: 10 })]),       // 15 мин
  )
  const p = one(state, 'balance')
  assertEqual(p.value, 17, '2,25 + 15 = 17,25 -> 17')
  assertEqual(p.secondary, { value: 1, target: 3 }, 'только вторник от пяти минут')
  assertEqual(p.detail, 'дней: 1 из 3, лучшая стойка 300 с', 'лучшая стойка')
  assertEqual(p.reachedMinimum, true, 'минимум 10')
  assertEqual(p.done, false, 'не выполнен')
  assertEqual(one(baseState(), 'balance').detail, 'дней: 0 из 3', 'пустая неделя: без стойки')
})

group('цели из настроек и защита от мусора', () => {
  const state = stateOf(session(MON, [cardio(60)]))
  const goals: WeeklyGoals = { ...DEFAULT_WEEK_GOALS, zone2Minutes: 60 }
  const p = weekProgress(state, MON, { goals }, LIBRARY).pillars.zone2
  assertEqual(p.target, 60, 'цель из аргумента')
  assertEqual(p.done, true, 'выполнено по своей цели')

  state.settings.goals = { ...DEFAULT_WEEK_GOALS, zone2Minutes: 30 }
  assertEqual(weekProgress(state, MON, undefined, LIBRARY).pillars.zone2.target, 30, 'без аргумента - state.settings')

  const garbage = { goals: { ...DEFAULT_WEEK_GOALS, zone2Minutes: Number.NaN, strengthSets: -5, mobilityDays: Number.NaN } }
  const g = weekProgress(state, MON, garbage, LIBRARY)
  assertEqual(g.pillars.zone2.target, 150, 'NaN -> умолчание')
  assertEqual(g.pillars.strength.target, 50, 'отрицательное -> умолчание')
  assertEqual(g.pillars.mobility.secondary?.target, 3, 'NaN в днях -> умолчание')

  const low = weekProgress(baseState(), MON, { goals: { ...DEFAULT_WEEK_GOALS, zone2Minutes: 40 } }, LIBRARY)
  assertEqual(low.pillars.zone2.minimum, 40, 'минимум не выше цели')
})

group('pillarProgress совпадает с weekProgress', () => {
  const state = stateOf(session(MON, [strength('squat', 7), cardio(30)]))
  assertEqual(pillarProgress(state, MON, 'zone2', undefined, LIBRARY), week(state).pillars.zone2, 'зона 2')
  assertEqual(pillarProgress(state, WED, 'strength', undefined, LIBRARY).value, 7, 'любая дата недели')
})

group('вся неделя выполнена: allDone', () => {
  const d = (date: string) => session(date, [strength('squat', 9), strength('row', 9), hold('stretch-hip', [600]), hold('sls', [600])])
  const state = stateOf(
    d(MON), d(WED), d(FRI), session(TUE, [cardio(150)]), session(THU, [intervals(4), intervals(4)]),
  )
  const w = week(state)
  assertEqual(w.allDone, true, 'allDone')
  for (const p of ['strength', 'zone2', 'intervals', 'mobility', 'balance'] as const) {
    assertEqual(w.pillars[p].done, true, `${p} выполнен`)
  }
})

group('нагрузка дня', () => {
  const state = stateOf(session(MON, [strength('lunge', 4), strength('bench', 3), intervals(3)]))
  const load = dayLoad(state, MON, LIBRARY)
  assertEqual(load.workingSets, 7, 'подходы')
  assertEqual(load.groups.legs, 4, 'ноги')
  assertEqual(load.groups.core, 4, 'кор')
  assertEqual(load.intervalSessions, 1, 'интервальная сессия')
  assertEqual(dayLoad(state, TUE, LIBRARY).workingSets, 0, 'другая дата пуста')
})

group('weekHistory: порядок, длина, неделя через границу года', () => {
  const state = stateOf(session(MON, [strength('squat', 7)]))
  const h = weekHistory(state, SAT, 3, undefined, LIBRARY)
  assertEqual(h.map(w => w.weekStart), ['2026-09-28', '2026-10-05', MON], 'по возрастанию, последняя - текущая')
  assertEqual(h[2].pillars.strength.value, 7, 'текущая неделя с данными')
  assertEqual(weekHistory(state, SAT).length, 8, 'по умолчанию 8')
  assertEqual(weekHistory(state, SAT, 0), [], 'ноль недель')
  assertEqual(weekHistory(state, SAT, -2), [], 'отрицательное число')
  assertEqual(weekHistory(state, SAT, Number.NaN), [], 'NaN')
  assertEqual(weekHistory(state, SAT, 2.9, undefined, LIBRARY).length, 2, 'дробное округляется вниз')
  const ny = weekHistory(baseState(), '2027-01-02', 2)
  assertEqual(ny.map(w => w.weekStart), ['2026-12-21', '2026-12-28'], 'неделя 28 дек - 3 янв')
})

group('pillarDeficit: нехватка учитывает дни у силы, мобильности и баланса, но не у интервалов', () => {
  assertEqual(pillarDeficit(one(baseState(), 'zone2')), 1, 'пусто - полная нехватка')
  const state = stateOf(session(MON, [hold('stretch-hip', [1800])]))
  assertEqual(pillarDeficit(one(state, 'mobility')), 2 / 3, 'минуты есть, дней 1 из 3')
  const hardOnly = stateOf(session(MON, [intervals(2)]), session(TUE, [intervals(2)]))
  assertEqual(pillarDeficit(one(hardOnly, 'intervals')), 0, 'интервалы: тяжёлые минуты не нужны')
})

finish()
