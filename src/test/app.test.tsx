/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { clearRemoteCache } from '../lib/remote'
import { SessionProvider } from '../lib/session'
import { calls, setFixtures } from './fakeSupabase'
import { STUDENT, studentProfile, studentWorld, TEACHER, teacherProfile } from './fixtures'

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

describe('signing in', () => {
  it('sends a signed-out visitor to sign in with their college email', async () => {
    setFixtures({ user: null })
    mount('/')
    expect(await screen.findByLabelText(/college email/i)).toBeTruthy()
  })

  it('asks a new student for their name and roll number, then lets them in', async () => {
    setFixtures(studentWorld({ tables: { ...studentWorld().tables, profiles: [studentProfile({ full_name: '', roll_number: null })] } }))
    const user = userEvent.setup()
    mount('/')

    await user.type(await screen.findByLabelText(/full name/i), 'Asha Rao')
    await user.type(screen.getByLabelText(/roll number/i), '21cs001')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByText('Least spare')).toBeTruthy()
    expect(calls).toContainEqual({
      kind: 'update',
      name: 'profiles',
      args: { full_name: 'Asha Rao', roll_number: '21CS001' }
    })
  })

  it('does not ask a teacher for a roll number', async () => {
    setFixtures({ user: TEACHER, tables: { profiles: [teacherProfile({ full_name: '' })] } })
    mount('/')

    expect(await screen.findByLabelText(/full name/i)).toBeTruthy()
    expect(screen.queryByLabelText(/roll number/i)).toBeNull()
  })
})

describe('student home', () => {
  it('shows the class taking attendance now and each course with its margin', async () => {
    setFixtures(studentWorld())
    mount('/')

    // One of two classes attended is 50%, against a 75% target.
    expect(await screen.findByText(/live · started/i)).toBeTruthy()
    expect(screen.getByText('Not marked yet')).toBeTruthy()
    expect(screen.getAllByText(/attend next 2/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/courses · 1/i)).toBeTruthy()
  })

  it('docks Home, Courses and Settings for a student', async () => {
    setFixtures(studentWorld())
    mount('/')
    await screen.findByText('Least spare')

    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Courses', 'Settings'])
  })
})

describe('student course detail', () => {
  it('lists each class since joining with its outcome', async () => {
    setFixtures(studentWorld())
    mount('/courses/course-1')

    expect(await screen.findByRole('heading', { name: 'Database Systems' })).toBeTruthy()
    expect(screen.getByText(/classes · 3/i)).toBeTruthy()
    // Once in the margin panel's counts, once in the history.
    expect(screen.getAllByText('Present')).toHaveLength(2)
    expect(screen.getAllByText('Absent')).toHaveLength(2)
    expect(screen.getByText('In progress')).toBeTruthy()
    expect(screen.getByText(/attend the next 2 classes/i)).toBeTruthy()
  })

  it('sends a course the student is not in back to the list', async () => {
    setFixtures(studentWorld())
    mount('/courses/not-mine')
    expect(await screen.findByRole('heading', { name: /^courses$/i })).toBeTruthy()
  })
})

describe('joining a course', () => {
  it('joins with a code typed loosely and opens the course', async () => {
    const world = studentWorld()
    setFixtures({ ...world, rpc: { ...world.rpc, join_course: () => 'course-1' } })
    const user = userEvent.setup()
    mount('/courses')

    await user.click(await screen.findByRole('button', { name: /join a course/i }))
    await user.type(await screen.findByLabelText(/join code/i), 'abc-234')
    await user.click(screen.getByRole('button', { name: /^join$/i }))

    expect(await screen.findByRole('heading', { name: 'Database Systems' })).toBeTruthy()
    expect(calls).toContainEqual({ kind: 'rpc', name: 'join_course', args: { p_code: 'ABC234' } })
  })

  it('shows the server’s reason when a join is refused', async () => {
    const world = studentWorld()
    setFixtures({
      ...world,
      rpc: {
        ...world.rpc,
        join_course: () => {
          throw new Error('No course has that code. Check it with your teacher.')
        }
      }
    })
    mount('/join/ZZZ999')

    expect(await screen.findByText(/no course has that code/i)).toBeTruthy()
  })
})

describe('signing out', () => {
  it('forgets the account on this device', async () => {
    setFixtures(studentWorld())
    const user = userEvent.setup()
    mount('/settings')

    await user.click(await screen.findByRole('button', { name: /sign out/i }))
    await user.click(await screen.findByRole('button', { name: /^sign out$/i }))

    expect(await screen.findByLabelText(/college email/i)).toBeTruthy()
    expect(Object.keys(window.localStorage).filter((key) => key.includes(STUDENT.id))).toEqual([])
  })
})
