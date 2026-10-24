/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { clearRemoteCache } from '../lib/remote'
import { SessionProvider } from '../lib/session'
import { calls, setFixtures } from './fakeSupabase'
import { course, teacherWorld } from './fixtures'

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
})

describe('teacher courses', () => {
  it('docks the teacher tabs and lists each course with its at-risk count', async () => {
    setFixtures(teacherWorld())
    mount('/')

    expect(await screen.findByText('Database Systems')).toBeTruthy()
    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Courses', 'Live', 'Settings'])
    expect(screen.getByText('At risk')).toBeTruthy()
  })

  it('creates a course and shows its join code to share', async () => {
    setFixtures(
      teacherWorld({
        onInsert: (_table, row) => course({ id: 'course-2', join_code: 'NEW234', ...row })
      })
    )
    const user = userEvent.setup()
    mount('/')

    await user.click(await screen.findByRole('button', { name: /create a course/i }))
    await user.type(await screen.findByLabelText(/course name/i), 'Operating Systems')
    await user.type(screen.getByLabelText(/^code$/i), 'cs305')
    await user.click(screen.getByRole('button', { name: /^create course$/i }))

    expect(await screen.findByText('NEW234', { selector: 'p' })).toBeTruthy()
    expect(calls).toContainEqual(
      expect.objectContaining({
        kind: 'insert',
        name: 'courses',
        args: expect.objectContaining({ name: 'Operating Systems', code: 'CS305' })
      })
    )
  })
})

describe('teacher course detail', () => {
  it('highlights students below target and sorts the lowest first on request', async () => {
    setFixtures(teacherWorld())
    const user = userEvent.setup()
    mount('/courses/course-1')

    expect(await screen.findByText(/roster · 3/i)).toBeTruthy()
    const names = () =>
      within(screen.getByRole('list'))
        .getAllByRole('listitem')
        .map((item) => within(item).getByText(/^[A-Z][a-z]+ [A-Z][a-z]+$/).textContent)

    // Roll numbers sort numerically: 21CS2, 21CS9, 21CS10.
    expect(names()).toEqual(['Asha Rao', 'Bilal Khan', 'Chen Li'])

    await user.click(screen.getByRole('radio', { name: '%' }))
    expect(names()).toEqual(['Bilal Khan', 'Asha Rao', 'Chen Li'])

    // 6 of 10 against 75% needs 6 more in a row; 7 of 10 needs 2.
    expect(screen.getByText(/attend next 6/)).toBeTruthy()
    expect(screen.getByText(/attend next 2/)).toBeTruthy()
  })
})

describe('teacher session detail', () => {
  it('marks an absent student present by hand, with a reason', async () => {
    setFixtures(teacherWorld())
    const user = userEvent.setup()
    mount('/sessions/live')

    await user.click(await screen.findByRole('button', { name: /bilal khan/i }))
    await user.click(await screen.findByRole('button', { name: /save mark/i }))
    expect(await screen.findByText(/give a reason/i)).toBeTruthy()

    await user.type(screen.getByLabelText(/reason/i), 'Phone battery dead')
    await user.click(screen.getByRole('button', { name: /save mark/i }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        kind: 'rpc',
        name: 'teacher_mark',
        args: { p_session: 'live', p_student: 's-b', p_status: 'present', p_reason: 'Phone battery dead' }
      })
    )
    // The sheet closes once the server has the mark.
    await waitFor(() => expect(screen.queryByRole('button', { name: /save mark/i })).toBeNull())
  })

  it('counts who is still unmarked while the session is open', async () => {
    setFixtures(teacherWorld())
    mount('/sessions/live')

    expect(await screen.findByText(/not marked yet · 2/i)).toBeTruthy()
    expect(screen.getByText(/present · 1/i)).toBeTruthy()
  })
})
