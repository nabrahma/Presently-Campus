/**
 * mark-attendance: accepts or refuses one scan.
 *
 * The student comes from the verified access token, never from the body.
 * The rules live in _shared/markAttendance.ts; this file only connects them
 * to the database, as the service role, which is the only role allowed to
 * write a QR mark.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4'
import { bearerToken, clientIp, corsHeaders, json, userAgent } from '../_shared/http.ts'
import { markAttendance, type ScanStore } from '../_shared/markAttendance.ts'
import { byteaToBytes } from '../_shared/qrToken.ts'

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
})

function fail(error: unknown): never {
  throw error instanceof Error ? error : new Error(String((error as { message?: string })?.message ?? error))
}

function storeFor(db: SupabaseClient): ScanStore {
  return {
    async getSession(id) {
      const { data, error } = await db
        .from('class_sessions')
        .select('id, course_id, status, started_at, course:courses(name)')
        .eq('id', id)
        .maybeSingle()
      if (error) fail(error)
      if (!data) return null
      return {
        id: data.id,
        courseId: data.course_id,
        courseName: (data.course as unknown as { name: string } | null)?.name ?? 'your class',
        status: data.status,
        startedAt: data.started_at
      }
    },

    async getSecret(sessionId) {
      const { data, error } = await db.from('session_secrets').select('secret').eq('session_id', sessionId).maybeSingle()
      if (error) fail(error)
      return data ? byteaToBytes(String(data.secret)) : null
    },

    async isEnrolled(courseId, studentId) {
      const { data, error } = await db
        .from('enrolments')
        .select('student_id')
        .eq('course_id', courseId)
        .eq('student_id', studentId)
        .eq('status', 'active')
        .maybeSingle()
      if (error) fail(error)
      return data !== null
    },

    async getDevice(id) {
      const { data, error } = await db
        .from('devices')
        .select('id, student_id, status, active_from, created_at, public_key')
        .eq('id', id)
        .maybeSingle()
      if (error) fail(error)
      if (!data) return null
      return {
        id: data.id,
        studentId: data.student_id,
        status: data.status,
        activeFrom: data.active_from,
        createdAt: data.created_at,
        publicKey: data.public_key
      }
    },

    async deviceMarked(sessionId, deviceId) {
      const { data, error } = await db
        .from('attendance')
        .select('student_id')
        .eq('session_id', sessionId)
        .eq('device_id', deviceId)
        .maybeSingle()
      if (error) fail(error)
      return data?.student_id ?? null
    },

    async findMark(sessionId, studentId) {
      const { data, error } = await db
        .from('attendance')
        .select('status, marked_at')
        .eq('session_id', sessionId)
        .eq('student_id', studentId)
        .maybeSingle()
      if (error) fail(error)
      return data ? { status: data.status, markedAt: data.marked_at } : null
    },

    async insertMark({ session, studentId, deviceId, ip, userAgent }) {
      // The database adds the soft flags (off campus, shared connection,
      // late) as it writes the mark, and reports which constraint stopped a
      // racing duplicate.
      const { data, error } = await db.rpc('record_qr_mark', {
        p_session: session.id,
        p_student: studentId,
        p_device: deviceId,
        p_ip: ip,
        p_user_agent: userAgent
      })
      if (error) fail(error)
      if (data.status === 'conflict') return { ok: false, conflict: data.conflict === 'device' ? 'device' : 'student' }
      return { ok: true, markedAt: data.marked_at }
    },

    async logAttempt(attempt) {
      const { error } = await db.from('scan_attempts').insert({
        session_id: attempt.sessionId,
        student_id: attempt.studentId,
        device_id: attempt.deviceId,
        result: attempt.result,
        reason: attempt.reason,
        ip: attempt.ip,
        user_agent: attempt.userAgent
      })
      if (error) fail(error)
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ ok: false, message: 'Use POST.' }, 405)

  const token = bearerToken(request.headers)
  const { data: auth } = token ? await admin.auth.getUser(token) : { data: { user: null } }
  if (!auth.user) return json({ ok: false, reason: 'unauthenticated', message: 'Sign in again, then scan.' }, 401)

  const body = await request.json().catch(() => ({}))

  try {
    const result = await markAttendance(storeFor(admin), {
      token: body.token,
      deviceId: body.device_id,
      signature: body.signature,
      userId: auth.user.id,
      ip: clientIp(request.headers),
      userAgent: userAgent(request.headers),
      now: Date.now()
    })
    // Refusals are answers, not errors: the app shows the message either way.
    return json(result)
  } catch (error) {
    console.error('mark-attendance failed', error)
    return json({ ok: false, reason: 'server_error', message: 'Something went wrong. Scan again.' }, 500)
  }
})
