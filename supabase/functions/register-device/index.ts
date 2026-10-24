/**
 * register-device: records this phone's public key against the signed-in
 * student, under the rules in _shared/registerDevice.ts.
 *
 * Calling it again with the same key is harmless and returns the device, so
 * the app uses it on every sign-in to learn its device id and status.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import { bearerToken, corsHeaders, json, userAgent } from '../_shared/http.ts'
import { registerDevice, type DeviceStore, type RegisteredDevice } from '../_shared/registerDevice.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
})

const COLUMNS = 'id, student_id, status, active_from, created_at'

function fail(error: unknown): never {
  throw error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error))
}

function toDevice(row: Record<string, unknown>): RegisteredDevice {
  return {
    id: String(row.id),
    studentId: String(row.student_id),
    status: row.status as RegisteredDevice['status'],
    activeFrom: row.active_from ? String(row.active_from) : null,
    createdAt: String(row.created_at)
  }
}

function storeFor(db: SupabaseClient): DeviceStore {
  return {
    async getProfile(userId) {
      const { data, error } = await db.from('profiles').select('role, full_name, roll_number').eq('id', userId).maybeSingle()
      if (error) fail(error)
      if (!data) return null
      return { role: data.role, onboarded: data.full_name !== '' && (data.role === 'teacher' || data.roll_number !== null) }
    },

    async findByKey(publicKey) {
      // jsonb equality ignores member order, and the key is already reduced
      // to the same four members it was stored with.
      const { data, error } = await db.from('devices').select(COLUMNS).eq('public_key', JSON.stringify(publicKey)).maybeSingle()
      if (error) fail(error)
      return data ? toDevice(data) : null
    },

    async liveDevices(studentId) {
      const { data, error } = await db.from('devices').select(COLUMNS).eq('student_id', studentId).neq('status', 'revoked')
      if (error) fail(error)
      return (data ?? []).map(toDevice)
    },

    async insertDevice(device) {
      const { data, error } = await db
        .from('devices')
        .insert({
          student_id: device.studentId,
          public_key: device.publicKey,
          user_agent: device.userAgent,
          status: device.status,
          active_from: device.activeFrom
        })
        .select(COLUMNS)
        .single()
      if (error) fail(error)
      return toDevice(data)
    },

    async revoke(deviceId) {
      const { error } = await db
        .from('devices')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', deviceId)
      if (error) fail(error)
    },

    async logEvent(event) {
      const { error } = await db
        .from('device_events')
        .insert({ device_id: event.deviceId, student_id: event.studentId, event: event.event, actor: event.studentId })
      if (error) fail(error)
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, message: 'Use POST.' }, 405)

  const token = bearerToken(request.headers)
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  if (!auth.user) return json({ ok: false, reason: 'unauthenticated', message: 'Sign in again.' }, 401)

  const body = await request.json().catch(() => ({}))

  try {
    const result = await registerDevice(storeFor(admin), {
      userId: auth.user.id,
      publicKey: body.public_key,
      userAgent: userAgent(request.headers),
      now: Date.now()
    })
    return json(result)
  } catch (error) {
    console.error('register-device failed', error)
    return json({ ok: false, reason: 'server_error', message: 'Could not register this phone. Try again.' }, 500)
  }
})
