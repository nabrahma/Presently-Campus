/**
 * Attendance is recorded against the calendar day the student actually lived,
 * so every date key here is derived from local time.
 *
 * `new Date().toISOString().slice(0, 10)` is the classic trap: east of UTC it
 * returns yesterday for any local time before the UTC offset, so an 8am check-in
 * in India (UTC+5:30) would silently land on the wrong day.
 */

const pad = (value: number) => String(value).padStart(2, '0')

/** `yyyy-MM-dd` for a Date, using its local calendar day. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `yyyy-MM-dd` for today, in the device's timezone. */
export function todayKey(): string {
  return dateKey(new Date())
}

/**
 * Parse a `yyyy-MM-dd` key back into a Date at local noon.
 *
 * Noon rather than midnight keeps the day stable across daylight-saving
 * transitions, where a local midnight can legitimately not exist.
 */
export function keyToDate(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  if (!year || !month || !day) return new Date(NaN)
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

/** True when `key` is a well-formed calendar date that actually exists. */
export function isValidDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false
  const parsed = keyToDate(key)
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === key
}

/** True when the key refers to a day after today. Future days cannot be marked. */
export function isFutureKey(key: string): boolean {
  return key > todayKey()
}

/** Shifts a date key by whole days, staying on the local calendar. */
export function shiftKey(key: string, days: number): string {
  const date = keyToDate(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

/*
  The launch screen needs exactly two date labels. Intl is built into the
  browser and costs nothing to ship, which keeps the whole date library off
  the critical path — it now loads only with the calendar.
*/
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const dayMonthFormat = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' })

/** e.g. "Wednesday" */
export function formatWeekday(date: Date): string {
  return weekdayFormat.format(date)
}

/** e.g. "29 July" */
export function formatDayMonth(date: Date): string {
  return dayMonthFormat.format(date)
}

/*
  Sessions carry full timestamps rather than date keys, and are shown in the
  device's own time, which for a campus app is the campus's time.
*/
const shortDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

/** e.g. "Mon 21 Oct" */
export function formatShortDay(iso: string): string {
  return shortDayFormat.format(new Date(iso))
}

/** e.g. "10:02" */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso))
}

/** e.g. "Mon 21 Oct · 10:02" */
export function formatSessionTime(iso: string): string {
  return `${formatShortDay(iso)} · ${formatTime(iso)}`
}
