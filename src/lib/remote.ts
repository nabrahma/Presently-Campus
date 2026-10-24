import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'

/**
 * Server data, cached by key.
 *
 * Everything a screen shows comes from the server, and the server is the only
 * thing that can change it, so there is no outbox here: a read is cached, a
 * write goes straight to the server and the affected keys are fetched again.
 *
 * The last answer for each key is kept in memory and in local storage, so a
 * screen paints at once and the app can still be read offline. Keys always
 * include the user id, and signing out clears every one of them.
 */

interface Entry<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  /** When data last arrived from the server, or 0 if it only came from storage. */
  fetchedAt: number
}

// Its own prefix, so clearing the cache on sign-out or a view switch leaves
// device settings such as the theme and text size alone.
const STORAGE_PREFIX = 'presently-campus:v1:data:'
/** Remounting a screen within this window reuses the answer it just got. */
const FRESH_MS = 5_000

const EMPTY: Entry<never> = { data: undefined, error: null, loading: false, fetchedAt: 0 }

const entries = new Map<string, Entry<unknown>>()
const listeners = new Map<string, Set<() => void>>()
const loaders = new Map<string, () => Promise<unknown>>()
const inflight = new Map<string, Promise<void>>()

function readStored<T>(key: string): T | undefined {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}

function writeStored(key: string, data: unknown) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data))
  } catch {
    // Out of quota or blocked: the cache is a convenience, not the record.
  }
}

function entryFor<T>(key: string): Entry<T> {
  let entry = entries.get(key) as Entry<T> | undefined
  if (!entry) {
    const stored = typeof window === 'undefined' ? undefined : readStored<T>(key)
    entry = stored === undefined ? EMPTY : { ...EMPTY, data: stored }
    entries.set(key, entry)
  }
  return entry
}

function set<T>(key: string, change: Partial<Entry<T>>) {
  // A new object each time, so useSyncExternalStore sees the change.
  entries.set(key, { ...entryFor<T>(key), ...change })
  listeners.get(key)?.forEach((notify) => notify())
}

/** Fetches a key again, sharing the request with anyone already waiting on it. */
export function revalidate(key: string): Promise<void> {
  const load = loaders.get(key)
  if (!load) return Promise.resolve()

  const pending = inflight.get(key)
  if (pending) return pending

  set(key, { loading: true })
  const request = load()
    .then((data) => {
      set(key, { data, error: null, loading: false, fetchedAt: Date.now() })
      writeStored(key, data)
    })
    .catch((failure: unknown) => {
      set(key, {
        loading: false,
        error: failure instanceof Error ? failure.message : 'Something went wrong.'
      })
    })
    .finally(() => inflight.delete(key))

  inflight.set(key, request)
  return request
}

/**
 * Marks every key under a prefix as out of date after a write. Keys a screen
 * is showing are fetched now; the rest are fetched when next shown.
 */
export function invalidate(prefix: string): Promise<void> {
  for (const [key, entry] of entries) {
    if (key.startsWith(prefix)) entries.set(key, { ...entry, fetchedAt: 0 })
  }
  const shown = [...loaders.keys()].filter((key) => key.startsWith(prefix))
  return Promise.all(shown.map(revalidate)).then(() => undefined)
}

/** Replaces a key's data locally, ahead of the server confirming it. */
export function mutate<T>(key: string, update: (current: T | undefined) => T) {
  set<T>(key, { data: update(entryFor<T>(key).data) })
}

/** Forgets everything, in memory and on disk. Called on sign-out. */
export function clearRemoteCache() {
  entries.clear()
  inflight.clear()
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(STORAGE_PREFIX)) window.localStorage.removeItem(key)
    }
  } catch {
    // Nothing more can be done about storage that refuses access.
  }
  listeners.forEach((set) => set.forEach((notify) => notify()))
}

function subscribe(key: string, notify: () => void) {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(notify)
  return () => {
    set.delete(notify)
    if (set.size === 0) {
      listeners.delete(key)
      loaders.delete(key)
    }
  }
}

export interface Remote<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Reads a key, fetching it on mount and whenever the app comes back into
 * view. A null key reads nothing, for screens still waiting on an id.
 */
export function useRemote<T>(key: string | null, load: () => Promise<T>): Remote<T> {
  // The loader closes over the caller's latest values without the key
  // changing, so it is registered by reference rather than by identity.
  const loadRef = useRef(load)
  loadRef.current = load

  const entry = useSyncExternalStore(
    useCallback((notify) => (key ? subscribe(key, notify) : () => undefined), [key]),
    () => (key ? entryFor<T>(key) : (EMPTY as Entry<T>)),
    () => EMPTY as Entry<T>
  )

  useEffect(() => {
    if (!key) return
    loaders.set(key, () => loadRef.current())
    if (Date.now() - entryFor(key).fetchedAt > FRESH_MS) void revalidate(key)
  }, [key])

  const refresh = useCallback(() => (key ? revalidate(key) : Promise.resolve()), [key])

  return { data: entry.data, error: entry.error, loading: entry.loading, refresh }
}

/*
  Coming back to the app, or back online, is when what is on screen is most
  likely to be out of date: a class may have started, or closed.
*/
if (typeof window !== 'undefined') {
  const refreshVisible = () => {
    if (document.visibilityState !== 'visible') return
    for (const key of loaders.keys()) void revalidate(key)
  }
  document.addEventListener('visibilitychange', refreshVisible)
  window.addEventListener('online', refreshVisible)
}
