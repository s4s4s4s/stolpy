---
name: stolpy-map
description: Карта проекта Столпы: где что лежит, как собрать и проверить
---

# Карта проекта Столпы

Каркас. Пакет проверки дополняет разделы по мере появления кода.

## Устройство

- `src/main.tsx` - вход: регистрация service worker, монтирование `App`.
- `src/ui/App.tsx` - оболочка и маршруты по `location.hash`.
- `src/ui/screens/` - по файлу на экран, именованный экспорт без пропсов.
- `src/ui/swUpdate.ts`, `src/ui/UpdateBanner.tsx` - обновление по нажатию.
- `src/ui/health/HealthBlock.tsx` - блок отправки в Apple Health.
- `src/ui/styles/index.css` - единственный CSS-импорт, подключает остальные файлы стилей по порядку; `fonts.css` генерирует `scripts/fetch-fonts.mjs`.
- `public/` - иконки и сплэши (генерирует `scripts/make-icons.mjs`), `public/fonts` - woff2 с лицензией OFL.
- `test/_harness.ts` - `assert`, `assertEqual`, `group`, `finish`, `FakeDriver`, `withFakeLocalStorage`.
- `src/core`, `src/data`, `src/state` - ядро, данные и хранилище (появятся в следующих пакетах).

## Команды

- `npm ci` - установка.
- `npm test` - все тесты через `scripts/run-tests.mjs`; `npm run test:one -- <подстрока>` - один файл.
- `npm run build` - `tsc -b` и сборка vite в `dist`.
- `npm run icons`, `npm run fonts` - перегенерация ресурсов в `public/`.
- `npm run shots`, `npm run demo` - снимки экранов и демо-состояние.

## Правила

- Длинное и среднее тире запрещены везде, только дефис (`test/dashes.test.ts`, хук `.githooks/commit-msg`).
- Эмодзи нет. Репозиторий публичный: личных данных нет ни в коде, ни в данных, ни в документах.
- Новая версия приложения применяется только по нажатию (`registerType: 'prompt'`).
- Готово = `npm test` и `npm run build` с кодом 0.
