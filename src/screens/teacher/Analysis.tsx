import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { AbsenceHeatmap, TrendChart } from '../../components/Charts'
import { LoadError } from '../../components/LoadError'
import { Percent } from '../../components/Margin'
import { Panel, Readout, SectionHead } from '../../components/Panel'
import { absenceGrid, attendanceTrend, projectRoster, sessionsLeft, sessionsPerWeek, type Outlook, type Projection } from '../../lib/analysis'
import { courseLabel } from '../../lib/api'
import { cn } from '../../lib/cn'
import { dateKey, formatDayMonth, keyToDate } from '../../lib/date'
import { flagLabel } from '../../lib/flags'
import { useCourseDetail, useFlagOutcomes } from '../../lib/teacher'

const OUTLOOK: Record<Outlook, { label: string; tone: string }> = {
  cannot_recover: { label: 'Cannot reach target', tone: 'text-danger' },
  below: { label: 'Below target', tone: 'text-danger' },
  heading_below: { label: 'Heading below', tone: 'text-warn' },
  safe: { label: 'On course', tone: 'text-accent' },
  no_data: { label: 'Nothing counted', tone: 'text-ink-faint' }
}

const DEFAULT_WEEKS_AHEAD = 6
const cutoffKey = (courseId: string) => `presently-campus:v1:cutoff:${courseId}`

/** The cutoff a teacher last chose for this course, or six weeks from today. */
function initialCutoff(courseId: string): string {
  try {
    const saved = window.localStorage.getItem(cutoffKey(courseId))
    if (saved && /^\d{4}-\d{2}-\d{2}$/.test(saved)) return saved
  } catch {
    // A missing preference only means the default.
  }
  return dateKey(new Date(Date.now() + DEFAULT_WEEKS_AHEAD * 7 * 86_400_000))
}

/**
 * The course in aggregate: who will not make the target by the cutoff at the
 * pace they are going, how attendance has moved class by class, when
 * absences cluster, and whether the flags are finding proxies.
 */
