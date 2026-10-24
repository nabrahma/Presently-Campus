import { run, type Row } from './api'
import { figuresStats } from './attendanceMath'
import { toCsv } from './csv'
import { dateKey } from './date'
import type { RosterRow } from './teacher'
import type { Course } from '../types'

export interface ExportMark {
  status: 'present' | 'excused'
  method: 'qr' | 'manual'
  markedAt: string
  flags: string[]
}

export interface ExportStudent {
  id: string
  rollNumber: string
  fullName: string
  enrolmentStatus: 'active' | 'removed'
  joinedAt: string
  marks: Record<string, ExportMark>
}

export interface CourseExport {
  sessions: Array<{ id: string; startedAt: string }>
  students: ExportStudent[]
}

export async function loadCourseExport(courseId: string): Promise<CourseExport> {
  const answer = (await run((db) => db.rpc('course_export', { p_course: courseId }))) as Row
  return {
    sessions: ((answer.sessions as Row[]) ?? []).map((row) => ({ id: String(row.id), startedAt: String(row.started_at) })),
    students: ((answer.students as Row[]) ?? []).map((row) => ({
      id: String(row.id),
      rollNumber: String(row.roll_number ?? ''),
      fullName: String(row.full_name ?? ''),
      enrolmentStatus: row.enrolment_status === 'removed' ? 'removed' : 'active',
      joinedAt: String(row.joined_at),
      marks: Object.fromEntries(
        Object.entries((row.marks as Record<string, Row>) ?? {}).map(([sessionId, mark]) => [
          sessionId,
          {
            status: mark.status === 'excused' ? 'excused' : 'present',
            method: mark.method === 'qr' ? 'qr' : 'manual',
            markedAt: String(mark.marked_at),
            flags: Array.isArray(mark.flags) ? mark.flags.map(String) : []
          }
        ])
      )
    }))
  }
}

const pad = (value: number) => String(value).padStart(2, '0')

/** "2026-10-21 10:02" in local time: sortable, and readable in a spreadsheet. */
function stamp(iso: string): string {
  const date = new Date(iso)
  return `${dateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * What a session meant for a student, by the rule the figures use: marked,
 * absent if enrolled before it began, otherwise nothing to say.
 */
function outcome(student: ExportStudent, session: { id: string; startedAt: string }): 'present' | 'excused' | 'absent' | null {
  const mark = student.marks[session.id]
  if (mark) return mark.status
  return Date.parse(session.startedAt) >= Date.parse(student.joinedAt) ? 'absent' : null
}

const LETTER = { present: 'P', excused: 'E', absent: 'A' } as const

/**
 * The register: one row per student, one column per class, with the figures
 * the roster shows. Figures come from the server's roster rather than being
 * recounted here, so the sheet and the screen cannot disagree.
 */
export function registerCsv(course: Pick<Course, 'targetPercentage'>, data: CourseExport, roster: RosterRow[]): string {
  const figures = new Map(roster.map((row) => [row.studentId, row]))

  return toCsv(
    ['Roll number', 'Name', 'Enrolment', 'Attended', 'Held', 'Excused', 'Percentage', ...data.sessions.map((session) => stamp(session.startedAt))],
    data.students.map((student) => {
      const row = figures.get(student.id)
      const stats = row ? figuresStats(row, course.targetPercentage) : null
      return [
        student.rollNumber,
        student.fullName,
        student.enrolmentStatus,
        row?.attended ?? '',
        row?.held ?? '',
        row?.excused ?? '',
        stats?.percentage ?? '',
        ...data.sessions.map((session) => {
          const result = outcome(student, session)
          return result ? LETTER[result] : ''
        })
      ]
    })
  )
}

/**
 * Every mark on its own row, with how and when it was made and any flags:
 * the shape analysis tools want.
 */
export function marksCsv(data: CourseExport): string {
  return toCsv(
    ['roll_number', 'name', 'session_started_at', 'status', 'method', 'marked_at', 'flags'],
    data.students.flatMap((student) =>
      data.sessions.flatMap((session) => {
        const result = outcome(student, session)
        if (!result) return []
        const mark = student.marks[session.id]
        return [
          [
            student.rollNumber,
            student.fullName,
            new Date(session.startedAt).toISOString(),
            result,
            mark?.method ?? '',
            mark ? new Date(mark.markedAt).toISOString() : '',
            mark?.flags.join(' ') ?? ''
          ]
        ]
      })
    )
  )
}

/** e.g. "CS301-A-attendance-2026-10-24.csv" */
export function exportFilename(course: Pick<Course, 'code' | 'section' | 'name'>, kind: 'register' | 'marks', today: string): string {
  const base = [course.code || course.name, course.section].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]+/g, '-')
  return `${base}-${kind === 'register' ? 'attendance' : 'marks'}-${today}.csv`
}
