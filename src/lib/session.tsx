import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { ApiError, fetchProfile, run, updateProfile } from './api'
import { clearRemoteCache } from './remote'
import { ensureFreshSession, isCloudEnabled, supabase } from './supabaseClient'
import type { Profile, Role } from '../types'

interface Session {
  /** False until it is known whether someone is signed in, and who. */
  hydrated: boolean
  /** True when the build has Supabase credentials. */
  cloud: boolean
  online: boolean
  userId: string | null
  email: string | null
  profile: Profile | null
  /** Why the profile could not be loaded, when there is no cached copy either. */
  profileError: string | null
  saveProfile: (changes: { fullName: string; rollNumber?: string | null }) => Promise<void>
  reloadProfile: () => Promise<void>
  /** Developers only: show the app as a teacher or as a student sees it. */
  switchView: (role: Role) => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<Session | null>(null)

const PROFILE_KEY = 'presently-campus:v1:profile'

/*
  The profile decides which app someone sees, so it is cached for the next
  launch: an installed app opened offline still knows whether it belongs to a
  student or a teacher.
*/
function readCachedProfile(userId: string): Profile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    const profile = raw ? (JSON.parse(raw) as Profile) : null
    return profile?.id === userId ? profile : null
  } catch {
    return null
  }
}

function writeCachedProfile(profile: Profile | null) {
  try {
    if (profile) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
    else window.localStorage.removeItem(PROFILE_KEY)
  } catch {
    // A missing cache only costs a request on the next launch.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(!isCloudEnabled)
  const [userId, setUserId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))

  // The user a profile request was made for, so a slow answer for someone who
  // has since signed out is dropped rather than shown to the next person.
  const currentUser = useRef<string | null>(null)

  const loadProfile = useCallback(async (id: string) => {
    const cached = readCachedProfile(id)
    if (cached) setProfile(cached)

    try {
      const fresh = await fetchProfile(id)
      if (currentUser.current !== id) return
      if (!fresh) throw new ApiError('Your profile is missing. Sign out and back in.')
      setProfile(fresh)
      setProfileError(null)
      writeCachedProfile(fresh)
    } catch (failure) {
      if (currentUser.current !== id) return
      // With a cached copy the app still works for reading; without one there
      // is no way to tell a student from a teacher, so the error is shown.
      if (!cached) setProfileError(failure instanceof Error ? failure.message : 'Could not load your profile.')
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return

    let cancelled = false
    let adopted = false

    const adopt = async (id: string | null, address: string | null) => {
      // Token refreshes report the same user again; only a change matters.
      if (adopted && currentUser.current === id) return
      adopted = true
      currentUser.current = id
      setUserId(id)
      setEmail(address)
      setProfileError(null)
      if (id) {
        await loadProfile(id)
      } else {
        setProfile(null)
      }
      if (!cancelled) setHydrated(true)
    }

    void (async () => {
      const { data } = await client.auth.getSession()
      // An installed app reopened after hours holds a dead access token;
      // refreshing first turns that into an ordinary launch.
      if (data.session) await ensureFreshSession(client)
      if (cancelled) return
      await adopt(data.session?.user.id ?? null, data.session?.user.email ?? null)
    })()

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      // The client holds its auth lock while this runs, and loading the
      // profile needs that lock, so the work waits for the callback to return.
      window.setTimeout(() => void adopt(session?.user.id ?? null, session?.user.email ?? null), 0)
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  const saveProfile = useCallback<Session['saveProfile']>(
    async (changes) => {
      if (!userId) throw new ApiError('Sign in first.')
      const saved = await updateProfile(userId, changes)
      setProfile(saved)
      writeCachedProfile(saved)
    },
    [userId]
  )

  const reloadProfile = useCallback(async () => {
    if (userId) await loadProfile(userId)
  }, [loadProfile, userId])

  const switchView = useCallback(
    async (role: Role) => {
      if (!userId) throw new ApiError('Sign in first.')
      // The server changes the account's role, so every rule then applies
      // exactly as it would to a real teacher or student.
      await run((db) => db.rpc('set_dev_view', { p_role: role }))
      // Cached screens belong to the other view; none of them carry over.
      clearRemoteCache()
      await loadProfile(userId)
    },
    [loadProfile, userId]
  )

  const signOut = useCallback(async () => {
    // Local data goes first: if the request fails, this device must still
    // stop showing the previous person's attendance.
    clearRemoteCache()
    writeCachedProfile(null)
    if (supabase) {
      const { error } = await supabase.auth.signOut().catch((failure: unknown) => ({ error: failure }))
      if (error) await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    }
    currentUser.current = null
    setUserId(null)
    setEmail(null)
    setProfile(null)
  }, [])

  const value = useMemo<Session>(
    () => ({
      hydrated,
      cloud: isCloudEnabled,
      online,
      userId,
      email,
      profile,
      profileError,
      saveProfile,
      reloadProfile,
      switchView,
      signOut
    }),
    [email, hydrated, online, profile, profileError, reloadProfile, saveProfile, signOut, switchView, userId]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): Session {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession must be used inside SessionProvider')
  return session
}

/** The signed-in user's id, for screens that only render once there is one. */
export function useUserId(): string {
  const { userId } = useSession()
  if (!userId) throw new Error('useUserId needs a signed-in user')
  return userId
}
