import { useCallback, useSyncExternalStore } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type TextSize = 'standard' | 'large' | 'largest'

export interface Appearance {
  theme: ThemeChoice
  text: TextSize
}

/*
  How the app looks is a choice about this device, not the account: the same
  teacher may want large text on the classroom laptop and not on their phone.
  So it lives in this browser's storage, and index.html applies it before the
  first paint so the page never flashes the wrong theme.
*/
const KEY = 'presently-campus:v1:appearance'

const DEFAULT: Appearance = { theme: 'system', text: 'standard' }

/** Page colours, for the browser chrome around the app. Match index.css. */
const CHROME = { light: '#f1f1ee', dark: '#0e0e10' } as const

function read(): Appearance {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return DEFAULT
    const parsed = JSON.parse(raw) as Partial<Appearance>
    return {
      theme: parsed.theme === 'light' || parsed.theme === 'dark' ? parsed.theme : 'system',
      text: parsed.text === 'large' || parsed.text === 'largest' ? parsed.text : 'standard'
    }
  } catch {
    return DEFAULT
  }
}

function systemDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolvedTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice === 'system') return systemDark() ? 'dark' : 'light'
  return choice
}

/** Puts a choice on the document. Mirrors the script in index.html. */
export function applyAppearance(appearance: Appearance) {
  const root = document.documentElement
  const theme = resolvedTheme(appearance.theme)
  root.dataset.theme = theme
  root.dataset.text = appearance.text
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme])
}

let current: Appearance | null = null
const listeners = new Set<() => void>()

function snapshot(): Appearance {
  if (!current) current = read()
  return current
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setAppearance(changes: Partial<Appearance>) {
  current = { ...snapshot(), ...changes }
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Without storage the choice still holds until the app is closed.
  }
  applyAppearance(current)
  for (const listener of listeners) listener()
}

/**
 * Applies the saved appearance and, while the theme follows the system, keeps
 * following it when the system switches (as many phones do at sunset).
 * Called once at launch.
 */
export function startAppearance() {
  applyAppearance(snapshot())
  if (typeof window.matchMedia !== 'function') return
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (snapshot().theme === 'system') {
      applyAppearance(snapshot())
      for (const listener of listeners) listener()
    }
  })
}

/** The current appearance and a setter. */
export function useAppearance(): [Appearance, (changes: Partial<Appearance>) => void] {
  const appearance = useSyncExternalStore(subscribe, snapshot, () => DEFAULT)
  const update = useCallback((changes: Partial<Appearance>) => setAppearance(changes), [])
  return [appearance, update]
}

/** The theme actually showing, for the toggle that switches it. */
export function useShownTheme(): 'light' | 'dark' {
  const [appearance] = useAppearance()
  return resolvedTheme(appearance.theme)
}
