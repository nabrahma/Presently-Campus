import { useEffect } from 'react'
import { run, toCourse, toFigures, toMark, toSession, type Row } from './api'
import { invalidate, useRemote } from './remote'
import { useUserId } from './session'
import { supabase } from './supabaseClient'
import type { AttendanceMark, ClassSession, Course, Figures, SessionOutcome } from '../types'

export interface StudentCourse {
  course: Course
  teacherName: string
  joinedAt: string
  figures: Figures
}

/**
 * Everything a student's screens show, fetched together. It is small — a
 * term's sessions across a handful of courses, and the student's own marks —
 * and every screen needs most of it, so one request set serves them all.
 */
export interface StudentSnapshot {
  courses: StudentCourse[]
  sessions: ClassSession[]
  marks: AttendanceMark[]
}

export const studentKey = (userId: string) => `${userId}:student`

export async function loadStudentSnapshot(userId: string): Promise<StudentSnapshot> {
  // Row Level Security already limits courses and sessions to the ones this
  // student is enrolled in, so they are fetched alongside the enrolments
  // rather than after them.
  const [enrolments, courses, figures, sessions, marks] = await Promise.all([
    run((db) => db.from('enrolments').select('course_id, joined_at').eq('student_id', userId).eq('status', 'active')),
    run((db) => db.from('courses').select('*, teacher:profiles!courses_teacher_id_fkey(full_name)')),
    run((db) => db.rpc('my_figures')),
    run((db) => db.from('class_sessions').select('*').order('started_at', { ascending: false })),
    run((db) => db.from('attendance').select('*').eq('student_id', userId))
  ])

  const joined = new Map((enrolments as Row[]).map((row) => [String(row.course_id), String(row.joined_at)]))
  const figuresByCourse = new Map((figures as Row[]).map((row) => [String(row.course_id), toFigures(row)]))

  return {
    courses: (courses as Row[])
      .filter((row) => joined.has(String(row.id)))
      .map((row) => ({
        course: toCourse(row),
        teacherName: String((row.teacher as Row | null)?.full_name ?? ''),
        joinedAt: joined.get(String(row.id)) ?? '',
        figures: figuresByCourse.get(String(row.id)) ?? toFigures(undefined)
      }))
      .sort((a, b) => (a.course.code || a.course.name).localeCompare(b.course.code || b.course.name)),
    sessions: (sessions as Row[]).filter((row) => joined.has(String(row.course_id))).map(toSession),
    marks: (marks as Row[]).map(toMark)
  }
}

export function useStudentData() {
  const userId = useUserId()
  return useRemote(studentKey(userId), () => loadStudentSnapshot(userId))
}

/** Joins a course by its code and returns the course's id. */
export async function joinCourse(userId: string, code: string): Promise<string> {
  const courseId = await run((db) => db.rpc('join_course', { p_code: code }))
  await invalidate(studentKey(userId))
  return String(courseId)
}

/**
 * Keeps a student's screens current while a class starts or ends: a session
 * opening in one of their courses is what puts the Scan button in front of
 * them. Realtime delivers only rows Row Level Security lets them read.
 */
export function useSessionUpdates(userId: string) {
  useEffect(() => {
    const client = supabase
    if (!client) return

    const channel = client
      .channel(`student-sessions:${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'class_sessions' }, () => {
        void invalidate(studentKey(userId))
      })
      .subscribe()

    return () => {
      void client.removeChannel(channel)
    }
  }, [userId])
}

/* -------------------------------------------------------------------------- */
/* Derived views                                                               */
/* -------------------------------------------------------------------------- */

export interface HistoryEntry {
  session: ClassSession
  outcome: SessionOutcome
  mark: AttendanceMark | null
}

/**
 * A student's record in one course, newest first, by the same rule the server
 * counts with: a closed session is absent unless marked, but only if it
 * started after the student joined. Earlier sessions are left out unless they
 * carry a mark.
 */
export function courseHistory(
  courseId: string,
  joinedAt: string,
  sessions: ClassSession[],
  marks: AttendanceMark[]
): HistoryEntry[] {
  const markFor = new Map(marks.map((mark) => [mark.sessionId, mark]))
  const joined = Date.parse(joinedAt)

  return sessions
    .filter((session) => session.courseId === courseId)
    .flatMap((session): HistoryEntry[] => {
      const mark = markFor.get(session.id) ?? null
      if (!mark && Date.parse(session.startedAt) < joined) return []

      let outcome: SessionOutcome
      if (session.status === 'cancelled') outcome = 'cancelled'
      else if (mark) outcome = mark.status
      else if (session.status === 'open') outcome = 'open'
      else outcome = 'absent'

      return [{ session, outcome, mark }]
    })
    .sort((a, b) => b.session.startedAt.localeCompare(a.session.startedAt))
}

export interface OpenClass {
  session: ClassSession
  course: Course
  mark: AttendanceMark | null
}

/** Classes taking attendance right now in the student's courses. */
export function openClasses(snapshot: StudentSnapshot): OpenClass[] {
  const courses = new Map(snapshot.courses.map((entry) => [entry.course.id, entry.course]))
  const markFor = new Map(snapshot.marks.map((mark) => [mark.sessionId, mark]))

  return snapshot.sessions.flatMap((session) => {
    const course = courses.get(session.courseId)
    if (session.status !== 'open' || !course) return []
    return [{ session, course, mark: markFor.get(session.id) ?? null }]
  })
}
