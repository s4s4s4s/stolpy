import { assert, assertEqual, finish, group } from './_harness.ts'
import {
  DEFAULT_SET_SEC, SEC_PER_REP, healthPayload, healthShareText, healthShortcutUrl, healthType,
  isDuplicateSend, itemSeconds, markConfirmed, markSent, sessionSeconds, toLocalISO,
} from '../src/core/health.ts'
import type { Exercise, IntervalProtocol, Session, SessionItem } from '../src/core/types.ts'

const T0 = Date.UTC(2026, 9, 17, 14, 30, 0)   // 17 октября 2026, 14:30 UTC

function ex(id: string, pillar: Exercise['pillar']): Exercise {
  return {
    id, title: id, pillar, equipment: ['bodyweight'], input: 'time',
    defaults: { sets: 1 }, technique: 'x',
  }
}
const LIB: Exercise[] = [ex('plank', 'mobility'), ex('stand', 'balance'), ex('pullup', 'strength')]

const PROTO: IntervalProtocol = {
  id: 'p', title: 'p', workSec: 30, restSec: 60, rounds: 4, warmupSec: 120, cooldownSec: 60, note: '', source: '',
}

function strength(sets: number, extra: Partial<Extract<SessionItem, { type: 'strength' }>> = {}): SessionItem {
  return {
    id: 's', exerciseId: 'pullup', type: 'strength', unit: 'reps', planned: [], restSec: 60,
    sets: Array.from({ length: sets }, () => ({ kind: 'work' as const, reps: 10, doneAt: T0 })),
    ...extra,
  }
}
function cardio(mode: Extract<SessionItem, { type: 'cardio' }>['mode'], durationSec: number, distanceKm?: number): SessionItem {
  return { id: 'c' + mode, exerciseId: 'walk', type: 'cardio', mode, durationSec, distanceKm }
}
function hold(exerciseId: string, seconds: number[]): SessionItem {
  return {
    id: 'h' + exerciseId, exerciseId, type: 'hold', perSide: false, plannedSets: seconds.length, plannedSeconds: 30,
    holds: seconds.map(s => ({ seconds: s, doneAt: T0 })),
  }
}
function session(items: SessionItem[], extra: Partial<Session> = {}): Session {
  return { id: 'x', date: '2026-10-17', startedAt: T0, place: 'home', title: 't', items, ...extra }
}

group('тип по преобладающему столпу', () => {
  assertEqual(healthType(session([strength(3)]), LIB), 'strength', 'сила')
  assertEqual(healthType(session([cardio('walk', 1800)]), LIB), 'walking', 'ходьба')
  assertEqual(healthType(session([cardio('incline-walk', 1800)]), LIB), 'walking', 'ходьба в горку')
  assertEqual(healthType(session([cardio('run', 1800)]), LIB), 'running', 'бег')
  assertEqual(healthType(session([cardio('jog', 1800)]), LIB), 'running', 'трусца')
  assertEqual(healthType(session([cardio('bike', 1800)]), LIB), 'cycling', 'велосипед')
  assertEqual(healthType(session([cardio('row', 1800)]), LIB), 'rowing', 'гребля')
  assertEqual(healthType(session([cardio('elliptical', 1800)]), LIB), 'elliptical', 'эллипс')
  assertEqual(healthType(session([cardio('swim', 1800)]), LIB), 'swimming', 'плавание')
  assertEqual(healthType(session([cardio('jump-rope', 600)]), LIB), 'jump-rope', 'скакалка')
  assertEqual(healthType(session([cardio('other', 600)]), LIB), 'cardio', 'прочее кардио')
  const intervals: SessionItem = { id: 'i', exerciseId: 'e', type: 'intervals', mode: 'bike', protocol: PROTO, roundsDone: 4 }
  assertEqual(healthType(session([intervals]), LIB), 'hiit', 'интервалы не зависят от вида кардио')
  assertEqual(healthType(session([hold('plank', [60])]), LIB), 'flexibility', 'мобильность')
  assertEqual(healthType(session([hold('stand', [60])]), LIB), 'balance', 'баланс')
  assertEqual(healthType(session([hold('unknown', [60])]), LIB), 'balance', 'удержание неизвестного упражнения')
})

