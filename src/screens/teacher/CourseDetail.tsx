import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, BookOpen, CalendarCheck, ChevronRight, Download, FileSpreadsheet, Gauge, LineChart, Pencil, Play, QrCode as QrIcon, Radio, Rows3, TriangleAlert, Users } from 'lucide-react'
import { BackLink } from '../../components/BackLink'
import { Booting } from '../../components/Booting'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CourseForm } from '../../components/CourseForm'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { MarginNote, MarginPanel, Percent } from '../../components/Margin'
import { ActionRow, Panel, SectionHead } from '../../components/Panel'
import { QrCode } from '../../components/QrCode'
import { Sheet } from '../../components/Sheet'
import { ScreenHead } from '../../components/Shell'
import { StatCard } from '../../components/StatCard'
import { courseLabel } from '../../lib/api'
import { exportFilename, loadCourseExport, marksCsv, registerCsv } from '../../lib/courseExport'
import { downloadCsv } from '../../lib/csv'
import { todayKey } from '../../lib/date'
import { cn } from '../../lib/cn'
import { formatSessionTime, formatShortDay } from '../../lib/date'
import { atRisk, scoreRoster, sortRoster, type RosterSort, type ScoredStudent } from '../../lib/roster'
import { useUserId } from '../../lib/session'
import {
  setEnrolment,
  startSession,
  updateCourse,
  useCourseDetail,
  type SessionSummary
} from '../../lib/teacher'
import type { Course } from '../../types'

export const sessionPath = (sessionId: string) => `/sessions/${sessionId}`
/** The full-screen QR code for a running session. */
export const projectorPath = (sessionId: string) => `/live/${sessionId}`

