import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, BookOpen, CalendarCheck, ChevronRight, Gauge, Layers, PartyPopper, Plus, Radio, TriangleAlert, Users } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { CourseForm } from '../../components/CourseForm'
import { Empty } from '../../components/Empty'
import { Meter } from '../../components/Gauge'
import { LoadError } from '../../components/LoadError'
import { Panel, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { Sheet } from '../../components/Sheet'
import { StatCard } from '../../components/StatCard'
import { courseLabel } from '../../lib/api'
import { safetyZone } from '../../lib/attendanceMath'
import { cn } from '../../lib/cn'
import { useUserId } from '../../lib/session'
import { createCourse, useTeacherCourses, type TeacherCourse } from '../../lib/teacher'
import { projectorPath } from './CourseDetail'

/**
 * The teacher's dashboard: the whole term at a glance across every course,
 * then each course as a card. Everything a teacher acts on at the start of a
 * class (a live session, a course slipping below target) sits in the column
 * on the right.
 */
export function TeacherCourses() {
  const userId = useUserId()
  const navigate = useNavigate()
  const { data, error, refresh } = useTeacherCourses()
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  const archivedCount = data?.filter((entry) => entry.course.archived).length ?? 0
  const visible = useMemo(
    () =>
      (data ?? [])
        .filter((entry) => entry.course.archived === showArchived)
        .sort((a, b) => courseLabel(a.course).localeCompare(courseLabel(b.course))),
    [data, showArchived]
  )

  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  const active = data.filter((entry) => !entry.course.archived)
  const totals = summarise(active)

  return (
    <>
      <ScreenHead
        label={`${active.length} active ${active.length === 1 ? 'course' : 'courses'}`}
        title="Courses"
        action={
          <button type="button" onClick={() => setCreating(true)} aria-label="Create a course" className="btn-primary">
            <Plus size={20} strokeWidth={2.4} />
            <span>New course</span>
          </button>
        }
      />

      {active.length > 0 ? (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          <StatCard icon={Users} label="Students" value={String(totals.students)} detail={`Across ${active.length} ${active.length === 1 ? 'course' : 'courses'}`} />
          <StatCard icon={CalendarCheck} label="Classes held" value={String(totals.held)} detail="This term, all courses" />
          <StatCard
            icon={Gauge}
            label="Average attendance"
            value={totals.average === null ? '––' : String(totals.average)}
            suffix={totals.average === null ? undefined : '%'}
            detail="Weighted by class size"
          />
          <StatCard
            icon={TriangleAlert}
            label="Below target"
            value={String(totals.atRisk)}
            suffix={totals.atRisk === 1 ? 'student' : 'students'}
            tone={totals.atRisk > 0 ? 'danger' : 'default'}
            detail="Under their course's target"
          />
        </div>
      ) : null}

      <div className="lg:flex lg:items-start lg:gap-5">
        <div className="min-w-0 lg:flex-1">
          {active.length > 0 && !showArchived ? <AttendanceByCourse entries={active} /> : null}

          <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-3">
            <h2 className="title text-[1.25rem]">{showArchived ? 'Archived courses' : 'Your courses'}</h2>
            {archivedCount > 0 ? <ArchiveFilter value={showArchived} onChange={setShowArchived} /> : null}
          </div>

          {visible.length === 0 ? (
            <Empty
              icon={showArchived ? <Archive size={26} strokeWidth={1.8} /> : <Layers size={26} strokeWidth={1.8} />}
              title={showArchived ? 'Nothing archived' : 'No courses yet'}
              text={
                showArchived
                  ? 'Archived courses keep their records but take no new students or sessions.'
                  : 'Create a course, share its join code with the class, and start a session when you teach.'
              }
              action={
                showArchived ? null : (
                  <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                    Create course
                  </button>
                )
              }
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:gap-4">
              {visible.map((entry) => (
                <CourseCard key={entry.course.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        <aside aria-label="Today" className="mt-5 space-y-4 lg:mt-0 lg:w-[22rem] lg:shrink-0">
          <LiveNow entries={active} />
          <NeedsAttention entries={active} />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="panel flex w-full items-center gap-4 border-dashed p-5 text-left transition-colors hover:border-accent-solid/50 hover:bg-accent-wash/40"
          >
            <span className="grid size-12 shrink-0 place-items-center rounded-xl border-2 border-accent-solid/40 text-accent">
              <Plus size={22} strokeWidth={2.4} />
            </span>
            <span>
              <span className="block text-[1.0625rem] font-bold">Add a new course</span>
              <span className="mt-0.5 block text-[0.95rem] text-ink-muted">Students join it with a code you share once</span>
            </span>
          </button>
        </aside>
      </div>

      <Sheet
        open={creating}
        onClose={() => setCreating(false)}
        title="New course"
        description="Students join it with a code you share once."
      >
        <CourseForm
          submitLabel="Create course"
          onSubmit={async (draft) => {
            const course = await createCourse(userId, draft)
            setCreating(false)
            toast.success(`Created · join code ${course.joinCode}`)
            navigate(`/courses/${course.id}?share=1`)
          }}
        />
      </Sheet>
    </>
  )
}

function summarise(entries: TeacherCourse[]) {
  let students = 0
  let held = 0
  let atRisk = 0
  let weighted = 0
  let weight = 0
  for (const { overview } of entries) {
    students += overview.students
    held += overview.sessionsHeld
    atRisk += overview.atRisk
    if (overview.averagePercentage !== null && overview.students > 0) {
      weighted += overview.averagePercentage * overview.students
      weight += overview.students
    }
  }
  return { students, held, atRisk, average: weight === 0 ? null : Math.round(weighted / weight) }
}

const percentText = (value: number | null) => (value === null ? '––' : `${Math.round(value)}%`)

/** Each course's average against its own target, as one bar per course. */
function AttendanceByCourse({ entries }: { entries: TeacherCourse[] }) {
  const sorted = [...entries].sort((a, b) => courseLabel(a.course).localeCompare(courseLabel(b.course)))

  return (
    <Panel className="mb-6 p-5 md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="title text-[1.25rem]">Attendance by course</h2>
        <p className="flex items-center gap-2 text-[0.95rem] text-ink-muted">
          <span aria-hidden className="inline-block h-4 w-0.75 rounded-full bg-ink" />
          Course target
        </p>
      </div>
      <ul className="space-y-4">
        {sorted.map(({ course, overview }) => {
          const zone = safetyZone(overview.averagePercentage, course.targetPercentage)
          return (
            <li key={course.id}>
              <Link to={`/courses/${course.id}`} className="group block rounded-lg">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[1rem] font-semibold group-hover:text-accent">
                    {courseLabel(course)}
                    <span className="font-medium text-ink-muted"> · target {course.targetPercentage}%</span>
                  </span>
                  <span className="readout text-[1.125rem]">{percentText(overview.averagePercentage)}</span>
                </div>
                <Meter percentage={overview.averagePercentage} target={course.targetPercentage} zone={zone} />
              </Link>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

/** A course as a card: who is in it in large type, the rest beside it, the name underneath. */
function CourseCard({ entry }: { entry: TeacherCourse }) {
  const { course, overview } = entry

  return (
    <Link
      to={`/courses/${course.id}`}
      className="panel group flex h-full min-w-0 flex-col p-5 transition-[box-shadow,border-color] hover:border-accent-solid/40 hover:shadow-(--shadow-lift)"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[0.95rem] font-semibold text-ink-muted">Students</p>
          <p className="readout mt-2 text-[2.5rem]">{overview.students}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-5 gap-y-1.5 text-[0.975rem]">
          <dt className="text-ink-muted">Held</dt>
          <dd className="text-right font-bold tabular-nums">{overview.sessionsHeld}</dd>
          <dt className="text-ink-muted">Avg</dt>
          <dd className="text-right font-bold tabular-nums">{percentText(overview.averagePercentage)}</dd>
          <dt className="text-ink-muted">At risk</dt>
          <dd className={cn('text-right font-bold tabular-nums', overview.atRisk > 0 && 'text-danger')}>{overview.atRisk}</dd>
        </dl>
      </div>

      <div className="mt-5 flex items-center gap-3 border-t border-line pt-4">
        <span className="icon-tile size-10">
          <BookOpen size={19} strokeWidth={2.1} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="title line-clamp-2 text-[1.125rem] break-words group-hover:text-accent">{course.name}</p>
          <p className="mt-0.5 truncate text-[0.95rem] text-ink-muted">
            {courseLabel(course)}
            {course.term ? ` · ${course.term}` : ''}
          </p>
        </div>
        {overview.openSessionId ? <LiveChip /> : null}
        <ChevronRight size={20} className="shrink-0 text-ink-faint" />
      </div>
    </Link>
  )
}

function LiveChip() {
  return (
    <span className="chip shrink-0 bg-accent-wash text-accent">
      <span aria-hidden className="size-2 rounded-full bg-accent-bright motion-safe:animate-pulse" />
      Live
    </span>
  )
}

/** The class taking attendance right now, one tap from its projector. */
function LiveNow({ entries }: { entries: TeacherCourse[] }) {
  const live = entries.filter((entry) => entry.overview.openSessionId)

  return (
    <Panel className="p-5">
      <SectionHead label="Live now" />
      {live.length === 0 ? (
        <p className="pb-1 text-[1rem] leading-relaxed text-ink-muted">
          No class is taking attendance. Start a session from a course when you begin teaching.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {live.map(({ course, overview }) => (
            <li key={course.id}>
              <Link
                to={projectorPath(overview.openSessionId!)}
                className="flex items-center gap-3 rounded-xl bg-accent-wash px-4 py-3.5 transition-colors hover:bg-accent-wash/70"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-solid text-accent-ink">
                  <Radio size={19} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1.0625rem] font-bold text-accent">{courseLabel(course)}</span>
                  <span className="block text-[0.95rem] text-ink-muted">Open the projector</span>
                </span>
                <ChevronRight size={20} className="shrink-0 text-accent" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

/** Courses with students below target, the most first. */
function NeedsAttention({ entries }: { entries: TeacherCourse[] }) {
  const slipping = entries.filter((entry) => entry.overview.atRisk > 0).sort((a, b) => b.overview.atRisk - a.overview.atRisk)

  return (
    <Panel className="p-5">
      <SectionHead label="Needs attention" />
      {slipping.length === 0 ? (
        <p className="flex items-start gap-3 pb-1 text-[1rem] leading-relaxed text-ink-muted">
          <PartyPopper size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-good" />
          Every student is on target in every course.
        </p>
      ) : (
        <ul>
          {slipping.map(({ course, overview }) => (
            <li key={course.id} className="border-b border-line last:border-b-0">
              <Link to={`/courses/${course.id}`} className="hover-row -mx-2 flex min-h-16 items-center gap-3 rounded-xl px-2 py-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger-wash text-danger">
                  <TriangleAlert size={18} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[1.0625rem] font-semibold">{courseLabel(course)}</span>
                  <span className="block text-[0.95rem] text-danger">
                    {overview.atRisk} {overview.atRisk === 1 ? 'student' : 'students'} below target
                  </span>
                </span>
                <ChevronRight size={20} className="shrink-0 text-ink-faint" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function ArchiveFilter({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div role="tablist" aria-label="Course filter" className="inset inline-flex gap-1 p-1">
      {(
        [
          [false, 'Active'],
          [true, 'Archived']
        ] as const
      ).map(([key, label]) => (
        <button
          key={String(key)}
          role="tab"
          type="button"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={cn(
            'min-h-10 rounded-lg px-4 text-[0.975rem] font-semibold transition-colors',
            value === key ? 'bg-surface text-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
