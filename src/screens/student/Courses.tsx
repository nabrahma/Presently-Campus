import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ChevronRight, Layers, Loader2, Plus } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { Meter } from '../../components/Gauge'
import { LoadError } from '../../components/LoadError'
import { MarginNote, Percent } from '../../components/Margin'
import { DataRow } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { Sheet } from '../../components/Sheet'
import { courseLabel } from '../../lib/api'
import { figuresStats, safetyZone } from '../../lib/attendanceMath'
import { cn } from '../../lib/cn'
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
          <button
            type="button"
            onClick={() => setJoining(true)}
            aria-label="Join a course"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-bg active:opacity-80"
          >
            <Plus size={18} strokeWidth={2.4} />
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
        <div className="divide-y divide-line md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 xl:grid-cols-3">
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
    <Link to={`/courses/${course.id}`} className="block h-full">
      <DataRow
        bare
        className={cn(
          'py-4',
          'md:h-full md:rounded-panel md:border md:border-line md:px-4',
          'md:transition-colors md:hover:border-line-strong'
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9rem] text-ink">{course.name}</p>
          <p className="mt-1.5 truncate font-mono text-[0.6rem] tracking-[0.08em] text-ink-faint uppercase">
            {courseLabel(course)}
            {entry.teacherName ? ` · ${entry.teacherName}` : ''}
          </p>
          <div className="mt-2.5 max-w-[9rem]">
            <Meter percentage={stats.percentage} target={course.targetPercentage} zone={zone} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <Percent stats={stats} target={course.targetPercentage} className="text-[1.15rem]" />
          <p className="mt-1 font-mono text-[0.6rem] text-ink-faint tabular-nums">
            {stats.total === 0 ? '—' : `${stats.present}/${stats.total}`}
            <MarginNote stats={stats} />
          </p>
        </div>
        <ChevronRight size={15} className="shrink-0 text-ink-faint" />
      </DataRow>
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
        <label className="label mb-2.5 block" htmlFor="join-code">
          Join code
        </label>
        <input
          id="join-code"
          className="field text-center font-mono text-[1.4rem] tracking-[0.4em] uppercase"
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
        <p role="alert" className="rounded-2xl border border-danger/30 bg-danger-wash px-4 py-3 text-[0.78rem] text-danger">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
        {busy ? <Loader2 size={15} className="motion-safe:animate-spin" /> : 'Join'}
      </button>
    </form>
  )
}
