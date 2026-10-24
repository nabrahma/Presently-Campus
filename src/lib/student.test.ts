import { describe, expect, it } from 'vitest'
import { courseHistory, openClasses, type StudentSnapshot } from './student'
import type { AttendanceMark, ClassSession, Course } from '../types'

const session = (id: string, startedAt: string, status: ClassSession['status'] = 'closed', courseId = 'c1'): ClassSession => ({
  id,
  courseId,
  startedBy: 't1',
  startedAt,
  closedAt: status === 'open' ? null : startedAt,
  status,
  note: null
})

const mark = (sessionId: string, status: AttendanceMark['status'] = 'present'): AttendanceMark => ({
  sessionId,
  studentId: 's1',
  status,
  method: 'qr',
  deviceId: 'd1',
  markedAt: '2026-10-01T10:00:00Z',
  markedBy: null,
  reason: null,
  flags: []
})

const JOINED = '2026-10-05T00:00:00Z'

describe('courseHistory', () => {
  it('counts a closed, unmarked class after joining as absent', () => {
    const history = courseHistory('c1', JOINED, [session('a', '2026-10-06T10:00:00Z')], [])
    expect(history.map((entry) => entry.outcome)).toEqual(['absent'])
  })

  it('leaves out unmarked classes from before the student joined, as the server does', () => {
    const history = courseHistory('c1', JOINED, [session('early', '2026-10-01T10:00:00Z')], [])
    expect(history).toEqual([])
  })

  it('keeps an earlier class that carries a mark anyway', () => {
    const history = courseHistory('c1', JOINED, [session('early', '2026-10-01T10:00:00Z')], [mark('early')])
    expect(history.map((entry) => entry.outcome)).toEqual(['present'])
  })

  it('shows open and cancelled classes for what they are', () => {
    const history = courseHistory(
      'c1',
      JOINED,
      [session('now', '2026-10-08T10:00:00Z', 'open'), session('off', '2026-10-07T10:00:00Z', 'cancelled')],
      [mark('off')]
    )
    expect(history.map((entry) => [entry.session.id, entry.outcome])).toEqual([
      ['now', 'open'],
      ['off', 'cancelled']
    ])
  })

  it('orders newest first and ignores other courses', () => {
    const history = courseHistory(
      'c1',
      JOINED,
      [
        session('older', '2026-10-06T10:00:00Z'),
        session('elsewhere', '2026-10-09T10:00:00Z', 'closed', 'c2'),
        session('newer', '2026-10-08T10:00:00Z')
      ],
      [mark('newer', 'excused')]
    )
    expect(history.map((entry) => [entry.session.id, entry.outcome])).toEqual([
      ['newer', 'excused'],
      ['older', 'absent']
    ])
  })
})

describe('openClasses', () => {
  const course = { id: 'c1', name: 'DBMS' } as Course

  it('lists open sessions in enrolled courses with any mark already made', () => {
    const snapshot: StudentSnapshot = {
      courses: [{ course, teacherName: '', joinedAt: JOINED, figures: { attended: 0, held: 0, excused: 0 } }],
      sessions: [
        session('live', '2026-10-08T10:00:00Z', 'open'),
        session('done', '2026-10-07T10:00:00Z'),
        session('other', '2026-10-08T10:00:00Z', 'open', 'c2')
      ],
      marks: [mark('live')]
    }

    const open = openClasses(snapshot)
    expect(open).toHaveLength(1)
    expect(open[0].session.id).toBe('live')
    expect(open[0].mark?.status).toBe('present')
  })
})
