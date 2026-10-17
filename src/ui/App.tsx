/* Временная оболочка каркаса: показывает заглушку экрана по location.hash.
   Пакет оболочки UI заменяет файл целиком (маршрутизатор, состояние, баннеры). */

import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { UpdateBanner } from './UpdateBanner.tsx'
import { Home } from './screens/Home.tsx'
import { Onboarding } from './screens/Onboarding.tsx'
import { Start } from './screens/Start.tsx'
import { Library } from './screens/Library.tsx'
import { CustomExercise } from './screens/CustomExercise.tsx'
import { Session } from './screens/Session.tsx'
import { External } from './screens/External.tsx'
import { Progress } from './screens/Progress.tsx'
import { SessionView } from './screens/SessionView.tsx'
import { ExerciseView } from './screens/ExerciseView.tsx'
import { Tests } from './screens/Tests.tsx'
import { TestView } from './screens/TestView.tsx'
import { Program } from './screens/Program.tsx'
import { Settings } from './screens/Settings.tsx'

/* Маршруты плана (раздел 6): '#/', '#/start', '#/progress/session/:id' и так далее.
   Для '#/library/new' (создание своего упражнения) путь выбран каркасом,
   пакет оболочки вправе его переопределить. */
const ROUTES: Record<string, () => ReactElement> = {
  '': Home,
  onboarding: Onboarding,
  start: Start,
  library: Library,
  'library/new': CustomExercise,
  session: Session,
  external: External,
  progress: Progress,
  'progress/session': SessionView,
  'progress/exercise': ExerciseView,
  tests: Tests,
  'tests/id': TestView,
  program: Program,
  settings: Settings
}

/** Ключ маршрута из хеша: сегменты пути без параметра :id в конце. */
function routeKey(hash: string): string {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  const [head, second, third] = parts
  if (head === 'progress' && (second === 'session' || second === 'exercise') && third) return `progress/${second}`
  if (head === 'tests' && second) return 'tests/id'
  if (head === 'library' && second === 'new') return 'library/new'
  return head ?? ''
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash)

  useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const Screen = ROUTES[routeKey(hash)] ?? Home

  return (
    <>
      <Screen />
      <UpdateBanner />
    </>
  )
}
