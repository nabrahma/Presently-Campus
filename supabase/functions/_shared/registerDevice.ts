/**
 * The rules for registering a phone (section 5.3), behind DeviceStore so they
 * can be tested without a database.
 *
 *   - A public key belongs to one account. A key already registered to
 *     someone else is refused.
 *   - A student's first phone is active once a 12-hour cooling-off ends, or
 *     sooner if a teacher approves it.
 *   - A phone for a student who already has one is a device change: it waits
 *     for a teacher, who retires the old phone by approving the new one.
 *
 * Registering the same key again is harmless and returns the same device,
 * which is how the app learns its device id and status on a later sign-in.
 */

import { normalisePublicJwk, type PublicJwk } from './deviceSignature.ts'

export const COOLING_OFF_HOURS = 12

export interface RegisteredDevice {
  id: string
  studentId: string
  status: 'active' | 'pending' | 'revoked'
  activeFrom: string | null
  createdAt: string
}

export interface DeviceStore {
  getProfile(userId: string): Promise<{ role: 'student' | 'teacher'; onboarded: boolean } | null>
  findByKey(publicKey: PublicJwk): Promise<RegisteredDevice | null>
  /** The student's devices that are not revoked. */
  liveDevices(studentId: string): Promise<RegisteredDevice[]>
  insertDevice(device: {
    studentId: string
    publicKey: PublicJwk
    userAgent: string | null
    status: 'active' | 'pending'
    activeFrom: string | null
  }): Promise<RegisteredDevice>
  revoke(deviceId: string): Promise<void>
  logEvent(event: {
    deviceId: string
    studentId: string
    event: 'registered' | 'requested' | 'superseded'
  }): Promise<void>
}

export type RegisterReason =
  | 'registered'
  | 'requested'
  | 'existing'
  | 'not_student'
  | 'invalid_key'
  | 'key_in_use'
  | 'key_retired'

export const REGISTER_MESSAGES: Record<RegisterReason, string> = {
  registered: `This phone is registered. It can mark attendance after ${COOLING_OFF_HOURS} hours, or as soon as a teacher approves it.`,
  requested: 'Device change requested. A teacher of one of your courses needs to approve it.',
  existing: 'This phone is already registered to you.',
  not_student: 'Only students register a phone.',
  invalid_key: 'This browser produced a key that cannot be used. Update it, or try another browser.',
  key_in_use: 'This phone is registered to another account.',
  key_retired: 'This phone’s key was retired. Register it again.'
}

export interface RegisterResult {
  ok: boolean
  reason: RegisterReason
  message: string
  device?: RegisteredDevice
}

export async function registerDevice(
  store: DeviceStore,
  request: { userId: string; publicKey: unknown; userAgent: string | null; now: number }
): Promise<RegisterResult> {
  const answer = (reason: RegisterReason, device?: RegisteredDevice): RegisterResult => ({
    ok: reason === 'registered' || reason === 'requested' || reason === 'existing',
    reason,
    message: REGISTER_MESSAGES[reason],
    device
  })

  const profile = await store.getProfile(request.userId)
  if (!profile || profile.role !== 'student') return answer('not_student')

  const publicKey = normalisePublicJwk(request.publicKey)
  if (!publicKey) return answer('invalid_key')

  const known = await store.findByKey(publicKey)
  if (known) {
    if (known.studentId !== request.userId) return answer('key_in_use')
    // A rejected or replaced key stays retired; the phone makes a new one.
    if (known.status === 'revoked') return answer('key_retired')
    return answer('existing', known)
  }

  const userAgent = request.userAgent ? request.userAgent.slice(0, 512) : null
  const devices = await store.liveDevices(request.userId)

  if (!devices.some((device) => device.status === 'active')) {
    const device = await store.insertDevice({
      studentId: request.userId,
      publicKey,
      userAgent,
      status: 'active',
      activeFrom: new Date(request.now + COOLING_OFF_HOURS * 3_600_000).toISOString()
    })
    await store.logEvent({ deviceId: device.id, studentId: request.userId, event: 'registered' })
    return answer('registered', device)
  }

  // Only the latest request stands; an earlier one is withdrawn.
  for (const earlier of devices.filter((device) => device.status === 'pending')) {
    await store.revoke(earlier.id)
    await store.logEvent({ deviceId: earlier.id, studentId: request.userId, event: 'superseded' })
  }

  const device = await store.insertDevice({
    studentId: request.userId,
    publicKey,
    userAgent,
    status: 'pending',
    activeFrom: null
  })
  await store.logEvent({ deviceId: device.id, studentId: request.userId, event: 'requested' })
  return answer('requested', device)
}