export function TeacherCourseDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const userId = useUserId()
  const [search, setSearch] = useSearchParams()
  const { data, error, refresh } = useCourseDetail(id)

  const [sort, setSort] = useState<RosterSort>('roll')
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<ScoredStudent | null>(null)
  const [starting, setStarting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const sharing = search.get('share') === '1'

  const target = data?.course.targetPercentage ?? 75
  const scored = useMemo(() => scoreRoster(data?.roster ?? [], target), [data, target])
  const active = useMemo(
    () => sortRoster(scored.filter((student) => student.row.enrolmentStatus === 'active'), sort),
    [scored, sort]
  )
  const removed = scored.filter((student) => student.row.enrolmentStatus === 'removed')

  if (data === null) return <Navigate to="/" replace />
  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  const { course, sessions } = data
  const open = sessions.find((session) => session.status === 'open')
  const held = sessions.filter((session) => session.status === 'closed').length
  const counted = active.filter((student) => student.stats.percentage !== null)
  const average =
    counted.length === 0
      ? null
      : Math.round(counted.reduce((sum, student) => sum + (student.stats.percentage ?? 0), 0) / counted.length)
  const risk = atRisk(active)

  const setSharing = (value: boolean) => {
    const next = new URLSearchParams(search)
    if (value) next.set('share', '1')
    else next.delete('share')
    setSearch(next, { replace: true })
  }

  const start = async () => {
    if (starting) return
    setStarting(true)
    try {
      const started = await startSession(userId, course.id)
      navigate(projectorPath(started.session.id))
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : 'Could not start the session.')
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      <BackLink to="/" label="Courses" />

      <ScreenHead
        icon={<BookOpen size={26} strokeWidth={2} />}
        title={course.name}
        label={`${courseLabel(course)}${course.term ? ` · ${course.term}` : ''}${course.archived ? ' · Archived' : ''} · target ${course.targetPercentage}% · join code ${course.joinCode}`}
      />

      {/* The one thing a teacher opens this for at the start of class comes
          first and largest; everything else is a labelled button beside it. */}
      <div className="mb-6 flex flex-wrap gap-2.5">
        {open ? (
          <Link to={projectorPath(open.sessionId)} className="btn-accent w-full sm:w-auto">
            <Radio size={20} strokeWidth={2.2} /> Open live session · {open.present}/{open.expected - open.excused}
          </Link>
        ) : course.archived ? null : (
          <button type="button" className="btn-accent w-full sm:w-auto sm:min-w-[14rem]" disabled={starting} onClick={() => void start()}>
            <Play size={20} strokeWidth={2.4} /> {starting ? 'Starting…' : 'Start session'}
          </button>
        )}
        <div className="grid w-full grid-cols-2 gap-2.5 sm:flex sm:w-auto sm:flex-wrap">
          <Link to={`/courses/${course.id}/analysis`} className="btn-secondary">
            <LineChart size={19} strokeWidth={2.2} /> Analysis
          </Link>
          <button type="button" onClick={() => setExporting(true)} aria-label="Export attendance" className="btn-secondary">
            <Download size={19} strokeWidth={2.2} /> Export
          </button>
          <button type="button" onClick={() => setSharing(true)} aria-label="Show the join code" className="btn-secondary">
            <QrIcon size={19} strokeWidth={2.2} /> Join code
          </button>
          <button type="button" onClick={() => setEditing(true)} aria-label={`Edit ${course.name}`} className="btn-secondary">
            <Pencil size={19} strokeWidth={2.2} /> Edit
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard icon={Users} label="Students" value={String(active.length)} />
        <StatCard icon={CalendarCheck} label="Held" value={String(held)} suffix={held === 1 ? 'class' : 'classes'} />
        <StatCard icon={Gauge} label="Average" value={average === null ? '––' : String(average)} suffix="%" />
        <StatCard
          icon={TriangleAlert}
          label="At risk"
          value={String(risk.length)}
          tone={risk.length > 0 ? 'danger' : 'default'}
          suffix={risk.length === 1 ? 'student' : 'students'}
        />
      </div>

      <div className="lg:flex lg:items-start lg:gap-5">
        <Panel className="min-w-0 px-4 pt-4 pb-2 md:px-6 lg:flex-1">
          <SectionHead
            label={`Roster · ${active.length}`}
            action={<SortControl value={sort} onChange={setSort} />}
          />

          {active.length === 0 ? (
            <div className="pb-3">
              <Empty
                icon={<Users size={18} strokeWidth={1.8} />}
                title="No students yet"
                text={`Students join with the code ${course.joinCode}. Show it on the projector once.`}
                action={
                  <button type="button" className="btn-secondary" onClick={() => setSharing(true)}>
                    Show join code
                  </button>
                }
              />
            </div>
          ) : (
            <div role="list">
              {active.map((student) => (
                <RosterLine key={student.row.studentId} student={student} target={target} onOpen={() => setSelected(student)} />
              ))}
            </div>
          )}

          {removed.length > 0 ? (
            <div className="mt-6">
              <SectionHead label={`Removed · ${removed.length}`} />
              {removed.map((student) => (
                <div key={student.row.studentId} className="flex min-h-16 items-center gap-3 border-b border-line py-3 last:border-b-0">
                  <span className="w-[6.5rem] shrink-0 font-mono text-[0.95rem] text-ink-muted">{student.row.rollNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[1.0625rem] text-ink-muted">{student.row.fullName}</span>
                  <button
                    type="button"
                    className="chip min-h-11 bg-elevated px-4 text-ink hover:bg-line"
                    onClick={() =>
                      void setEnrolment(userId, course.id, student.row.studentId, 'active').then(
                        () => toast.success(`${student.row.fullName} restored`),
                        (failure: Error) => toast.error(failure.message)
                      )
                    }
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel className="mt-5 min-w-0 px-4 pt-4 pb-2 md:px-6 lg:mt-0 lg:w-[24rem] lg:shrink-0">
          <SectionHead label={`Sessions · ${sessions.length}`} />
          {sessions.length === 0 ? (
            <p className="pb-4 text-[1rem] text-ink-muted">No sessions yet. Start one when the class begins.</p>
          ) : (
            sessions.map((session) => <SessionLine key={session.sessionId} session={session} />)
          )}
        </Panel>
      </div>

      <Sheet open={sharing} onClose={() => setSharing(false)} title={`Join ${courseLabel(course)}`} description="Students scan this with their phone camera, or type the code in the app.">
        <JoinShare course={course} />
      </Sheet>

      <Sheet
        open={exporting}
        onClose={() => setExporting(false)}
        title="Export attendance"
        description="Closed sessions only. Excused classes count on neither side, as on the roster."
      >
        <ActionRow
          icon={<FileSpreadsheet size={20} strokeWidth={1.9} />}
          title="Register"
          detail="One row per student, a column per class: P, A or E, with totals"
          onClick={() =>
            void loadCourseExport(course.id).then(
              (exported) => {
                downloadCsv(registerCsv(course, exported, data.roster), exportFilename(course, 'register', todayKey()))
                setExporting(false)
              },
              (failure: Error) => toast.error(failure.message)
            )
          }
        />
        <ActionRow
          icon={<Rows3 size={20} strokeWidth={1.9} />}
          title="Every mark"
          detail="One row per student per class, with method, time and flags, for analysis"
          onClick={() =>
            void loadCourseExport(course.id).then(
              (exported) => {
                downloadCsv(marksCsv(exported), exportFilename(course, 'marks', todayKey()))
                setExporting(false)
              },
              (failure: Error) => toast.error(failure.message)
            )
          }
        />
      </Sheet>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit course">
        <CourseForm
          initial={course}
          submitLabel="Save changes"
          onSubmit={async (draft) => {
            await updateCourse(userId, course.id, draft)
            setEditing(false)
            toast.success('Saved')
          }}
        />
        <div className="mt-7 space-y-3 border-t border-line pt-6">
          <button
            type="button"
            className="btn-secondary w-full"
            onClick={() => {
              void updateCourse(userId, course.id, { archived: !course.archived }).catch((failure: Error) =>
                toast.error(failure.message)
              )
              setEditing(false)
            }}
          >
            {course.archived ? (
              <>
                <ArchiveRestore size={19} /> Restore
              </>
            ) : (
              <>
                <Archive size={19} /> Archive
              </>
            )}
          </button>
          <p className="text-[0.975rem] leading-relaxed text-ink-muted">
            Archiving keeps every record but stops new students joining and new sessions starting.
          </p>
        </div>
      </Sheet>

      <StudentSheet
        student={selected}
        course={course}
        onClose={() => setSelected(null)}
        onRemove={async (student) => {
          await setEnrolment(userId, course.id, student.row.studentId, 'removed')
          setSelected(null)
          toast.success(`${student.row.fullName} removed`)
        }}
      />
    </>
  )
}

function SortControl({ value, onChange }: { value: RosterSort; onChange: (value: RosterSort) => void }) {
  return (
    <div role="radiogroup" aria-label="Sort roster" className="inset flex gap-1 rounded-full p-1">
      {(
        [
          ['roll', 'Roll'],
          ['name', 'Name'],
          ['percentage', '%']
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'min-h-10 min-w-11 rounded-full px-3.5 text-[0.95rem] font-semibold transition-colors',
            value === key ? 'bg-surface text-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

const ZONE_EDGE: Record<ScoredStudent['zone'], string> = {
  danger: 'bg-danger',
  caution: 'bg-warn',
  safe: 'bg-transparent',
  neutral: 'bg-transparent'
}

function RosterLine({ student, target, onOpen }: { student: ScoredStudent; target: number; onOpen: () => void }) {
  const { row, stats, zone } = student

  return (
    <button
      type="button"
      role="listitem"
      onClick={onOpen}
      className={cn(
        'hover-row -mx-2 flex min-h-16 w-[calc(100%+1rem)] items-center gap-3 rounded-xl border-b border-line px-2 py-3 text-left last:border-b-0 active:opacity-70',
        zone === 'danger' && 'bg-danger-wash/70'
      )}
    >
      {/* Colour is never the only signal: the margin note says it in words. */}
      <span aria-hidden className={cn('h-10 w-1 shrink-0 rounded-full', ZONE_EDGE[zone])} />
      <span className="hidden w-[6.5rem] shrink-0 font-mono text-[0.95rem] text-ink-muted tabular-nums sm:block">
        {row.rollNumber}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.0625rem] font-semibold">{row.fullName}</span>
        <span className="mt-0.5 block truncate text-[0.95rem] text-ink-muted tabular-nums">
          <span className="font-mono sm:hidden">{row.rollNumber} · </span>
          {stats.total === 0 ? 'Nothing counted yet' : `${stats.present} of ${stats.total}`}
          <MarginNote stats={stats} />
        </span>
      </span>
      <Percent stats={stats} target={target} className="text-[1.375rem]" />
    </button>
  )
}

const STATUS_LABEL: Record<SessionSummary['status'], string> = {
  open: 'Live',
  closed: 'Closed',
  cancelled: 'Cancelled'
}

function SessionLine({ session }: { session: SessionSummary }) {
  return (
    <Link to={sessionPath(session.sessionId)} className="block">
      <div className="hover-row -mx-2 flex min-h-16 items-center gap-3 rounded-xl border-b border-line px-2 py-3 last:border-b-0">
        <div className="min-w-0 flex-1">
          <p className="text-[1.0625rem] font-medium tabular-nums">{formatSessionTime(session.startedAt)}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'chip py-1 text-[0.85rem]',
                session.status === 'open'
                  ? 'bg-accent-wash text-accent'
                  : session.status === 'cancelled'
                    ? 'bg-elevated text-ink-muted line-through'
                    : 'bg-elevated text-ink-muted'
              )}
            >
              {STATUS_LABEL[session.status]}
            </span>
            {session.flagged > 0 ? (
              <span className="chip bg-warn-wash py-1 text-[0.85rem] text-warn">{`${session.flagged} flagged`}</span>
            ) : null}
          </p>
        </div>
        {session.status === 'cancelled' ? null : (
          <span className="readout text-[1.375rem]">
            {session.present}
            {/* Excused students count on neither side. */}
            <span className="text-[0.65em] text-ink-muted">/{session.expected - session.excused}</span>
          </span>
        )}
        <ChevronRight size={20} className="shrink-0 text-ink-faint" />
      </div>
    </Link>
  )
}

/** The join code and its QR, big enough to project once at the start of term. */
function JoinShare({ course }: { course: Course }) {
  const url = `${window.location.origin}/join/${course.joinCode}`

  return (
    <div className="flex flex-col items-center">
      <QrCode value={url} label={`QR code to join ${course.name}`} className="max-w-[18rem]" />
      <p className="readout mt-6 text-[2.75rem] tracking-[0.25em]">{course.joinCode}</p>
      <p className="mt-3 text-center text-[1rem] leading-relaxed text-ink-muted">
        Codes have no 0, O, 1, I or L, so they cannot be misread.
      </p>
      <button
        type="button"
        className="btn-secondary mt-6 w-full"
        onClick={() =>
          void navigator.clipboard?.writeText(url).then(
            () => toast.success('Link copied'),
            () => toast.error('Could not copy')
          )
        }
      >
        Copy join link
      </button>
    </div>
  )
}

function StudentSheet({
  student,
  course,
  onClose,
  onRemove
}: {
  student: ScoredStudent | null
  course: Course
  onClose: () => void
  onRemove: (student: ScoredStudent) => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <Sheet
        open={student !== null && !confirming}
        onClose={onClose}
        title={student?.row.fullName ?? 'Student'}
        description={student ? `${student.row.rollNumber} · joined ${formatShortDay(student.row.joinedAt)}` : undefined}
      >
        {student ? (
          <>
            <MarginPanel stats={student.stats} target={course.targetPercentage} subject="they" />
            <button type="button" className="btn-danger mt-6 w-full" onClick={() => setConfirming(true)}>
              Remove from course
            </button>
          </>
        ) : null}
      </Sheet>

      <ConfirmDialog
        open={confirming && student !== null}
        destructive
        title={`Remove ${student?.row.fullName ?? 'student'}?`}
        description="They stop seeing this course and cannot rejoin with the code. Their past attendance is kept, and you can restore them."
        confirmLabel="Remove"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          if (!student) return
          try {
            await onRemove(student)
          } catch (failure) {
            toast.error(failure instanceof Error ? failure.message : 'Could not remove.')
          } finally {
            setConfirming(false)
          }
        }}
      />
    </>
  )
}
