import type { AppState, DateISO, ExerciseLibrary, GoalsSource } from './types'
import { PILLARS } from './types'
import { addDays, weekStartOf } from './dates'
import { weeksWord } from './plural'
import { countedSessions, weekProgress } from './week'

/* Серия недель (раздел 4.6 плана): считаем назад от прошлой недели, пока все
   пять столпов выполнены. Текущая неделя прибавляется, если уже выполнена
   целиком; пока она не выполнена, серию не обрывает и не растит. */

export interface WeekStreak {
  weeks: number               // длина серии, включая текущую неделю, если она выполнена
  currentReached: boolean     // текущая неделя выполнена целиком
  currentPillarsDone: number  // «N из 5» по текущей неделе
}

export function weekStreak(
  state: AppState, today: DateISO, settings?: GoalsSource, library?: ExerciseLibrary,
): WeekStreak {
  const currentStart = weekStartOf(today)
  const current = weekProgress(state, currentStart, settings, library)
  const currentPillarsDone = PILLARS.filter(p => current.pillars[p].done).length

  // Глубже самой ранней сессии идти незачем: в пустой неделе столпы не выполнены.
  let earliest: DateISO | null = null
  for (const session of countedSessions(state)) {
    if (earliest === null || session.date < earliest) earliest = session.date
  }

  let weeks = 0
  if (earliest !== null) {
    const earliestStart = weekStartOf(earliest)
    for (let start = addDays(currentStart, -7); start >= earliestStart; start = addDays(start, -7)) {
      if (!weekProgress(state, start, settings, library).allDone) break
      weeks++
    }
  }
  if (current.allDone) weeks++
  return { weeks, currentReached: current.allDone, currentPillarsDone }
}

/* Подпись серии для главного экрана; при нуле подписи нет вовсе. */
export function formatStreak(weeks: number): string | null {
  if (!Number.isInteger(weeks) || weeks <= 0) return null
  return `серия ${weeks} ${weeksWord(weeks)}`
}
