import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 'prompt', а не 'autoUpdate': новая версия скачивается сама, но подменяет
      // экран только по нажатию человека. Во время тренировки перезагрузка
      // под руками выглядит как сбой и может прервать запись подхода.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        id: './',
        name: 'Столпы',
        short_name: 'Столпы',
        description: 'Запись тренировок по пяти столпам: сила, зона 2, интервалы, мобильность, баланс',
        lang: 'ru',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: './',
        scope: '.',
        categories: ['health', 'fitness', 'lifestyle'],
        background_color: '#131519',
        theme_color: '#131519',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        /* Сеть приложению не нужна: данные лежат на телефоне. Кэшируем статику:
           код, стили, шрифты, иконки и сплэши iOS (без них при офлайн-запуске
           белый экран). Для png и svg перечислены явные маски, чтобы случайный
           крупный файл в public/ не раздул прекеш молча. */
        globPatterns: [
          '**/*.{js,css,html,woff2,svg}',
          'icon-*.png',
          'apple-touch-icon.png',
          'splash-*.png'
        ]
      }
    })
  ]
})
