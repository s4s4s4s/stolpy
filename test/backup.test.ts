import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, assertEqual, finish, group } from './_harness.ts'
import type { AppState, ProgramProgress, Session } from '../src/core/types.ts'
import {
  BACKUP_APP, backupFileName, buildBackup, hasRecords, importBackup, markBackedUp, mergeStates, parseBackup,
} from '../src/core/backup.ts'
import { CURRENT_VERSION, defaultState } from '../src/state/storage.ts'

const NOW = Date.UTC(2026, 9, 17, 9, 0)
const FIXTURE_TEXT = readFileSync(join(process.cwd(), 'test', 'fixtures', 'state-v1.json'), 'utf8')
const fixture = (): AppState => JSON.parse(FIXTURE_TEXT) as AppState
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function session(id: string, date = '2026-10-12'): Session {
  return { id, date, startedAt: 1000, endedAt: 2000, place: 'home', title: id, items: [] }
}

function program(over: Partial<ProgramProgress> = {}): ProgramProgress {
  return {
    programId: 'muscleup', startedOn: '2026-09-07', trainingWeekdays: [0, 2, 4], phaseIndex: 0, phaseStartedWeek: 1,
    completedDays: [], measurements: [], ...over,
  }
}

group('buildBackup -> parseBackup: круг без потерь', () => {
  const st = fixture()
  const text = buildBackup(st, NOW)
  const file = JSON.parse(text)
  assertEqual([file.app, file.version, file.exportedAt], [BACKUP_APP, CURRENT_VERSION, NOW], 'поля конверта')
  assertEqual(BACKUP_APP, 'stolpy', 'метка приложения')
  assertEqual(file.state, st, 'состояние внутри')
  const r = parseBackup(text, NOW + 1)
  assertEqual(r, { ok: true, state: st, dropped: 0, exportedAt: NOW }, 'разбор')
})

group('parseBackup: отказы с причиной и текстом', () => {
  const st = fixture()
  const cases: [string, string, string][] = [
    ['пустой файл', '', 'empty'],
    ['пробелы', ' \n ', 'empty'],
    ['не JSON', '{"app":"stolpy"', 'not-json'],
    ['текст', 'привет', 'not-json'],
    ['массив', '[]', 'not-stolpy'],
    ['null', 'null', 'not-stolpy'],
    ['чужое приложение', JSON.stringify({ app: 'eda', version: 1, exportedAt: NOW, state: st }), 'not-stolpy'],
    ['без app', JSON.stringify({ version: 1, state: st }), 'not-stolpy'],
    ['без версии', JSON.stringify({ app: 'stolpy', state: st }), 'not-stolpy'],
    ['версия строкой', JSON.stringify({ app: 'stolpy', version: '1', state: st }), 'not-stolpy'],
    ['без state', JSON.stringify({ app: 'stolpy', version: 1 }), 'not-stolpy'],
    ['state не объект', JSON.stringify({ app: 'stolpy', version: 1, state: [] }), 'not-stolpy'],
    ['файл новее', JSON.stringify({ app: 'stolpy', version: 2, exportedAt: NOW, state: st }), 'newer-version'],
    ['состояние новее', JSON.stringify({ app: 'stolpy', version: 1, exportedAt: NOW, state: { ...st, version: 2 } }), 'newer-version'],
    ['копия без записей', buildBackup(defaultState(NOW), NOW), 'empty'],
  ]
  for (const [name, text, reason] of cases) {
    const r = parseBackup(text, NOW)
    assert(!r.ok, `${name}: отказ`)
    if (!r.ok) {
      assertEqual(r.reason, reason, `${name}: причина`)
      assert(r.message.length > 0, `${name}: текст для человека`)
    }
  }
})

group('parseBackup: битые записи выпадают и считаются, без exportedAt - null', () => {
  const st = fixture()
  const raw = clone(st) as unknown as { sessions: Record<string, unknown>; bodyWeights: unknown[] }
  raw.sessions['битая'] = { id: 'битая' }
  raw.bodyWeights.push({ date: '2026-09-30', kg: -1 })
  const r = parseBackup(JSON.stringify({ app: 'stolpy', version: 1, state: raw }), NOW)
  assert(r.ok, 'принята')
  if (r.ok) {
    assertEqual(r.dropped, 2, 'две потери')
    assertEqual(r.state, st, 'остальное цело')
    assertEqual(r.exportedAt, null, 'нет exportedAt')
  }
  const weird = parseBackup(JSON.stringify({ app: 'stolpy', version: 1, exportedAt: 'вчера', state: st }), NOW)
  assert(weird.ok && weird.exportedAt === null, 'exportedAt не число - null')
})

