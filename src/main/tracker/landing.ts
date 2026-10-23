import type { LandingReport } from '@shared/sim'

interface Grade {
  /** Нижняя граница вертикальной скорости, fpm (включительно). */
  minVs: number
  grade: string
  penalty: number
}

/** Шкала оценки касания по вертикальной скорости. */
const GRADES: Grade[] = [
  { minVs: -60, grade: 'Мягчайшая', penalty: 0 },
  { minVs: -180, grade: 'Отличная', penalty: 0 },
  { minVs: -300, grade: 'Хорошая', penalty: 0 },
  { minVs: -450, grade: 'Жёсткая', penalty: 5 },
  { minVs: -600, grade: 'Очень жёсткая', penalty: 15 },
  { minVs: -Infinity, grade: 'Тяжёлая — нужна проверка ТО', penalty: 30 }
]

export const HARD_G = 1.8

export function gradeLanding(input: Omit<LandingReport, 'grade' | 'penalty'>): LandingReport {
  const g = GRADES.find((x) => input.vsFpm >= x.minVs)!
  let penalty = g.penalty
  let grade = g.grade
  if (input.gForce > HARD_G && penalty < 30) {
    penalty += 10
    grade += `, перегрузка ${input.gForce.toFixed(2)} g`
  }
  if (input.bounces > 0) {
    penalty += 5 * input.bounces
    grade += input.bounces === 1 ? ', «козёл»' : `, «козлов»: ${input.bounces}`
  }
  return { ...input, grade, penalty }
}

/** Порог, после которого самолёт требует внеплановой проверки — пригодится экономике. */
export const needsInspection = (l: LandingReport): boolean => l.vsFpm < -600 || l.gForce > 2.0
