/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { clearRemoteCache } from '../lib/remote'
import { SessionProvider } from '../lib/session'
import { calls, setFixtures, type Row } from './fakeSupabase'
import { teacherProfile, teacherWorld } from './fixtures'

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

afterEach(() => {
  cleanup()
  clearRemoteCache()
  window.localStorage.clear()
})

describe('developer view', () => {
  it('lets a developer switch to the student app', async () => {
    const world = teacherWorld()
    // A dev viewing as a teacher, with the roll number kept for the student view.
    const profile: Row = teacherProfile({ is_dev: true, roll_number: 'DEV01' })
    setFixtures({
      ...world,
      tables: { ...world.tables, profiles: [profile] },
      rpc: {
        ...world.rpc,
        // The server changes the role; the app then reloads the profile.
        set_dev_view: ({ p_role }) => {
          profile.role = p_role
          return p_role
        },
        my_figures: () => []
      }
    })

    mount('/')
    const student = await screen.findByRole('radio', { name: /view as student/i })
    expect(screen.getByRole('radio', { name: /view as teacher/i }).getAttribute('aria-checked')).toBe('true')

    await userEvent.click(student)

    await waitFor(() => expect(calls.some((call) => call.name === 'set_dev_view')).toBe(true))
    expect(calls.find((call) => call.name === 'set_dev_view')?.args).toEqual({ p_role: 'student' })
    // The student's home, with the student's tabs.
    expect(await screen.findByText('Least spare')).toBeTruthy()
    expect(screen.getByRole('link', { name: /scan/i })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /view as student/i }).getAttribute('aria-checked')).toBe('true')
  })

  it('shows nobody else the switch', async () => {
    setFixtures(teacherWorld())
    mount('/')
    await screen.findByRole('heading', { name: /^courses$/i })
    expect(screen.queryByRole('radiogroup', { name: /developer view/i })).toBeNull()
  })
})
