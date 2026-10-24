import { describe, expect, it } from 'vitest'
import { generateDeviceKey, normalisePublicJwk, scanMessage, signScan, verifyScanSignature } from './deviceSignature.ts'

describe('device keys', () => {
  it('makes a key whose private half cannot be exported', async () => {
    const { privateKey, publicJwk } = await generateDeviceKey()
    expect(privateKey.extractable).toBe(false)
    await expect(crypto.subtle.exportKey('jwk', privateKey)).rejects.toThrow()
    expect(Object.keys(publicJwk).sort()).toEqual(['crv', 'kty', 'x', 'y'])
  })

  it('verifies a scan signed by the same phone', async () => {
    const { privateKey, publicJwk } = await generateDeviceKey()
    const message = scanMessage('p1.token', 'user-1')
    expect(await verifyScanSignature(publicJwk, message, await signScan(privateKey, message))).toBe(true)
  })

  it('refuses a signature from another phone', async () => {
    const mine = await generateDeviceKey()
    const theirs = await generateDeviceKey()
    const message = scanMessage('p1.token', 'user-1')
    expect(await verifyScanSignature(mine.publicJwk, message, await signScan(theirs.privateKey, message))).toBe(false)
  })

  it('refuses a signature reused for another student or another token', async () => {
    const { privateKey, publicJwk } = await generateDeviceKey()
    const signature = await signScan(privateKey, scanMessage('p1.token', 'user-1'))
    expect(await verifyScanSignature(publicJwk, scanMessage('p1.token', 'user-2'), signature)).toBe(false)
    expect(await verifyScanSignature(publicJwk, scanMessage('p1.other', 'user-1'), signature)).toBe(false)
  })

  it('refuses malformed signatures without throwing', async () => {
    const { publicJwk } = await generateDeviceKey()
    for (const signature of [undefined, 42, '', 'not base64!', 'AAAA', 'A'.repeat(200)]) {
      expect(await verifyScanSignature(publicJwk, 'message', signature)).toBe(false)
    }
  })
})

describe('normalisePublicJwk', () => {
  const coordinate = 'A'.repeat(43)

  it('keeps only the members that identify the key', () => {
    expect(normalisePublicJwk({ kty: 'EC', crv: 'P-256', x: coordinate, y: coordinate, ext: true, key_ops: ['verify'] })).toEqual({
      kty: 'EC',
      crv: 'P-256',
      x: coordinate,
      y: coordinate
    })
  })

  it('refuses a key carrying its private half', () => {
    expect(normalisePublicJwk({ kty: 'EC', crv: 'P-256', x: coordinate, y: coordinate, d: coordinate })).toBeNull()
  })

  it('refuses other curves, other key types and junk', () => {
    expect(normalisePublicJwk({ kty: 'EC', crv: 'P-384', x: coordinate, y: coordinate })).toBeNull()
    expect(normalisePublicJwk({ kty: 'RSA', n: 'x', e: 'AQAB' })).toBeNull()
    expect(normalisePublicJwk({ kty: 'EC', crv: 'P-256', x: 'short', y: coordinate })).toBeNull()
    expect(normalisePublicJwk('key')).toBeNull()
    expect(normalisePublicJwk(null)).toBeNull()
  })
})
