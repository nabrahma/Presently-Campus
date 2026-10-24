import { describe, expect, it } from 'vitest'
import { absenceGrid, attendanceTrend, gridKey, project, projectRoster, sessionsLeft, sessionsPerWeek } from './analysis'
import type { RosterRow, SessionSummary } from './teacher'

const NOW = new Date(2026, 9, 24, 12, 0).getTime()
const daysAgo = (days: number, hour = 10) => {
  const date = new Date(NOW - days * 86_400_000)
  date.setHours(hour, 0, 0, 0)
  return date.toISOString()
}

const summary = (id: string, startedAt: string, expected: number, present: number, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  sessionId: id,
  startedAt,
  closedAt: startedAt,
  status: 'closed',
  note: null,
  expected,
  present,
  excused: 0,
  flagged: 0,
  ...overrides
})

const row = (rollNumber: string, attended: number, held: number): RosterRow => ({
  studentId: rollNumber,
  rollNumber,
  fullName: rollNumber,
  enrolmentStatus: 'active',
  joinedAt: '',
  attended,
  held,
  excused: 0
})

describe('pace', () => {
  it('counts classes a week over the last four weeks', () => {
    const sessions = Array.from({ length: 12 }, (_, index) => summary(`s${index}`, daysAgo(index * 2 + 1), 10, 9))
    expect(sessionsPerWeek(sessions, NOW)).toBe(3)
  })

  it('falls back to the whole history when the last month had none', () => {
    const sessions = [summary('a', daysAgo(70), 1, 1), summary('b', daysAgo(63), 1, 1), summary('c', daysAgo(56), 1, 1)]
    expect(sessionsPerWeek(sessions, NOW)).toBeCloseTo(1.5)
  })

  it('ignores sessions that did not happen, and projects what is left', () => {
    expect(sessionsPerWeek([summary('a', daysAgo(2), 10, 9, { status: 'cancelled' })], NOW)).toBe(0)
    expect(sessionsLeft(3, NOW, NOW + 4 * 7 * 86_400_000)).toBe(12)
    expect(sessionsLeft(3, NOW, NOW - 1)).toBe(0)
  })
})

describe('project', () => {
  it('needs nothing and spares plenty for a student well above target', () => {
    // 18 of 20 now; with 10 more, 75% of 30 is 22.5, so 5 must be attended.
    expect(project(row('a', 18, 20), 75, 10)).toMatchObject({ mustAttend: 5, canMiss: 5, likelyToMiss: 1, outlook: 'safe' })
  })

  it('warns about a student on target today who is missing too many to finish there', () => {
    // 15 of 20 is exactly 75%. Of the next 10, 8 must be attended (23 of 30), so 2
    // may be missed; missing one in four means about 3.
    expect(project(row('b', 15, 20), 75, 10)).toMatchObject({ mustAttend: 8, canMiss: 2, likelyToMiss: 3, outlook: 'heading_below' })
  })

  it('shows what a student below target must do', () => {
    expect(project(row('c', 12, 20), 75, 20)).toMatchObject({ mustAttend: 18, outlook: 'below' })
  })

  it('says when the target can no longer be reached by the cutoff', () => {
    // 75% of 24 is 18: 13 more, with only 4 left.
    expect(project(row('d', 5, 20), 75, 4)).toMatchObject({ mustAttend: 13, outlook: 'cannot_recover' })
  })

  it('lists the most urgent first and leaves removed students out', () => {
    const removed = { ...row('gone', 0, 20), enrolmentStatus: 'removed' as const }
    const order = projectRoster([row('a', 18, 20), row('d', 5, 20), removed, row('b', 15, 20)], 75, 10).map((item) => item.row.rollNumber)
    expect(order).toEqual(['d', 'b', 'a'])
  })
})

describe('absenceGrid', () => {
  it('groups closed sessions by weekday and hour, leaving excused students out', () => {
    // 21 Oct 2026 is a Wednesday; 19 Oct a Monday.
    const wednesday = new Date(2026, 9, 21, 9, 5).toISOString()
    const wednesdayLater = new Date(2026, 9, 14, 9, 55).toISOString()
    const monday = new Date(2026, 9, 19, 14, 0).toISOString()
    const grid = absenceGrid([
      summary('a', wednesday, 10, 8, { excused: 2 }),
      summary('b', wednesdayLater, 10, 5),
      summary('c', monday, 20, 19),
      summary('d', monday, 20, 0, { status: 'cancelled' })
    ])

    expect(grid.weekdays).toEqual([1, 3])
    expect(grid.hours).toEqual([9, 14])
    // Wednesdays at 9: 8 counted with all present, then 10 counted with 5 absent.
    expect(grid.cells.get(gridKey(3, 9))).toMatchObject({ sessions: 2, counted: 18, absent: 5 })
    expect(grid.cells.get(gridKey(1, 14))?.rate).toBeCloseTo(0.05)
  })
})

describe('attendanceTrend', () => {
  it('gives each closed session’s attendance, oldest first', () => {
    const trend = attendanceTrend([
      summary('new', daysAgo(1), 40, 30),
      summary('old', daysAgo(8), 40, 36, { excused: 4 }),
      summary('open', daysAgo(0), 40, 10, { status: 'open' })
    ])
    expect(trend.map((point) => [point.sessionId, point.percentage])).toEqual([
      ['old', 100],
      ['new', 75]
    ])
  })
})
