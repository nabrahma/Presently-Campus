/** Request and response plumbing shared by the Edge Functions. */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

/** The access token from an Authorization header, if there is one. */
export function bearerToken(headers: Headers): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(headers.get('Authorization') ?? '')
  return match ? match[1].trim() : null
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/
const IPV6 = /^[0-9a-f:]{2,39}(?:%[0-9a-z]+)?$/i

/**
 * The caller's address as the platform's proxy reports it: the first entry
 * of X-Forwarded-For. Anything that is not plainly an address is dropped
 * rather than stored, since the column is typed and the value is only ever
 * a soft signal.
 */
export function clientIp(headers: Headers): string | null {
  const first = (headers.get('X-Forwarded-For') ?? '').split(',')[0].trim()
  if (IPV4.test(first)) return first
  if (first.includes(':') && IPV6.test(first)) return first.replace(/%.*$/, '')
  return null
}

/** A user agent short enough for its column. */
export function userAgent(headers: Headers): string | null {
  const value = headers.get('User-Agent')
  return value ? value.slice(0, 512) : null
}
