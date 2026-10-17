import type { SoundMode } from '../core/types'
import type { SignalKind } from '../core/timers'

/* Звуковые сигналы без внешних файлов (раздел 5 плана).
   silent   - ничего (интерфейс сам показывает вспышку).
   ambient  - Web Audio: тоны осциллятором, уважает беззвучный переключатель
              и играет поверх музыки.
   playback - элемент audio с WAV, собранным в памяти; вместе с
              navigator.audioSession.type = 'playback' слышен и при беззвучном
              режиме iOS. */

export interface Tone {
  freq: number
  startMs: number
  durMs: number
}

const SHORT_TONE = { freq: 880, durMs: 120 }
const LONG_TONE = { freq: 660, durMs: 400 }
const TRIPLE_GAP_MS = 220

/** Тоны сигнала: short - один короткий, long - один длинный, triple - три коротких подряд. */
export function toneSequence(kind: SignalKind): Tone[] {
  switch (kind) {
    case 'short':
      return [{ ...SHORT_TONE, startMs: 0 }]
    case 'long':
      return [{ ...LONG_TONE, startMs: 0 }]
    case 'triple':
      return [0, 1, 2].map(i => ({ ...SHORT_TONE, startMs: i * TRIPLE_GAP_MS }))
  }
}

const SIGNAL_KINDS: SignalKind[] = ['short', 'long', 'triple']
const SAMPLE_RATE = 22050
const AMPLITUDE = 0.6
const EDGE_MS = 6          // плавный вход и выход тона, без щелчков

/** WAV 16 бит, моно, из тонов сигнала. Чистая функция: проверяется в node. */
export function renderWav(kind: SignalKind): Uint8Array<ArrayBuffer> {
  const tones = toneSequence(kind)
  const totalMs = Math.max(...tones.map(t => t.startMs + t.durMs)) + 40
  const count = Math.ceil((totalMs / 1000) * SAMPLE_RATE)
  const pcm = new Int16Array(count)
  const edge = (EDGE_MS / 1000) * SAMPLE_RATE

  for (const tone of tones) {
    const from = Math.floor((tone.startMs / 1000) * SAMPLE_RATE)
    const len = Math.floor((tone.durMs / 1000) * SAMPLE_RATE)
    for (let i = 0; i < len && from + i < count; i++) {
      const env = Math.min(1, i / edge, (len - i) / edge)
      const v = Math.sin((2 * Math.PI * tone.freq * i) / SAMPLE_RATE) * env * AMPLITUDE
      pcm[from + i] = Math.round(v * 32767)
    }
  }

  const bytes = new Uint8Array(new ArrayBuffer(44 + pcm.length * 2))
  const view = new DataView(bytes.buffer)
  const text = (offset: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)               // PCM
  view.setUint16(22, 1, true)               // моно
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  pcm.forEach((sample, i) => view.setInt16(44 + i * 2, sample, true))
  return bytes
}

export interface Signaler {
  readonly mode: SoundMode
  /** Подготовка звука. Вызывать внутри обработчика касания («Начать», «Проверить звук»). */
  prime: () => Promise<void>
  play: (kind: SignalKind) => void
  dispose: () => void
}

type AudioSessionNav = Navigator & { audioSession?: { type: string } }
type AudioContextCtor = typeof AudioContext

function setAudioSession(type: string): void {
  try {
    const session = (navigator as AudioSessionNav).audioSession
    if (session) session.type = type
  } catch {
    /* свойство есть не везде и не всегда записываемо */
  }
}

function audioContextCtor(): AudioContextCtor | null {
  const w = window as typeof globalThis & { webkitAudioContext?: AudioContextCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function createSilent(): Signaler {
  return { mode: 'silent', prime: async () => undefined, play: () => undefined, dispose: () => undefined }
}

function createAmbient(): Signaler {
  let ctx: AudioContext | null = null

  const ensure = (): AudioContext | null => {
    if (ctx && ctx.state !== 'closed') return ctx
    const Ctor = audioContextCtor()
    ctx = Ctor ? new Ctor() : null
    return ctx
  }

  return {
    mode: 'ambient',
    async prime() {
      const c = ensure()
      if (!c) return
      try {
        await c.resume()
      } catch {
        /* вне жеста resume отклоняется: следующий play попробует снова */
      }
    },
    play(kind) {
      const c = ensure()
      if (!c) return
      /* после сворачивания состояние suspended или interrupted */
      if (c.state !== 'running') void c.resume().catch(() => undefined)
      const base = c.currentTime
      for (const tone of toneSequence(kind)) {
        const start = base + tone.startMs / 1000
        const end = start + tone.durMs / 1000
        const osc = c.createOscillator()
        const gain = c.createGain()
        osc.frequency.value = tone.freq
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(AMPLITUDE, start + EDGE_MS / 1000)
        gain.gain.setValueAtTime(AMPLITUDE, end - EDGE_MS / 1000)
        gain.gain.linearRampToValueAtTime(0, end)
        osc.connect(gain).connect(c.destination)
        osc.start(start)
        osc.stop(end + 0.02)
      }
    },
    dispose() {
      const c = ctx
      ctx = null
      if (c && c.state !== 'closed') void c.close().catch(() => undefined)
    },
  }
}

function createPlayback(): Signaler {
  const urls = new Map<SignalKind, string>()
  const elements = new Map<SignalKind, HTMLAudioElement>()

  const ensure = (kind: SignalKind): HTMLAudioElement => {
    let el = elements.get(kind)
    if (el) return el
    const url = URL.createObjectURL(new Blob([renderWav(kind)], { type: 'audio/wav' }))
    urls.set(kind, url)
    el = new Audio(url)
    el.preload = 'auto'
    elements.set(kind, el)
    return el
  }

  return {
    mode: 'playback',
    async prime() {
      setAudioSession('playback')
      /* iOS разрешает каждому элементу звучать только после собственного
         play() внутри жеста: проигрываем все беззвучно и сразу останавливаем. */
      await Promise.all(SIGNAL_KINDS.map(async kind => {
        const el = ensure(kind)
        el.muted = true
        try {
          await el.play()
          el.pause()
          el.currentTime = 0
        } catch {
          /* вне жеста play отклоняется: следующий play() попробует снова */
        } finally {
          el.muted = false
        }
      }))
    },
    play(kind) {
      setAudioSession('playback')
      const el = ensure(kind)
      el.currentTime = 0
      void el.play().catch(() => undefined)
    },
    dispose() {
      elements.forEach(el => el.pause())
      elements.clear()
      urls.forEach(url => URL.revokeObjectURL(url))
      urls.clear()
    },
  }
}

export function createSignaler(mode: SoundMode): Signaler {
  switch (mode) {
    case 'silent':
      return createSilent()
    case 'ambient':
      return createAmbient()
    case 'playback':
      return createPlayback()
  }
}
