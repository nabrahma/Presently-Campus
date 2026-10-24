import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ChevronRight, Layers, Plus, Radio } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { CourseForm } from '../../components/CourseForm'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
import { DataRow } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { Sheet } from '../../components/Sheet'
import { courseLabel } from '../../lib/api'
import { cn } from '../../lib/cn'
import { useUserId } from '../../lib/session'
import { createCourse, useTeacherCourses, type TeacherCourse } from '../../lib/teacher'

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

  return (
    <>
      <ScreenHead
        label={`${data.length - archivedCount} active`}
        title="Courses"
        action={
          <button
            type="button"
            onClick={() => setCreating(true)}
            aria-label="Create a course"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-bg active:opacity-80"
          >
            <Plus size={18} strokeWidth={2.4} />
          </button>
        }
      />

      {archivedCount > 0 ? (
        <div role="tablist" aria-label="Course filter" className="mb-5 flex gap-2">
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
              aria-selected={showArchived === key}
              onClick={() => setShowArchived(key)}
              className={cn(
                'rounded-full border px-4 py-2 font-mono text-[0.65rem] tracking-[0.1em] uppercase transition-colors',
                showArchived === key ? 'border-accent bg-accent text-bg' : 'border-line text-ink-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <Empty
          icon={showArchived ? <Archive size={18} strokeWidth={1.8} /> : <Layers size={18} strokeWidth={1.8} />}
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
        <div className="divide-y divide-line md:grid md:grid-cols-2 md:gap-3 md:divide-y-0 xl:grid-cols-3">
          {visible.map((entry) => (
            <CourseCard key={entry.course.id} entry={entry} />
          ))}
        </div>
      )}

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

function CourseCard({ entry }: { entry: TeacherCourse }) {
  const { course, overview } = entry

  return (
    <Link to={`/courses/${course.id}`} className="block h-full">
      <DataRow
        bare
        className={cn(
          'items-start py-4',
          'md:h-full md:rounded-panel md:border md:border-line md:px-4',
          'md:transition-colors md:hover:border-line-strong'
        )}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-mono text-[0.62rem] tracking-[0.08em] text-ink-faint uppercase">
              {courseLabel(course)}
              {course.term ? ` · ${course.term}` : ''}
            </p>
            {overview.openSessionId ? (
              <span className="label flex shrink-0 items-center gap-1 text-accent">
                <Radio size={11} strokeWidth={2.2} /> Live
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 truncate text-[0.95rem] text-ink">{course.name}</p>

          <dl className="mt-3 grid grid-cols-4 gap-2">
            <Figure label="Students" value={String(overview.students)} />
            <Figure label="Held" value={String(overview.sessionsHeld)} />
            <Figure
              label="Avg"
              value={overview.averagePercentage === null ? '––' : `${Math.round(overview.averagePercentage)}%`}
            />
            <Figure label="At risk" value={String(overview.atRisk)} danger={overview.atRisk > 0} />
          </dl>
        </div>
        <ChevronRight size={15} className="mt-1 shrink-0 text-ink-faint" />
      </DataRow>
    </Link>
  )
}

function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label truncate">{label}</dt>
      <dd className={cn('readout mt-1.5 text-[0.95rem]', danger && 'text-danger')}>{value}</dd>
    </div>
  )
}
