import { assert, assertEqual, finish, group } from './_harness.ts'
import { EXERCISES } from '../src/data/exercises.ts'
import { TEMPLATES } from '../src/data/templates.ts'
import { INTERVAL_PROTOCOLS } from '../src/data/protocols.ts'

/* Связка данных двух пакетов: протоколы шаблонов и умолчаний упражнений
   должны существовать в INTERVAL_PROTOCOLS. */

const protocolIds = new Set(INTERVAL_PROTOCOLS.map(p => p.id))

group('каждый protocolId шаблонов есть в INTERVAL_PROTOCOLS', () => {
  const used = TEMPLATES.flatMap(t => t.items.filter(i => i.protocolId !== undefined).map(i => ({ t: t.id, id: i.protocolId! })))
  assertEqual(used.length, 6, 'элементов с протоколом: дом 3, зал 1, Джонсон 2')
  for (const { t, id } of used) assert(protocolIds.has(id), `${t}: неизвестный протокол ${id}`)
  assertEqual(
    [...new Set(used.map(u => u.id))].sort(),
    ['johnson-8x20-20', 'noequip-8x20-10', 'norwegian-4x4', 'tabata-20-10'],
    'используемые протоколы',
  )
})

group('протокол в шаблоне есть у интервальных упражнений, и только у них', () => {
  const byId = new Map(EXERCISES.map(e => [e.id, e]))
  for (const t of TEMPLATES) {
    for (const i of t.items) {
      const e = byId.get(i.exerciseId)!
      assertEqual(i.protocolId !== undefined, e.pillar === 'intervals', `${t.id}/${i.exerciseId}: протокол только у интервалов`)
    }
  }
})

group('протоколы по умолчанию интервальных упражнений существуют', () => {
  for (const e of EXERCISES.filter(x => x.pillar === 'intervals')) {
    assert(protocolIds.has(e.defaults.protocolId ?? ''), `${e.id}: протокол по умолчанию ${e.defaults.protocolId}`)
  }
})

group('упоминания протоколов в подсказках существуют', () => {
  for (const t of TEMPLATES) {
    for (const i of t.items) {
      for (const match of i.cue?.match(/\b(?:johnson|norwegian|tabata|noequip|interval|sit)-[a-z0-9-]+/g) ?? []) {
        assert(protocolIds.has(match), `${t.id}: в подсказке протокол ${match}, которого нет`)
      }
    }
  }
})

finish()
