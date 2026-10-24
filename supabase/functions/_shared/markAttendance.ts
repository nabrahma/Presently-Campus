/**
 * The rules for accepting a scan, in the order the requirements give them
 * (section 5.4). The first check that fails decides the answer, and every
 * attempt is logged whatever the outcome.
 *
 * Storage is behind ScanStore so the rules can be tested without a database;
 * the Edge Function supplies the real one.
 */

import { normalisePublicJwk, scanMessage, verifyScanSignature } from './deviceSignature.ts'
import { parseToken, verifyToken } from './qrToken.ts'

export type ScanReason =
  | 'accepted'
  | 'already_marked'
  | 'invalid_token'
  | 'session_closed'
  | 'token_expired'
  | 'not_enrolled'
  | 'device_not_registered'
  | 'device_too_new'
  | 'device_unverified'
  | 'device_already_used'

/** What the student is told. Kept short: it is read on a phone, mid-class. */
export const SCAN_MESSAGES: Record<ScanReason, string> = {
  accepted: 'Marked present.',
  already_marked: 'Already marked present.',
  invalid_token: "That isn't a Presently code.",
  session_closed: 'This class has closed.',
  token_expired: 'Code expired. Scan the screen again.',
  not_enrolled: "You're not in this course. Join it first.",
  device_not_registered: "This phone isn't registered to you.",
  device_too_new: "New phones can't mark this class. Ask your teacher.",
  device_unverified: "This phone couldn't be verified.",
  device_already_used: 'This phone has already marked someone in this class.'
}

export interface ScanSession {
  id: string
  courseId: string
  courseName: string
  status: 'open' | 'closed' | 'cancelled'
  startedAt: string
}

export interface ScanDevice {
  id: string
  studentId: string
  status: 'active' | 'pending' | 'revoked'
  activeFrom: string | null
  createdAt: string
  publicKey: unknown
}

export interface ExistingMark {
  status: 'present' | 'excused'
  markedAt: string
}

export type InsertOutcome =
  | { ok: true; markedAt: string }
  | { ok: false; conflict: 'student' | 'device' }

export interface ScanStore {
  getSession(sessionId: string): Promise<ScanSession | null>
  getSecret(sessionId: string): Promise<Uint8Array<ArrayBuffer> | null>
  isEnrolled(courseId: string, studentId: string): Promise<boolean>
  getDevice(deviceId: string): Promise<ScanDevice | null>
  /** The student this device has already marked in this session, if any. */
  deviceMarked(sessionId: string, deviceId: string): Promise<string | null>
  findMark(sessionId: string, studentId: string): Promise<ExistingMark | null>
  /** Inserts the mark; the database's constraints settle any race. */
  insertMark(mark: {
    session: ScanSession
    studentId: string
    deviceId: string
    ip: string | null
    userAgent: string | null
  }): Promise<InsertOutcome>
  logAttempt(attempt: {
    sessionId: string | null
    studentId: string
    deviceId: string | null
    result: 'accepted' | 'rejected'
    reason: ScanReason
    ip: string | null
    userAgent: string | null
  }): Promise<void>
}

export interface ScanRequest {
  token: unknown
  deviceId: unknown
  signature: unknown
  /** From the verified JWT, never from the request body. */
  userId: string
  ip: string | null
  userAgent: string | null
  now: number
}

export interface ScanResult {
  ok: boolean
  reason: ScanReason
  message: string
  sessionId?: string
  courseName?: string
  markedAt?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function markAttendance(store: ScanStore, request: ScanRequest): Promise<ScanResult> {
  let sessionId: string | null = null
  let deviceId: string | null = null

  const finish = async (reason: ScanReason, extra: Partial<ScanResult> = {}): Promise<ScanResult> => {
    const ok = reason === 'accepted' || reason === 'already_marked'
    try {
      await store.logAttempt({
        sessionId,
        studentId: request.userId,
        deviceId,
        result: ok ? 'accepted' : 'rejected',
        reason,
        ip: request.ip,
        userAgent: request.userAgent
      })
    } catch {
      // The log matters, but not more than telling the student the outcome.
    }
    return { ok, reason, message: SCAN_MESSAGES[reason], ...extra }
  }

  // 1. The token parses and names a session that exists.
  const token = parseToken(request.token)
  if (!token) return finish('invalid_token')
  const session = await store.getSession(token.sessionId)
  if (!session) return finish('invalid_token')
  sessionId = session.id

  // 2. The session is open.
  if (session.status !== 'open') return finish('session_closed')

  // 3. The signature is valid for the current or previous window.
  const secret = await store.getSecret(session.id)
  if (!secret || !(await verifyToken(secret, token, request.now))) return finish('token_expired')

  // 4. The student is enrolled in the session's course.
  if (!(await store.isEnrolled(session.courseId, request.userId))) return finish('not_enrolled')

  // 5. The device belongs to this student and is active.
  const device =
    typeof request.deviceId === 'string' && UUID.test(request.deviceId) ? await store.getDevice(request.deviceId) : null
  if (device) deviceId = device.id
  if (!device || device.studentId !== request.userId || device.status !== 'active') {
    return finish('device_not_registered')
  }

  // 6. Its cooling-off is over or a teacher approved it, and it was
  //    registered before this class began: clearing the app's data and
  //    registering during the class gets nowhere.
  const activeFrom = device.activeFrom ? Date.parse(device.activeFrom) : Number.POSITIVE_INFINITY
  if (activeFrom > request.now || Date.parse(device.createdAt) >= Date.parse(session.startedAt)) {
    return finish('device_too_new')
  }

  // 7. The request was signed by that device's private key.
  const publicKey = normalisePublicJwk(device.publicKey)
  const message = typeof request.token === 'string' ? scanMessage(request.token, request.userId) : ''
  if (!publicKey || !(await verifyScanSignature(publicKey, message, request.signature))) {
    return finish('device_unverified')
  }

  // 8. The device has not marked anyone else in this class.
  const markedBy = await store.deviceMarked(session.id, device.id)
  if (markedBy && markedBy !== request.userId) return finish('device_already_used')

  // 9. Not already marked; if so, this scan changes nothing.
  const existing = await store.findMark(session.id, request.userId)
  if (existing) {
    return finish('already_marked', {
      sessionId: session.id,
      courseName: session.courseName,
      markedAt: existing.markedAt,
      message: existing.status === 'present' ? SCAN_MESSAGES.already_marked : 'Your teacher has already marked you.'
    })
  }

  const inserted = await store.insertMark({
    session,
    studentId: request.userId,
    deviceId: device.id,
    ip: request.ip,
    userAgent: request.userAgent
  })

  // Two scans at once land here: the constraints decide which one won.
  if (!inserted.ok) {
    if (inserted.conflict === 'device') return finish('device_already_used')
    const mark = await store.findMark(session.id, request.userId)
    return finish('already_marked', { sessionId: session.id, courseName: session.courseName, markedAt: mark?.markedAt })
  }

  // Any soft flags stay with the teacher. Telling the student which signal
  // tripped would only teach them to avoid it.
  return finish('accepted', { sessionId: session.id, courseName: session.courseName, markedAt: inserted.markedAt })
}
