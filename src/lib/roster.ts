import { figuresStats, safetyZone, type AttendanceStats, type SafetyZone } from './attendanceMath'
import type { RosterRow } from './teacher'

export type RosterSort = 'roll' | 'name' | 'percentage'

export interface ScoredStudent {
  row: RosterRow
  stats: AttendanceStats
  zone: SafetyZone
}

/** Each student's figures through the same maths the student sees. */
export function scoreRoster(rows: RosterRow[], target: number): ScoredStudent[] {
  return rows.map((row) => {
    const stats = figuresStats(row, target)
    return { row, stats, zone: safetyZone(stats.percentage, target) }
  })
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Roll numbers sort numerically within their prefix (21CS9 before 21CS10).
 * By percentage, the lowest comes first because that is who needs attention,
 * and students with nothing counted yet go last.
 */
export function sortRoster(students: ScoredStudent[], by: RosterSort): ScoredStudent[] {
  const byRoll = (a: ScoredStudent, b: ScoredStudent) => collator.compare(a.row.rollNumber, b.row.rollNumber)

  return [...students].sort((a, b) => {
    if (by === 'name') return collator.compare(a.row.fullName, b.row.fullName) || byRoll(a, b)
    if (by === 'percentage') {
      const pa = a.stats.percentage
      const pb = b.stats.percentage
      if (pa === null || pb === null) return pa === pb ? byRoll(a, b) : pa === null ? 1 : -1
      // Unrounded, so two students both shown at 66.7% still order correctly.
      const ra = a.stats.present / a.stats.total
      const rb = b.stats.present / b.stats.total
      return ra - rb || byRoll(a, b)
    }
    return byRoll(a, b)
  })
}

/** Students below their course's target, the ones a teacher should talk to. */
export const atRisk = (students: ScoredStudent[]) => students.filter((student) => student.zone === 'danger')
