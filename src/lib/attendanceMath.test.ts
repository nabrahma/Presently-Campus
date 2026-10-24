import { describe, expect, it } from 'vitest'
import {
  attendanceStats,
  figuresStats,
  normalizeTarget,
  safetyZone,
  standings,
  type CountedStatus
} from './attendanceMath'

const record = (status: CountedStatus) => ({ status })

const build = (present: number, absent: number, cancelled = 0, holiday = 0) => [
  ...Array.from({ length: present }, () => record('present')),
  ...Array.from({ length: absent }, () => record('absent')),
  ...Array.from({ length: cancelled }, () => record('cancelled')),
  ...Array.from({ length: holiday }, () => record('holiday'))
]

describe('attendanceStats', () => {
  it('matches the documented worked examples', () => {
    expect(attendanceStats(build(12, 5), 75)).toMatchObject({ percentage: 70.6, comeback: 3 })
    expect(attendanceStats(build(15, 2), 75)).toMatchObject({ percentage: 88.2, bunkable: 3 })
    expect(attendanceStats(build(11, 5), 75)).toMatchObject({ percentage: 68.8, comeback: 4 })
  })

  it('excludes cancelled and holiday sessions from the percentage', () => {
    expect(attendanceStats(build(1, 1, 5, 3), 75)).toMatchObject({
      total: 2,
      percentage: 50,
      cancelled: 5,
      holiday: 3,
      recorded: 10
    })
  })

  it('reports no data rather than zero for an empty set', () => {
    expect(attendanceStats([], 75)).toMatchObject({
      percentage: null,
      bunkable: null,
      comeback: null,
      total: 0
    })
  })

  it('treats sitting exactly on target as safe with no room to spare', () => {
    // 15/20 is exactly 75%: on target, but one more absence breaks it.
    expect(attendanceStats(build(15, 5), 75)).toMatchObject({ percentage: 75, bunkable: 0 })
  })

  it('survives the float boundaries that a fractional target lands just under', () => {
    // Evaluated in float space, 0.75 * 20 is 14.999999999999998 and these
    // exactly-on-target cases wrongly report a comeback instead.
    expect(attendanceStats(build(3, 1), 75).bunkable).toBe(0)
    expect(attendanceStats(build(30, 10), 75).bunkable).toBe(0)
    expect(attendanceStats(build(60, 20), 75).bunkable).toBe(0)
  })

  it('never suggests a comeback of zero while below target', () => {
    for (let present = 0; present <= 40; present += 1) {
      for (let absent = 1; absent <= 20; absent += 1) {
        const stats = attendanceStats(build(present, absent), 75)
        if (stats.comeback === null) continue
        expect(stats.comeback).toBeGreaterThan(0)
      }
    }
  })

  it('produces the smallest comeback that actually reaches the target', () => {
    for (let present = 0; present <= 30; present += 1) {
      for (let absent = 1; absent <= 15; absent += 1) {
        const stats = attendanceStats(build(present, absent), 75)
        if (stats.comeback === null) continue

        const total = present + absent
        expect((present + stats.comeback) / (total + stats.comeback)).toBeGreaterThanOrEqual(0.75)
        expect(
          (present + stats.comeback - 1) / (total + stats.comeback - 1)
        ).toBeLessThan(0.75)
      }
    }
  })

  it('produces the largest bunkable count that still stays on target', () => {
    for (let present = 1; present <= 40; present += 1) {
      for (let absent = 0; absent <= 15; absent += 1) {
        const stats = attendanceStats(build(present, absent), 75)
        if (stats.bunkable === null) continue

        const total = present + absent
        expect(present / (total + stats.bunkable)).toBeGreaterThanOrEqual(0.75)
        expect(present / (total + stats.bunkable + 1)).toBeLessThan(0.75)
      }
    }
  })

  it('reports an unrecoverable 100% target instead of an infinite comeback', () => {
    const stats = attendanceStats(build(9, 1), 100)
    expect(stats.percentage).toBe(90)
    expect(stats.comeback).toBeNull()
    expect(stats.bunkable).toBeNull()
  })

  it('allows a perfect record to satisfy a 100% target', () => {
    expect(attendanceStats(build(5, 0), 100)).toMatchObject({ percentage: 100, bunkable: 0 })
  })

  it('never divides by a zero, negative, or non-finite target', () => {
    for (const target of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      const stats = attendanceStats(build(3, 1), target)
      expect(Number.isFinite(stats.bunkable ?? stats.comeback ?? 0)).toBe(true)
    }
  })

  it('handles a record set with no attended classes at all', () => {
    expect(attendanceStats(build(0, 4), 75)).toMatchObject({ percentage: 0, comeback: 12 })
  })
})

