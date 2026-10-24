import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight, Gauge as GaugeIcon, Layers, Plus, Radio, ScanLine, TriangleAlert } from 'lucide-react'
import { Booting } from '../../components/Booting'
import { Empty } from '../../components/Empty'
import { SegmentMeter } from '../../components/Gauge'
import { LoadError } from '../../components/LoadError'
import { MarginNote, Percent } from '../../components/Margin'
import { describePhone } from '../../components/PhonePanel'
import { DataRow, Panel, SectionHead } from '../../components/Panel'
import { ScreenHead } from '../../components/Shell'
import { StatCard } from '../../components/StatCard'
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

  const lowestPercentage = lowest?.stats.percentage ?? null

  return (
    <>
      <ScreenHead label={formatWeekday(keyToDate(date))} title={formatDayMonth(keyToDate(date))} />

      {phone ? <PhoneWarning status={phone} /> : null}

      {live.length > 0 ? (
        <div className="mb-5 space-y-3">
          {live.map((entry) => (
            <LiveClass key={entry.session.id} entry={entry} />
          ))}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1.5fr_1fr_1fr] lg:gap-4">
        <Link
          to={lowest ? `/courses/${lowest.item.course.id}` : '/courses'}
          className="col-span-2 block rounded-panel lg:col-span-1"
        >
          <StatCard
            icon={GaugeIcon}
            label={lowest ? `Lowest · ${courseLabel(lowest.item.course)}` : 'Lowest course'}
            value={lowestPercentage === null ? '––' : String(lowestPercentage)}
            suffix="%"
            tone={toneOf(lowestPercentage, lowest?.target ?? 75)}
            detail={
              lowest ? `${lowest.stats.present} of ${lowest.stats.total} attended · target ${lowest.target}%` : 'No classes yet'
            }
            className="h-full transition-shadow hover:shadow-(--shadow-lift)"
          >
            <SegmentMeter
              percentage={lowestPercentage}
              target={lowest?.target ?? 75}
              zone={safetyZone(lowestPercentage, lowest?.target ?? 75)}
              segments={30}
            />
          </StatCard>
        </Link>

        <StatCard
          icon={CalendarClock}
          label="Least spare"
          value={leastSpare ? String(leastSpare.stats.bunkable) : '––'}
          suffix={leastSpare?.stats.bunkable === 1 ? 'class' : 'classes'}
          tone={leastSpare ? (leastSpare.stats.bunkable ? 'good' : 'warn') : 'muted'}
          detail={leastSpare ? courseLabel(leastSpare.item.course) : lowest ? 'None on target' : 'No classes yet'}
        />

        <StatCard
          icon={TriangleAlert}
          label="Below target"
          value={String(below.length)}
          suffix={below.length === 1 ? 'course' : 'courses'}
          tone={below.length > 0 ? 'danger' : 'muted'}
          detail={below.length > 0 ? 'Attend every class until it recovers' : 'Every course is on target'}
        />
      </div>

      <Panel className="mt-5 px-5 pt-4 pb-2 md:px-6">
        <SectionHead
          label={`Courses · ${data.courses.length}`}
          action={
            <Link to="/courses" className="chip min-h-11 bg-elevated px-4 text-ink hover:bg-line">
              <Plus size={16} strokeWidth={2.4} /> Join
            </Link>
          }
        />

        {data.courses.length === 0 ? (
          <div className="pb-3">
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
      </Panel>
    </>
  )
}

function toneOf(percentage: number | null, target: number) {
  const zone = safetyZone(percentage, target)
  return zone === 'danger' ? 'danger' : zone === 'caution' ? 'warn' : zone === 'safe' ? 'good' : 'muted'
}

/** A class taking attendance right now: the one thing on this screen to act on. */
function LiveClass({ entry }: { entry: OpenClass }) {
  const marked = entry.mark?.status === 'present'

  return (
    <section className="rounded-panel border-2 border-accent-bright/50 bg-accent-wash p-5 md:flex md:items-center md:gap-6 md:p-6">
      <div className="min-w-0 flex-1">
        <p className="chip bg-surface text-accent">
          <Radio size={16} strokeWidth={2.2} className="motion-safe:animate-pulse" />
          Live · started {formatTime(entry.session.startedAt)}
        </p>
        <p className="title mt-3 truncate text-[1.5rem]">{entry.course.name}</p>
        <p className="mt-1 text-[1.0625rem] text-ink-muted">
          {marked
            ? `Marked present · ${formatTime(entry.mark!.markedAt)}`
            : entry.mark?.status === 'excused'
              ? 'Excused by your teacher'
              : 'Not marked yet'}
        </p>
      </div>
      {entry.mark ? null : (
        <Link to="/scan" className="btn-accent mt-5 w-full md:mt-0 md:w-auto md:min-w-[12rem]">
          <ScanLine size={20} strokeWidth={2.2} /> Scan
        </Link>
      )}
    </section>
  )
}

/** Shown only when this phone cannot mark attendance at all. */
function PhoneWarning({ status }: { status: PhoneStatus }) {
  if (status.kind === 'active' || status.kind === 'cooling' || status.kind === 'pending') return null
  const copy = describePhone(status)

  return (
    <Link
      to="/settings"
      className="mb-5 flex items-center gap-3.5 rounded-panel border border-warn/40 bg-warn-wash px-4 py-4 active:opacity-70 md:px-5"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-surface text-warn">
        <TriangleAlert size={22} strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1 text-[1.0625rem] leading-snug">
        <span className="font-semibold text-warn">{copy.label}.</span>{' '}
        <span className="text-ink">{copy.action ?? 'See Settings'} to mark attendance from this phone.</span>
      </span>
      <ChevronRight size={20} className="shrink-0 text-ink-muted" />
    </Link>
  )
}

function CourseLine({ entry, stats }: { entry: StudentCourse; stats: AttendanceStats }) {
  return (
    <Link to={`/courses/${entry.course.id}`} className="block border-b border-line last:border-b-0">
      <DataRow bare className="hover-row -mx-2 rounded-xl px-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1.0625rem] font-semibold">{entry.course.name}</p>
          <p className="mt-0.5 truncate text-[0.95rem] text-ink-muted">
            {courseLabel(entry.course)}
            <MarginNote stats={stats} />
          </p>
        </div>
        <Percent stats={stats} target={entry.course.targetPercentage} className="text-[1.5rem]" />
        <ChevronRight size={20} className="shrink-0 text-ink-faint" />
      </DataRow>
    </Link>
  )
}