group('преобладание и ничьи', () => {
  assertEqual(healthType(session([strength(2), cardio('walk', 1800)]), LIB), 'walking', 'кардио длиннее силы')
  assertEqual(healthType(session([strength(10), cardio('walk', 300)]), LIB), 'strength', 'сила длиннее кардио')
  assertEqual(
    healthType(session([cardio('walk', 600), cardio('bike', 1200), cardio('walk', 500)]), LIB),
    'cycling', 'вид кардио по сумме времени: ходьба 1100 против велосипеда 1200',
  )
  assertEqual(
    healthType(session([cardio('walk', 600), cardio('bike', 1200), cardio('walk', 700)]), LIB),
    'walking', 'ходьба 1300 против велосипеда 1200',
  )
  assertEqual(
    healthType(session([cardio('bike', 600), cardio('run', 600)]), LIB),
    'cycling', 'ничья видов кардио: первый встретившийся',
  )
  assertEqual(
    healthType(session([cardio('walk', 600), hold('stand', [600])]), LIB),
    'walking', 'ничья столпов: порядок PILLARS, zone2 раньше баланса',
  )
  assertEqual(
    healthType(session([{
      id: 'e', exerciseId: 'e', type: 'external', activityId: 'tennis', activityTitle: 'Теннис',
      durationMin: 60, split: { zone2: 20, intervals: 40 },
    }]), LIB),
    'hiit', 'внешнее занятие делится по split',
  )
  assertEqual(
    healthType(session([{
      id: 'e', exerciseId: 'e', type: 'external', activityId: 'hike', activityTitle: 'Поход',
      durationMin: 60, split: { zone2: 60 },
    }]), LIB),
    'cardio', 'внешнее кардио без вида',
  )
})

group('пустая и мусорная сессия', () => {
  assertEqual(healthType(session([]), LIB), 'other', 'нет элементов')
  assertEqual(healthType(session([strength(0)]), LIB), 'other', 'силовой без подходов')
  assertEqual(healthType(session([cardio('walk', 0)]), LIB), 'other', 'кардио нулевой длины')
  assertEqual(healthType(session([cardio('walk', NaN)]), LIB), 'other', 'NaN длительность')
  assertEqual(healthType(session([cardio('walk', -5)]), LIB), 'other', 'отрицательная длительность')
  const p = healthPayload(session([]), LIB, { tzOffsetMin: 0 })
  assertEqual(p.durationSeconds, 0, 'пустая: длительность 0')
  assert(!('distanceKm' in p) && !('energyKcal' in p), 'пустая: без необязательных полей')
  assertEqual(healthType(session([hold('plank', [0, -3])]), LIB), 'other', 'удержания без секунд')
  assertEqual(healthType(session([{
    id: 'e', exerciseId: 'e', type: 'external', activityId: 'a', activityTitle: 'a', durationMin: 30, split: {},
  }]), LIB), 'other', 'внешнее без разбивки')
})

group('библиотека: массив и словарь', () => {
  const dict = Object.fromEntries(LIB.map(e => [e.id, e]))
  assertEqual(healthType(session([hold('plank', [60])]), dict), 'flexibility', 'словарь')
  assertEqual(healthType(session([hold('plank', [60])]), []), 'balance', 'пустая библиотека')
  assertEqual(healthType(session([hold('constructor', [60])]), dict), 'balance', 'ключ прототипа не ломает поиск')
})

