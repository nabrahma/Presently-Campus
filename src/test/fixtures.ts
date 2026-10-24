import type { Fixtures, Row } from './fakeSupabase'

export const STUDENT = { id: 'student-1', email: 'asha@college.edu' }
export const TEACHER = { id: 'teacher-1', email: 'meera@college.edu' }

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

export const studentProfile = (overrides: Row = {}): Row => ({
  id: STUDENT.id,
  role: 'student',
  full_name: 'Asha Rao',
  roll_number: '21CS001',
  ...overrides
})

export const teacherProfile = (overrides: Row = {}): Row => ({
  id: TEACHER.id,
  role: 'teacher',
  full_name: 'Dr Meera Iyer',
  roll_number: null,
  ...overrides
})

export const course = (overrides: Row = {}): Row => ({
  id: 'course-1',
  teacher_id: TEACHER.id,
  name: 'Database Systems',
  code: 'CS301',
  section: 'A',
  term: 'Monsoon 2026',
  target_percentage: 75,
  late_after_minutes: 10,
  join_code: 'ABC234',
  archived: false,
  created_at: hoursAgo(24 * 60),
  ...overrides
})

export const session = (id: string, startedHoursAgo: number, status = 'closed', overrides: Row = {}): Row => ({
  id,
  course_id: 'course-1',
  started_by: TEACHER.id,
  started_at: hoursAgo(startedHoursAgo),
  closed_at: status === 'open' ? null : hoursAgo(startedHoursAgo - 1),
  status,
  note: null,
  ...overrides
})

/**
 * A student enrolled in one course: present at the first class, absent from
 * the second, and the third is open right now and unmarked.
 */
export function studentWorld(overrides: Partial<Fixtures> = {}): Partial<Fixtures> {
  return {
    user: STUDENT,
    tables: {
      profiles: [studentProfile()],
      enrolments: [{ course_id: 'course-1', student_id: STUDENT.id, joined_at: hoursAgo(24 * 30), status: 'active' }],
      courses: [{ ...course(), teacher: { full_name: 'Dr Meera Iyer' } }],
      class_sessions: [session('x3', 0.2, 'open'), session('x2', 48), session('x1', 96)],
      attendance: [
        {
          session_id: 'x1',
          student_id: STUDENT.id,
          status: 'present',
          method: 'qr',
          device_id: 'device-1',
          marked_at: hoursAgo(95.9),
          marked_by: null,
          reason: null,
          flags: []
        }
      ]
    },
    rpc: {
      my_figures: () => [{ course_id: 'course-1', attended: 1, held: 2, excused: 0 }]
    },
    ...overrides
  }
}
