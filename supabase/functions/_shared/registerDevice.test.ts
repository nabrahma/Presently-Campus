import { beforeEach, describe, expect, it } from 'vitest'
import { generateDeviceKey, type PublicJwk } from './deviceSignature.ts'
import { COOLING_OFF_HOURS, registerDevice, type DeviceStore, type RegisteredDevice } from './registerDevice.ts'

const STUDENT = 'student-1'
const OTHER = 'student-2'
const NOW = Date.parse('2026-10-24T09:00:00Z')

interface StoredDevice extends RegisteredDevice {
  publicKey: PublicJwk
}

class MemoryDevices implements DeviceStore {
  profiles = new Map<string, { role: 'student' | 'teacher'; onboarded: boolean }>([
    [STUDENT, { role: 'student', onboarded: true }],
    [OTHER, { role: 'student', onboarded: true }],
    ['teacher-1', { role: 'teacher', onboarded: true }]
  ])
  devices: StoredDevice[] = []
  events: Array<{ deviceId: string; event: string }> = []

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null
  }
  async findByKey(publicKey: PublicJwk) {
    return this.devices.find((device) => JSON.stringify(device.publicKey) === JSON.stringify(publicKey)) ?? null
  }
  async liveDevices(studentId: string) {
    return this.devices.filter((device) => device.studentId === studentId && device.status !== 'revoked')
  }
  async insertDevice(input: Parameters<DeviceStore['insertDevice']>[0]) {
    const device: StoredDevice = {
      id: `device-${this.devices.length + 1}`,
      studentId: input.studentId,
      status: input.status,
      activeFrom: input.activeFrom,
      createdAt: new Date(NOW).toISOString(),
      publicKey: input.publicKey
    }
    this.devices.push(device)
    return device
  }
  async revoke(deviceId: string) {
    const device = this.devices.find((item) => item.id === deviceId)
    if (device) device.status = 'revoked'
  }
  async logEvent(event: Parameters<DeviceStore['logEvent']>[0]) {
    this.events.push({ deviceId: event.deviceId, event: event.event })
  }
}

let store: MemoryDevices
const newKey = async () => (await generateDeviceKey()).publicJwk
const register = (publicKey: unknown, userId = STUDENT) =>
  registerDevice(store, { userId, publicKey, userAgent: 'Mozilla/5.0 (iPhone)', now: NOW })

beforeEach(() => {
  store = new MemoryDevices()
})

describe('registerDevice', () => {
  it('activates a first phone after the cooling-off period', async () => {
    const result = await register(await newKey())
    expect(result).toMatchObject({ ok: true, reason: 'registered' })
    expect(result.device?.status).toBe('active')
    expect(Date.parse(result.device!.activeFrom!)).toBe(NOW + COOLING_OFF_HOURS * 3_600_000)
    expect(store.events).toEqual([{ deviceId: 'device-1', event: 'registered' }])
  })

  it('returns the same device when the same phone registers again', async () => {
    const key = await newKey()
    const first = await register(key)
    const again = await register(key)
    expect(again).toMatchObject({ ok: true, reason: 'existing' })
    expect(again.device?.id).toBe(first.device?.id)
    expect(store.devices).toHaveLength(1)
  })

  it('refuses a key that belongs to another account', async () => {
    const key = await newKey()
    await register(key, OTHER)
    expect(await register(key)).toMatchObject({ ok: false, reason: 'key_in_use' })
  })

  it('makes a second phone a device change that waits for a teacher', async () => {
    await register(await newKey())
    const result = await register(await newKey())
    expect(result).toMatchObject({ ok: true, reason: 'requested' })
    expect(result.device).toMatchObject({ status: 'pending', activeFrom: null })
    expect(store.devices.filter((device) => device.status === 'active')).toHaveLength(1)
  })

  it('keeps only the latest device change request', async () => {
    await register(await newKey())
    const first = await register(await newKey())
    await register(await newKey())
    expect(store.devices.find((device) => device.id === first.device?.id)?.status).toBe('revoked')
    expect(store.devices.filter((device) => device.status === 'pending')).toHaveLength(1)
    expect(store.events.map((event) => event.event)).toEqual(['registered', 'requested', 'superseded', 'requested'])
  })

  it('asks a phone with a retired key to make a new one', async () => {
    const key = await newKey()
    const result = await register(key)
    await store.revoke(result.device!.id)
    expect(await register(key)).toMatchObject({ ok: false, reason: 'key_retired' })
  })

  it('refuses teachers and unknown users', async () => {
    expect(await register(await newKey(), 'teacher-1')).toMatchObject({ ok: false, reason: 'not_student' })
    expect(await register(await newKey(), 'nobody')).toMatchObject({ ok: false, reason: 'not_student' })
  })

  it('refuses a key that is not a P-256 public key', async () => {
    const key = await newKey()
    expect(await register({ ...key, d: key.x })).toMatchObject({ ok: false, reason: 'invalid_key' })
    expect(await register({ kty: 'oct', k: 'secret' })).toMatchObject({ ok: false, reason: 'invalid_key' })
  })
})
