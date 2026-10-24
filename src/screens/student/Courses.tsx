import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, Layers, Loader2, Plus } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { Meter } from '../../components/Gauge'
import { LoadError } from '../../components/LoadError'
import { MarginNote, Percent } from '../../components/Margin'
import { ScreenHead } from '../../components/Shell'
import { Sheet } from '../../components/Sheet'
import { courseLabel } from '../../lib/api'
import { figuresStats, safetyZone } from '../../lib/attendanceMath'
import { useUserId } from '../../lib/session'
import { joinCourse, useStudentData, type StudentCourse } from '../../lib/student'

export function StudentCourses() {
  const { data, error, refresh } = useStudentData()
  const [joining, setJoining] = useState(false)

  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  return (
    <>
      <ScreenHead
        label={`${data.courses.length} enrolled`}
        title="Courses"
        action={
          <button type="button" onClick={() => setJoining(true)} aria-label="Join a course" className="btn-primary">
            <Plus size={20} strokeWidth={2.4} />
            <span>Join</span>
          </button>
        }
      />

      {data.courses.length === 0 ? (
        <Empty
          icon={<Layers size={18} strokeWidth={1.8} />}
          title="No courses yet"
          text="Your teacher shares a six-character code for each course. Join with it once and every class you attend shows up here."
          action={
            <button type="button" className="btn-primary" onClick={() => setJoining(true)}>
              Join a course
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
          {data.courses.map((entry) => (
            <CourseCard key={entry.course.id} entry={entry} />
          ))}
        </div>
      )}

      <Sheet
        open={joining}
        onClose={() => setJoining(false)}
        title="Join a course"
        description="Type the code your teacher shared, or scan its QR code with your camera."
      >
        <JoinForm onJoined={() => setJoining(false)} />
      </Sheet>
    </>
  )
}

function CourseCard({ entry }: { entry: StudentCourse }) {
  const { course } = entry
  const stats = figuresStats(entry.figures, course.targetPercentage)
  const zone = safetyZone(stats.percentage, course.targetPercentage)

  return (
    <Link
      to={`/courses/${course.id}`}
      className="panel flex h-full flex-col p-5 transition-shadow hover:shadow-(--shadow-lift)"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="title truncate text-[1.25rem]">{course.name}</p>
          <p className="mt-1 truncate text-[0.95rem] text-ink-muted">
            {courseLabel(course)}
            {entry.teacherName ? ` · ${entry.teacherName}` : ''}
          </p>
        </div>
        <ChevronRight size={20} className="mt-1 shrink-0 text-ink-faint" />
      </div>

      <div className="mt-5 flex items-end justify-between gap-3">
        <Percent stats={stats} target={course.targetPercentage} className="text-[2.25rem]" />
        <p className="pb-1 text-right text-[0.95rem] text-ink-muted tabular-nums">
          {stats.total === 0 ? 'No classes yet' : `${stats.present} of ${stats.total}`}
          <MarginNote stats={stats} />
        </p>
      </div>
      <div className="mt-3">
        <Meter percentage={stats.percentage} target={course.targetPercentage} zone={zone} />
      </div>
    </Link>
  )
}

/** Join codes are six characters with no look-alikes; anything else is stripped. */
export const cleanJoinCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)

export function JoinForm({ onJoined }: { onJoined?: () => void }) {
  const navigate = useNavigate()
  const userId = useUserId()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (code.length !== 6) {
      setError('Join codes are six characters.')
      return
    }

    setBusy(true)
    setError('')
    try {
      const courseId = await joinCourse(userId, code)
      toast.success('Joined')
      onJoined?.()
      navigate(`/courses/${courseId}`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not join.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div>
        <label className="mb-2 block text-[1rem] font-medium" htmlFor="join-code">
          Join code
        </label>
        <input
          id="join-code"
          className="field min-h-16 text-center font-mono text-[1.75rem] tracking-[0.35em] uppercase"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABC234"
          value={code}
          onChange={(event) => {
            setCode(cleanJoinCode(event.target.value))
            if (error) setError('')
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-2xl border border-danger/30 bg-danger-wash px-4 py-3 text-[1rem] text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
        {busy ? <Loader2 size={20} className="motion-safe:animate-spin" /> : 'Join'}
      </button>
    </form>
  )
}
