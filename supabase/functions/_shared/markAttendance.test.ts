import { beforeEach, describe, expect, it } from 'vitest'
import { generateDeviceKey, scanMessage, signScan, type PublicJwk } from './deviceSignature.ts'
import {
  markAttendance,
  SCAN_MESSAGES,
  type InsertOutcome,
  type ScanDevice,
  type ScanReason,
  type ScanRequest,
  type ScanSession,
  type ScanStore
} from './markAttendance.ts'
import { createToken, windowAt } from './qrToken.ts'

const STUDENT = '11111111-1111-4111-8111-111111111111'
const FRIEND = '22222222-2222-4222-8222-222222222222'
const SESSION = '0b6c2a52-3f9e-4c47-9a3a-5d2f3c1e7a10'
const UNKNOWN_SESSION = '9d1e4b7a-2c3f-4e5a-8b6c-7d8e9f0a1b2c'
const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const FRIEND_DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const NOW = 1_790_000_003_000
const minutes = (count: number) => count * 60_000
const iso = (ms: number) => new Date(ms).toISOString()

interface Mark {
  sessionId: string
  studentId: string
  deviceId: string
  status: 'present' | 'excused'
  markedAt: string
}

/** The database, in memory, with the same unique rules attendance has. */
class MemoryStore implements ScanStore {
  sessions = new Map<string, ScanSession>()
  secrets = new Map<string, Uint8Array<ArrayBuffer>>()
  enrolled = new Set<string>()
  devices = new Map<string, ScanDevice>()
  marks: Mark[] = []
  attempts: Parameters<ScanStore['logAttempt']>[0][] = []
  /** Lets a test simulate a scan that lands between the checks and the insert. */
  raceWith: InsertOutcome | null = null

  async getSession(id: string) {
    return this.sessions.get(id) ?? null
  }
  async getSecret(id: string) {
    return this.secrets.get(id) ?? null
  }
  async isEnrolled(courseId: string, studentId: string) {
    return this.enrolled.has(`${courseId}|${studentId}`)
  }
  async getDevice(id: string) {
    return this.devices.get(id) ?? null
  }
  async deviceMarked(sessionId: string, deviceId: string) {
    return this.marks.find((mark) => mark.sessionId === sessionId && mark.deviceId === deviceId)?.studentId ?? null
  }
  async findMark(sessionId: string, studentId: string) {
    return this.marks.find((mark) => mark.sessionId === sessionId && mark.studentId === studentId) ?? null
  }
  async insertMark({ session, studentId, deviceId }: Parameters<ScanStore['insertMark']>[0]): Promise<InsertOutcome> {
    if (this.raceWith) return this.raceWith
    if (this.marks.some((mark) => mark.sessionId === session.id && mark.studentId === studentId)) {
      return { ok: false, conflict: 'student' }
    }
    if (this.marks.some((mark) => mark.sessionId === session.id && mark.deviceId === deviceId)) {
      return { ok: false, conflict: 'device' }
    }
    const markedAt = iso(NOW)
    this.marks.push({ sessionId: session.id, studentId, deviceId, status: 'present', markedAt })
    return { ok: true, markedAt }
  }
  async logAttempt(attempt: Parameters<ScanStore['logAttempt']>[0]) {
    this.attempts.push(attempt)
  }
}

const secret = new Uint8Array(Array.from({ length: 32 }, (_, index) => index * 7))
let store: MemoryStore
let phone: { privateKey: CryptoKey; publicJwk: PublicJwk }
let friendPhone: { privateKey: CryptoKey; publicJwk: PublicJwk }

function device(overrides: Partial<ScanDevice> = {}): ScanDevice {
  return {
    id: DEVICE,
    studentId: STUDENT,
    status: 'active',
    activeFrom: iso(NOW - minutes(60 * 24)),
    createdAt: iso(NOW - minutes(60 * 36)),
    publicKey: phone.publicJwk,
    ...overrides
  }
}

