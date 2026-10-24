/**
 * @vitest-environment jsdom
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { clearRemoteCache } from '../lib/remote'
import { SessionProvider } from '../lib/session'
import { calls, setFixtures } from './fakeSupabase'
import { studentWorld } from './fixtures'

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

/* A camera that "sees" whatever a test shows it. */
const camera = vi.hoisted(() => ({
  show: null as null | ((text: string) => void),
  failWith: null as unknown
}))

vi.mock('qr-scanner', () => ({
  default: class {
    constructor(_video: unknown, onDecode: (result: { data: string }) => void) {
      camera.show = (text) => onDecode({ data: text })
    }
    start() {
      return camera.failWith ? Promise.reject(camera.failWith) : Promise.resolve()
    }
    pause() {
      return Promise.resolve(true)
    }
    stop() {}
    destroy() {}
  }
}))

const TOKEN = 'p1.0b6c2a52-3f9e-4c47-9a3a-5d2f3c1e7a10.179000000.AAAAAAAAAAAAAAAAAAAAAA'

function mount(route = '/scan') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>
  )
}

async function cameraReady() {
  await screen.findByText(/hold steady/i)
}

const show = (text: string) => act(() => camera.show!(text))

beforeEach(() => {
  camera.show = null
  camera.failWith = null
})

afterEach(() => {
  cleanup()
  clearRemoteCache()
})

describe('scanning', () => {
  it('marks the student present and names the class', async () => {
    setFixtures(
      studentWorld({
        functions: {
          'mark-attendance': () => ({
            data: {
              ok: true,
              reason: 'accepted',
              message: 'Marked present.',
              courseName: 'Database Systems',
              markedAt: '2026-10-24T10:02:00Z'
            }
          })
        }
      })
    )
    mount()
    await cameraReady()
    await show(TOKEN)

    expect(await screen.findByText('Marked present.')).toBeTruthy()
    expect(screen.getByText(/database systems ·/i)).toBeTruthy()
    expect(calls).toContainEqual({
      kind: 'function',
      name: 'mark-attendance',
      args: { token: TOKEN, device_id: null, signature: '' }
    })
  })

  it('shows the server’s reason when a scan is refused, and lets the student try again', async () => {
    setFixtures(
      studentWorld({
        functions: {
          'mark-attendance': () => ({
            data: { ok: false, reason: 'token_expired', message: 'Code expired. Scan the screen again.' }
          })
        }
      })
    )
    mount()
    await cameraReady()
    await show(TOKEN)

    expect(await screen.findByText('Code expired. Scan the screen again.')).toBeTruthy()
    act(() => screen.getByRole('button', { name: /scan again/i }).click())
    await cameraReady()
  })

  it('points to the phone’s settings when the phone was the problem', async () => {
    setFixtures(
      studentWorld({
        functions: {
          'mark-attendance': () => ({
            data: { ok: false, reason: 'device_not_registered', message: "This phone isn't registered to you." }
          })
        }
      })
    )
    mount()
    await cameraReady()
    await show(TOKEN)

    expect(await screen.findByText("This phone isn't registered to you.")).toBeTruthy()
    expect(screen.getByRole('link', { name: /check this phone/i })).toBeTruthy()
  })

  it('ignores other QR codes, saying so once', async () => {
    setFixtures(studentWorld())
    mount()
    await cameraReady()
    await show('https://example.com/menu')

    expect(await screen.findByText("That isn't a Presently code.")).toBeTruthy()
    expect(calls.filter((call) => call.kind === 'function')).toEqual([])
  })

  it('follows a course join code to the join link', async () => {
    const world = studentWorld()
    setFixtures({ ...world, rpc: { ...world.rpc, join_course: () => 'course-1' } })
    mount()
    await cameraReady()
    await show('https://presently-campus.vercel.app/join/ABC234')

    await waitFor(() => expect(calls).toContainEqual({ kind: 'rpc', name: 'join_course', args: { p_code: 'ABC234' } }))
  })

  it('explains how to turn the camera on when permission is refused', async () => {
    camera.failWith = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    setFixtures(studentWorld())
    mount()

    expect(await screen.findByText(/camera access is off/i)).toBeTruthy()
  })
})
