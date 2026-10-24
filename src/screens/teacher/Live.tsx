import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, Play, Radio } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { DataRow, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { courseLabel } from '../../lib/api'
import { useUserId } from '../../lib/session'
import { startSession, useTeacherCourses } from '../../lib/teacher'
import { liveSessionPath } from './CourseDetail'

/**
 * The classroom tab: whatever is running now, and one tap to start the next.
 */
export function TeacherLive() {
  const userId = useUserId()
  const navigate = useNavigate()
  const { data, error, refresh } = useTeacherCourses()
  const [starting, setStarting] = useState<string | null>(null)

  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  const active = data.filter((entry) => !entry.course.archived)
  const live = active.filter((entry) => entry.overview.openSessionId)
  const idle = active.filter((entry) => !entry.overview.openSessionId)

  const start = async (courseId: string) => {
    if (starting) return
    setStarting(courseId)
    try {
      const started = await startSession(userId, courseId)
      navigate(liveSessionPath(started.session.id))
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not start the session.')
    } finally {
      setStarting(null)
    }
  }

  return (
    <>
      <ScreenHead label={live.length > 0 ? `${live.length} running` : 'Nothing running'} title="Live" />

      {active.length === 0 ? (
        <Empty
          icon={<Radio size={18} strokeWidth={1.8} />}
          title="No courses yet"
          text="Create a course first. Its sessions start from here."
          action={
            <Link to="/" className="btn-primary">
              Your courses
            </Link>
          }
        />
      ) : (
        <div className="space-y-7 lg:grid lg:grid-cols-2 lg:gap-8 lg:space-y-0">
          <div>
            <SectionHead label={`Running · ${live.length}`} />
            {live.length === 0 ? (
              <p className="py-4 text-[0.8rem] text-ink-muted">No session is open. Start one when class begins.</p>
            ) : (
              live.map(({ course, overview }) => (
                <Link key={course.id} to={liveSessionPath(overview.openSessionId!)} className="block">
                  <DataRow className="hover-row md:px-2">
                    <Radio size={15} strokeWidth={2.2} className="shrink-0 text-accent" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[0.82rem] text-ink uppercase">{courseLabel(course)}</p>
                      <p className="mt-1 truncate text-[0.75rem] text-ink-muted">{course.name}</p>
                    </div>
                    <ChevronRight size={15} className="shrink-0 text-ink-faint" />
                  </DataRow>
                </Link>
              ))
            )}
          </div>

          <div>
            <SectionHead label="Start a session" />
            {idle.length === 0 ? (
              <p className="py-4 text-[0.8rem] text-ink-muted">Every course has a session running.</p>
            ) : (
              idle.map(({ course, overview }) => (
                <DataRow key={course.id}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[0.82rem] text-ink uppercase">{courseLabel(course)}</p>
                    <p className="mt-1 truncate text-[0.75rem] text-ink-muted">
                      {course.name} · {overview.students} {overview.students === 1 ? 'student' : 'students'}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Start a session of ${course.name}`}
                    disabled={starting !== null}
                    onClick={() => void start(course.id)}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 font-mono text-[0.65rem] tracking-[0.1em] text-bg uppercase active:opacity-80 disabled:opacity-40"
                  >
                    <Play size={12} strokeWidth={2.6} />
                    {starting === course.id ? 'Starting' : 'Start'}
                  </button>
                </DataRow>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
