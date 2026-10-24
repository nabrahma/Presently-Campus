import { useEffect, useState } from 'react'
import { run, type Row } from './api'
import { deviceKeysSupported, ensureDeviceKey, forgetDeviceKey, loadDeviceKey, onDeviceKeyChange, rememberRegistration, signForScan, type StoredKey } from './deviceKey'
import { invalidate, useRemote } from './remote'
import { useUserId } from './session'
import { studentKey } from './student'
import { ensureFreshSession, supabase } from './supabaseClient'
import type { RegisterResult } from '../../supabase/functions/_shared/registerDevice.ts'
import type { ScanResult } from '../../supabase/functions/_shared/markAttendance.ts'

export type { ScanResult }

export interface Device {
  id: string
  status: 'active' | 'pending' | 'revoked'
  activeFrom: string | null
  createdAt: string
  revokedAt: string | null
  userAgent: string | null
}

const devicesKey = (userId: string) => `${userId}:devices`

function toDevice(row: Row): Device {
  return {
    id: String(row.id),
    status: row.status as Device['status'],
    activeFrom: row.active_from ? String(row.active_from) : null,
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : null,
    userAgent: row.user_agent ? String(row.user_agent) : null
  }
}

export async function loadMyDevices(userId: string): Promise<Device[]> {
  const rows = await run((db) =>
    db.from('devices').select('*').eq('student_id', userId).order('created_at', { ascending: false })
  )
  return (rows as Row[]).map(toDevice)
}

export function useMyDevices() {
  const userId = useUserId()
  return useRemote(devicesKey(userId), () => loadMyDevices(userId))
}

/* -------------------------------------------------------------------------- */
/* Calling the Edge Functions                                                  */
/* -------------------------------------------------------------------------- */

interface Failure {
  ok: false
  reason: string
  message: string
}

/**
 * Calls an Edge Function and returns its JSON answer. Refusals arrive as
 * ordinary answers; only transport and server failures are turned into one
 * here, with a message a person can act on.
 */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T | Failure> {
  const client = supabase
  if (!client) return { ok: false, reason: 'offline', message: 'This build has no Supabase credentials.' }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { ok: false, reason: 'offline', message: 'You are offline. Scanning needs a connection.' }
  }

  await ensureFreshSession(client)
  const { data, error } = await client.functions.invoke(name, { body })
  if (!error) return data as T

  // A non-2xx answer still carries the function's own JSON message.
  const context = (error as { context?: Response }).context
  const answer = context && typeof context.json === 'function' ? await context.json().catch(() => null) : null
  if (answer && typeof answer.message === 'string') return { ok: false, reason: String(answer.reason ?? 'error'), message: answer.message }
  return { ok: false, reason: 'network', message: 'Cannot reach the server. Check your connection and try again.' }
}

/**
 * Registers this phone to the signed-in student: a first phone, or a device
 * change request if they already have one. A key the server has retired is
 * replaced with a fresh one and registered once more.
 */
export async function registerThisPhone(userId: string): Promise<RegisterResult | Failure> {
  let key = await ensureDeviceKey()
  let result = await invoke<RegisterResult>('register-device', { public_key: key.publicJwk })

  if (!result.ok && result.reason === 'key_retired') {
    await forgetDeviceKey()
    key = await ensureDeviceKey()
    result = await invoke<RegisterResult>('register-device', { public_key: key.publicJwk })
  }

  if (result.ok && 'device' in result && result.device) await rememberRegistration(result.device.id, userId)
  await invalidate(devicesKey(userId))
  return result
}

/** Sends one scanned code to the server and returns its verdict. */
export async function submitScan(userId: string, token: string): Promise<ScanResult | Failure> {
  const { deviceId, signature } = await signForScan(token, userId)
  const result = await invoke<ScanResult>('mark-attendance', { token, device_id: deviceId, signature })
  if (result.ok) await invalidate(studentKey(userId))
  return result
}

/* -------------------------------------------------------------------------- */
/* This phone's standing                                                       */
/* -------------------------------------------------------------------------- */

export type PhoneStatus =
  | { kind: 'unsupported' }
  | { kind: 'unregistered'; elsewhere: Device | null }
  | { kind: 'other-account' }
  | { kind: 'revoked' }
  | { kind: 'pending'; device: Device; elsewhere: Device | null }
  | { kind: 'cooling'; device: Device; until: string }
  | { kind: 'active'; device: Device }

/**
 * What this phone can do for this student, from the key it holds and the
 * student's devices on the server. Row Level Security shows a student only
 * their own devices, so a key the list does not contain belongs to someone
 * else.
 */
export function phoneStatus(local: StoredKey | null, devices: Device[], supported: boolean, now: number): PhoneStatus {
  if (!supported) return { kind: 'unsupported' }

  const active = devices.find((device) => device.status === 'active') ?? null
  if (!local?.deviceId) return { kind: 'unregistered', elsewhere: active }

  const mine = devices.find((device) => device.id === local.deviceId)
  if (!mine) return { kind: 'other-account' }
  if (mine.status === 'revoked') return { kind: 'revoked' }
  if (mine.status === 'pending') return { kind: 'pending', device: mine, elsewhere: active }
  if (mine.activeFrom && Date.parse(mine.activeFrom) > now) {
    return { kind: 'cooling', device: mine, until: mine.activeFrom }
  }
  return { kind: 'active', device: mine }
}

/** This phone's standing, kept current as the key or the device list changes. */
export function usePhoneStatus(): { status: PhoneStatus | null; refresh: () => Promise<void> } {
  const devices = useMyDevices()
  const [local, setLocal] = useState<StoredKey | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    const read = () => void loadDeviceKey().then((key) => !cancelled && setLocal(key))
    read()
    const stop = onDeviceKeyChange(read)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const status =
    local === undefined || !devices.data ? null : phoneStatus(local, devices.data, deviceKeysSupported(), Date.now())
  return { status, refresh: devices.refresh }
}
