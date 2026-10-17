import { assert, assertEqual, finish, group } from './_harness.ts'
import { clampProtocol, intervalPhases, protocolDurationSec } from '../src/core/timers.ts'
import { CUSTOM_PROTOCOL_ID, CUSTOM_PROTOCOL_LIMITS, INTERVAL_PROTOCOLS } from '../src/data/protocols.ts'

const byId = (id: string) => INTERVAL_PROTOCOLS.find(p => p.id === id)

group('состав по разделу 3.4', () => {
  assertEqual(INTERVAL_PROTOCOLS.map(p => p.id), [
    'norwegian-4x4', 'interval-15-15', 'interval-30-30', 'tabata-20-10', 'sit-3x20',
    'noequip-8x20-10', 'johnson-8x20-20', 'johnson-8x20-40', 'johnson-30s', 'custom',
  ], 'девять готовых и свой')
  const row = (id: string) => {
    const p = byId(id)
    return p && [p.workSec, p.restSec, p.rounds, p.warmupSec, p.cooldownSec]
  }
  assertEqual(row('norwegian-4x4'), [240, 180, 4, 600, 300], '4x4')
  assertEqual(row('interval-15-15'), [15, 15, 20, 600, 300], '15/15')
  assertEqual(row('interval-30-30'), [30, 30, 10, 600, 300], '30/30')
  assertEqual(row('tabata-20-10'), [20, 10, 8, 300, 180], 'табата')
  assertEqual(row('sit-3x20'), [20, 120, 3, 120, 120], 'SIT')
  assertEqual(row('noequip-8x20-10'), [20, 10, 8, 180, 120], 'без оборудования')
  assertEqual(row('johnson-8x20-20'), [20, 20, 8, 180, 120], 'Джонсон 20/20')
  assertEqual(row('johnson-8x20-40'), [20, 40, 8, 180, 120], 'Джонсон 20/40')
  assertEqual(row('johnson-30s'), [30, 60, 5, 300, 180], 'Джонсон 30 с')
})

group('уникальные id и заполненные поля', () => {
  const ids = INTERVAL_PROTOCOLS.map(p => p.id)
  assertEqual(new Set(ids).size, ids.length, 'id не повторяются')
  assertEqual(ids.filter(id => id === CUSTOM_PROTOCOL_ID).length, 1, 'ровно один свой')
  for (const p of INTERVAL_PROTOCOLS) {
    assert(p.title.trim().length > 0, `${p.id}: название`)
    assert(p.note.trim().length > 0, `${p.id}: заметка`)
    assert(p.source.trim().length > 0, `${p.id}: источник`)
    assert(!new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`).test(`${p.title}${p.note}${p.source}`), `${p.id}: без длинного тире`)
  }
})

group('положительные длительности', () => {
  for (const p of INTERVAL_PROTOCOLS) {
    for (const key of ['workSec', 'rounds'] as const) {
      assert(Number.isInteger(p[key]) && p[key] > 0, `${p.id}: ${key} целое положительное`)
    }
    for (const key of ['restSec', 'warmupSec', 'cooldownSec'] as const) {
      assert(Number.isInteger(p[key]) && p[key] >= 0, `${p.id}: ${key} целое неотрицательное`)
    }
    assert(protocolDurationSec(p) > 0, `${p.id}: общая длительность положительна`)
  }
})

group('custom в пределах', () => {
  const custom = byId(CUSTOM_PROTOCOL_ID)!
  const L = CUSTOM_PROTOCOL_LIMITS
  assert(custom.workSec >= L.workSec.min && custom.workSec <= L.workSec.max, 'работа')
  assert(custom.restSec >= L.restSec.min && custom.restSec <= L.restSec.max, 'отдых')
  assert(custom.rounds >= L.rounds.min && custom.rounds <= L.rounds.max, 'раунды')
  assert(custom.warmupSec >= L.warmupSec.min && custom.warmupSec <= L.warmupSec.max, 'разминка')
  assert(custom.cooldownSec >= L.cooldownSec.min && custom.cooldownSec <= L.cooldownSec.max, 'заминка')
  assertEqual(L, {
    workSec: { min: 5, max: 600 }, restSec: { min: 0, max: 600 }, rounds: { min: 1, max: 30 },
    warmupSec: { min: 0, max: 900 }, cooldownSec: { min: 0, max: 600 },
  }, 'пределы по разделу 3.4')
  assertEqual(clampProtocol(custom, L), custom, 'стартовый custom уже в пределах')
  for (const p of INTERVAL_PROTOCOLS) {
    if (p.id === CUSTOM_PROTOCOL_ID) continue
    assert(p.workSec >= L.workSec.min && p.rounds <= L.rounds.max, `${p.id}: помещается в пределы custom`)
  }
})

group('сумма фаз равна полной длительности', () => {
  for (const p of INTERVAL_PROTOCOLS) {
    const phases = intervalPhases(p)
    const sum = phases.reduce((s, ph) => s + ph.sec, 0)
    const expected = p.warmupSec + p.rounds * p.workSec + (p.rounds - 1) * p.restSec + p.cooldownSec
    assertEqual(sum, expected, `${p.id}: сумма фаз`)
    assertEqual(protocolDurationSec(p), expected, `${p.id}: protocolDurationSec`)
    assertEqual(phases.filter(ph => ph.kind === 'work').length, p.rounds, `${p.id}: рабочих отрезков`)
    assertEqual(phases.filter(ph => ph.kind === 'rest').length, p.restSec > 0 ? p.rounds - 1 : 0, `${p.id}: отдыхов`)
    const last = phases[phases.length - 1]
    assertEqual(last.startSec + last.sec, sum, `${p.id}: метки фаз стыкуются`)
  }
  assertEqual(protocolDurationSec(byId('norwegian-4x4')!), 2400, '4x4 это 40 минут')
})

finish()