group('parseBackup: состояние без версии внутри мигрирует', () => {
  const st = fixture() as unknown as Record<string, unknown>
  delete st.version
  const r = parseBackup(JSON.stringify({ app: 'stolpy', version: 1, state: st }), NOW)
  assert(r.ok && r.dropped === 0, 'принято без потерь')
  assert(r.ok && r.state.version === CURRENT_VERSION, 'версия текущая')
})

group('hasRecords: каждая коллекция по отдельности делает копию непустой', () => {
  const empty = defaultState(NOW)
  assert(!hasRecords(empty), 'пусто')
  assert(!hasRecords({ ...empty, settings: { ...empty.settings, birthYear: 1990 } }), 'одни настройки - пусто')
  const variants: AppState[] = [
    { ...empty, sessions: { a: session('a') } },
    { ...empty, customExercises: clone(fixture().customExercises) },
    { ...empty, customTemplates: clone(fixture().customTemplates) },
    { ...empty, programs: { muscleup: program() } },
    { ...empty, testResults: clone(fixture().testResults) },
    { ...empty, bodyWeights: [{ date: '2026-10-01', kg: 70 }] },
  ]
  variants.forEach((v, i) => assert(hasRecords(v), `вариант ${i}`))
})

group('mergeStates: объединение по id, при совпадении остаётся текущая', () => {
  const cur = { ...defaultState(NOW), sessions: { a: session('a'), b: { ...session('b'), title: 'текущая' } } }
  const inc = { ...defaultState(1), sessions: { b: { ...session('b'), title: 'из копии' }, c: session('c') } }
  const r = mergeStates(cur, inc)
  assertEqual(Object.keys(r.state.sessions).sort(), ['a', 'b', 'c'], 'все три')
  assertEqual(r.state.sessions.b.title, 'текущая', 'совпавшая - текущая')
  assertEqual(r.counts.sessions, { added: 1, kept: 1, replaced: 0 }, 'счётчики')
})

group('mergeStates: свои упражнения, шаблоны, тесты, вес', () => {
  const f = fixture()
  const cur: AppState = {
    ...defaultState(NOW),
    customExercises: { 'ex-towel-row': { ...f.customExercises['ex-towel-row'], title: 'текущее' } },
    testResults: [{ id: 't1', testId: 'grip', date: '2026-10-01', values: {}, result: 40 }],
    bodyWeights: [{ date: '2026-10-01', kg: 70 }, { date: '2026-10-10', kg: 71 }],
  }
  const inc: AppState = {
    ...defaultState(1),
    customExercises: { ...f.customExercises, 'ex-2': { ...f.customExercises['ex-towel-row'], id: 'ex-2' } },
    customTemplates: f.customTemplates,
    testResults: [
      { id: 't1', testId: 'grip', date: '2026-10-01', values: {}, result: 99 },
      { id: 't0', testId: 'grip', date: '2026-09-01', values: {}, result: 38 },
    ],
    bodyWeights: [{ date: '2026-10-01', kg: 99 }, { date: '2026-09-20', kg: 72 }],
  }
  const r = mergeStates(cur, inc)
  assertEqual(r.state.customExercises['ex-towel-row'].title, 'текущее', 'совпавшее упражнение - текущее')
  assert('ex-2' in r.state.customExercises, 'новое упражнение добавлено')
  assertEqual(r.counts.customExercises, { added: 1, kept: 1, replaced: 0 }, 'счётчики упражнений')
  assertEqual(r.state.customTemplates, f.customTemplates, 'шаблоны добавлены')
  assertEqual(r.counts.customTemplates, { added: 1, kept: 0, replaced: 0 }, 'счётчики шаблонов')
  assertEqual(r.state.testResults.map(t => [t.id, t.result]), [['t0', 38], ['t1', 40]], 'тесты по id, по дате')
  assertEqual(r.counts.testResults, { added: 1, kept: 1, replaced: 0 }, 'счётчики тестов')
  assertEqual(r.state.bodyWeights, [{ date: '2026-09-20', kg: 72 }, { date: '2026-10-01', kg: 70 }, { date: '2026-10-10', kg: 71 }], 'вес по дате, совпавшая дата - текущая')
  assertEqual(r.counts.bodyWeights, { added: 1, kept: 1, replaced: 0 }, 'счётчики веса')
})

