import { describe, expect, it } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('writes a header and one line per row', () => {
    const csv = toCsv(['roll', 'name', 'attended'], [['21CS001', 'Asha Rao', 12]])
    const lines = csv.split('\r\n')

    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('"roll","name","attended"')
    expect(lines[1]).toBe('"21CS001","Asha Rao","12"')
  })

  it('escapes quotes by doubling them', () => {
    expect(toCsv(['name'], [['The "Hard" One']])).toContain('"The ""Hard"" One"')
  })

  it('neutralises values a spreadsheet would run as a formula', () => {
    // A student named =HYPERLINK(...) must not execute for whoever opens it.
    const csv = toCsv(['name'], [['=HYPERLINK("http://x")'], ['+1'], ['-1'], ['@SUM(A1)']])
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`)
    expect(csv).toContain(`"'+1"`)
    expect(csv).toContain(`"'-1"`)
    expect(csv).toContain(`"'@SUM(A1)"`)
    expect(csv).not.toContain('"=HYPERLINK')
  })

  it('flattens newlines so a row can never span lines', () => {
    const csv = toCsv(['name'], [['Line\nBreak']])
    expect(csv.split('\r\n')).toHaveLength(2)
    expect(csv).toContain('"Line Break"')
  })

  it('writes missing values as empty cells rather than "undefined"', () => {
    expect(toCsv(['a', 'b', 'c'], [[null, undefined, '']])).toBe('"a","b","c"\r\n"","",""')
  })

  it('produces only a header when there are no rows', () => {
    expect(toCsv(['roll', 'name'], [])).toBe('"roll","name"')
  })
})