group('длительность', () => {
  assertEqual(sessionSeconds(session([strength(3)], { endedAt: T0 + 45 * 60_000 })), 2700, 'по концу сессии')
  assertEqual(sessionSeconds(session([cardio('walk', 1800)], { endedAt: T0 })), 1800, 'конец равен началу: сумма элементов')
  assertEqual(sessionSeconds(session([cardio('walk', 1800)], { endedAt: T0 - 5 })), 1800, 'конец раньше начала: сумма элементов')
  assertEqual(sessionSeconds(session([cardio('walk', 1800)])), 1800, 'идущая: сумма элементов')
  assertEqual(sessionSeconds(session([cardio('walk', 1800)], { endedAt: NaN })), 1800, 'NaN в конце')
  assertEqual(sessionSeconds(session([cardio('walk', 1200), cardio('bike', 600)])), 1800, 'сумма двух кардио')

  assertEqual(itemSeconds(strength(3)), 3 * 10 * SEC_PER_REP + 2 * 60, 'сила: повторы и отдых между подходами')
  assertEqual(itemSeconds(strength(1)), 30, 'один подход без отдыха')
  assertEqual(
    itemSeconds(strength(2, { unit: 'seconds', sets: [
      { kind: 'work', seconds: 40, doneAt: T0 }, { kind: 'work', doneAt: T0 },
    ] })),
    40 + DEFAULT_SET_SEC + 60, 'секунды и подход без данных',
  )
  assertEqual(itemSeconds(hold('plank', [30, 45])), 75, 'удержания')
  const iv = (rounds: number): SessionItem => ({ id: 'i', exerciseId: 'e', type: 'intervals', mode: 'run', protocol: PROTO, roundsDone: rounds })
  assertEqual(itemSeconds(iv(4)), 120 + 4 * 30 + 3 * 60 + 60, 'интервалы: разминка, раунды, заминка')
  assertEqual(itemSeconds(iv(0)), 0, 'интервалы без раундов')
  assertEqual(itemSeconds(iv(2.9)), 120 + 2 * 30 + 60 + 60, 'дробные раунды округляются вниз')
  const e: SessionItem = { id: 'e', exerciseId: 'e', type: 'external', activityId: 'a', activityTitle: 'a', durationMin: 25, split: { zone2: 25 } }
  assertEqual(itemSeconds(e), 1500, 'внешнее')
  assertEqual(healthPayload(session([cardio('walk', 1800)]), LIB, { tzOffsetMin: 0 }).durationSeconds, 1800, 'в полезной нагрузке')
})

group('часовой пояс и начало', () => {
  assertEqual(toLocalISO(T0, 0), '2026-10-17T14:30:00+00:00', 'UTC')
  assertEqual(toLocalISO(T0, 240), '2026-10-17T18:30:00+04:00', 'UTC+4')
  assertEqual(toLocalISO(T0, -300), '2026-10-17T09:30:00-05:00', 'UTC-5')
  assertEqual(toLocalISO(T0, 330), '2026-10-17T20:00:00+05:30', 'половинное смещение')
  assertEqual(toLocalISO(T0, -210), '2026-10-17T11:00:00-03:30', 'отрицательное половинное')
  assertEqual(toLocalISO(Date.UTC(2026, 11, 31, 22, 0, 5), 240), '2027-01-01T02:00:05+04:00', 'переход через год')
  assertEqual(toLocalISO(Date.UTC(2026, 0, 1, 1, 0, 0), -120), '2025-12-31T23:00:00-02:00', 'переход назад через год')
  assertEqual(toLocalISO(Date.UTC(2026, 2, 1, 0, 0, 0), 0), '2026-03-01T00:00:00+00:00', 'начало месяца')
  assertEqual(healthPayload(session([strength(1)]), LIB, { tzOffsetMin: 240 }).startISO, '2026-10-17T18:30:00+04:00', 'в полезной нагрузке')
  const system = healthPayload(session([strength(1)]), LIB).startISO
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(system), 'смещение системы: формат')
  assertEqual(new Date(system).getTime(), T0, 'смещение системы: тот же момент')
})

group('расстояние и калории', () => {
  const walk = session([cardio('walk', 1800, 2.5), cardio('run', 600, 1.234)])
  assertEqual(healthPayload(walk, LIB, { tzOffsetMin: 0 }).distanceKm, 3.73, 'сумма расстояний, два знака')
  assert(!('distanceKm' in healthPayload(session([cardio('walk', 1800)]), LIB)), 'без расстояния поля нет')
  assert(!('distanceKm' in healthPayload(session([cardio('walk', 1800, 0)]), LIB)), 'нулевое расстояние не передаётся')
  assert(!('distanceKm' in healthPayload(session([cardio('walk', 1800, NaN)]), LIB)), 'NaN расстояние не передаётся')
  assert(!('energyKcal' in healthPayload(walk, LIB)), 'калории не придумываются')
  assertEqual(healthPayload(walk, LIB, { energyKcal: 250.4 }).energyKcal, 250, 'введённые калории')
  assert(!('energyKcal' in healthPayload(walk, LIB, { energyKcal: 0 })), 'ноль калорий не передаётся')
  assert(!('energyKcal' in healthPayload(walk, LIB, { energyKcal: -10 })), 'отрицательные не передаются')
  assert(!('energyKcal' in healthPayload(walk, LIB, { energyKcal: NaN })), 'NaN не передаётся')
})

