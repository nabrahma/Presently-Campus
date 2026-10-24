import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, ChevronLeft, ChevronRight, Download, FileSpreadsheet, LineChart, Pencil, Play, QrCode as QrIcon, Radio, Rows3, Users } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { CourseForm } from '../../components/CourseForm'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { MarginNote, MarginPanel, Percent } from '../../components/Margin'
import { ActionRow, Panel, Readout, SectionHead } from '../../components/Panel'
import { QrCode } from '../../components/QrCode'
import { Sheet } from '../../components/Sheet'
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
      <Link
        to="/"
        className="mb-5 inline-flex items-center gap-1.5 font-mono text-[0.65rem] tracking-[0.1em] text-ink-muted uppercase active:opacity-60"
      >
        <ChevronLeft size={14} strokeWidth={2.2} />
        Courses
      </Link>

      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="label truncate">
            {courseLabel(course)}
            {course.term ? ` · ${course.term}` : ''}
            {course.archived ? ' · Archived' : ''}
          </p>
          <h1 className="mt-2.5 text-[1.4rem] leading-tight tracking-[-0.01em]">{course.name}</h1>
          <p className="mt-2 font-mono text-[0.6rem] tracking-[0.08em] text-ink-faint uppercase">
            Target {course.targetPercentage}% · join code {course.joinCode}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setExporting(true)}
            aria-label="Export attendance"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink-muted active:opacity-60"
          >
            <Download size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setSharing(true)}
            aria-label="Show the join code"
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink-muted active:opacity-60"
          >
            <QrIcon size={15} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label={`Edit ${course.name}`}
            className="grid h-10 w-10 place-items-center rounded-full border border-line text-ink-muted active:opacity-60"
          >
            <Pencil size={15} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div className="mb-6 flex flex-wrap gap-3">
        {open ? (
          <Link to={projectorPath(open.sessionId)} className="btn-primary flex-1 md:flex-none">
            <Radio size={15} strokeWidth={2.2} /> Open live session · {open.present}/{open.expected - open.excused}
          </Link>
        ) : course.archived ? null : (
          <button type="button" className="btn-primary flex-1 md:flex-none" disabled={starting} onClick={() => void start()}>
            <Play size={14} strokeWidth={2.4} /> {starting ? 'Starting' : 'Start session'}
          </button>
        )}
        <Link to={`/courses/${course.id}/analysis`} className="btn-secondary flex-1 md:flex-none">
          <LineChart size={14} strokeWidth={2.2} /> Analysis
        </Link>
      </div>

      <div className="mb-7 grid grid-cols-4 gap-3">
        <Panel className="px-4 py-3.5">
          <Readout label="Students" value={String(active.length)} size="sm" />
        </Panel>
        <Panel className="px-4 py-3.5">
          <Readout label="Held" value={String(held)} size="sm" />
        </Panel>
        <Panel className="px-4 py-3.5">
          <Readout label="Average" value={average === null ? '––' : String(average)} suffix="%" size="sm" />
        </Panel>
        <Panel className="px-4 py-3.5">
          <Readout label="At risk" value={String(risk.length)} size="sm" tone={risk.length > 0 ? 'danger' : 'default'} />
        </Panel>
      </div>

      <div className="lg:flex lg:items-start lg:gap-8">
        <div className="min-w-0 lg:flex-1">
          <SectionHead
            label={`Roster · ${active.length}`}
            action={<SortControl value={sort} onChange={setSort} />}
          />

          {active.length === 0 ? (
            <div className="mt-4">
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
            <div className="mt-7">
              <SectionHead label={`Removed · ${removed.length}`} />
              {removed.map((student) => (
                <div key={student.row.studentId} className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
                  <span className="w-[5.5rem] shrink-0 font-mono text-[0.72rem] text-ink-faint">{student.row.rollNumber}</span>
                  <span className="min-w-0 flex-1 truncate text-[0.85rem] text-ink-muted">{student.row.fullName}</span>
                  <button
                    type="button"
                    className="font-mono text-[0.62rem] tracking-[0.1em] text-accent uppercase active:opacity-60"
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
        </div>

        <div className="mt-7 min-w-0 lg:mt-0 lg:w-[22rem] lg:shrink-0">
          <SectionHead label={`Sessions · ${sessions.length}`} />
          {sessions.length === 0 ? (
            <p className="py-4 text-[0.8rem] text-ink-muted">No sessions yet. Start one when the class begins.</p>
          ) : (
            sessions.map((session) => <SessionLine key={session.sessionId} session={session} />)
          )}
        </div>
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
          icon={<FileSpreadsheet size={16} strokeWidth={1.9} />}
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
          icon={<Rows3 size={16} strokeWidth={1.9} />}
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
                <ArchiveRestore size={14} /> Restore
              </>
            ) : (
              <>
                <Archive size={14} /> Archive
              </>
            )}
          </button>
          <p className="text-[0.72rem] leading-relaxed text-ink-faint">
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
    <div role="radiogroup" aria-label="Sort roster" className="flex gap-3">
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
            'font-mono text-[0.62rem] tracking-[0.1em] uppercase transition-colors',
            value === key ? 'text-accent' : 'text-ink-faint'
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
        'hover-row flex w-full items-center gap-3 border-b border-line py-3 text-left last:border-b-0 active:opacity-60 md:px-2',
        zone === 'danger' && 'bg-danger-wash'
      )}
    >
      {/* Colour is never the only signal: the margin note says it in words. */}
      <span aria-hidden className={cn('h-8 w-[2px] shrink-0 rounded-full', ZONE_EDGE[zone])} />
      <span className="w-[5.5rem] shrink-0 font-mono text-[0.72rem] text-ink-muted tabular-nums">{row.rollNumber}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.85rem] text-ink">{row.fullName}</span>
        <span className="mt-1 block truncate font-mono text-[0.6rem] tracking-[0.06em] text-ink-faint tabular-nums">
          {stats.total === 0 ? 'Nothing counted yet' : `${stats.present}/${stats.total}`}
          <MarginNote stats={stats} />
        </span>
      </span>
      <Percent stats={stats} target={target} className="text-[1rem]" />
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
      <div className="hover-row flex items-center gap-3 border-b border-line py-3 last:border-b-0 md:px-2">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[0.76rem] text-ink tabular-nums">{formatSessionTime(session.startedAt)}</p>
          <p
            className={cn(
              'mt-1 font-mono text-[0.6rem] tracking-[0.08em] uppercase',
              session.status === 'open' ? 'text-accent' : 'text-ink-faint'
            )}
          >
            {STATUS_LABEL[session.status]}
            {session.flagged > 0 ? <span className="text-warn">{` · ${session.flagged} flagged`}</span> : null}
          </p>
        </div>
        {session.status === 'cancelled' ? null : (
          <span className="readout text-[0.95rem]">
            {session.present}
            {/* Excused students count on neither side. */}
            <span className="text-[0.7em] text-ink-faint">/{session.expected - session.excused}</span>
          </span>
        )}
        <ChevronRight size={15} className="shrink-0 text-ink-faint" />
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
      <p className="readout mt-6 text-[2.4rem] tracking-[0.25em]">{course.joinCode}</p>
      <p className="mt-3 text-center text-[0.78rem] leading-relaxed text-ink-muted">
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
