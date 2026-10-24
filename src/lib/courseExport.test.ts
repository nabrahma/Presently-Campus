import { describe, expect, it } from 'vitest'
import { exportFilename, marksCsv, registerCsv, type CourseExport } from './courseExport'
import type { RosterRow } from './teacher'

const local = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month - 1, day, hour, minute).toISOString()

const data: CourseExport = {
  sessions: [
    { id: 'x1', startedAt: local(2026, 10, 1, 10, 0) },
    { id: 'x2', startedAt: local(2026, 10, 8, 10, 5) },
    { id: 'x3', startedAt: local(2026, 10, 15, 9, 55) }
  ],
  students: [
    {
      id: 'a',
      rollNumber: '21CS001',
      fullName: 'Asha Rao',
      enrolmentStatus: 'active',
      joinedAt: local(2026, 9, 1, 0, 0),
      marks: {
        x1: { status: 'present', method: 'qr', markedAt: local(2026, 10, 1, 10, 2), flags: [] },
        x2: { status: 'excused', method: 'manual', markedAt: local(2026, 10, 8, 11, 0), flags: [] }
      }
    },
    {
      // Joined after the first class, so it is blank for them, not an absence.
      id: 'b',
      rollNumber: '21CS002',
      fullName: '=HYPERLINK("x")',
      enrolmentStatus: 'active',
      joinedAt: local(2026, 10, 5, 0, 0),
      marks: { x3: { status: 'present', method: 'qr', markedAt: local(2026, 10, 15, 9, 58), flags: ['late', 'off_campus'] } }
    }
  ]
}

const roster: RosterRow[] = [
  { studentId: 'a', rollNumber: '21CS001', fullName: 'Asha Rao', enrolmentStatus: 'active', joinedAt: '', attended: 1, held: 2, excused: 1 },
  { studentId: 'b', rollNumber: '21CS002', fullName: 'x', enrolmentStatus: 'active', joinedAt: '', attended: 1, held: 2, excused: 0 }
]

describe('registerCsv', () => {
  const lines = registerCsv({ targetPercentage: 75 }, data, roster).split('\r\n')

  it('heads each class with its local date and time, oldest first', () => {
    expect(lines[0]).toBe(
      '"Roll number","Name","Enrolment","Attended","Held","Excused","Percentage","2026-10-01 10:00","2026-10-08 10:05","2026-10-15 09:55"'
    )
  })

  it('writes P, E and A by the same rule as the figures', () => {
    expect(lines[1]).toBe('"21CS001","Asha Rao","active","1","2","1","50","P","E","A"')
    expect(lines[2]).toContain('"","A","P"')
  })

  it('keeps a student’s name from running as a formula', () => {
    expect(lines[2]).toContain(`"'=HYPERLINK(""x"")"`)
  })
})

describe('marksCsv', () => {
  it('writes one row per counted class, with method and flags', () => {
    const lines = marksCsv(data).split('\r\n')
    expect(lines[0]).toBe('"roll_number","name","session_started_at","status","method","marked_at","flags"')
    // Asha: three classes; the second student: two, since they joined after the first.
    expect(lines).toHaveLength(1 + 3 + 2)
    expect(lines.at(-1)).toContain('"present","qr"')
    expect(lines.at(-1)).toContain('"late off_campus"')
    expect(lines[3]).toContain('"absent","",""')
  })
})

describe('exportFilename', () => {
  it('names the file after the course and the day', () => {
    expect(exportFilename({ code: 'CS301', section: 'A', name: 'Database Systems' }, 'register', '2026-10-24')).toBe(
      'CS301-A-attendance-2026-10-24.csv'
    )
    expect(exportFilename({ code: '', section: '', name: 'Data & Society' }, 'marks', '2026-10-24')).toBe(
      'Data-Society-marks-2026-10-24.csv'
    )
  })
})
