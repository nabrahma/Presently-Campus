import { describe, expect, it } from 'vitest'
import { atRisk, scoreRoster, sortRoster } from './roster'
import type { RosterRow } from './teacher'

const row = (rollNumber: string, fullName: string, attended: number, held: number, excused = 0): RosterRow => ({
  studentId: rollNumber,
  rollNumber,
  fullName,
  attended,
  held,
  excused,
  enrolmentStatus: 'active',
  joinedAt: '2026-10-01T00:00:00Z'
})

const roster = [
  row('21CS10', 'Chen Li', 9, 10),
  row('21CS9', 'Bilal Khan', 6, 10),
  row('21CS2', 'Asha Rao', 0, 0),
  row('21CS1', 'Divya Menon', 2, 3)
]

const order = (by: Parameters<typeof sortRoster>[1]) =>
  sortRoster(scoreRoster(roster, 75), by).map((student) => student.row.rollNumber)

describe('sortRoster', () => {
  it('sorts roll numbers numerically within their prefix', () => {
    expect(order('roll')).toEqual(['21CS1', '21CS2', '21CS9', '21CS10'])
  })

  it('sorts by name', () => {
    expect(order('name')).toEqual(['21CS2', '21CS9', '21CS10', '21CS1'])
  })

  it('puts the lowest percentage first and students with nothing counted last', () => {
    expect(order('percentage')).toEqual(['21CS9', '21CS1', '21CS10', '21CS2'])
  })
})

describe('scoreRoster', () => {
  it('scores each student through the same maths students see', () => {
    const [chen] = scoreRoster([roster[0]], 75)
    expect(chen.stats).toMatchObject({ percentage: 90, bunkable: 2 })
    expect(chen.zone).toBe('safe')
  })

  it('flags only students below target as at risk', () => {
    expect(atRisk(scoreRoster(roster, 75)).map((student) => student.row.rollNumber)).toEqual(['21CS9', '21CS1'])
  })
})
