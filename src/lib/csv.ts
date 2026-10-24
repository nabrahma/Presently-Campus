/**
 * Escapes a value for CSV.
 *
 * The leading-character guard stops spreadsheet apps from interpreting a value
 * like `=cmd()` or `+1` as a formula, which is a well known CSV injection
 * vector when the sheet is opened by someone else.
 */
function escapeCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').trim()
  const safe = /^[=+\-@\t\r]/.test(normalized) ? `'${normalized}` : normalized
  return `"${safe.replace(/"/g, '""')}"`
}

type Cell = string | number | null | undefined

/**
 * A whole sheet: a header row and data rows, every cell escaped.
 *
 * Numbers are written as quoted cells too; spreadsheets still read them as
 * numbers, and one code path means one escaping rule.
 */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const line = (cells: Cell[]) =>
    cells.map((cell) => escapeCell(cell === null || cell === undefined ? '' : String(cell))).join(',')

  // CRLF is what Excel expects; the join keeps a trailing newline off the file.
  return [line(headers), ...rows.map(line)].join('\r\n')
}

/**
 * Triggers a browser download.
 *
 * The anchor is attached to the document because Firefox ignores clicks on
 * detached nodes, and the object URL is revoked on the next frame because
 * revoking synchronously cancels the download in some browsers.
 */
export function downloadCsv(contents: string, filename: string): void {
  // The BOM makes Excel read the file as UTF-8 rather than the system codepage.
  const blob = new Blob([`﻿${contents}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()

  window.setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 0)
}
