import { SegmentMeter, ZONE_TEXT } from './Gauge'
import { Panel, Readout, type Tone } from './Panel'
import { cn } from '../lib/cn'
import { safetyZone, type AttendanceStats } from '../lib/attendanceMath'

/** The one figure that answers "can I miss the next class": spare or needed. */
export function marginOf(stats: AttendanceStats): { value: string; caption: string; tone: Tone } {
  if (stats.percentage === null) return { value: '––', caption: 'no classes yet', tone: 'muted' }
  if (stats.bunkable !== null) {
    return {
      value: String(stats.bunkable),
      caption: stats.bunkable === 1 ? 'class spare' : 'classes spare',
      tone: stats.bunkable === 0 ? 'warn' : 'good'
    }
  }
  if (stats.comeback !== null) {
    return {
      value: String(stats.comeback),
      caption: stats.comeback === 1 ? 'class needed' : 'classes needed',
      tone: 'danger'
    }
  }
  return { value: '––', caption: 'unreachable', tone: 'danger' }
}

/** The margin in words, addressed to whoever it is about. */
export function marginExplanation(stats: AttendanceStats, target: number, subject: 'you' | 'they' = 'you'): string {
  const are = subject === 'you' ? 'you are' : 'they are'
  if (stats.percentage === null) return 'Nothing counted yet. Figures appear once a class has closed.'
  if (stats.bunkable !== null) {
    return stats.bunkable === 0
      ? `Exactly on target. One more absence drops ${subject === 'you' ? 'you' : 'them'} below ${target}%.`
      : `Miss the next ${stats.bunkable === 1 ? 'class' : `${stats.bunkable} classes`} and ${are} still at ${target}% or above. Excused and cancelled classes never change this.`
  }
  if (stats.comeback !== null) {
    return `Attend the next ${stats.comeback} ${stats.comeback === 1 ? 'class' : 'classes'} in a row to reach ${target}%.`
  }
  return `A ${target}% target cannot be recovered once a class has been missed.`
}

/** Inline margin for a list row: " · 3 spare" or " · attend next 2". */
export function MarginNote({ stats }: { stats: AttendanceStats }) {
  if (stats.total === 0) return null
  if (stats.bunkable !== null) {
    return <span className={stats.bunkable > 0 ? 'text-good' : 'text-warn'}>{` · ${stats.bunkable} spare`}</span>
  }
  return (
    <span className="text-danger">
      {stats.comeback === null ? ' · unreachable' : ` · attend next ${stats.comeback}`}
    </span>
  )
}

/** Percentage coloured by its zone, with a small % sign. */
export function Percent({
  stats,
  target,
  className
}: {
  stats: AttendanceStats
  target: number
  className?: string
}) {
  const zone = safetyZone(stats.percentage, target)
  return (
    <span className={cn('readout', ZONE_TEXT[zone], className)}>
      {stats.percentage === null ? '––' : stats.percentage}
      <span className="text-[0.6em] text-ink-muted">%</span>
    </span>
  )
}

/** The full reading for one course: margin, explanation, percentage and counts. */
export function MarginPanel({
  stats,
  target,
  subject = 'you',
  className
}: {
  stats: AttendanceStats
  target: number
  subject?: 'you' | 'they'
  className?: string
}) {
  const margin = marginOf(stats)
  const zone = safetyZone(stats.percentage, target)

  return (
    <Panel className={cn('p-5 md:p-7', className)}>
      <Readout label="Margin" value={margin.value} suffix={margin.caption} tone={margin.tone} size="xl" />
      <p className="mt-4 max-w-[34rem] text-[1.0625rem] leading-relaxed text-ink-muted">
        {marginExplanation(stats, target, subject)}
      </p>

      <div className="inset mt-6 p-4 md:p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <Percent stats={stats} target={target} className="text-[1.75rem]" />
          <span className="text-[0.95rem] text-ink-muted">
            {stats.present} of {stats.total} attended · target {target}%
          </span>
        </div>
        <SegmentMeter percentage={stats.percentage} target={target} zone={zone} />
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2.5 md:gap-3">
        {(
          [
            ['Present', stats.present],
            ['Absent', stats.absent],
            ['Excused', stats.holiday]
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-line px-3.5 py-3.5">
            <dt className="label">{label}</dt>
            <dd className="readout mt-2 text-[1.5rem]">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
