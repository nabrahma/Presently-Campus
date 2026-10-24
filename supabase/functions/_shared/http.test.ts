import { describe, expect, it } from 'vitest'
import { bearerToken, clientIp, userAgent } from './http.ts'

const headers = (values: Record<string, string>) => new Headers(values)

describe('clientIp', () => {
  it('takes the first forwarded address', () => {
    expect(clientIp(headers({ 'X-Forwarded-For': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7')
    expect(clientIp(headers({ 'X-Forwarded-For': '2001:db8::1' }))).toBe('2001:db8::1')
  })

  it('drops anything that is not plainly an address', () => {
    expect(clientIp(headers({}))).toBeNull()
    expect(clientIp(headers({ 'X-Forwarded-For': 'unknown' }))).toBeNull()
    expect(clientIp(headers({ 'X-Forwarded-For': '999.1.1.1' }))).toBeNull()
    expect(clientIp(headers({ 'X-Forwarded-For': "1.1.1.1'; drop table" }))).toBeNull()
  })
})

describe('bearerToken', () => {
  it('reads the token from the Authorization header', () => {
    expect(bearerToken(headers({ Authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi')
    expect(bearerToken(headers({}))).toBeNull()
    expect(bearerToken(headers({ Authorization: 'Basic abc' }))).toBeNull()
  })
})

describe('userAgent', () => {
  it('trims to the column’s length', () => {
    expect(userAgent(headers({ 'User-Agent': 'x'.repeat(600) }))?.length).toBe(512)
    expect(userAgent(headers({}))).toBeNull()
  })
})