describe('normalizeTarget', () => {
  it('clamps anything unusable into a sane range', () => {
    expect(normalizeTarget(0)).toBe(1)
    expect(normalizeTarget(-5)).toBe(1)
    expect(normalizeTarget(140)).toBe(100)
    expect(normalizeTarget(Number.NaN)).toBe(75)
    expect(normalizeTarget(74.6)).toBe(75)
  })
})

describe('safetyZone', () => {
  it('separates below target, close to target, and clear of it', () => {
    expect(safetyZone(null, 75)).toBe('neutral')
    expect(safetyZone(74.9, 75)).toBe('danger')
    expect(safetyZone(75, 75)).toBe('caution')
    expect(safetyZone(79.9, 75)).toBe('caution')
    expect(safetyZone(80, 75)).toBe('safe')
  })
})

describe('standings', () => {
  const entry = (name: string, present: number, absent: number, target = 75) => ({
    item: name,
    stats: attendanceStats(build(present, absent), target),
    target
  })

  // The demo account: two subjects comfortably above 75%, one well below.
  const demo = [entry('DSA', 18, 3), entry('DBMS-L', 12, 2), entry('MA201', 10, 6)]

  it('names the subject furthest below its target as the lowest', () => {
    expect(standings(demo).lowest?.item).toBe('MA201')
  })

  it('reports the smallest margin, not the sum of every margin', () => {
    // 3 spare in DSA and 2 in DBMS-L is not 5 to spend anywhere: missing a
    // third DBMS-L class drops it below target.
    const { leastSpare } = standings(demo)
    expect(leastSpare?.item).toBe('DBMS-L')
    expect(leastSpare?.stats.bunkable).toBe(2)
  })

  it('lists every subject under target, worst first', () => {
    const below = standings([...demo, entry('PHY', 14, 5)]).below.map((item) => item.item)
    expect(below).toEqual(['MA201', 'PHY'])
  })

  it('judges each subject against its own target', () => {
    // 80% clears a 75% target but not an 85% one.
    const { lowest, below } = standings([entry('Easy', 8, 2, 75), entry('Strict', 8, 2, 85)])
    expect(lowest?.item).toBe('Strict')
    expect(below.map((item) => item.item)).toEqual(['Strict'])
  })

  it('counts a subject that rounds to its target but sits under it as below', () => {
    // 299 of 399 is 74.94%, displayed as 74.9, and one class short.
    const { below } = standings([entry('Edge', 299, 100)])
    expect(below).toHaveLength(1)
  })

  it('leaves out subjects with nothing counted yet', () => {
    const result = standings([entry('New', 0, 0), entry('DSA', 18, 3)])
    expect(result.lowest?.item).toBe('DSA')
    expect(standings([entry('New', 0, 0)])).toEqual({ lowest: null, leastSpare: null, below: [] })
  })

  it('has no spare figure when every subject is under target', () => {
    expect(standings([entry('MA201', 10, 6)]).leastSpare).toBeNull()
  })
})

describe('figuresStats', () => {
  it('gives the same answer as the records it summarises', () => {
    // The server's held already excludes excused classes.
    expect(figuresStats({ attended: 12, held: 17, excused: 2 }, 75)).toEqual(
      attendanceStats(build(12, 5, 0, 2), 75)
    )
    expect(figuresStats({ attended: 15, held: 17, excused: 0 }, 75)).toMatchObject({ bunkable: 3 })
  })

  it('reports no data for a course with nothing held', () => {
    expect(figuresStats({ attended: 0, held: 0, excused: 1 }, 75)).toMatchObject({
      percentage: null,
      total: 0,
      holiday: 1
    })
  })

  it('never invents absences from inconsistent counts', () => {
    expect(figuresStats({ attended: 3, held: 2, excused: 0 }, 75)).toMatchObject({ present: 3, absent: 0 })
  })
})
