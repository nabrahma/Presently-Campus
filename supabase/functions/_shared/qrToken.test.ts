import { describe, expect, it } from 'vitest'
import {
  base64Decode,
  base64UrlEncode,
  byteaToBytes,
  createToken,
  parseToken,
  secondsLeft,
  verifyToken,
  windowAt,
  WINDOW_SECONDS
} from './qrToken.ts'

const SESSION = '0b6c2a52-3f9e-4c47-9a3a-5d2f3c1e7a10'
const OTHER_SESSION = '9d1e4b7a-2c3f-4e5a-8b6c-7d8e9f0a1b2c'
const secret = new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
const otherSecret = new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index))

// 10:00:03 on some day, three seconds into a window.
const NOW = 1_790_000_003_000
const window = windowAt(NOW)

async function tokenAt(ms: number, key = secret, session = SESSION) {
  return createToken(key, session, windowAt(ms))
}

async function verify(token: string, at = NOW, key = secret) {
  const parsed = parseToken(token)
  return parsed !== null && (await verifyToken(key, parsed, at))
}

describe('windows', () => {
  it('cuts time into ten-second windows', () => {
    expect(WINDOW_SECONDS).toBe(10)
    expect(windowAt(1_790_000_000_000)).toBe(windowAt(1_790_000_009_999))
    expect(windowAt(1_790_000_010_000)).toBe(windowAt(1_790_000_000_000) + 1)
  })

  it('counts down to the next window', () => {
    expect(secondsLeft(NOW)).toBe(7)
    expect(secondsLeft(1_790_000_000_000)).toBe(10)
  })
})

describe('verifyToken', () => {
  it('accepts a token from the current window', async () => {
    expect(await verify(await tokenAt(NOW))).toBe(true)
  })

  it('accepts a token from the previous window, so a slow scan still counts', async () => {
    expect(await verify(await tokenAt(NOW - 10_000))).toBe(true)
  })

  it('refuses a token two windows old: a photo forwarded after 20 seconds', async () => {
    expect(await verify(await tokenAt(NOW - 20_000))).toBe(false)
    expect(await verify(await tokenAt(NOW - 30_000))).toBe(false)
  })

  it('refuses a token from a future window', async () => {
    expect(await verify(await tokenAt(NOW + 10_000))).toBe(false)
  })

  it('refuses a tampered signature', async () => {
    const token = await tokenAt(NOW)
    const at = token.length - 6
    const swapped = token[at] === 'A' ? 'B' : 'A'
    expect(await verify(token.slice(0, at) + swapped + token.slice(at + 1))).toBe(false)
  })

  it('refuses a token signed with another session’s secret', async () => {
    expect(await verify(await tokenAt(NOW, otherSecret))).toBe(false)
  })

  it('refuses a token whose session id was swapped for another', async () => {
    const token = await tokenAt(NOW)
    expect(await verify(token.replace(SESSION, OTHER_SESSION))).toBe(false)
  })

  it('refuses a token whose window was moved forward', async () => {
    const old = await tokenAt(NOW - 30_000)
    expect(await verify(old.replace(`.${window - 3}.`, `.${window}.`))).toBe(false)
  })
})

describe('parseToken', () => {
  it('reads a token it made', async () => {
    const token = await tokenAt(NOW)
    expect(parseToken(token)).toMatchObject({ sessionId: SESSION, window })
    expect(token.length).toBeLessThan(80)
  })

  it('rejects anything that is not a token', () => {
    for (const value of [
      '',
      'hello',
      `https://example.com/${SESSION}`,
      `p2.${SESSION}.${window}.AAAAAAAAAAAAAAAAAAAAAA`,
      `p1.not-a-uuid.${window}.AAAAAAAAAAAAAAAAAAAAAA`,
      `p1.${SESSION}.-5.AAAAAAAAAAAAAAAAAAAAAA`,
      `p1.${SESSION}.1.5.AAAAAAAAAAAAAAAAAAAAAA`,
      `p1.${SESSION}.${window}.short`,
      `p1.${SESSION}.${window}.AAAAAAAAAAAAAAAAAAAAA+`,
      `p1.${SESSION.toUpperCase()}.${window}.AAAAAAAAAAAAAAAAAAAAAA`,
      42,
      null
    ]) {
      expect(parseToken(value)).toBeNull()
    }
  })
})

describe('encoding', () => {
  it('round-trips base64url without padding', () => {
    const bytes = new Uint8Array([251, 255, 0, 1, 62, 63])
    const text = base64UrlEncode(bytes)
    expect(text).not.toMatch(/[+/=]/)
    expect(Array.from(base64Decode(text)!)).toEqual(Array.from(bytes))
  })

  it('reads the standard base64 Postgres produces', () => {
    expect(Array.from(base64Decode('+/8AAT4/')!)).toEqual([251, 255, 0, 1, 62, 63])
    expect(base64Decode('not base64!')).toBeNull()
  })

  it('reads bytea as PostgREST returns it', () => {
    expect(Array.from(byteaToBytes('\\x00ff10')!)).toEqual([0, 255, 16])
    expect(byteaToBytes('00ff')).toBeNull()
    expect(byteaToBytes('\\x0')).toBeNull()
  })
})
