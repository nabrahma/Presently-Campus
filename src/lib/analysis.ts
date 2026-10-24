import { figuresStats, type AttendanceStats } from './attendanceMath'
import type { RosterRow, SessionSummary } from './teacher'

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

/* -------------------------------------------------------------------------- */
/* Pace                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How many classes a week the course has been holding, from the last four
 * weeks if it met in them, otherwise across its whole history. There is no
 * timetable, so the past is the only guide to how many classes are left.
 */
export function sessionsPerWeek(sessions: SessionSummary[], now: number): number {
  const closed = sessions.filter((session) => session.status === 'closed').map((session) => Date.parse(session.startedAt))
  if (closed.length === 0) return 0

  const recent = closed.filter((at) => at > now - 4 * WEEK_MS && at <= now)
  if (recent.length > 0) return recent.length / 4

  const span = Math.max(...closed) - Math.min(...closed)
  return closed.length / Math.max(1, span / WEEK_MS)
}

/** Classes still to come before the cutoff, at the current pace. */
export function sessionsLeft(perWeek: number, now: number, cutoff: number): number {
  return Math.max(0, Math.round((perWeek * (cutoff - now)) / WEEK_MS))
}

/* -------------------------------------------------------------------------- */
/* Projection to a cutoff                                                      */
/* -------------------------------------------------------------------------- */

export type Outlook = 'cannot_recover' | 'below' | 'heading_below' | 'safe' | 'no_data'

export interface Projection {
  row: RosterRow
  stats: AttendanceStats
  /** Of the classes left, how many they must attend to finish on target. More than are left means they cannot. */
  mustAttend: number
  /** Of the classes left, how many they may miss and still finish on target. */
  canMiss: number
  /** How many they will miss if they keep missing at their usual rate. */
  likelyToMiss: number
  outlook: Outlook
}

/**
 * Where a student will stand at the cutoff.
 *
 * The requirement is a target at a date, so this asks two questions of every
 * student: can they still make it, and will they, if they carry on as they
 * have? A student on target today who misses one class in three, with ten to
 * go and only two to spare, is heading below it.
 */
export function project(row: RosterRow, target: number, remaining: number): Projection {
  const stats = figuresStats(row, target)
  const { attended, held } = row

  // Smallest x with (attended + x) / (held + remaining) at or above target,
  // in integer space like the rest of the maths.
  const needed = Math.max(0, Math.ceil((target * (held + remaining) - 100 * attended) / 100))
  const canMiss = Math.max(0, remaining - needed)
  const likelyToMiss = held > 0 ? Math.round((remaining * (held - attended)) / held) : 0

  let outlook: Outlook
  if (held === 0 && remaining === 0) outlook = 'no_data'
  else if (needed > remaining) outlook = 'cannot_recover'
  else if (stats.percentage !== null && stats.bunkable === null) outlook = 'below'
  else if (likelyToMiss > canMiss) outlook = 'heading_below'
  else outlook = held === 0 ? 'no_data' : 'safe'

  return { row, stats, mustAttend: needed, canMiss, likelyToMiss, outlook }
}

const OUTLOOK_ORDER: Record<Outlook, number> = {
  cannot_recover: 0,
  below: 1,
  heading_below: 2,
  safe: 3,
  no_data: 4
}

/** Every active student's outlook, the most urgent first. */
export function projectRoster(roster: RosterRow[], target: number, remaining: number): Projection[] {
  return roster
    .filter((row) => row.enrolmentStatus === 'active')
    .map((row) => project(row, target, remaining))
    .sort(
      (a, b) =>
        OUTLOOK_ORDER[a.outlook] - OUTLOOK_ORDER[b.outlook] ||
        b.mustAttend - a.mustAttend ||
        a.row.rollNumber.localeCompare(b.row.rollNumber, undefined, { numeric: true })
    )
}

/* -------------------------------------------------------------------------- */
/* When absences happen                                                        */
/* -------------------------------------------------------------------------- */

/** Students a session counted for, leaving out the excused. */
const counted = (session: SessionSummary) => Math.max(0, session.expected - session.excused)

export interface GridCell {
  weekday: number
  hour: number
  sessions: number
  counted: number
  absent: number
  /** Absent share of counted students, 0 to 1. */
  rate: number
}

export interface AbsenceGrid {
  /** Weekdays that had classes, Monday first (1 = Monday … 0 = Sunday last). */
  weekdays: number[]
  /** Hours of the day that had classes, by start time. */
  hours: number[]
  cells: Map<string, GridCell>
}

export const gridKey = (weekday: number, hour: number) => `${weekday}|${hour}`

/**
 * Absence by weekday and starting hour, in the device's local time, which on
 * a campus is the campus's time. Only closed sessions count.
 */
export function absenceGrid(sessions: SessionSummary[]): AbsenceGrid {
  const cells = new Map<string, GridCell>()

  for (const session of sessions) {
    if (session.status !== 'closed' || counted(session) === 0) continue
    const start = new Date(session.startedAt)
    const weekday = start.getDay()
    const hour = start.getHours()
    const key = gridKey(weekday, hour)
    const cell = cells.get(key) ?? { weekday, hour, sessions: 0, counted: 0, absent: 0, rate: 0 }
    cell.sessions += 1
    cell.counted += counted(session)
    cell.absent += Math.max(0, counted(session) - session.present)
    cell.rate = cell.counted === 0 ? 0 : cell.absent / cell.counted
    cells.set(key, cell)
  }

  const mondayFirst = (day: number) => (day + 6) % 7
  const weekdays = [...new Set([...cells.values()].map((cell) => cell.weekday))].sort((a, b) => mondayFirst(a) - mondayFirst(b))
  const hours = [...new Set([...cells.values()].map((cell) => cell.hour))].sort((a, b) => a - b)
  return { weekdays, hours, cells }
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

export interface TrendPoint {
  sessionId: string
  at: number
  present: number
  counted: number
  /** Present share of counted students, 0 to 100. */
  percentage: number
}

/** Attendance at each closed session, oldest first. */
export function attendanceTrend(sessions: SessionSummary[]): TrendPoint[] {
  return sessions
    .filter((session) => session.status === 'closed' && counted(session) > 0)
    .map((session) => ({
      sessionId: session.sessionId,
      at: Date.parse(session.startedAt),
      present: session.present,
      counted: counted(session),
      percentage: Math.round((session.present / counted(session)) * 1000) / 10
    }))
    .sort((a, b) => a.at - b.at)
}
