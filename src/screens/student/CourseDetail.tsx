import { useMemo } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronLeft, History } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { MarginPanel } from '../../components/Margin'
import { SectionHead } from '../../components/Panel'
import { courseLabel } from '../../lib/api'
import { figuresStats } from '../../lib/attendanceMath'
import { cn } from '../../lib/cn'
import { formatSessionTime, formatTime } from '../../lib/date'
import { courseHistory, useStudentData, type HistoryEntry } from '../../lib/student'
import { OUTCOME_LABELS, type SessionOutcome } from '../../types'

const DOT: Record<SessionOutcome, string> = {
  present: 'bg-accent',
  absent: 'bg-danger',
  excused: 'bg-ink-faint',
  cancelled: 'bg-ink-faint',
  open: 'bg-warn'
}

export function StudentCourseDetail() {
  const { id } = useParams()
  const { data, error, refresh } = useStudentData()

  const entry = data?.courses.find((item) => item.course.id === id)
  const history = useMemo(
    () => (data && entry ? courseHistory(entry.course.id, entry.joinedAt, data.sessions, data.marks) : []),
    [data, entry]
  )

  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />
  if (!entry) return <Navigate to="/courses" replace />

  const { course } = entry
  const stats = figuresStats(entry.figures, course.targetPercentage)

  return (
    <>
      <Link
        to="/courses"
        className="mb-5 inline-flex items-center gap-1.5 font-mono text-[0.65rem] tracking-[0.1em] text-ink-muted uppercase active:opacity-60"
      >
        <ChevronLeft size={14} strokeWidth={2.2} />
        Courses
      </Link>

      <header className="mb-6">
        <p className="label truncate">
          {courseLabel(course)}
          {course.term ? ` · ${course.term}` : ''}
        </p>
        <h1 className="mt-2.5 text-[1.4rem] leading-tight tracking-[-0.01em]">{course.name}</h1>
        <p className="mt-2 font-mono text-[0.6rem] tracking-[0.08em] text-ink-faint uppercase">
          {entry.teacherName || 'Teacher'} · target {course.targetPercentage}%
        </p>
      </header>

      <div className="lg:flex lg:items-start lg:gap-8">
        <MarginPanel
          stats={stats}
          target={course.targetPercentage}
          className="lg:sticky lg:top-0 lg:w-[22rem] lg:shrink-0"
        />

        <div className="mt-7 min-w-0 lg:mt-0 lg:flex-1">
          <SectionHead label={`Classes · ${history.length}`} />

          {history.length === 0 ? (
            <div className="mt-4">
              <Empty
                icon={<History size={18} strokeWidth={1.8} />}
                title="No classes yet"
                text="Each class held since you joined appears here, with whether you were marked present."
              />
            </div>
          ) : (
            <div>
              {history.map((item) => (
                <HistoryRow key={item.session.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function HistoryRow({ item }: { item: HistoryEntry }) {
  const { session, outcome, mark } = item

  const detail =
    outcome === 'cancelled'
      ? 'Does not count'
      : mark?.method === 'qr'
        ? `Scanned ${formatTime(mark.markedAt)}`
        : mark
          ? `By your teacher${mark.reason ? ` · ${mark.reason}` : ''}`
          : outcome === 'open'
            ? 'Taking attendance now'
            : null

  return (
    <div className="flex items-center gap-3 border-b border-line py-3.5 last:border-b-0">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[outcome])} />
      <div className="min-w-0 flex-1">
        <p className="font-mono text-[0.78rem] text-ink tabular-nums">{formatSessionTime(session.startedAt)}</p>
        {detail ? (
          <p className="mt-1 truncate font-mono text-[0.6rem] tracking-[0.06em] text-ink-faint">{detail}</p>
        ) : null}
      </div>
      <span className={cn('label', outcome === 'absent' && 'text-danger', outcome === 'present' && 'text-accent')}>
        {OUTCOME_LABELS[outcome]}
      </span>
    </div>
  )
}