beforeEach(async () => {
  phone ??= await generateDeviceKey()
  friendPhone ??= await generateDeviceKey()

  store = new MemoryStore()
  store.sessions.set(SESSION, {
    id: SESSION,
    courseId: 'course-1',
    courseName: 'Database Systems',
    status: 'open',
    startedAt: iso(NOW - minutes(5))
  })
  store.secrets.set(SESSION, secret)
  store.enrolled.add(`course-1|${STUDENT}`)
  store.enrolled.add(`course-1|${FRIEND}`)
  store.devices.set(DEVICE, device())
  store.devices.set(
    FRIEND_DEVICE,
    device({ id: FRIEND_DEVICE, studentId: FRIEND, publicKey: friendPhone.publicJwk })
  )
})

/** A scan as the app sends it, from the student's own phone, unless told otherwise. */
async function scan(
  options: {
    token?: unknown
    tokenAt?: number
    sessionId?: string
    userId?: string
    deviceId?: unknown
    key?: CryptoKey
    signFor?: string
    now?: number
  } = {}
) {
  const now = options.now ?? NOW
  const userId = options.userId ?? STUDENT
  const token =
    options.token ?? (await createToken(secret, options.sessionId ?? SESSION, windowAt(options.tokenAt ?? now)))
  const signature =
    typeof token === 'string'
      ? await signScan(options.key ?? phone.privateKey, scanMessage(token, options.signFor ?? userId))
      : 'none'

  const request: ScanRequest = {
    token,
    deviceId: options.deviceId ?? DEVICE,
    signature,
    userId,
    ip: '10.1.2.3',
    userAgent: 'Mozilla/5.0 (Android)',
    now
  }
  return markAttendance(store, request)
}

const expectReason = async (result: Promise<{ reason: ScanReason }>, reason: ScanReason) =>
  expect((await result).reason).toBe(reason)

describe('a valid scan', () => {
  it('marks the student present and says which class', async () => {
    const result = await scan()
    expect(result).toMatchObject({
      ok: true,
      reason: 'accepted',
      message: SCAN_MESSAGES.accepted,
      courseName: 'Database Systems',
      sessionId: SESSION
    })
    expect(store.marks).toHaveLength(1)
    expect(store.marks[0]).toMatchObject({ studentId: STUDENT, deviceId: DEVICE })
  })

  it('logs the attempt with its address and browser', async () => {
    await scan()
    expect(store.attempts).toEqual([
      {
        sessionId: SESSION,
        studentId: STUDENT,
        deviceId: DEVICE,
        result: 'accepted',
        reason: 'accepted',
        ip: '10.1.2.3',
        userAgent: 'Mozilla/5.0 (Android)'
      }
    ])
  })

  it('accepts a code from the previous window', async () => {
    await expectReason(scan({ tokenAt: NOW - 10_000 }), 'accepted')
  })
})

