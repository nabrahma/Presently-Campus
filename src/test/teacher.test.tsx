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
import { calls, emitRealtime, setFixtures } from './fakeSupabase'
import { course, reportRow, STUDENT, teacherWorld } from './fixtures'
import { describeAgent } from '../screens/teacher/Approvals'

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
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Courses', 'Live', 'Approvals', 'Settings'])
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

describe('flag review', () => {
  it('explains a flag and removes the mark when the teacher calls it a proxy', async () => {
    const world = teacherWorld()
    setFixtures({
      ...world,
      rpc: {
        ...world.rpc,
        session_report: () => [
          reportRow('s-a', '21CS10', 'Chen Li', 'present', { flags: ['shared_connection', 'late'] }),
          reportRow('s-b', '21CS9', 'Bilal Khan', 'absent')
        ]
      }
    })
    const user = userEvent.setup()
    mount('/sessions/live')

    expect(await screen.findByText(/flagged · 1/i)).toBeTruthy()
    expect(screen.getByText(/several students scanned from one connection/i)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /proxy · mark absent/i }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        kind: 'rpc',
        name: 'teacher_mark',
        args: { p_session: 'live', p_student: 's-a', p_status: 'absent', p_reason: 'Reviewed flag: proxy' }
      })
    )
  })
})

describe('projector', () => {
  it('shows a rotating code and the count of students marked', async () => {
    const world = teacherWorld()
    setFixtures({
      ...world,
      rpc: {
        ...world.rpc,
        live_session_key: () => ({ secret: btoa(String.fromCharCode(...new Array(32).fill(7))), server_time: Date.now() })
      }
    })
    mount('/live/live')

    expect(await screen.findByRole('img', { name: /attendance code for database systems/i })).toBeTruthy()
    expect(screen.getByText(/of 3 marked/i)).toBeTruthy()
    expect(screen.getByRole('timer')).toBeTruthy()
    // Full screen: the dock is not there to distract a projected class.
    expect(screen.queryByRole('navigation')).toBeNull()
  })

  it('moves the count as marks arrive over Realtime', async () => {
    const world = teacherWorld()
    let present = ['s-a']
    setFixtures({
      ...world,
      rpc: {
        ...world.rpc,
        live_session_key: () => ({ secret: btoa(String.fromCharCode(...new Array(32).fill(7))), server_time: Date.now() }),
        session_report: () =>
          [
            ['s-a', '21CS10', 'Chen Li'],
            ['s-b', '21CS9', 'Bilal Khan'],
            ['s-c', '21CS2', 'Asha Rao']
          ].map(([id, roll, name]) => reportRow(id, roll, name, present.includes(id) ? 'present' : 'absent'))
      }
    })
    mount('/live/live')
    await screen.findByText(/of 3 marked/i)
    // The countdown beside it shows small numbers too, so look only at the count.
    const count = { selector: '[aria-live="polite"]' }
    expect(screen.getByText('1', count)).toBeTruthy()

    present = ['s-a', 's-b']
    emitRealtime('attendance')
    expect(await screen.findByText('2', count)).toBeTruthy()
  })

  it('says so when the session has already closed', async () => {
    const world = teacherWorld()
    setFixtures({
      ...world,
      tables: {
        ...world.tables,
        class_sessions: [{ ...(world.tables!.class_sessions[0] as object), status: 'closed', closed_at: new Date().toISOString() }]
      }
    })
    mount('/live/live')

    expect(await screen.findByText(/this session has closed/i)).toBeTruthy()
  })
})

describe('phone approvals', () => {
  const requests = () => {
    const world = teacherWorld()
    const soon = new Date(Date.now() + 6 * 3_600_000).toISOString()
    return {
      ...world,
      tables: {
        ...world.tables,
        devices: [
          {
            id: 'old-phone',
            student_id: STUDENT.id,
            status: 'active',
            active_from: '2026-08-01T09:00:00Z',
            created_at: '2026-08-01T09:00:00Z',
            user_agent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0',
            student: { full_name: 'Asha Rao', roll_number: '21CS001' }
          },
          {
            id: 'new-phone',
            student_id: STUDENT.id,
            status: 'pending',
            active_from: null,
            created_at: '2026-10-24T08:00:00Z',
            user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1',
            student: { full_name: 'Asha Rao', roll_number: '21CS001' }
          },
          {
            id: 'first-phone',
            student_id: 's-b',
            status: 'active',
            active_from: soon,
            created_at: new Date().toISOString(),
            user_agent: null,
            student: { full_name: 'Bilal Khan', roll_number: '21CS9' }
          }
        ]
      },
      rpc: { ...world.rpc, approve_device: () => ({}), reject_device: () => ({}) }
    }
  }

  it('lists device changes and cooling-off phones, and approves one', async () => {
    setFixtures(requests())
    const user = userEvent.setup()
    mount('/approvals')

    expect(await screen.findByText(/device changes · 1/i)).toBeTruthy()
    expect(screen.getByText(/new phones cooling off · 1/i)).toBeTruthy()
    expect(screen.getByText(/iPhone · Safari/)).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /approve asha rao's phone/i }))
    await waitFor(() => expect(calls).toContainEqual({ kind: 'rpc', name: 'approve_device', args: { p_device: 'new-phone' } }))
  })

  it('asks before rejecting', async () => {
    setFixtures(requests())
    const user = userEvent.setup()
    mount('/approvals')

    await user.click(await screen.findByRole('button', { name: /reject bilal khan's phone/i }))
    await user.click(await screen.findByRole('button', { name: /^reject$/i }))
    await waitFor(() => expect(calls).toContainEqual({ kind: 'rpc', name: 'reject_device', args: { p_device: 'first-phone' } }))
  })
})

describe('describeAgent', () => {
  it('names the platform and browser', () => {
    expect(describeAgent('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('Android · Chrome')
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Windows · Edge')
    expect(describeAgent(null)).toBe('Unknown device')
  })
})

describe('analysis', () => {
  it('lists who will not make the target by the cutoff, and charts each class', async () => {
    const world = teacherWorld()
    const weeksAgo = (weeks: number, hour: number) => {
      const date = new Date(Date.now() - weeks * 7 * 86_400_000)
      date.setHours(hour, 0, 0, 0)
      return date.toISOString()
    }
    setFixtures({
      ...world,
      rpc: {
        ...world.rpc,
        flag_outcomes: () => [{ flag: 'shared_connection', kept: 1, removed: 2, pending: 0 }],
        course_sessions_summary: () =>
          [1, 2, 3].map((weeks) => ({
            session_id: `w${weeks}`,
            started_at: weeksAgo(weeks, 10),
            closed_at: weeksAgo(weeks, 11),
            status: 'closed',
            note: null,
            expected: 3,
            present: 2,
            excused: 0,
            flagged: 0
          }))
      }
    })
    mount('/courses/course-1/analysis')

    // Bilal, 6 of 10, is below; Asha, 7 of 10, too; Chen, 9 of 10, is fine.
    expect(await screen.findByText(/needs attention by .* · 2/i)).toBeTruthy()
    expect(screen.getByText('Bilal Khan')).toBeTruthy()
    expect(screen.queryByText('Chen Li')).toBeNull()

    // The heatmap's one cell: Mondays or whichever weekday, at 10:00, a third absent.
    expect(screen.getByRole('button', { name: /10:00 · 3 classes · 33% absent \(3 of 9\)/ })).toBeTruthy()
    expect(screen.getByText('Proxies removed')).toBeTruthy()
  })
})
