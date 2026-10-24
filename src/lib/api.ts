import type { SupabaseClient } from '@supabase/supabase-js'
import { describeError, supabase, withValidToken } from './supabaseClient'
import type {
  AttendanceMark,
  ClassSession,
  Course,
  Figures,
  MarkMethod,
  MarkStatus,
  Profile,
  Role,
  SessionStatus
} from '../types'

/** A failed request, already phrased for the person who will read it. */
export class ApiError extends Error {}

function client(): SupabaseClient {
  if (!supabase) throw new ApiError('This build has no Supabase credentials.')
  return supabase
}

/**
 * Runs one request with token recovery and turns a failure into an ApiError.
 * Every read and write in the app goes through here.
 */
export async function run<T>(
  request: (db: SupabaseClient) => PromiseLike<{ data: T; error: unknown }>
): Promise<T> {
  const db = client()
  const { data, error } = await withValidToken(db, () => request(db))
  if (error) throw new ApiError(describeError(error))
  return data
}

/* -------------------------------------------------------------------------- */
/* Row mapping                                                                 */
/* -------------------------------------------------------------------------- */

export type Row = Record<string, unknown>

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value))
const nullableText = (value: unknown) => (value === null || value === undefined ? null : String(value))
const count = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function toProfile(row: Row): Profile {
  const role: Role = row.role === 'teacher' ? 'teacher' : 'student'
  const fullName = text(row.full_name)
  const rollNumber = nullableText(row.roll_number)
  return {
    id: text(row.id),
    role,
    fullName,
    rollNumber,
    onboarded: fullName !== '' && (role === 'teacher' || rollNumber !== null),
    isDev: row.is_dev === true
  }
}

export function toCourse(row: Row): Course {
  return {
    id: text(row.id),
    teacherId: text(row.teacher_id),
    name: text(row.name),
    code: text(row.code),
    section: text(row.section),
    term: text(row.term),
    targetPercentage: count(row.target_percentage) || 75,
    lateAfterMinutes: count(row.late_after_minutes),
    joinCode: text(row.join_code),
    archived: Boolean(row.archived),
    createdAt: text(row.created_at)
  }
}

export function toSession(row: Row): ClassSession {
  return {
    id: text(row.id),
    courseId: text(row.course_id),
    startedBy: text(row.started_by),
    startedAt: text(row.started_at),
    closedAt: nullableText(row.closed_at),
    status: (row.status as SessionStatus) ?? 'closed',
    note: nullableText(row.note)
  }
}

export function toMark(row: Row): AttendanceMark {
  return {
    sessionId: text(row.session_id),
    studentId: text(row.student_id),
    status: (row.status as MarkStatus) ?? 'present',
    method: (row.method as MarkMethod) ?? 'manual',
    deviceId: nullableText(row.device_id),
    markedAt: text(row.marked_at),
    markedBy: nullableText(row.marked_by),
    reason: nullableText(row.reason),
    flags: Array.isArray(row.flags) ? row.flags.map(String) : []
  }
}

export function toFigures(row: Row | undefined): Figures {
  return {
    attended: count(row?.attended),
    held: count(row?.held),
    excused: count(row?.excused)
  }
}

/** "CS301 · A" style label for a course, falling back to its name. */
export function courseLabel(course: Pick<Course, 'code' | 'name' | 'section'>): string {
  const head = course.code || course.name
  return course.section ? `${head} · ${course.section}` : head
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const row = await run((db) => db.from('profiles').select('*').eq('id', userId).maybeSingle())
  return row ? toProfile(row as Row) : null
}

export async function updateProfile(
  userId: string,
  changes: { fullName: string; rollNumber?: string | null }
): Promise<Profile> {
  const payload: Row = { full_name: changes.fullName }
  if (changes.rollNumber !== undefined) payload.roll_number = changes.rollNumber
  const row = await run((db) => db.from('profiles').update(payload).eq('id', userId).select('*').single())
  return toProfile(row as Row)
}