describe('each check, in order', () => {
  it('1. refuses something that is not a Presently code', async () => {
    await expectReason(scan({ token: 'https://example.com' }), 'invalid_token')
    await expectReason(scan({ token: 42 }), 'invalid_token')
    expect(store.attempts.every((attempt) => attempt.sessionId === null)).toBe(true)
  })

  it('1. refuses a code for a session that does not exist', async () => {
    await expectReason(scan({ sessionId: UNKNOWN_SESSION }), 'invalid_token')
  })

  it('2. refuses a class that has closed, even with a valid code (a replayed request)', async () => {
    await expectReason(scan(), 'accepted')
    store.sessions.get(SESSION)!.status = 'closed'
    await expectReason(scan({ userId: FRIEND, deviceId: FRIEND_DEVICE, key: friendPhone.privateKey }), 'session_closed')
  })

  it('3. refuses an expired code: a photo scanned 30 seconds later', async () => {
    await expectReason(scan({ tokenAt: NOW - 30_000 }), 'token_expired')
    expect(store.marks).toHaveLength(0)
  })

  it('3. refuses a code signed with another secret', async () => {
    const forged = await createToken(new Uint8Array(32), SESSION, windowAt(NOW))
    await expectReason(scan({ token: forged }), 'token_expired')
  })

  it('4. refuses a student who is not in the course', async () => {
    store.enrolled.delete(`course-1|${STUDENT}`)
    await expectReason(scan(), 'not_enrolled')
  })

  it('5. refuses another student’s phone: an account used on a friend’s phone', async () => {
    await expectReason(scan({ deviceId: FRIEND_DEVICE, key: friendPhone.privateKey }), 'device_not_registered')
  })

  it('5. refuses a phone that is unknown, pending or revoked', async () => {
    await expectReason(scan({ deviceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }), 'device_not_registered')
    await expectReason(scan({ deviceId: 'not-a-uuid' }), 'device_not_registered')
    store.devices.set(DEVICE, device({ status: 'pending', activeFrom: null }))
    await expectReason(scan(), 'device_not_registered')
    store.devices.set(DEVICE, device({ status: 'revoked' }))
    await expectReason(scan(), 'device_not_registered')
  })

  it('6. refuses a phone still cooling off', async () => {
    store.devices.set(DEVICE, device({ activeFrom: iso(NOW + minutes(60)) }))
    await expectReason(scan(), 'device_too_new')
  })

  it('6. refuses a phone registered after the class began, even if approved', async () => {
    // Clear data, sign in as an absent friend, register, get approved, scan.
    store.devices.set(DEVICE, device({ createdAt: iso(NOW - minutes(2)), activeFrom: iso(NOW - minutes(1)) }))
    await expectReason(scan(), 'device_too_new')
  })

  it('7. refuses a request not signed by the registered phone', async () => {
    await expectReason(scan({ key: friendPhone.privateKey }), 'device_unverified')
  })

  it('7. refuses a signature made for another student', async () => {
    await expectReason(scan({ signFor: FRIEND }), 'device_unverified')
  })

  it('8. refuses a phone that already marked someone else in this class', async () => {
    store.marks.push({ sessionId: SESSION, studentId: FRIEND, deviceId: DEVICE, status: 'present', markedAt: iso(NOW) })
    await expectReason(scan(), 'device_already_used')
  })

  it('9. answers a second scan with "already marked" and adds no row', async () => {
    await expectReason(scan(), 'accepted')
    const again = await scan()
    expect(again).toMatchObject({ ok: true, reason: 'already_marked', message: 'Already marked present.' })
    expect(store.marks).toHaveLength(1)
  })

  it('9. leaves a teacher’s excused mark alone', async () => {
    store.marks.push({ sessionId: SESSION, studentId: STUDENT, deviceId: DEVICE, status: 'excused', markedAt: iso(NOW) })
    const result = await scan()
    expect(result).toMatchObject({ ok: true, reason: 'already_marked', message: 'Your teacher has already marked you.' })
    expect(store.marks[0].status).toBe('excused')
  })

  it('stops at the first failure: a closed class with a stranger’s phone reports the closed class', async () => {
    store.sessions.get(SESSION)!.status = 'closed'
    await expectReason(scan({ deviceId: FRIEND_DEVICE, key: friendPhone.privateKey }), 'session_closed')
  })

  it('logs every rejection with its reason', async () => {
    await scan({ tokenAt: NOW - 30_000 })
    await scan({ key: friendPhone.privateKey })
    expect(store.attempts.map((attempt) => [attempt.result, attempt.reason])).toEqual([
      ['rejected', 'token_expired'],
      ['rejected', 'device_unverified']
    ])
  })
})

describe('two scans at once', () => {
  it('reports a phone that won a race for another student as used', async () => {
    store.raceWith = { ok: false, conflict: 'device' }
    await expectReason(scan(), 'device_already_used')
  })

  it('reports a student whose own earlier scan won as already marked', async () => {
    store.raceWith = { ok: false, conflict: 'student' }
    await expectReason(scan(), 'already_marked')
  })
})
