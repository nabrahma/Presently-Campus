import { describe, expect, it } from 'vitest'
import { createToken, parseToken, verifyToken, windowAt } from '../../supabase/functions/_shared/qrToken.ts'
import { clockOffset } from './projector'

const SESSION = '0b6c2a52-3f9e-4c47-9a3a-5d2f3c1e7a10'
const secret = new Uint8Array(32).fill(9)

describe('clockOffset', () => {
  it('measures the server ahead of or behind this device, from the round trip’s midpoint', () => {
    expect(clockOffset(10_000, 1_000, 1_200)).toBe(8_900)
    expect(clockOffset(1_000, 120_000, 120_400)).toBe(-119_200)
  })
})

describe('a projector with a wrong clock', () => {
  // Acceptance test 9: the teacher's laptop clock is two minutes off.
  it.each([
    ['fast', 120_000],
    ['slow', -120_000]
  ])('still produces codes the server accepts when two minutes %s', async (_label, skew) => {
    const serverNow = 1_790_000_004_000
    const laptopNow = serverNow + skew

    // start_session answers with the server's time; the round trip takes 300 ms.
    const offset = clockOffset(serverNow, laptopNow - 150, laptopNow + 150)
    const token = await createToken(secret, SESSION, windowAt(laptopNow + offset))

    expect(await verifyToken(secret, parseToken(token)!, serverNow)).toBe(true)

    // Without the correction, the same laptop's code is refused.
    const uncorrected = await createToken(secret, SESSION, windowAt(laptopNow))
    expect(await verifyToken(secret, parseToken(uncorrected)!, serverNow)).toBe(false)
  })
})
