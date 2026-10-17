import { assert, assertEqual, finish, group } from './_harness.ts'
import { createSignaler, renderWav, toneSequence } from '../src/ui/audio.ts'

const ascii = (b: Uint8Array, from: number, len: number): string => String.fromCharCode(...b.slice(from, from + len))

group('тоны сигналов', () => {
  assertEqual(toneSequence('short'), [{ freq: 880, durMs: 120, startMs: 0 }], 'короткий 880 Гц 120 мс')
  assertEqual(toneSequence('long'), [{ freq: 660, durMs: 400, startMs: 0 }], 'длинный 660 Гц 400 мс')
  const triple = toneSequence('triple')
  assertEqual(triple.length, 3, 'тройной - три тона')
  assert(triple[0].startMs < triple[1].startMs && triple[1].startMs < triple[2].startMs, 'по порядку')
  assert(triple[0].startMs + triple[0].durMs <= triple[1].startMs, 'тоны не налезают')
})

group('WAV в памяти', () => {
  for (const kind of ['short', 'long', 'triple'] as const) {
    const wav = renderWav(kind)
    const view = new DataView(wav.buffer)
    assertEqual([ascii(wav, 0, 4), ascii(wav, 8, 4), ascii(wav, 12, 4), ascii(wav, 36, 4)], ['RIFF', 'WAVE', 'fmt ', 'data'], `${kind}: заголовок`)
    assertEqual(view.getUint32(4, true), wav.length - 8, `${kind}: размер RIFF`)
    assertEqual(view.getUint32(40, true), wav.length - 44, `${kind}: размер data`)
    assertEqual([view.getUint16(20, true), view.getUint16(22, true), view.getUint16(34, true)], [1, 1, 16], `${kind}: PCM, моно, 16 бит`)
    let peak = 0
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(view.getInt16(i, true)))
    assert(peak > 10000 && peak < 32767, `${kind}: звук есть и без перегруза (пик ${peak})`)
    assertEqual(view.getInt16(44, true), 0, `${kind}: плавный вход, первый отсчёт 0`)
  }
  assert(renderWav('long').length > renderWav('short').length, 'длинный длиннее короткого')
})

group('silent ничего не делает', async () => {
  const s = createSignaler('silent')
  assertEqual(s.mode, 'silent', 'режим')
  await s.prime()
  s.play('long')
  s.dispose()
  assert(true, 'без исключений и без обращения к DOM')
})

finish()
