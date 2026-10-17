import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './ui/styles/index.css'
import { App } from './ui/App.tsx'
import { announceUpdateReady } from './ui/swUpdate.ts'

/* Сеть приложению не нужна: данные лежат на телефоне, service worker нужен
   для офлайн-работы. Новая версия скачивается сама, но НЕ подменяет экран
   молча: приложение говорит об этом полосой и ждёт нажатия. Перезагрузка
   под руками посреди подхода выглядит как сбой, а не как забота. */
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    announceUpdateReady(() => updateSW(true))
  }
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
