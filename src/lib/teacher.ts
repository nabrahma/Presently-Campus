import { run, toCourse, toFigures, toMark, toSession, type Row } from './api'
import { invalidate, useRemote } from './remote'
import { useUserId } from './session'
import type { AttendanceMark, ClassSession, Course, Figures, SessionStatus } from '../types'

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export interface CourseOverview {
  students: number
  sessionsHeld: number
  averagePercentage: number | null
  atRisk: number
  openSessionId: string | null
}

export interface TeacherCourse {
  course: Course
  overview: CourseOverview
}

export interface RosterRow extends Figures {
  studentId: string
  fullName: string
  rollNumber: string
  enrolmentStatus: 'active' | 'removed'
  joinedAt: string
}

export interface SessionSummary {
  sessionId: string
  startedAt: string
  closedAt: string | null
  status: SessionStatus
  note: string | null
  expected: number
  present: number
  excused: number
  flagged: number
}

export interface CourseDetail {
  course: Course
  roster: RosterRow[]
  sessions: SessionSummary[]
}

export type ReportStatus = 'present' | 'excused' | 'absent'

export interface SessionReportRow {
  studentId: string
  fullName: string
  rollNumber: string
  status: ReportStatus
  method: 'qr' | 'manual' | null
  markedAt: string | null
  reason: string | null
  flags: string[]
  joinedAfterStart: boolean
}

export interface SessionDetail {
  session: ClassSession
  course: Course
  report: SessionReportRow[]
}

export interface CourseDraft {
  name: string
  code: string
  section: string
  term: string
  targetPercentage: number
  lateAfterMinutes: number
}

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

// Every teacher key starts with the user id, so one invalidation by prefix
// refreshes all of a teacher's screens after a write.
export const teacherPrefix = (userId: string) => `${userId}:teacher`
const coursesKey = (userId: string) => `${teacherPrefix(userId)}:courses`
const courseKey = (userId: string, courseId: string) => `${teacherPrefix(userId)}:course:${courseId}`
const sessionKey = (userId: string, sessionId: string) => `${teacherPrefix(userId)}:session:${sessionId}`

const refreshAll = (userId: string) => invalidate(teacherPrefix(userId))

/* -------------------------------------------------------------------------- */
/* Mapping                                                                     */
/* -------------------------------------------------------------------------- */

const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)

function toOverview(row: Row | undefined): CourseOverview {
  return {
    students: number(row?.students),
    sessionsHeld: number(row?.sessions_held),
    averagePercentage:
      row?.average_percentage === null || row?.average_percentage === undefined ? null : Number(row.average_percentage),
    atRisk: number(row?.at_risk),
    openSessionId: row?.open_session_id ? String(row.open_session_id) : null
  }
}

function toRosterRow(row: Row): RosterRow {
  return {
    ...toFigures(row),
    studentId: String(row.student_id),
    fullName: String(row.full_name ?? ''),
    rollNumber: String(row.roll_number ?? ''),
    enrolmentStatus: row.enrolment_status === 'removed' ? 'removed' : 'active',
    joinedAt: String(row.joined_at ?? '')
  }
}

function toSummary(row: Row): SessionSummary {
  return {
    sessionId: String(row.session_id),
    startedAt: String(row.started_at),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    status: row.status as SessionStatus,
    note: row.note ? String(row.note) : null,
    expected: number(row.expected),
    present: number(row.present),
    excused: number(row.excused),
    flagged: number(row.flagged)
  }
}

function toReportRow(row: Row): SessionReportRow {
  return {
    studentId: String(row.student_id),
    fullName: String(row.full_name ?? ''),
    rollNumber: String(row.roll_number ?? ''),
    status: (row.status as ReportStatus) ?? 'absent',
    method: row.method === 'qr' || row.method === 'manual' ? row.method : null,
    markedAt: row.marked_at ? String(row.marked_at) : null,
    reason: row.reason ? String(row.reason) : null,
    flags: Array.isArray(row.flags) ? row.flags.map(String) : [],
    joinedAfterStart: Boolean(row.joined_after_start)
  }
}

