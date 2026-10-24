import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()

function isUsable(value: string | undefined): value is string {
  // The example env file ships placeholder values; treat those as unconfigured
  // rather than letting the client fail on every request.
  if (!value) return false
  return !value.includes('your-project') && !value.includes('your-anon')
}

function create(): SupabaseClient | null {
  if (!isUsable(url) || !isUsable(anonKey)) return null

  try {
    void new URL(url)
  } catch {
    console.warn('VITE_SUPABASE_URL is not a valid URL; running without cloud sync.')
    return null
  }

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      /*
        Implicit, not PKCE. A PKCE link only completes in the browser that
        asked for it, because that browser holds the other half of the code.
        People ask on a laptop and open the email on a phone, or in their mail
        app's own browser, and the link then did nothing at all. An implicit
        link carries the session itself, so it signs in wherever it is opened.
      */
      flowType: 'implicit'
    }
  })
}

/**
 * Why the sign-in link that opened this page failed, if it did: expired, used
 * already, or opened twice. Read before anything navigates, because the app
 * redirects to the sign-in screen and the reason would go with the old URL.
 */
export const linkError: string | null = readLinkError()

function readLinkError(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  const code = params.get('error_code') ?? query.get('error_code')
  const description = params.get('error_description') ?? query.get('error_description')
  if (!code && !description) return null
  if (code === 'otp_expired' || /expired|invalid/i.test(description ?? '')) {
    return 'That sign-in link has expired or was already used. Send yourself a new one below.'
  }
  return description ?? 'That sign-in link did not work. Send yourself a new one below.'
}

export const supabase = create()

/** True when the build has real credentials, so cloud sync is available. */
export const isCloudEnabled = supabase !== null

/**
 * Why the server refused an access token, when that is why a request failed.
 *
 *   expired  the token aged out. A refresh fixes it.
 *   early    the token is newer than the database's clock: PostgREST rejects
 *            an `iat` or `nbf` more than 30 seconds ahead of its own time with
 *            "JWT issued at future" / "JWT not yet valid". This lands right
 *            after a sign-in or refresh, and refreshing again only makes it
 *            worse — the new token is newer still. Waiting is what fixes it.
 *
 * Both are recoverable and routine, so they are retried rather than reported.
 * PostgREST errors carry a code but no HTTP status, so the match is on those.
 */
export type TokenFault = 'expired' | 'early'

export function tokenFault(error: unknown): TokenFault | null {
  if (!error) return null
  const failure = error as { code?: string; status?: number; message?: string }
  const message = failure.message ?? ''

  if (/issued at future|not yet valid/i.test(message)) return 'early'
  if (
    failure.code === 'PGRST301' ||
    failure.code === 'PGRST303' ||
    failure.status === 401 ||
    /jwt expired|jwt is expired|token is expired|invalid claim|invalid jwt|bad_jwt/i.test(message)
  ) {
    return 'expired'
  }
  return null
}

/** True when a request failed only because of its access token. */
export function isTokenFault(error: unknown): boolean {
  return tokenFault(error) !== null
}

/*
  Several requests rejected in turn each ask for a refresh. One is enough, and
  with refresh-token rotation a string of them is what gets a session revoked.
  Concurrent callers already share one refresh inside the client; this covers
  the ones that arrive just after it finished.
*/
const FORCED_REFRESH_WINDOW_MS = 10_000
let lastForced: { token: string; at: number } | null = null

/**
 * Guarantees the client holds a usable access token before it is used.
 *
 * `autoRefreshToken` only ticks while the page is awake, so an installed app
 * reopened after a long gap starts with a token that is already dead. Refreshing
 * up front turns what would surface as a JWT error into a normal request.
 *
 * That check can only use the device's clock. `force` is for when the server
 * has already said the token is expired: a phone whose clock runs behind still
 * believes the token is valid, and without forcing would retry the same dead
 * token forever.
 */
export async function ensureFreshSession(
  client: SupabaseClient,
  { force = false }: { force?: boolean } = {}
): Promise<boolean> {
  try {
    const { data, error } = await client.auth.getSession()
    if (error || !data.session) return false

    if (force) {
      // Another request refreshed a moment ago and the client already holds
      // its token, which the retry will carry.
      const current = data.session.access_token
      if (
        current &&
        lastForced?.token === current &&
        Date.now() - lastForced.at < FORCED_REFRESH_WINDOW_MS
      ) {
        return true
      }
    } else {
      const expiresAt = data.session.expires_at ? data.session.expires_at * 1000 : 0
      // A minute of headroom covers the round trip and any clock skew.
      if (expiresAt && expiresAt - Date.now() > 60_000) return true
    }

    const refreshed = await client.auth.refreshSession()
    const session = refreshed.data.session
    if (refreshed.error || !session) return false

    if (force && session.access_token) lastForced = { token: session.access_token, at: Date.now() }
    return true
  } catch {
    return false
  }
}

/**
 * How long to wait for the database's clock to catch up with a token it called
 * early. Short, because a person may be watching a spinner; anything longer is
 * left queued and retried in the background.
 */
export const EARLY_TOKEN_WAITS_MS = [1_500, 3_500]

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Runs a request and recovers from a refused token: an expired one is
 * refreshed once and the request repeated, an early one is given a moment and
 * repeated. Anything else is returned as it came.
 */
export async function withValidToken<T extends { error: unknown }>(
  client: SupabaseClient,
  run: () => PromiseLike<T>
): Promise<T> {
  let result = await run()
  let refreshed = false
  let waits = 0

  for (;;) {
    const fault = tokenFault(result.error)

    if (fault === 'expired' && !refreshed) {
      refreshed = true
      if (!(await ensureFreshSession(client, { force: true }))) return result
    } else if (fault === 'early' && waits < EARLY_TOKEN_WAITS_MS.length) {
      await wait(EARLY_TOKEN_WAITS_MS[waits])
      waits += 1
    } else {
      return result
    }

    result = await run()
  }
}

/** Turns any thrown value into something worth showing a person. */
export function describeError(error: unknown): string {
  if (!error) return 'Something went wrong.'
  if (typeof error === 'string') return error

  const message = (error as { message?: string }).message ?? ''

  if (/failed to fetch|network|load failed/i.test(message)) {
    return 'Cannot reach the server. Check your connection.'
  }
  if (/invalid login credentials/i.test(message)) {
    return 'That email and password combination is not recognised.'
  }
  if (/email not confirmed/i.test(message)) {
    return 'Confirm your email address first — check your inbox.'
  }
  if (/user already registered|already been registered/i.test(message)) {
    return 'That email already has an account. Sign in instead.'
  }
  if (/for security purposes|rate limit|too many requests/i.test(message)) {
    return 'Too many attempts. Wait a minute, then try again.'
  }
  if (/password should be at least/i.test(message)) {
    return 'Passwords need at least 6 characters.'
  }
  if (/issued at future|not yet valid/i.test(message)) {
    return 'The server is catching up with your sign-in. Try again in a moment.'
  }
  if (/refresh token|session.*expired|not authenticated|jwt expired/i.test(message)) {
    return 'Your session expired. Sign in again.'
  }
  // Auth hides the sign-up trigger's own message behind this one; the only
  // rule that trigger enforces is the college email domain.
  if (/database error saving new user/i.test(message)) {
    return 'Sign-up was refused. Use your college email address.'
  }
  if (/profiles_roll_number_key/i.test(message)) {
    return 'That roll number is already registered. Check it, or ask your teacher.'
  }
  if (/permission denied|row-level security/i.test(message)) {
    return 'You do not have access to that.'
  }

  return message || 'Something went wrong.'
}
