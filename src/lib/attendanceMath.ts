import { MAX_TARGET, MIN_TARGET, type Figures } from '../types'

/**
 * The four outcomes the maths was written around. Present and absent count;
 * cancelled and holiday are recorded but excluded from both sides, which is
 * exactly how an excused class is treated.
 */
export type CountedStatus = 'present' | 'absent' | 'cancelled' | 'holiday'

export interface AttendanceStats {
  present: number
  absent: number
  cancelled: number
  holiday: number
  /** Classes that count toward the percentage: present + absent. */
  total: number
  /** Every record, including the ones excluded from the percentage. */
  recorded: number
  percentage: number | null
  /** Classes that can still be missed while staying on target, or null if below target. */
  bunkable: number | null
  /** Consecutive classes needed to reach target, or null if already on target. */
  comeback: number | null
}

export const EMPTY_STATS: AttendanceStats = {
  present: 0,
  absent: 0,
  cancelled: 0,
  holiday: 0,
  total: 0,
  recorded: 0,
  percentage: null,
  bunkable: null,
  comeback: null
}

/** Guards against a stored target of 0, NaN, or something above 100. */
export function normalizeTarget(target: number): number {
  if (!Number.isFinite(target)) return 75
  return Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(target)))
}

/**
 * Floating point makes `0.75 * 20` land at 14.999999999999998, which would turn
 * an exact boundary into an off-by-one. Comparisons are done in integer space
 * instead: `present * 100 >= target * total`.
 */
export function attendanceStats(
  records: ReadonlyArray<{ status: CountedStatus }>,
  targetPercentage: number
): AttendanceStats {
  let present = 0
  let absent = 0
  let cancelled = 0
  let holiday = 0

  for (const record of records) {
    if (record.status === 'present') present += 1
    else if (record.status === 'absent') absent += 1
    else if (record.status === 'cancelled') cancelled += 1
    else if (record.status === 'holiday') holiday += 1
  }

  const total = present + absent
  const recorded = present + absent + cancelled + holiday
  const target = normalizeTarget(targetPercentage)

  if (total === 0) {
    return { ...EMPTY_STATS, present, absent, cancelled, holiday, total, recorded }
  }

  const percentage = Math.round((present / total) * 1000) / 10
  const onTarget = present * 100 >= target * total

  if (onTarget) {
    // Largest n where present / (total + n) still meets target.
    const bunkable = Math.max(0, Math.floor((present * 100 - target * total) / target))
    return { present, absent, cancelled, holiday, total, recorded, percentage, bunkable, comeback: null }
  }

  // A 100% target can never be recovered once a class has been missed.
  if (target >= 100) {
    return { present, absent, cancelled, holiday, total, recorded, percentage, bunkable: null, comeback: null }
  }

  // Smallest n where (present + n) / (total + n) meets target.
  const comeback = Math.max(1, Math.ceil((target * total - present * 100) / (100 - target)))
  return { present, absent, cancelled, holiday, total, recorded, percentage, bunkable: null, comeback }
}

/**
 * The same figures for a course, from the server's counts.
 *
 * `held` already leaves out excused classes, so present + absent is `held`
 * and excused rides along as holiday: counted nowhere, shown for the record.
 */
export function figuresStats({ attended, held, excused }: Figures, targetPercentage: number): AttendanceStats {
  const present = Math.max(0, attended)
  const absent = Math.max(0, held - present)
  return attendanceStats(
    [
      ...Array.from({ length: present }, () => ({ status: 'present' as const })),
      ...Array.from({ length: absent }, () => ({ status: 'absent' as const })),
      ...Array.from({ length: Math.max(0, excused) }, () => ({ status: 'holiday' as const }))
    ],
    targetPercentage
  )
}

export type SafetyZone = 'neutral' | 'danger' | 'caution' | 'safe'

export function safetyZone(percentage: number | null, target: number): SafetyZone {
  if (percentage === null) return 'neutral'
  const normalized = normalizeTarget(target)
  if (percentage < normalized) return 'danger'
  if (percentage < normalized + 5) return 'caution'
  return 'safe'
}

/** True when the subject meets its target, decided in integer space. */
export function isOnTarget(stats: AttendanceStats): boolean {
  return stats.bunkable !== null
}

export interface Standing<T> {
  item: T
  stats: AttendanceStats
  target: number
}

/**
 * Where a set of subjects stands, judged the way colleges judge it: each
 * subject against its own target.
 *
 * There is deliberately no pooled figure. A healthy overall percentage can sit
 * on top of one subject that is below the line, and that one subject is what
 * decides whether someone can sit the exam. Nor are spare classes summed:
 * three spare in one subject and two in another is not five to spend anywhere.
 *
 *   lowest      the subject furthest below, or closest to, its own target
 *   leastSpare  of the subjects on target, the one with the fewest to spare
 *   below       every subject under target, worst first
 *
 * Subjects with nothing counted yet have no standing and are left out.
 */
export function standings<T>(entries: Standing<T>[]) {
  const counted = entries.filter((entry) => entry.stats.total > 0)

  // Percentage points above (or below) the subject's own target, unrounded so
  // two subjects that both display 75.0% still order correctly.
  const gap = ({ stats, target }: Standing<T>) =>
    (stats.present / stats.total) * 100 - normalizeTarget(target)

  const byGap = [...counted].sort((a, b) => gap(a) - gap(b))

  const onTarget = counted
    .filter((entry) => isOnTarget(entry.stats))
    .sort((a, b) => (a.stats.bunkable ?? 0) - (b.stats.bunkable ?? 0) || gap(a) - gap(b))

  return {
    lowest: byGap[0] ?? null,
    leastSpare: onTarget[0] ?? null,
    below: byGap.filter((entry) => !isOnTarget(entry.stats))
  }
}
