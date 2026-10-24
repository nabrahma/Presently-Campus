import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { verifyScanSignature, scanMessage } from '../../supabase/functions/_shared/deviceSignature.ts'
import { ensureDeviceKey, forgetDeviceKey, loadDeviceKey, rememberRegistration, signForScan, type StoredKey } from './deviceKey'
import { phoneStatus, type Device } from './devices'

const NOW = Date.parse('2026-10-24T09:00:00Z')
const hours = (count: number) => new Date(NOW + count * 3_600_000).toISOString()

const device = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  status: 'active',
  activeFrom: hours(-1),
  createdAt: hours(-24),
  revokedAt: null,
  userAgent: null,
  ...overrides
})

const local = (deviceId: string | null) => ({ deviceId, userId: 'me' }) as StoredKey

describe('phoneStatus', () => {
  it('cannot help a browser that cannot keep a key', () => {
    expect(phoneStatus(null, [], false, NOW).kind).toBe('unsupported')
  })

  it('is unregistered with no key, and says so when another phone is registered', () => {
    expect(phoneStatus(null, [], true, NOW)).toEqual({ kind: 'unregistered', elsewhere: null })
    expect(phoneStatus(local(null), [device()], true, NOW)).toEqual({ kind: 'unregistered', elsewhere: device() })
  })

  it('recognises a key registered to another account', () => {
    // The student's own devices do not include it: Row Level Security hides others'.
    expect(phoneStatus(local('someone-elses'), [device()], true, NOW).kind).toBe('other-account')
  })

  it('reports cooling off until the device becomes usable', () => {
    expect(phoneStatus(local('device-1'), [device({ activeFrom: hours(3) })], true, NOW)).toMatchObject({
      kind: 'cooling',
      until: hours(3)
    })
  })

  it('reports active, pending and retired phones', () => {
    expect(phoneStatus(local('device-1'), [device()], true, NOW).kind).toBe('active')
    expect(phoneStatus(local('device-1'), [device({ status: 'pending', activeFrom: null })], true, NOW).kind).toBe('pending')
    expect(phoneStatus(local('device-1'), [device({ status: 'revoked', revokedAt: hours(-1) })], true, NOW).kind).toBe('revoked')
  })
})

describe('the stored device key', () => {
  beforeEach(async () => {
    await forgetDeviceKey()
  })

  it('is made once and kept', async () => {
    const first = await ensureDeviceKey()
    const again = await ensureDeviceKey()
    expect(again.publicJwk).toEqual(first.publicJwk)
  })

  it('cannot be read out of storage, only used', async () => {
    await ensureDeviceKey()
    const stored = await loadDeviceKey()
    expect(stored?.privateKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('jwk', stored!.privateKey)).rejects.toThrow()
  })

  it('signs scans the server can verify, once registered', async () => {
    const key = await ensureDeviceKey()
    await rememberRegistration('device-1', 'me')

    const { deviceId, signature } = await signForScan('p1.token', 'me')
    expect(deviceId).toBe('device-1')
    expect(await verifyScanSignature(key.publicJwk, scanMessage('p1.token', 'me'), signature)).toBe(true)
  })

  it('still sends a scan without a key, for the server to refuse and log', async () => {
    expect(await signForScan('p1.token', 'me')).toEqual({ deviceId: null, signature: '' })
  })
})
