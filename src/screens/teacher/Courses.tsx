import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Archive, ChevronRight, Layers, Plus, Radio } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { CourseForm } from '../../components/CourseForm'
import { Empty } from '../../components/Empty'
import { LoadError } from '../../components/LoadError'
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
          <button type="button" onClick={() => setCreating(true)} aria-label="Create a course" className="btn-primary">
            <Plus size={20} strokeWidth={2.4} />
            <span>New course</span>
          </button>
        }
      />

      {archivedCount > 0 ? (
        <div role="tablist" aria-label="Course filter" className="inset mb-5 inline-flex gap-1 rounded-full p-1.5">
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
                'min-h-11 rounded-full px-5 text-[1rem] font-semibold transition-colors',
                showArchived === key ? 'bg-surface text-ink shadow-(--shadow-card)' : 'text-ink-muted hover:text-ink'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

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
        <div className="grid gap-3 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
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
    <Link
      to={`/courses/${course.id}`}
      className="panel flex h-full flex-col p-2 transition-shadow hover:shadow-(--shadow-lift)"
    >
      <div className="flex items-start gap-3 px-3 pt-3 pb-4">
        <div className="min-w-0 flex-1">
          <p className="title truncate text-[1.25rem]">{course.name}</p>
          <p className="mt-1 truncate text-[0.95rem] text-ink-muted">
            {courseLabel(course)}
            {course.term ? ` · ${course.term}` : ''}
          </p>
          {overview.openSessionId ? (
            <span className="chip mt-2.5 bg-accent-wash text-accent">
              <Radio size={15} strokeWidth={2.2} className="motion-safe:animate-pulse" /> Live
            </span>
          ) : null}
        </div>
        <ChevronRight size={20} className="mt-1 shrink-0 text-ink-faint" />
      </div>

      <dl className="inset mt-auto grid grid-cols-4 gap-2 px-3.5 py-3.5">
        <Figure label="Students" value={String(overview.students)} />
        <Figure label="Held" value={String(overview.sessionsHeld)} />
        <Figure
          label="Avg"
          value={overview.averagePercentage === null ? '––' : `${Math.round(overview.averagePercentage)}%`}
        />
        <Figure label="At risk" value={String(overview.atRisk)} danger={overview.atRisk > 0} />
      </dl>
    </Link>
  )
}

function Figure({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label truncate">{label}</dt>
      <dd className={cn('readout mt-2 text-[1.375rem]', danger && 'text-danger')}>{value}</dd>
    </div>
  )
}
