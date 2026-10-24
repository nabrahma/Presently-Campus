export type Role = 'student' | 'teacher'

export interface Profile {
  id: string
  role: Role
  fullName: string
  /** Students only. Unique, stored upper-case. */
  rollNumber: string | null
  /**
   * The sign-up trigger creates an empty profile, so the row existing is not
   * proof that setup finished. A teacher needs a name; a student needs a name
   * and a roll number, because that is how they appear on a roster.
   */
  onboarded: boolean
  /** One of the developers, who can switch between the teacher's and the student's view. */
  isDev: boolean
}

export interface Course {
  id: string
  teacherId: string
  name: string
  code: string
  section: string
  term: string
  targetPercentage: number
  lateAfterMinutes: number
  joinCode: string
  archived: boolean
  createdAt: string
}

export type SessionStatus = 'open' | 'closed' | 'cancelled'

export interface ClassSession {
  id: string
  courseId: string
  startedBy: string
  startedAt: string
  closedAt: string | null
  status: SessionStatus
  note: string | null
}

/** What a stored mark can say. Absence is never stored. */
export type MarkStatus = 'present' | 'excused'
export type MarkMethod = 'qr' | 'manual'

export interface AttendanceMark {
  sessionId: string
  studentId: string
  status: MarkStatus
  method: MarkMethod
  deviceId: string | null
  markedAt: string
  markedBy: string | null
  reason: string | null
  flags: string[]
}

/** A student's standing in one course, as the server computes it. */
export interface Figures {
  attended: number
  held: number
  excused: number
}

/** What a session meant for one student. */
export type SessionOutcome = 'present' | 'excused' | 'absent' | 'open' | 'cancelled'

export const OUTCOME_LABELS: Record<SessionOutcome, string> = {
  present: 'Present',
  excused: 'Excused',
  absent: 'Absent',
  open: 'In progress',
  cancelled: 'Cancelled'
}

export const MIN_TARGET = 1
export const MAX_TARGET = 100
export const MAX_COURSE_NAME_LENGTH = 80
export const MAX_COURSE_CODE_LENGTH = 16
export const MAX_SECTION_LENGTH = 16
export const MAX_TERM_LENGTH = 32
export const MAX_NAME_LENGTH = 120
export const MAX_ROLL_LENGTH = 32
export const MAX_REASON_LENGTH = 200
