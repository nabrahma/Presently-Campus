import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Layers, Radio, ScanLine, TriangleAlert } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { Gauge, Meter } from '../../components/Gauge'
import { LoadError } from '../../components/LoadError'
import { MarginNote, Percent } from '../../components/Margin'
import { describePhone } from '../../components/PhonePanel'
import { DataRow, Panel, Readout, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { courseLabel } from '../../lib/api'
import { figuresStats, safetyZone, standings, type AttendanceStats } from '../../lib/attendanceMath'
import { formatDayMonth, formatTime, formatWeekday, keyToDate } from '../../lib/date'
import { usePhoneStatus, type PhoneStatus } from '../../lib/devices'
import { openClasses, useStudentData, type OpenClass, type StudentCourse } from '../../lib/student'
import { useTodayKey } from '../../lib/useTodayKey'

export function StudentHome() {
  const date = useTodayKey()
  const { data, error, refresh } = useStudentData()
  const { status: phone } = usePhoneStatus()

  /*
    Colleges hold each course to its own target, so the summary is per course:
    the one closest to the line, never an average that hides it.
  */
  const scored = useMemo(
    () =>
      (data?.courses ?? []).map((entry) => ({
        item: entry,
        stats: figuresStats(entry.figures, entry.course.targetPercentage),
        target: entry.course.targetPercentage
      })),
    [data]
  )
  const { lowest, leastSpare, below } = useMemo(() => standings(scored), [scored])
  const live = useMemo(() => (data ? openClasses(data) : []), [data])

  if (!data) return error ? <LoadError error={error} onRetry={() => void refresh()} /> : <Booting />

  return (
    <>
      <ScreenHead label={formatWeekday(keyToDate(date))} title={formatDayMonth(keyToDate(date))} />

      <div className="lg:flex lg:flex-row-reverse lg:items-start lg:gap-8">
        <div className="lg:sticky lg:top-0 lg:w-[20rem] lg:shrink-0 lg:space-y-3">
          <Panel className="px-5 py-4">
            {lowest ? (
              <Link to={`/courses/${lowest.item.course.id}`} className="block active:opacity-60">
                <LowestCourse
                  label={`Lowest · ${courseLabel(lowest.item.course)}`}
                  stats={lowest.stats}
                  target={lowest.target}
                />
              </Link>
            ) : (
              <LowestCourse label="Lowest course" stats={null} target={75} />
            )}
          </Panel>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:mt-0">
            <Panel className="px-5 py-4">
              <Readout
                label="Least spare"
                value={leastSpare ? String(leastSpare.stats.bunkable) : '––'}
                suffix={leastSpare?.stats.bunkable === 1 ? 'class' : 'classes'}
                tone={leastSpare && leastSpare.stats.bunkable ? 'accent' : 'muted'}
              />
              <p className="mt-1.5 truncate font-mono text-[0.6rem] tracking-[0.08em] text-ink-faint uppercase">
                {leastSpare
                  ? courseLabel(leastSpare.item.course)
                  : lowest
                    ? 'None on target'
                    : 'No classes yet'}
              </p>
            </Panel>
            <Panel className="px-5 py-4">
              <Readout
                label="Below target"
                value={String(below.length)}
                suffix={below.length === 1 ? 'course' : 'courses'}
                tone={below.length > 0 ? 'danger' : 'muted'}
              />
            </Panel>
          </div>
        </div>

        <div className="min-w-0 lg:flex-1">
          {phone ? <PhoneWarning status={phone} /> : null}

          {live.length > 0 ? (
            <div className="mt-7 space-y-3 lg:mt-0">
              {live.map((entry) => (
                <LiveClass key={entry.session.id} entry={entry} />
              ))}
            </div>
          ) : null}

          <div className={live.length > 0 ? 'mt-7' : 'mt-7 lg:mt-0'}>
            <SectionHead
              label={`Courses · ${data.courses.length}`}
              action={
                <Link
                  to="/courses"
                  className="font-mono text-[0.65rem] tracking-[0.1em] text-accent uppercase active:opacity-60"
                >
                  +Join
                </Link>
              }
            />

            {data.courses.length === 0 ? (
              <div className="mt-4">
                <Empty
                  icon={<Layers size={18} strokeWidth={1.8} />}
                  title="No courses yet"
                  text="Ask your teacher for the course's join code, then join it here."
                  action={
                    <Link to="/courses" className="btn-primary">
                      Join a course
                    </Link>
                  }
                />
              </div>
            ) : (
              <div>
                {scored.map(({ item, stats }) => (
                  <CourseLine key={item.course.id} entry={item} stats={stats} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/** A class taking attendance right now. */
function LiveClass({ entry }: { entry: OpenClass }) {
  const marked = entry.mark?.status === 'present'

  return (
    <Panel className="border-accent/40 bg-accent-wash px-5 py-4">
      <div className="flex items-center gap-2">
        <Radio size={13} strokeWidth={2.2} className="text-accent motion-safe:animate-pulse" />
        <p className="label text-accent">Live · started {formatTime(entry.session.startedAt)}</p>
      </div>
      <p className="mt-2.5 truncate text-[1rem]">{entry.course.name}</p>
      <p className="mt-1 font-mono text-[0.62rem] tracking-[0.08em] text-ink-muted uppercase">
        {marked
          ? `Marked present · ${formatTime(entry.mark!.markedAt)}`
          : entry.mark?.status === 'excused'
            ? 'Excused by your teacher'
            : 'Not marked yet'}
      </p>
      {entry.mark ? null : (
        <Link to="/scan" className="btn-primary mt-4 w-full">
          <ScanLine size={16} strokeWidth={2.2} /> Scan
        </Link>
      )}
    </Panel>
  )
}

/** Shown only when this phone cannot mark attendance at all. */
function PhoneWarning({ status }: { status: PhoneStatus }) {
  if (status.kind === 'active' || status.kind === 'cooling' || status.kind === 'pending') return null
  const copy = describePhone(status)

  return (
    <Link
      to="/settings"
      className="mt-7 flex items-start gap-2.5 rounded-2xl border border-warn/40 px-4 py-3 active:opacity-60 lg:mt-0 lg:mb-7"
    >
      <TriangleAlert size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-warn" />
      <span className="text-[0.76rem] leading-relaxed text-ink-muted">
        <span className="text-warn">{copy.label}.</span> {copy.action ?? 'See Settings'} to mark attendance from this phone.
      </span>
    </Link>
  )
}

function CourseLine({ entry, stats }: { entry: StudentCourse; stats: AttendanceStats }) {
  return (
    <Link to={`/courses/${entry.course.id}`} className="block">
      <DataRow className="hover-row md:px-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[0.82rem] tracking-[0.02em] text-ink uppercase">
            {courseLabel(entry.course)}
          </p>
          <p className="mt-1 truncate font-mono text-[0.6rem] tracking-[0.08em] text-ink-faint uppercase">
            {entry.course.name}
            <MarginNote stats={stats} />
          </p>
        </div>
        <Percent stats={stats} target={entry.course.targetPercentage} className="text-[1.05rem]" />
        <ChevronRight size={15} className="shrink-0 text-ink-faint" />
      </DataRow>
    </Link>
  )
}

/** The gauge readout for the course that decides whether someone is safe. */
function LowestCourse({
  label,
  stats,
  target
}: {
  label: string
  stats: AttendanceStats | null
  target: number
}) {
  const percentage = stats?.percentage ?? null
  const zone = safetyZone(percentage, target)

  return (
    <div className="flex items-center gap-4">
      <Gauge percentage={percentage} zone={zone} />
      <div className="min-w-0 flex-1">
        <p className="label truncate">{label}</p>
        <p className="readout mt-2 text-[1.75rem]">
          {percentage ?? '––'}
          <span className="text-[0.5em] text-ink-faint">%</span>
        </p>
        <div className="mt-3">
          <Meter percentage={percentage} target={target} zone={zone} />
        </div>
        <p className="mt-2.5 truncate font-mono text-[0.62rem] tracking-[0.08em] text-ink-faint uppercase">
          {stats ? `${stats.present}/${stats.total} · target ${target}%` : 'No classes yet'}
        </p>
      </div>
    </div>
  )
}
