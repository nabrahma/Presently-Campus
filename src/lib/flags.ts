/**
 * The soft signals a QR mark can carry. None of them rejects a scan; each
 * has an innocent explanation, which is why a teacher reviews them.
 */
export const FLAG_LABELS: Record<string, string> = {
  off_campus: 'Off campus',
  shared_connection: 'Shared connection',
  late: 'Late'
}

export const FLAG_HELP: Record<string, string> = {
  off_campus: 'Scanned from outside the campus network. Mobile data does this too.',
  shared_connection: 'Several students scanned from one connection and browser within seconds.',
  late: 'Scanned after the course’s late mark.'
}

export const flagLabel = (flag: string) => FLAG_LABELS[flag] ?? flag.replace(/_/g, ' ')

/** Reasons recorded when a teacher resolves a flag, so the outcome can be counted. */
export const REVIEW_REASONS = {
  genuine: 'Reviewed flag: genuine',
  proxy: 'Reviewed flag: proxy'
} as const
