import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, Play, QrCode, Radio, Users } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { Panel, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { courseLabel } from '../../lib/api'
import { useUserId } from '../../lib/session'
import { startSession, useTeacherCourses } from '../../lib/teacher'
import { projectorPath, sessionPath } from './CourseDetail'

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
      navigate(projectorPath(started.session.id))
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not start the session.')
    } finally {
      setStarting(null)
    }
  }

  return (
    <>
      <ScreenHead
        label={live.length > 0 ? `${live.length} running` : 'Nothing running'}
        title="Live"
        icon={<Radio size={26} strokeWidth={2} />}
      />

      {active.length === 0 ? (
        <Empty
          icon={<Radio size={26} strokeWidth={1.8} />}
          title="No courses yet"
          text="Create a course first. Its sessions start from here."
          action={
            <Link to="/" className="btn-primary">
              Your courses
            </Link>
          }
        />
      ) : (
        <div className="space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5 lg:space-y-0">
          <section>
            <SectionHead label={`Running · ${live.length}`} />
            {live.length === 0 ? (
              <p className="dot-grid rounded-panel border border-dashed border-line-strong px-5 py-8 text-center text-[1.0625rem] text-ink-muted">
                No session is open. Start one when class begins.
              </p>
            ) : (
              <div className="space-y-3">
                {live.map(({ course, overview }) => (
                  <section key={course.id} className="rounded-panel border-2 border-accent-bright/50 bg-accent-wash p-5">
                    <p className="chip bg-surface text-accent">
                      <Radio size={16} strokeWidth={2.2} className="motion-safe:animate-pulse" /> Live
                    </p>
                    <Link to={sessionPath(overview.openSessionId!)} className="mt-3 flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="title block truncate text-[1.375rem]">{course.name}</span>
                        <span className="mt-0.5 block text-[1rem] text-ink-muted">{courseLabel(course)}</span>
                      </span>
                      <ChevronRight size={20} className="shrink-0 text-ink-muted" />
                    </Link>
                    <Link to={projectorPath(overview.openSessionId!)} className="btn-accent mt-4 w-full">
                      <QrCode size={20} strokeWidth={2.2} /> Show code
                    </Link>
                  </section>
                ))}
              </div>
            )}
          </section>

          <Panel className="px-4 pt-4 pb-2 md:px-6">
            <SectionHead label="Start a session" />
            {idle.length === 0 ? (
              <p className="pb-4 text-[1rem] text-ink-muted">Every course has a session running.</p>
            ) : (
              idle.map(({ course, overview }) => (
                <div key={course.id} className="flex min-h-18 items-center gap-3 border-b border-line py-3.5 last:border-b-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[1.0625rem] font-semibold">{course.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-[0.95rem] text-ink-muted">
                      {courseLabel(course)} · <Users size={15} className="shrink-0" /> {overview.students}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Start a session of ${course.name}`}
                    disabled={starting !== null}
                    onClick={() => void start(course.id)}
                    className="btn-primary min-h-12 shrink-0 px-5"
                  >
                    <Play size={17} strokeWidth={2.6} />
                    {starting === course.id ? 'Starting…' : 'Start'}
                  </button>
                </div>
              ))
            )}
          </Panel>
        </div>
      )}
    </>
  )
}