const draftPayload = (draft: Partial<CourseDraft> & { archived?: boolean }) => {
  const payload: Row = {}
  if (draft.name !== undefined) payload.name = draft.name.trim()
  if (draft.code !== undefined) payload.code = draft.code.trim().toUpperCase()
  if (draft.section !== undefined) payload.section = draft.section.trim().toUpperCase()
  if (draft.term !== undefined) payload.term = draft.term.trim()
  if (draft.targetPercentage !== undefined) payload.target_percentage = draft.targetPercentage
  if (draft.lateAfterMinutes !== undefined) payload.late_after_minutes = draft.lateAfterMinutes
  if (draft.archived !== undefined) payload.archived = draft.archived
  return payload
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function loadTeacherCourses(): Promise<TeacherCourse[]> {
  const [courses, overview] = await Promise.all([
    run((db) => db.from('courses').select('*').order('created_at', { ascending: false })),
    run((db) => db.rpc('my_courses_overview'))
  ])
  const byCourse = new Map((overview as Row[]).map((row) => [String(row.course_id), row]))
  return (courses as Row[]).map((row) => ({
    course: toCourse(row),
    overview: toOverview(byCourse.get(String(row.id)))
  }))
}

export async function loadCourseDetail(courseId: string): Promise<CourseDetail | null> {
  const course = await run((db) => db.from('courses').select('*').eq('id', courseId).maybeSingle())
  if (!course) return null

  const [roster, sessions] = await Promise.all([
    run((db) => db.rpc('course_report', { p_course: courseId })),
    run((db) => db.rpc('course_sessions_summary', { p_course: courseId }))
  ])

  return {
    course: toCourse(course as Row),
    roster: (roster as Row[]).map(toRosterRow),
    sessions: (sessions as Row[]).map(toSummary)
  }
}

export async function loadSessionDetail(sessionId: string): Promise<SessionDetail | null> {
  const session = await run((db) => db.from('class_sessions').select('*, course:courses(*)').eq('id', sessionId).maybeSingle())
  if (!session) return null

  const report = await run((db) => db.rpc('session_report', { p_session: sessionId }))
  return {
    session: toSession(session as Row),
    course: toCourse((session as Row).course as Row),
    report: (report as Row[]).map(toReportRow)
  }
}

export function useTeacherCourses() {
  const userId = useUserId()
  return useRemote(coursesKey(userId), loadTeacherCourses)
}

export function useCourseDetail(courseId: string | undefined) {
  const userId = useUserId()
  return useRemote(courseId ? courseKey(userId, courseId) : null, () => loadCourseDetail(courseId!))
}

export function useSessionDetail(sessionId: string | undefined) {
  const userId = useUserId()
  return useRemote(sessionId ? sessionKey(userId, sessionId) : null, () => loadSessionDetail(sessionId!))
}

/** Fetches a session's report again, for the live count and after marks. */
export const refreshSession = (userId: string, sessionId: string) => invalidate(sessionKey(userId, sessionId))

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function createCourse(userId: string, draft: CourseDraft): Promise<Course> {
  const row = await run((db) => db.from('courses').insert(draftPayload(draft)).select('*').single())
  await refreshAll(userId)
  return toCourse(row as Row)
}

export async function updateCourse(
  userId: string,
  courseId: string,
  changes: Partial<CourseDraft> & { archived?: boolean }
): Promise<void> {
  await run((db) => db.from('courses').update(draftPayload(changes)).eq('id', courseId).select('id').single())
  await refreshAll(userId)
}

export interface StartedSession {
  session: ClassSession
  /** The session's QR secret, base64. Present once QR attendance exists. */
  secret: string | null
  /** The server's clock at the moment the session started, in ms. */
  serverTime: number
}

export async function startSession(userId: string, courseId: string): Promise<StartedSession> {
  const sentAt = Date.now()
  const answer = (await run((db) => db.rpc('start_session', { p_course: courseId }))) as Row
  await refreshAll(userId)
  return {
    session: toSession(answer.session as Row),
    secret: answer.secret ? String(answer.secret) : null,
    serverTime: number(answer.server_time) || sentAt
  }
}

async function sessionAction(userId: string, action: string, sessionId: string): Promise<void> {
  await run((db) => db.rpc(action, { p_session: sessionId }))
  await refreshAll(userId)
}

export const closeSession = (userId: string, sessionId: string) => sessionAction(userId, 'close_session', sessionId)
export const cancelSession = (userId: string, sessionId: string) => sessionAction(userId, 'cancel_session', sessionId)
export const reopenSession = (userId: string, sessionId: string) => sessionAction(userId, 'reopen_session', sessionId)

export async function teacherMark(
  userId: string,
  sessionId: string,
  studentId: string,
  status: ReportStatus,
  reason: string
): Promise<AttendanceMark | null> {
  const row = await run((db) =>
    db.rpc('teacher_mark', { p_session: sessionId, p_student: studentId, p_status: status, p_reason: reason })
  )
  await refreshAll(userId)
  // Postgres returns a row of nulls, not null, for a mark that was removed.
  return row && (row as Row).session_id ? toMark(row as Row) : null
}

export async function setEnrolment(
  userId: string,
  courseId: string,
  studentId: string,
  status: 'active' | 'removed'
): Promise<void> {
  await run((db) =>
    db.from('enrolments').update({ status }).eq('course_id', courseId).eq('student_id', studentId).select('course_id').single()
  )
  await refreshAll(userId)
}

/* -------------------------------------------------------------------------- */
/* Projector                                                                   */
/* -------------------------------------------------------------------------- */

export interface LiveKey {
  secret: string
  serverTime: number
  /** This device's clock at either end of the request, to correct against. */
  sentAt: number
  receivedAt: number
}

/** The session's secret and the server's time, for a projector resuming a session. */
export async function fetchLiveKey(sessionId: string): Promise<LiveKey> {
  const sentAt = Date.now()
  const answer = (await run((db) => db.rpc('live_session_key', { p_session: sessionId }))) as Row
  return { secret: String(answer.secret), serverTime: number(answer.server_time), sentAt, receivedAt: Date.now() }
}

/* -------------------------------------------------------------------------- */
/* Phone approvals                                                             */
/* -------------------------------------------------------------------------- */

export interface PhoneRequest {
  deviceId: string
  studentId: string
  fullName: string
  rollNumber: string
  /** A device change waits for approval; a first phone is cooling off. */
  kind: 'change' | 'first'
  requestedAt: string
  activeFrom: string | null
  userAgent: string | null
  /** For a device change, when the phone it replaces was registered. */
  replacesSince: string | null
}

const approvalsKey = (userId: string) => `${teacherPrefix(userId)}:approvals`

export async function loadPhoneRequests(now = Date.now()): Promise<PhoneRequest[]> {
  // Row Level Security limits this to students in the teacher's courses.
  const rows = (await run((db) =>
    db
      .from('devices')
      .select('*, student:profiles!devices_student_id_fkey(full_name, roll_number)')
      .neq('status', 'revoked')
      .order('created_at', { ascending: true })
  )) as Row[]

  const activeSince = new Map(
    rows.filter((row) => row.status === 'active').map((row) => [String(row.student_id), String(row.created_at)])
  )

  return rows
    .filter((row) => row.status === 'pending' || (row.status === 'active' && Date.parse(String(row.active_from)) > now))
    .map((row) => {
      const student = (row.student as Row | null) ?? {}
      const change = row.status === 'pending'
      return {
        deviceId: String(row.id),
        studentId: String(row.student_id),
        fullName: String(student.full_name ?? ''),
        rollNumber: String(student.roll_number ?? ''),
        kind: change ? 'change' : 'first',
        requestedAt: String(row.created_at),
        activeFrom: row.active_from ? String(row.active_from) : null,
        userAgent: row.user_agent ? String(row.user_agent) : null,
        replacesSince: change ? (activeSince.get(String(row.student_id)) ?? null) : null
      }
    })
}

export function usePhoneRequests() {
  const userId = useUserId()
  return useRemote(approvalsKey(userId), () => loadPhoneRequests())
}

export async function decidePhone(userId: string, deviceId: string, approve: boolean): Promise<void> {
  await run((db) => db.rpc(approve ? 'approve_device' : 'reject_device', { p_device: deviceId }))
  await refreshAll(userId)
}