group('текст для отправки', () => {
  const payload = healthPayload(session([cardio('walk', 1800, 2)], { endedAt: T0 + 1_900_000 }), LIB, { tzOffsetMin: 240, energyKcal: 120 })
  const text = healthShareText(payload)
  assertEqual(JSON.parse(text), payload, 'круг сериализации')
  assertEqual(
    text,
    '{"type":"walking","startISO":"2026-10-17T18:30:00+04:00","durationSeconds":1900,"distanceKm":2,"energyKcal":120}',
    'точный вид и порядок полей',
  )
  assert(!text.includes('\n'), 'одна строка')
})

group('ссылка запуска команды', () => {
  assertEqual(healthShortcutUrl('Тренировка', '{"a":1}'), 'shortcuts://run-shortcut?name=%D0%A2%D1%80%D0%B5%D0%BD%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B0&input=text&text=%7B%22a%22%3A1%7D', 'кириллица и JSON закодированы')
  assertEqual(healthShortcutUrl('Моя запись', 'x'), 'shortcuts://run-shortcut?name=%D0%9C%D0%BE%D1%8F%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D1%8C&input=text&text=x', 'пробел это %20, не плюс')
  assertEqual(healthShortcutUrl('  Log  ', 'x'), 'shortcuts://run-shortcut?name=Log&input=text&text=x', 'имя обрезается по краям')
  assertEqual(healthShortcutUrl('', 'x'), null, 'пустое имя')
  assertEqual(healthShortcutUrl('   ', 'x'), null, 'имя из пробелов')
  assertEqual(healthShortcutUrl(undefined as unknown as string, 'x'), null, 'не строка')
  const tricky = healthShortcutUrl('a&b=c?d#e', 'x&y=1#z+%')
  assertEqual(tricky, 'shortcuts://run-shortcut?name=a%26b%3Dc%3Fd%23e&input=text&text=x%26y%3D1%23z%2B%25', 'служебные символы URL')
  const url = healthShortcutUrl('Моя команда', healthShareText(healthPayload(session([cardio('walk', 60)]), LIB, { tzOffsetMin: 240 })))!
  const parsed = new URL(url)
  assertEqual(parsed.searchParams.get('name'), 'Моя команда', 'имя восстанавливается')
  assertEqual(parsed.searchParams.get('input'), 'text', 'input=text')
  assert(JSON.parse(parsed.searchParams.get('text')!).type === 'walking', 'text восстанавливается в JSON')
  assertEqual(healthShortcutUrl('A', ''), 'shortcuts://run-shortcut?name=A&input=text&text=', 'пустой текст')
})

group('отметки отправки и дубликат', () => {
  const s = session([strength(1)])
  assertEqual(isDuplicateSend(s), false, 'не отправлялась')
  const sent = markSent(s, 5000)
  assertEqual(sent.health, { sentAt: 5000, confirmed: false }, 'отправлена')
  assertEqual(s.health, undefined, 'исходная сессия не изменена')
  assertEqual(isDuplicateSend(sent), true, 'после отправки повтор это дубликат')
  const confirmed = markConfirmed(sent)
  assertEqual(confirmed.health, { sentAt: 5000, confirmed: true }, 'подтверждена')
  assertEqual(sent.health, { sentAt: 5000, confirmed: false }, 'отправленная не изменена')
  assertEqual(isDuplicateSend(confirmed), true, 'подтверждённая тоже дубликат')
  assertEqual(markConfirmed(confirmed).health, { sentAt: 5000, confirmed: true }, 'повторное подтверждение идемпотентно')
  assert(markConfirmed(s) === s && s.health === undefined, 'подтверждение без отправки ничего не создаёт')
  const again = markSent(confirmed, 9000)
  assertEqual(again.health, { sentAt: 9000, confirmed: false }, 'повторная отправка сбрасывает подтверждение')
  assertEqual(markSent(s, 0).health, { sentAt: 0, confirmed: false }, 'время ноль допустимо')
  assertEqual(isDuplicateSend(markSent(s, 0)), true, 'sentAt 0 это тоже отправка')
})

finish()