export function TeacherAnalysis() {
  const { id } = useParams()
  const { data, error, refresh } = useCourseDetail(id)
  const flags = useFlagOutcomes(id)
  const [cutoff, setCutoff] = useState(() => (id ? initialCutoff(id) : ''))

  const now = Date.now()
  // The cutoff day counts in full.
  const cutoffAt = keyToDate(cutoff).getTime() + 12 * 3_600_000
  const perWeek = useMemo(() => (data ? sessionsPerWeek(data.sessions, now) : 0), [data, now])
  const left = sessionsLeft(perWeek, now, cutoffAt)
  const projections = useMemo(
    () => (data ? projectRoster(data.roster, data.course.targetPercentage, left) : []),
    [data, left]
  )
  const trend = useMemo(() => (data ? attendanceTrend(data.sessions) : []), [data])
  const grid = useMemo(() => (data ? absenceGrid(data.sessions) : null), [data])

  if (data === null) return <Navigate to="/" replace />
  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  const { course } = data
  const concern = projections.filter((item) => item.outlook !== 'safe' && item.outlook !== 'no_data')
  const counts = (outlook: Outlook) => projections.filter((item) => item.outlook === outlook).length

  const chooseCutoff = (value: string) => {
    setCutoff(value)
    try {
      window.localStorage.setItem(cutoffKey(course.id), value)
    } catch {
      // Remembering the date is a convenience.
    }
  }

  return (
    <>
      <Link
        to={`/courses/${course.id}`}
        className="mb-5 inline-flex items-center gap-1.5 font-mono text-[0.65rem] tracking-[0.1em] text-ink-muted uppercase active:opacity-60"
      >
        <ChevronLeft size={14} strokeWidth={2.2} />
        {courseLabel(course)}
      </Link>

      <header className="mb-6">
        <p className="label">Analysis · target {course.targetPercentage}%</p>
        <h1 className="mt-2.5 text-[1.4rem] leading-tight tracking-[-0.01em]">{course.name}</h1>
      </header>

      <Panel className="px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className="label mb-2.5 block" htmlFor="analysis-cutoff">
              Cutoff date
            </label>
            <input
              id="analysis-cutoff"
              type="date"
              className="field w-auto font-mono"
              value={cutoff}
              min={dateKey(new Date())}
              onChange={(event) => event.target.value && chooseCutoff(event.target.value)}
            />
          </div>
          <p className="max-w-[24rem] text-[0.78rem] leading-relaxed text-ink-muted">
            {perWeek === 0
              ? 'No classes have closed yet, so there is no pace to project from.'
              : `About ${perWeek.toFixed(1)} classes a week lately, so roughly ${left} more before ${formatDayMonth(keyToDate(cutoff))}.`}
          </p>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
          <Readout label="Cannot reach" value={String(counts('cannot_recover'))} size="sm" tone={counts('cannot_recover') ? 'danger' : 'default'} />
          <Readout label="Below now" value={String(counts('below'))} size="sm" tone={counts('below') ? 'danger' : 'default'} />
          <Readout label="Heading below" value={String(counts('heading_below'))} size="sm" />
        </div>
      </Panel>

      <div className="mt-7">
        <SectionHead label={`Needs attention by ${formatDayMonth(keyToDate(cutoff))} · ${concern.length}`} />
        <p className="pt-2 text-[0.72rem] leading-relaxed text-ink-faint">
          Heading below means on target today, but missing classes at their usual rate would take them
          under it before the cutoff.
        </p>
        {concern.length === 0 ? (
          <p className="py-4 text-[0.8rem] text-ink-muted">Every student is on course for the target.</p>
        ) : (
          <div role="table" aria-label="Students who need attention">
            {concern.map((item) => (
              <ProjectionRow key={item.row.studentId} item={item} left={left} target={course.targetPercentage} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-9 space-y-9 lg:grid lg:grid-cols-2 lg:gap-8 lg:space-y-0">
        <div>
          <SectionHead label="Attendance by class" />
          {trend.length === 0 ? (
            <p className="py-4 text-[0.8rem] text-ink-muted">A line appears once a class has closed.</p>
          ) : (
            <div className="pt-4">
              <TrendChart points={trend} target={course.targetPercentage} />
            </div>
          )}
        </div>

        <div>
          <SectionHead label="When absences happen" />
          {!grid || grid.cells.size === 0 ? (
            <p className="py-4 text-[0.8rem] text-ink-muted">Shown once classes have closed.</p>
          ) : (
            <div className="pt-4">
              <AbsenceHeatmap grid={grid} />
            </div>
          )}
        </div>
      </div>

      <div className="mt-9">
        <SectionHead label="Flags" />
        {!flags.data || flags.data.length === 0 ? (
          <p className="py-4 text-[0.8rem] text-ink-muted">No scans in this course have been flagged.</p>
        ) : (
          <table className="mt-2 w-full font-mono text-[0.72rem]">
            <thead>
              <tr className="text-left text-ink-faint">
                <th className="py-2 font-normal">Flag</th>
                <th className="py-2 text-right font-normal">Kept</th>
                <th className="py-2 text-right font-normal">Proxies removed</th>
                <th className="py-2 text-right font-normal">Waiting</th>
              </tr>
            </thead>
            <tbody>
              {flags.data.map((outcome) => (
                <tr key={outcome.flag} className="border-t border-line tabular-nums">
                  <td className="py-2">{flagLabel(outcome.flag)}</td>
                  <td className="py-2 text-right">{outcome.kept}</td>
                  <td className="py-2 text-right">{outcome.removed}</td>
                  <td className="py-2 text-right">{outcome.pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function ProjectionRow({ item, left, target }: { item: Projection; left: number; target: number }) {
  const outlook = OUTLOOK[item.outlook]
  const advice =
    item.outlook === 'cannot_recover'
      ? `Needs ${item.mustAttend}, only ${left} left`
      : item.outlook === 'below'
        ? `Attend ${item.mustAttend} of the next ${left}`
        : `Can miss ${item.canMiss}, usually misses ${item.likelyToMiss}`

  return (
    <div role="row" className="flex items-center gap-3 border-b border-line py-3 last:border-b-0">
      <span role="cell" className="w-[5.5rem] shrink-0 font-mono text-[0.72rem] text-ink-muted tabular-nums">
        {item.row.rollNumber}
      </span>
      <span role="cell" className="min-w-0 flex-1">
        <span className="block truncate text-[0.85rem]">{item.row.fullName}</span>
        <span className="mt-1 block truncate font-mono text-[0.6rem] tracking-[0.04em] text-ink-faint">
          <span className={cn(outlook.tone)}>{outlook.label}</span> · {advice}
        </span>
      </span>
      <span role="cell">
        <Percent stats={item.stats} target={target} className="text-[1rem]" />
      </span>
    </div>
  )
}
