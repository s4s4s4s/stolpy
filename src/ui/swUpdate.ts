/* Посредник между регистрацией service worker (main.tsx) и React. Регистрация
   стартует раньше монтирования React, так что «новая версия готова» может
   прийти до того, как кто-либо подписался - на такой случай событие
   запоминается и отдаётся подписчику сразу же, при подписке. */

export type ApplyUpdate = () => void | Promise<void>

type Handler = (apply: ApplyUpdate) => void

let pendingApply: ApplyUpdate | null = null
const handlers = new Set<Handler>()

/** Подписка на «новая версия скачана и ждёт». Возвращает отписку. */
export function onUpdateReady(handler: Handler): () => void {
  handlers.add(handler)
  if (pendingApply) handler(pendingApply)
  return () => {
    handlers.delete(handler)
  }
}

/** Зовётся из main.tsx, когда service worker сообщил о готовой версии. */
export function announceUpdateReady(apply: ApplyUpdate): void {
  pendingApply = apply
  for (const handler of handlers) handler(apply)
}
