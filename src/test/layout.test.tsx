/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { clearRemoteCache } from '../lib/remote'
import { SessionProvider } from '../lib/session'
import { setFixtures } from './fakeSupabase'
import { studentWorld } from './fixtures'

/*
  jsdom has no layout engine, so these assert the structural rules the layout
  depends on rather than measuring pixels.

  The rule below is not a style preference. The shell pins itself to the
  viewport and delegates all scrolling to one region; if any flex ancestor of
  that region can refuse to shrink, the region never scrolls and the dock is
  pushed off-screen. That shipped once.
*/

vi.mock('../lib/supabaseClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/supabaseClient')>()
  const { fakeSupabase } = await import('./fakeSupabase')
  return { ...actual, supabase: fakeSupabase, isCloudEnabled: true }
})

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => undefined],
    offlineReady: [false, () => undefined],
    updateServiceWorker: async () => undefined
  })
}))

function mount(route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>
  )
}

const classesOf = (element: Element) => element.className.split(/\s+/).filter(Boolean)

/** Strips a responsive prefix so `md:flex-1` counts as `flex-1`. */
const bare = (token: string) => token.replace(/^[a-z]+:/, '')

beforeEach(() => {
  setFixtures(studentWorld())
})

afterEach(() => {
  cleanup()
  clearRemoteCache()
})

describe('the scroll chain', () => {
  it('lets every flexible ancestor of the scroll region shrink', async () => {
    mount('/')
    await screen.findByText('Least spare')

    const region = document.querySelector('main.scroll-region')
    expect(region).not.toBeNull()

    const offenders: string[] = []
    let node = region!.parentElement

    while (node && node.id !== 'root' && node !== document.body) {
      const tokens = classesOf(node).map(bare)
      const grows = tokens.includes('flex-1') || tokens.some((token) => token.startsWith('basis-'))
      const canShrink = tokens.includes('min-h-0') || tokens.includes('h-full')

      if (grows && !canShrink) offenders.push(node.className)
      node = node.parentElement
    }

    expect(offenders).toEqual([])
  })

  it('keeps the scroll region itself able to shrink', async () => {
    mount('/')
    await screen.findByText('Least spare')

    const tokens = classesOf(document.querySelector('main.scroll-region')!)
    expect(tokens).toContain('min-h-0')
    expect(tokens).toContain('flex-1')
  })

  it('pins the shell to the viewport so the page never scrolls', async () => {
    mount('/')
    await screen.findByText('Least spare')

    const shell = document.querySelector('main.scroll-region')!.closest('.h-full')
    expect(shell).not.toBeNull()
    expect(classesOf(shell!)).toContain('flex')
  })

  it('keeps the navigation out of the scrolling region', async () => {
    mount('/')
    await screen.findByText('Least spare')

    const nav = screen.getByRole('navigation')
    // Inside the scroll region the dock would scroll away with the content.
    expect(document.querySelector('main.scroll-region')!.contains(nav)).toBe(false)
    // The bar (or sidebar) holding the links is what must not shrink.
    expect(classesOf(nav.closest('aside')!).map(bare)).toContain('shrink-0')
  })
})

describe('screen structure', () => {
  it('renders one scroll region, not one per screen', async () => {
    mount('/')
    await screen.findByText('Least spare')

    expect(document.querySelectorAll('main.scroll-region')).toHaveLength(1)
  })

  it('survives navigating between screens', async () => {
    mount('/settings')
    await screen.findByRole('heading', { name: /^settings$/i })

    expect(document.querySelectorAll('main.scroll-region')).toHaveLength(1)
    expect(screen.getByRole('navigation')).toBeTruthy()
  })
})
