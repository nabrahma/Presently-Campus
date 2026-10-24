import {
  generateDeviceKey,
  scanMessage,
  signScan,
  type PublicJwk
} from '../../supabase/functions/_shared/deviceSignature.ts'

/**
 * This phone's key, kept in IndexedDB.
 *
 * There is one key per browser, not one per account: it is what makes a phone
 * belong to one student. If a second student signs in here, they find the
 * first student's key, and the server refuses both registering it and
 * scanning with it.
 *
 * The private key is a non-extractable CryptoKey. IndexedDB can store it, the
 * browser can sign with it, and nothing can read it out.
 */

export interface StoredKey {
  privateKey: CryptoKey
  publicJwk: PublicJwk
  /** Set once the server has accepted the key. */
  deviceId: string | null
  /** The account the server registered it to. */
  userId: string | null
  createdAt: string
}

const DB_NAME = 'presently-campus'
const STORE = 'device'
const RECORD = 'this-phone'
const CHANGED = 'presently-campus:device-key'

/** True when this browser can hold a device key at all. */
export function deviceKeysSupported(): boolean {
  return typeof indexedDB !== 'undefined' && typeof crypto !== 'undefined' && Boolean(crypto.subtle)
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open device storage.'))
  })
}

async function transact<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result as T)
      request.onerror = () => reject(request.error ?? new Error('Device storage failed.'))
    })
  } finally {
    db.close()
  }
}

function announce() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED))
}

/** Calls back whenever this phone's key is created, registered or removed. */
export function onDeviceKeyChange(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener)
  return () => window.removeEventListener(CHANGED, listener)
}

export async function loadDeviceKey(): Promise<StoredKey | null> {
  if (!deviceKeysSupported()) return null
  try {
    return (await transact<StoredKey | undefined>('readonly', (store) => store.get(RECORD))) ?? null
  } catch {
    return null
  }
}

/** This phone's key, made now if it has none. */
export async function ensureDeviceKey(): Promise<StoredKey> {
  if (!deviceKeysSupported()) {
    throw new Error('This browser cannot keep a device key. Turn off private browsing, or use another browser.')
  }

  const existing = await loadDeviceKey()
  if (existing) return existing

  const { privateKey, publicJwk } = await generateDeviceKey()
  const record: StoredKey = { privateKey, publicJwk, deviceId: null, userId: null, createdAt: new Date().toISOString() }
  await transact('readwrite', (store) => store.put(record, RECORD))

  // Without this, Safari may clear the site's storage, and the key with it,
  // after a week without a visit. Installing the app is the stronger guard.
  void navigator.storage?.persist?.().catch(() => false)

  announce()
  return record
}

export async function rememberRegistration(deviceId: string, userId: string): Promise<void> {
  const existing = await loadDeviceKey()
  if (!existing) return
  await transact('readwrite', (store) => store.put({ ...existing, deviceId, userId }, RECORD))
  announce()
}

/** Removes the key, for when the server has retired it. */
export async function forgetDeviceKey(): Promise<void> {
  if (!deviceKeysSupported()) return
  await transact('readwrite', (store) => store.delete(RECORD))
  announce()
}

/**
 * Signs a scan with this phone's key. With no key, or one never registered,
 * the request still goes to the server, which refuses it and logs the
 * attempt for the teacher.
 */
export async function signForScan(token: string, userId: string): Promise<{ deviceId: string | null; signature: string }> {
  const key = await loadDeviceKey()
  if (!key) return { deviceId: null, signature: '' }
  return { deviceId: key.deviceId, signature: await signScan(key.privateKey, scanMessage(token, userId)) }
}
