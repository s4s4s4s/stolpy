import { assertEqual, finish, group } from './_harness.ts'
import { formatStreak, weekStreak } from '../src/core/streak.ts'
import type { Session } from '../src/core/types.ts'
import { LIBRARY, MON, SAT, baseState, cardio, fullWeek, session, stateOf } from './_week-fixtures.ts'

const streak = (sessions: Session[], today = SAT) => weekStreak(stateOf(...sessions), today, undefined, LIBRARY)
const WEEK_1 = '2026-09-28'
const WEEK_2 = '2026-10-05'

group('fullWeek сам по себе выполняет неделю (проверка фикстуры)', () => {
  const r = streak(fullWeek(MON))
  assertEqual(r.currentReached, true, 'текущая выполнена')
  assertEqual(r.currentPillarsDone, 5, 'пять из пяти')
})

group('пустая история: серия 0, подписи нет', () => {
  const r = weekStreak(baseState(), SAT)
  assertEqual(r, { weeks: 0, currentReached: false, currentPillarsDone: 0 }, 'нули')
  assertEqual(formatStreak(r.weeks), null, 'без текста')
})

group('три выполненные прошлые недели, текущая пустая: серия 3', () => {
  const r = streak([...fullWeek(WEEK_1), ...fullWeek(WEEK_2), ...fullWeek('2026-09-21')])
  assertEqual(r.weeks, 3, 'три недели')
  assertEqual(r.currentReached, false, 'текущая не выполнена')
})

group('выполненная текущая неделя прибавляется', () => {
  const r = streak([...fullWeek(WEEK_1), ...fullWeek(WEEK_2), ...fullWeek(MON)])
  assertEqual(r.weeks, 3, 'две прошлые и текущая')
  assertEqual(r.currentReached, true, 'текущая выполнена')
})

group('текущая выполнена, прошлая нет: серия 1', () => {
  const r = streak([...fullWeek(WEEK_2, ['balance']), ...fullWeek(MON)])
  assertEqual(r.weeks, 1, 'только текущая')
})

group('невыполненная текущая неделя серию не обрывает', () => {
  const r = streak([...fullWeek(WEEK_1), ...fullWeek(WEEK_2), session(MON, [cardio(150)])])
  assertEqual(r.weeks, 2, 'две прошлые')
  assertEqual(r.currentReached, false, 'текущая не выполнена')
  assertEqual(r.currentPillarsDone, 1, 'выполнена одна из пяти')
})

group('разрыв посередине: считается только хвост после разрыва', () => {
  const r = streak([...fullWeek('2026-09-21'), ...fullWeek(WEEK_1, ['intervals']), ...fullWeek(WEEK_2)])
  assertEqual(r.weeks, 1, 'до недели без интервалов не идём')
})

group('каждый столп в отдельности ломает неделю', () => {
  for (const pillar of ['strength', 'zone2', 'intervals', 'mobility', 'balance'] as const) {
    const r = streak([...fullWeek(WEEK_2, [pillar])])
    assertEqual(r.weeks, 0, `без ${pillar} серии нет`)
  }
})

group('сегодня понедельник: прошлая неделя ещё считается', () => {
  const r = streak(fullWeek(WEEK_2), MON)
  assertEqual(r.weeks, 1, 'одна прошлая')
  assertEqual(r.currentPillarsDone, 0, 'в текущей пока пусто')
})

group('воскресенье и понедельник: неделя считается целиком по её датам', () => {
  assertEqual(streak(fullWeek(WEEK_2), '2026-10-18').weeks, 1, 'в воскресенье 18 октября неделя 5-11 октября прошлая')
  assertEqual(streak(fullWeek(MON), '2026-10-18').weeks, 1, 'в воскресенье неделя 12-18 текущая и выполнена')
  assertEqual(streak(fullWeek(MON), '2026-10-19').weeks, 1, 'в понедельник она уже прошлая')
  assertEqual(streak(fullWeek(MON), '2026-10-26').weeks, 0, 'через неделю между ними пустая')
})

group('сессии вне недели и исключённые не складываются в серию', () => {
  const light = fullWeek(WEEK_2).map(s => ({ ...s, excludeFromWeek: true }))
  assertEqual(streak(light).weeks, 0, 'excludeFromWeek')
  const running = fullWeek(WEEK_2).map(s => ({ ...s, endedAt: undefined }))
  assertEqual(streak(running).weeks, 0, 'незавершённые')
})

group('очень старая история не зацикливает и не даёт серии', () => {
  const r = weekStreak(stateOf(...fullWeek(MON)), '2031-06-01', undefined, LIBRARY)
  assertEqual(r.weeks, 0, 'между неделями пустота')
})

group('цели из настроек влияют на серию', () => {
  const state = stateOf(session(WEEK_2, [cardio(10)]))
  const easy = { goals: { ...state.settings.goals, strengthSets: 1, strengthDays: 0, zone2Minutes: 1, intervalSessions: 1, mobilityMinutes: 1, mobilityDays: 0, balanceMinutes: 1, balanceDays: 0 } }
  assertEqual(weekStreak(state, SAT, easy, LIBRARY).weeks, 0, 'интервалов нет - серии нет даже с лёгкими целями')
})

group('formatStreak: склонение и пустые значения', () => {
  assertEqual(formatStreak(1), 'серия 1 неделя', '1')
  assertEqual(formatStreak(2), 'серия 2 недели', '2')
  assertEqual(formatStreak(5), 'серия 5 недель', '5')
  assertEqual(formatStreak(11), 'серия 11 недель', '11')
  assertEqual(formatStreak(21), 'серия 21 неделя', '21')
  assertEqual(formatStreak(0), null, '0')
  assertEqual(formatStreak(-3), null, 'отрицательное')
  assertEqual(formatStreak(1.5), null, 'дробное')
  assertEqual(formatStreak(Number.NaN), null, 'NaN')
})

finish()
