import { motion } from 'motion/react'
import { cn } from '../lib/cn'
import type { SafetyZone } from '../lib/attendanceMath'

/* Green for on target, amber for close, red for below: the colours people
   already read that way. Each is paired with words wherever it appears. */
const STROKE: Record<SafetyZone, string> = {
  neutral: 'stroke-ink-faint',
  safe: 'stroke-good-bright',
  caution: 'stroke-warn-bright',
  danger: 'stroke-danger'
}

const FILL: Record<SafetyZone, string> = {
  neutral: 'bg-ink-faint',
  safe: 'bg-good-bright',
  caution: 'bg-warn-bright',
  danger: 'bg-danger'
}

export const ZONE_TEXT: Record<SafetyZone, string> = {
  neutral: 'text-ink-muted',
  safe: 'text-good',
  caution: 'text-warn',
  danger: 'text-danger'
}

interface GaugeProps {
  percentage: number | null
  zone: SafetyZone
  size?: number
  className?: string
}

/**
 * A ring with the figure inside it.
 *
 * Drawn as an SVG rather than a conic gradient so the track keeps an even
 * width, the ends stay round, and the sweep can animate.
 */
export function Gauge({ percentage, zone, size = 84, className }: GaugeProps) {
  const stroke = 7
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const filled = Math.max(0, Math.min(100, percentage ?? 0))

  return (
    <div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={percentage === null ? 'No attendance recorded' : `${percentage} percent attendance`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-elevated" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={STROKE[zone]}
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference - (filled / 100) * circumference }}
          transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }}
        />
      </svg>

      <span className="readout absolute inset-0 flex items-center justify-center text-[1.2rem] text-ink">
        {percentage === null ? '––' : Math.round(percentage)}
        {percentage === null ? null : <span className="text-[0.6em] text-ink-muted">%</span>}
      </span>
    </div>
  )
}

/** The target as a dark tick across the bar, so "where I need to be" is visible. */
function TargetTick({ target }: { target: number }) {
  return (
    <span
      aria-hidden
      className="absolute -top-1.5 -bottom-1.5 w-0.75 -translate-x-1/2 rounded-full bg-ink"
      style={{ left: `${Math.min(100, Math.max(0, target))}%` }}
    />
  )
}

/** The reading as a solid bar, with the target marked on it. For list rows. */
export function Meter({
  percentage,
  target,
  zone
}: {
  percentage: number | null
  target: number
  zone: SafetyZone
}) {
  const filled = Math.max(0, Math.min(100, percentage ?? 0))

  return (
    <div className="relative h-2.5 w-full rounded-full bg-elevated">
      <motion.div
        className={cn('h-full rounded-full', FILL[zone])}
        initial={false}
        animate={{ width: `${filled}%` }}
        transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
      />
      <TargetTick target={target} />
    </div>
  )
}

/**
 * The reading as a row of ticks, filled up to the percentage: the large
 * meter at the top of a course. Coloured by zone, with the target marked.
 */
export function SegmentMeter({
  percentage,
  target,
  zone,
  segments = 36
}: {
  percentage: number | null
  target: number
  zone: SafetyZone
  segments?: number
}) {
  const lit = Math.round((Math.max(0, Math.min(100, percentage ?? 0)) / 100) * segments)

  return (
    <div className="relative">
      <div className="flex h-12 items-stretch gap-0.75" aria-hidden>
        {Array.from({ length: segments }, (_, index) => (
          <span
            key={index}
            className={cn('flex-1 rounded-full transition-colors duration-500', index < lit ? FILL[zone] : 'bg-line')}
          />
        ))}
      </div>
      <TargetTick target={target} />
    </div>
  )
}
