import { useEffect, useState } from 'react'

export interface StandaloneInfo {
  /** iPhone, iPad (включая iPadOS, который называет себя Mac). */
  ios: boolean
  /** Запущено с главного экрана: navigator.standalone или display-mode: standalone. */
  standalone: boolean
}

const DISPLAY_MODE_QUERY = '(display-mode: standalone)'

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false
  if (/iPad|iPhone|iPod/.test(navigator.userAgent)) return true
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true
  const media = typeof window.matchMedia === 'function' && window.matchMedia(DISPLAY_MODE_QUERY).matches
  return legacy || media
}

/** Режим установленного приложения. Нужен, чтобы подсказать «Добавить на
    главный экран» на iOS: Wake Lock, push и постоянное хранилище там
    работают надёжно только в установленном виде. */
export function useStandalone(): StandaloneInfo {
  const [info, setInfo] = useState<StandaloneInfo>(() => ({ ios: detectIos(), standalone: detectStandalone() }))

  useEffect(() => {
    const update = (): void => setInfo({ ios: detectIos(), standalone: detectStandalone() })
    update()
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DISPLAY_MODE_QUERY)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  return info
}
