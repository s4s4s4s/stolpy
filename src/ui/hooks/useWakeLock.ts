import { useCallback, useEffect, useRef, useState } from 'react'

export type WakeLockStatus = 'active' | 'released' | 'unsupported' | 'error'

export interface WakeLockControl {
  status: WakeLockStatus
  /** Запрос блокировки. Вызывать внутри обработчика касания («Начать»):
      iOS отказывает вне жеста. Безопасно вызывать повторно. */
  request: () => Promise<void>
  release: () => Promise<void>
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

/** Держит экран включённым, пока enabled. Запрос идёт только из жеста
    (request); при возврате на экран система снимает блокировку, и хук
    запрашивает её заново в try/catch. Отказ не блокирует работу: статус
    'error' даёт интерфейсу показать плашку «Экран может погаснуть». */
export function useWakeLock(enabled: boolean): WakeLockControl {
  const [status, setStatus] = useState<WakeLockStatus>(() => (supported() ? 'released' : 'unsupported'))
  const sentinel = useRef<WakeLockSentinel | null>(null)
  const wanted = useRef(false)
  const alive = useRef(true)

  const acquire = useCallback(async (): Promise<void> => {
    if (!supported()) {
      setStatus('unsupported')
      return
    }
    if (sentinel.current && !sentinel.current.released) return
    try {
      const lock = await navigator.wakeLock.request('screen')
      if (!alive.current || !wanted.current) {
        await lock.release()
        return
      }
      sentinel.current = lock
      lock.addEventListener('release', () => {
        if (sentinel.current === lock) sentinel.current = null
        if (alive.current) setStatus('released')
      })
      setStatus('active')
    } catch {
      /* отказ (низкий заряд, нет жеста, невидимая страница) - состояние, а не сбой */
      if (alive.current) setStatus('error')
    }
  }, [])

  const request = useCallback(async (): Promise<void> => {
    wanted.current = true
    await acquire()
  }, [acquire])

  const release = useCallback(async (): Promise<void> => {
    wanted.current = false
    const lock = sentinel.current
    sentinel.current = null
    if (lock && !lock.released) {
      try {
        await lock.release()
      } catch {
        /* уже снята системой */
      }
    }
    if (alive.current) setStatus(supported() ? 'released' : 'unsupported')
  }, [])

  useEffect(() => {
    if (!enabled) void release()
  }, [enabled, release])

  useEffect(() => {
    alive.current = true
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && wanted.current) void acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive.current = false
      wanted.current = false
      document.removeEventListener('visibilitychange', onVisibility)
      const lock = sentinel.current
      sentinel.current = null
      if (lock && !lock.released) void lock.release().catch(() => undefined)
    }
  }, [acquire])

  return { status, request, release }
}
