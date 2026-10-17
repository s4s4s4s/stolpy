import { useEffect, useState } from 'react'

/** Текущее время в миллисекундах. Тик по интервалу плюс мгновенный пересчёт
    при возврате в приложение: фоновые интервалы браузер замораживает, поэтому
    правда всегда считается от меток, а этот хук лишь заставляет перерисоваться. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const refresh = (): void => setNow(Date.now())
    refresh()
    const timer = window.setInterval(refresh, intervalMs)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [intervalMs])

  return now
}
