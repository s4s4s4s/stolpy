/* Честная полоса обновления: приложение обновляется само, но не молча.
   Пока новой версии нет - не рисует ничего. Когда пришла - снизу экрана
   появляется полоса с выбором «обновить сейчас» или «позже». Стилей
   собственных не заводит: живёт на примитивах темы (`.btn`), сама полоса -
   в styles/components.css. */

import { useEffect, useState } from 'react'
import { onUpdateReady } from './swUpdate.ts'
import type { ApplyUpdate } from './swUpdate.ts'

export function UpdateBanner() {
  const [apply, setApply] = useState<ApplyUpdate | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => onUpdateReady(a => setApply(() => a)), [])

  if (!apply || dismissed) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">Готова новая версия</span>
      <div className="update-banner__actions">
        <button type="button" className="btn btn--primary" onClick={() => { void apply() }}>
          Обновить
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setDismissed(true)}>
          Позже
        </button>
      </div>
    </div>
  )
}
