import { assert, assertEqual, finish, group } from './_harness.ts'
import { PROGRAM_MUSCLEUP as P } from '../src/data/program-muscleup.ts'
import { EXERCISES } from '../src/data/exercises.ts'
import { TEMPLATES } from '../src/data/templates.ts'

const byId = new Map(EXERCISES.map(e => [e.id, e]))

function programExerciseIds(): string[] {
  const ids = new Set<string>([P.measurement.exerciseId])
  for (const ph of P.phases) {
    for (const day of ph.days) for (const item of day.items) ids.add(item.exerciseId)
    for (const check of ph.exit) if (check.exerciseId !== undefined) ids.add(check.exerciseId)
  }
  return [...ids].sort()
}

group('каждый exerciseId программы есть в библиотеке', () => {
  const ids = programExerciseIds()
  assert(ids.length >= 18, `в программе не меньше 18 разных упражнений: ${ids.length}`)
  for (const id of ids) assert(byId.has(id), `упражнения ${id} нет в EXERCISES`)
})

group('упражнения программы - силовые, ввод подходит к объёму', () => {
  for (const ph of P.phases) {
    for (const day of ph.days) {
      for (const item of day.items) {
        const ex = byId.get(item.exerciseId)
        if (!ex) continue
        const where = `${ph.id}/${day.key}/${item.exerciseId}`
        assertEqual(ex.pillar, 'strength', `${where}: столп сила`)
        if (item.seconds !== undefined) {
          assert(ex.input === 'time' || ex.input === 'time-side', `${where}: секунды у упражнения на время`)
        }
      }
    }
  }
})

group('шаблон ежедневной мелочи существует и не идёт в неделю', () => {
  const t = TEMPLATES.find(x => x.id === P.dailyLightTemplateId)
  assert(t !== undefined, `шаблона ${P.dailyLightTemplateId} нет в TEMPLATES`)
  if (t) {
    assertEqual(t.excludeFromWeek, true, 'мелочь исключена из недели')
    assertEqual(t.source, 'program', 'источник program')
    for (const item of t.items) assert(byId.has(item.exerciseId), `в мелочи нет упражнения ${item.exerciseId}`)
  }
})

group('упражнение замера и критерии выхода разрешаются', () => {
  assert(byId.has(P.measurement.exerciseId), 'упражнение замера')
  for (const ph of P.phases) {
    for (const check of ph.exit) {
      if (check.kind === 'manual') continue
      assert(check.exerciseId !== undefined && byId.has(check.exerciseId), `${ph.id}: критерий ${check.kind} ссылается на существующее упражнение`)
    }
  }
})

finish()
