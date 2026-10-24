import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Booting } from './components/Booting'
import { Shell } from './components/Shell'
import { StudentHome } from './screens/student/Home'
import { ProfileMissing } from './screens/Onboarding'
import { useSession } from './lib/session'
import { useSessionUpdates } from './lib/student'
import type { Role } from './types'

/*
  A student's home is the reason the app gets opened, so it ships in the entry
  chunk and paints immediately. Everything else, the teacher's screens
  included, loads when first visited.
*/
const Auth = lazy(() => import('./screens/Auth').then((m) => ({ default: m.Auth })))
const Onboarding = lazy(() => import('./screens/Onboarding').then((m) => ({ default: m.Onboarding })))

// The tabs' loaders are named so they can be warmed ahead of the first tap.
const loadStudentCourses = () => import('./screens/student/Courses')
const loadStudentCourseDetail = () => import('./screens/student/CourseDetail')
const loadJoinLink = () => import('./screens/student/JoinLink')
const loadScan = () => import('./screens/student/Scan')
const loadSettings = () => import('./screens/Settings')
const loadTeacherCourses = () => import('./screens/teacher/Courses')
const loadTeacherCourseDetail = () => import('./screens/teacher/CourseDetail')
const loadTeacherSession = () => import('./screens/teacher/SessionDetail')
const loadTeacherLive = () => import('./screens/teacher/Live')

const StudentCourses = lazy(() => loadStudentCourses().then((m) => ({ default: m.StudentCourses })))
const StudentCourseDetail = lazy(() =>
  loadStudentCourseDetail().then((m) => ({ default: m.StudentCourseDetail }))
)
const JoinLink = lazy(() => loadJoinLink().then((m) => ({ default: m.JoinLink })))
const Scan = lazy(() => loadScan().then((m) => ({ default: m.Scan })))
const StudentSettings = lazy(() => loadSettings().then((m) => ({ default: m.StudentSettings })))
const Settings = lazy(() => loadSettings().then((m) => ({ default: m.Settings })))
const TeacherCourses = lazy(() => loadTeacherCourses().then((m) => ({ default: m.TeacherCourses })))
const TeacherCourseDetail = lazy(() =>
  loadTeacherCourseDetail().then((m) => ({ default: m.TeacherCourseDetail }))
)
const TeacherSessionDetail = lazy(() =>
  loadTeacherSession().then((m) => ({ default: m.TeacherSessionDetail }))
)
const TeacherLive = lazy(() => loadTeacherLive().then((m) => ({ default: m.TeacherLive })))

const WARM: Record<Role, Array<() => Promise<unknown>>> = {
  student: [loadScan, loadStudentCourses, loadStudentCourseDetail, loadSettings],
  teacher: [loadTeacherCourseDetail, loadTeacherSession, loadTeacherLive, loadSettings]
}

/**
 * Fetches every tab's code once the launch has painted, so the first visit to
 * a tab does not wait on the network after the indicator has already moved.
 */
function usePreloadedTabs(role: Role) {
  useEffect(() => {
    // Tests render every screen directly; there is nothing to warm there.
    if (import.meta.env.MODE === 'test') return

    const warm = () => {
      for (const load of WARM[role]) {
        void load().catch(() => undefined) // a failed prefetch just means a normal load later
      }
    }

    // Safari has no requestIdleCallback.
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(warm, { timeout: 3000 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(warm, 1200)
    return () => window.clearTimeout(timer)
  }, [role])
}

/*
  A join link opened while signed out has to survive the trip through sign-in,
  which for a magic link means a new tab. Only join links are remembered.
*/
const RETURN_KEY = 'presently-campus:v1:return-to'

function rememberReturn(path: string) {
  if (!path.startsWith('/join/')) return
  try {
    window.localStorage.setItem(RETURN_KEY, path)
  } catch {
    // Without storage the student lands on Home and joins by code instead.
  }
}

function takeReturn(): string | null {
  try {
    const path = window.localStorage.getItem(RETURN_KEY)
    window.localStorage.removeItem(RETURN_KEY)
    return path
  } catch {
    return null
  }
}

/**
 * Access control has four distinct answers, and collapsing any two of them is
 * what once sent returning users back through setup:
 *
 *   still loading     → wait, decide nothing
 *   no session        → sign in
 *   no profile        → explain, since the role is unknown
 *   setup unfinished  → onboarding
 */
function Protected({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { hydrated, userId, profile, profileError, signOut } = useSession()

  if (!hydrated) return <Booting />
  if (!userId) {
    rememberReturn(location.pathname)
    return <Navigate to="/auth" replace />
  }
  if (!profile) return <ProfileMissing message={profileError} onSignOut={() => void signOut()} />
  if (!profile.onboarded) {
    rememberReturn(location.pathname)
    return <Navigate to="/onboarding" replace />
  }

  return (
    <Signed role={profile.role} userId={userId}>
      {children}
    </Signed>
  )
}

/** Mounted only once someone is inside the app, so sign-in stays lean. */
function Signed({ role, userId, children }: { role: Role; userId: string; children: ReactNode }) {
  usePreloadedTabs(role)
  const navigate = useNavigate()

  // Read once, after mount: taking it during render would lose it to the
  // second render strict mode makes.
  useEffect(() => {
    const pending = takeReturn()
    if (pending && role === 'student' && pending !== window.location.pathname) navigate(pending, { replace: true })
  }, [navigate, role])

  return (
    <>
      {role === 'student' ? <StudentUpdates userId={userId} /> : null}
      {children}
    </>
  )
}

function StudentUpdates({ userId }: { userId: string }) {
  useSessionUpdates(userId)
  return null
}

const studentRoutes = (
  <>
    <Route path="/" element={<StudentHome />} />
    <Route path="/scan" element={<Scan />} />
    <Route path="/courses" element={<StudentCourses />} />
    <Route path="/courses/:id" element={<StudentCourseDetail />} />
    <Route path="/join/:code" element={<JoinLink />} />
    <Route path="/settings" element={<StudentSettings />} />
  </>
)

const teacherRoutes = (
  <>
    <Route path="/" element={<TeacherCourses />} />
    <Route path="/courses/:id" element={<TeacherCourseDetail />} />
    <Route path="/sessions/:id" element={<TeacherSessionDetail />} />
    <Route path="/live" element={<TeacherLive />} />
    <Route path="/settings" element={<Settings />} />
  </>
)

export default function App() {
  const { profile } = useSession()

  return (
    <Routes>
      {/* Screens outside the tabbed shell own their own full-height layout. */}
      <Route
        path="/auth"
        element={
          <Suspense fallback={<Booting />}>
            <Auth />
          </Suspense>
        }
      />
      <Route
        path="/onboarding"
        element={
          <Suspense fallback={<Booting />}>
            <Onboarding />
          </Suspense>
        }
      />

      {profile ? (
        <>
          {/* The shell mounts once and every tab renders into its outlet. */}
          <Route
            element={
              <Protected>
                <Shell />
              </Protected>
            }
          >
            {profile.role === 'teacher' ? teacherRoutes : studentRoutes}
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </>
      ) : (
        /*
          Which paths exist depends on the role, so nothing is matched until
          the profile is known. Otherwise a teacher reloading a session page
          would fall through to the catch-all and lose their place.
        */
        <Route
          path="*"
          element={
            <Protected>
              <Booting />
            </Protected>
          }
        />
      )}
    </Routes>
  )
}
