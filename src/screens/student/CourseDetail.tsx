import { useMemo } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { BookOpen, History } from 'lucide-react'
import { BackLink } from '../../components/BackLink'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { MarginPanel } from '../../components/Margin'
import { Panel, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { courseLabel } from '../../lib/api'
import { figuresStats } from '../../lib/attendanceMath'
import { cn } from '../../lib/cn'
import { formatSessionTime, formatTime } from '../../lib/date'
import { courseHistory, useStudentData, type HistoryEntry } from '../../lib/student'
import { OUTCOME_LABELS, type SessionOutcome } from '../../types'

const BADGE: Record<SessionOutcome, string> = {
  present: 'bg-good-wash text-good',
  absent: 'bg-danger-wash text-danger',
  excused: 'bg-elevated text-ink-muted',
  cancelled: 'bg-elevated text-ink-muted',
  open: 'bg-warn-wash text-warn'
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
      <BackLink to="/courses" label="Courses" />

      <ScreenHead
        icon={<BookOpen size={26} strokeWidth={2} />}
        title={course.name}
        label={`${courseLabel(course)}${course.term ? ` · ${course.term}` : ''} · ${entry.teacherName || 'Teacher'} · target ${course.targetPercentage}%`}
      />

      <div className="lg:flex lg:items-start lg:gap-5">
        <MarginPanel
          stats={stats}
          target={course.targetPercentage}
          className="lg:sticky lg:top-0 lg:w-[26rem] lg:shrink-0"
        />

        <Panel className="mt-5 min-w-0 px-5 pt-4 pb-2 md:px-6 lg:mt-0 lg:flex-1">
          <SectionHead label={`Classes · ${history.length}`} />

          {history.length === 0 ? (
            <div className="pb-3">
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
        </Panel>
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
    <div className="flex min-h-16 items-center gap-3 border-b border-line py-3.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[1.0625rem] font-medium tabular-nums">{formatSessionTime(session.startedAt)}</p>
        {detail ? <p className="mt-0.5 truncate text-[0.95rem] text-ink-muted">{detail}</p> : null}
      </div>
      <span className={cn('chip shrink-0', BADGE[outcome])}>{OUTCOME_LABELS[outcome]}</span>
    </div>
  )
}
