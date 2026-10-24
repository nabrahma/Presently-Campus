/**
 * Rotating QR tokens: the one implementation, shared by the mark-attendance
 * Edge Function (which verifies) and the teacher's browser (which signs).
 *
 * Time is cut into 10-second windows. A token names its session and window
 * and carries an HMAC of both under the session's secret:
 *
 *   p1.<session_id>.<window>.<sig>
 *   sig = base64url(HMAC-SHA256(secret, "<session_id>.<window>")), first 16 bytes
 *
 * The teacher's browser makes tokens locally, like an authenticator app, so
 * the code keeps rotating on a poor classroom connection. The server accepts
 * the current and the previous window, so a token lives 10 to 20 seconds:
 * long enough to scan, too short to forward.
 *
 * Runs unchanged in Deno, Node and browsers: it needs only WebCrypto, atob
 * and btoa.
 */

export const TOKEN_VERSION = 'p1'
export const WINDOW_SECONDS = 10
const SIGNATURE_BYTES = 16

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const WINDOW = /^\d{1,12}$/
// 16 bytes of base64url is 22 characters with the padding dropped.
const SIGNATURE = /^[A-Za-z0-9_-]{22}$/

export interface ParsedToken {
  sessionId: string
  window: number
  signature: string
}

/** The window a moment falls in. */
export function windowAt(epochMs: number): number {
  return Math.floor(epochMs / 1000 / WINDOW_SECONDS)
}

/** Seconds until the window containing this moment ends, for the countdown. */
export function secondsLeft(epochMs: number): number {
  const windowMs = WINDOW_SECONDS * 1000
  return (windowMs - (epochMs % windowMs)) / 1000
}

/* -------------------------------------------------------------------------- */
/* Encoding                                                                    */
/* -------------------------------------------------------------------------- */

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decodes standard or URL-safe base64, padded or not. Null if malformed. */
export function base64Decode(text: string): Uint8Array<ArrayBuffer> | null {
  const standard = text.replace(/-/g, '+').replace(/_/g, '/')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(standard)) return null
  try {
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

/** Postgres bytea as PostgREST returns it: "\x" followed by hex. */
export function byteaToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^\\x(?:[0-9a-f]{2})*$/i.test(value)) return null
  const hex = value.slice(2)
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/* -------------------------------------------------------------------------- */
/* Signing                                                                     */
/* -------------------------------------------------------------------------- */

async function hmac(secret: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))
}

export async function signWindow(
  secret: Uint8Array<ArrayBuffer>,
  sessionId: string,
  window: number
): Promise<string> {
  const mac = await hmac(secret, `${sessionId}.${window}`)
  return base64UrlEncode(mac.slice(0, SIGNATURE_BYTES))
}

export async function createToken(
  secret: Uint8Array<ArrayBuffer>,
  sessionId: string,
  window: number
): Promise<string> {
  return `${TOKEN_VERSION}.${sessionId}.${window}.${await signWindow(secret, sessionId, window)}`
}

/** Splits a scanned string into its parts, or null if it is not a token. */
export function parseToken(token: unknown): ParsedToken | null {
  if (typeof token !== 'string' || token.length > 128) return null
  const parts = token.split('.')
  if (parts.length !== 4) return null

  const [version, sessionId, window, signature] = parts
  if (version !== TOKEN_VERSION || !UUID.test(sessionId) || !WINDOW.test(window) || !SIGNATURE.test(signature)) {
    return null
  }
  return { sessionId, window: Number(window), signature }
}

/** Compares without stopping at the first difference. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

/**
 * True when the token was signed with this secret for the current or the
 * previous window at `nowMs`. A token from any other window, earlier or
 * later, is refused: later ones can only come from a clock that is wrong.
 */
export async function verifyToken(
  secret: Uint8Array<ArrayBuffer>,
  token: ParsedToken,
  nowMs: number
): Promise<boolean> {
  const current = windowAt(nowMs)
  if (token.window !== current && token.window !== current - 1) return false
  const expected = await signWindow(secret, token.sessionId, token.window)
  return sameText(expected, token.signature)
}
