/**
 * Device keys: how a scan proves it came from the student's registered phone.
 *
 * On first sign-in the phone makes an ECDSA P-256 key pair whose private half
 * is non-extractable: the browser will use it to sign but will not hand it
 * over, even to the app. Only the public half leaves the phone. Every scan
 * signs "<token>|<user_id>", so a request built anywhere else fails.
 *
 * Shared by the browser (signs) and the Edge Functions (verify). WebCrypto
 * only, so it runs unchanged in Deno, Node and browsers.
 */

import { base64Decode, base64UrlEncode } from './qrToken.ts'

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGNING = { name: 'ECDSA', hash: 'SHA-256' } as const

export interface PublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
}

/** The message a scan signs. The user id stops a signature being reused by anyone else. */
export function scanMessage(token: string, userId: string): string {
  return `${token}|${userId}`
}

// A P-256 coordinate is 32 bytes: 43 characters of unpadded base64url.
const COORDINATE = /^[A-Za-z0-9_-]{43}$/

/**
 * A public key reduced to exactly the members that identify it, or null if
 * it is not a P-256 public key. Anything carrying a private component is
 * refused outright rather than stripped: it means the key was exportable.
 */
export function normalisePublicJwk(input: unknown): PublicJwk | null {
  if (!input || typeof input !== 'object') return null
  const key = input as Record<string, unknown>
  if ('d' in key) return null
  if (key.kty !== 'EC' || key.crv !== 'P-256') return null
  if (typeof key.x !== 'string' || typeof key.y !== 'string') return null
  if (!COORDINATE.test(key.x) || !COORDINATE.test(key.y)) return null
  return { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }
}

/** True when the signature over the message verifies with this public key. */
export async function verifyScanSignature(jwk: PublicJwk, message: string, signature: unknown): Promise<boolean> {
  if (typeof signature !== 'string' || signature.length > 128) return false
  const bytes = base64Decode(signature)
  // WebCrypto ECDSA signatures are the raw 64-byte r || s form.
  if (!bytes || bytes.length !== 64) return false

  try {
    const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true }, ALGORITHM, false, ['verify'])
    return await crypto.subtle.verify(SIGNING, key, bytes, new TextEncoder().encode(message))
  } catch {
    // A point that is not on the curve, for one, throws rather than failing.
    return false
  }
}

/** Makes a phone's key pair. The private key can sign but never be exported. */
export async function generateDeviceKey(): Promise<{ privateKey: CryptoKey; publicJwk: PublicJwk }> {
  const pair = await crypto.subtle.generateKey(ALGORITHM, false, ['sign', 'verify'])
  // Public keys are always exportable, whatever the flag says.
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const publicJwk = normalisePublicJwk(exported)
  if (!publicJwk) throw new Error('The browser produced an unexpected key.')
  return { privateKey: pair.privateKey, publicJwk }
}

/** Signs a scan with the phone's private key. */
export async function signScan(privateKey: CryptoKey, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(SIGNING, privateKey, new TextEncoder().encode(message))
  return base64UrlEncode(new Uint8Array(signature))
}