group('mergeStates: программа с более поздней активностью побеждает', () => {
  const later = program({ completedDays: [{ date: '2026-10-05', dayKey: 'A', sessionId: 's' }] })
  const earlier = program({ measurements: [{ date: '2026-09-20', reps: 4 }] })
  const base = defaultState(NOW)

  const r1 = mergeStates({ ...base, programs: { muscleup: earlier } }, { ...base, programs: { muscleup: later } })
  assertEqual(r1.state.programs.muscleup, later, 'копия позже - копия')
  assertEqual(r1.counts.programs, { added: 0, kept: 0, replaced: 1 }, 'replaced')

  const r2 = mergeStates({ ...base, programs: { muscleup: later } }, { ...base, programs: { muscleup: earlier } })
  assertEqual(r2.state.programs.muscleup, later, 'текущая позже - текущая')
  assertEqual(r2.counts.programs, { added: 0, kept: 1, replaced: 0 }, 'kept')

  const sameDayMore = program({
    completedDays: [{ date: '2026-10-05', dayKey: 'A', sessionId: 's' }],
    measurements: [{ date: '2026-10-05', reps: 5 }],
  })
  const r3 = mergeStates({ ...base, programs: { muscleup: later } }, { ...base, programs: { muscleup: sameDayMore } })
  assertEqual(r3.state.programs.muscleup, sameDayMore, 'одна дата, больше отметок - копия')

  const r4 = mergeStates({ ...base, programs: { muscleup: later } }, { ...base, programs: { muscleup: clone(later) } })
  assertEqual(r4.counts.programs, { added: 0, kept: 1, replaced: 0 }, 'полное равенство - текущая')

  const fresh = program({ startedOn: '2026-10-12' })
  const r5 = mergeStates({ ...base, programs: { muscleup: program() } }, { ...base, programs: { muscleup: fresh } })
  assertEqual(r5.state.programs.muscleup, fresh, 'перезапуск позже считается активностью')

  const other = program({ programId: 'other' })
  const r6 = mergeStates({ ...base, programs: { muscleup: later } }, { ...base, programs: { other } })
  assertEqual(Object.keys(r6.state.programs).sort(), ['muscleup', 'other'], 'другая программа добавлена')
})

group('mergeStates: настройки и meta текущие, входы не меняются', () => {
  const cur = fixture()
  const inc = { ...fixture(), settings: { ...fixture().settings, defaultRestSec: 30, sound: 'silent' as const }, meta: { lastBackupAt: 1, sessionsSinceBackup: 99, installedAt: 1 } }
  const curCopy = clone(cur)
  const incCopy = clone(inc)
  const r = mergeStates(cur, inc)
  assertEqual(r.state.settings, cur.settings, 'настройки текущие')
  assertEqual(r.state.meta, cur.meta, 'meta текущая')
  assertEqual(cur, curCopy, 'текущее не мутировано')
  assertEqual(inc, incCopy, 'копия не мутирована')
  assertEqual(r.state.sessions, cur.sessions, 'слияние с собой ничего не добавляет')
  assertEqual(r.counts.sessions, { added: 0, kept: 4, replaced: 0 }, 'все совпали')
})

group('mergeStates: слияние с пустым и в пустое', () => {
  const f = fixture()
  const intoEmpty = mergeStates(defaultState(NOW), f)
  assertEqual(
    [intoEmpty.state.sessions, intoEmpty.state.customExercises, intoEmpty.state.customTemplates, intoEmpty.state.programs, intoEmpty.state.testResults, intoEmpty.state.bodyWeights],
    [f.sessions, f.customExercises, f.customTemplates, f.programs, f.testResults, f.bodyWeights],
    'всё из копии',
  )
  assertEqual(intoEmpty.state.settings, defaultState(NOW).settings, 'настройки пустого текущего')
  const withEmpty = mergeStates(f, defaultState(NOW))
  assertEqual(withEmpty.state, f, 'пустая копия ничего не меняет')
})

group('importBackup: замена целиком и слияние', () => {
  const cur = { ...defaultState(NOW), sessions: { a: session('a') } }
  const inc = fixture()
  const replaced = importBackup(cur, inc, 'replace')
  assertEqual(replaced.state, inc, 'замена: состояние копии, включая настройки')
  assert(!('a' in replaced.state.sessions), 'текущие записи ушли')
  assertEqual(replaced.counts.sessions, { added: 4, kept: 0, replaced: 0 }, 'счётчики замены')
  assertEqual(replaced.counts.bodyWeights.added, inc.bodyWeights.length, 'вес')
  const merged = importBackup(cur, inc, 'merge')
  assertEqual(merged, mergeStates(cur, inc), 'merge = mergeStates')
})

group('markBackedUp и backupFileName', () => {
  const st = fixture()
  const m = markBackedUp(st, NOW)
  assertEqual(m.meta, { ...st.meta, lastBackupAt: NOW, sessionsSinceBackup: 0 }, 'отметка')
  assertEqual(st.meta.sessionsSinceBackup, 4, 'вход не мутирован')
  assertEqual(backupFileName(new Date(2026, 9, 17, 23, 59)), 'stolpy-2026-10-17.json', 'местная дата')
  assertEqual(backupFileName(new Date(2026, 0, 5, 0, 1)), 'stolpy-2026-01-05.json', 'ведущие нули')
})

finish()
