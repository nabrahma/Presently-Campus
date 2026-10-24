import { Meter } from './Gauge'
import { Panel, Readout } from './Panel'
import { cn } from '../lib/cn'
import { safetyZone, type AttendanceStats } from '../lib/attendanceMath'

type Tone = 'default' | 'accent' | 'danger' | 'muted'

/** The one figure that answers "can I miss the next class": spare or needed. */
export function marginOf(stats: AttendanceStats): { value: string; caption: string; tone: Tone } {
  if (stats.percentage === null) return { value: '––', caption: 'no classes yet', tone: 'muted' }
  if (stats.bunkable !== null) {
    return {
      value: String(stats.bunkable),
      caption: stats.bunkable === 1 ? 'class spare' : 'classes spare',
      tone: stats.bunkable === 0 ? 'default' : 'accent'
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
    return <span className={stats.bunkable > 0 ? 'text-accent' : undefined}>{` · ${stats.bunkable} spare`}</span>
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
    <span
      className={cn(
        'readout',
        zone === 'danger' && 'text-danger',
        zone === 'caution' && 'text-warn',
        zone === 'safe' && 'text-accent',
        className
      )}
    >
      {stats.percentage === null ? '––' : stats.percentage}
      <span className="text-[0.55em] text-ink-faint">%</span>
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
    <Panel className={cn('px-5 py-5', className)}>
      <Readout label="Margin" value={margin.value} suffix={margin.caption} tone={margin.tone} size="xl" />
      <p className="mt-4 text-[0.82rem] leading-relaxed text-ink-muted">
        {marginExplanation(stats, target, subject)}
      </p>

      <div className="mt-5 border-t border-line pt-4">
        <div className="mb-3 flex items-baseline justify-between">
          <Percent stats={stats} target={target} className="text-[1.1rem]" />
          <span className="font-mono text-[0.62rem] tracking-[0.08em] text-ink-faint uppercase">
            {stats.present}/{stats.total} · target {target}%
          </span>
        </div>
        <Meter percentage={stats.percentage} target={target} zone={zone} />
      </div>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
        {(
          [
            ['Present', stats.present],
            ['Absent', stats.absent],
            ['Excused', stats.holiday]
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="label">{label}</dt>
            <dd className="readout mt-2 text-[1.1rem]">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}
