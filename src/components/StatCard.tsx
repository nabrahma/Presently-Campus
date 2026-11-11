import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/cn'
import { TONE_TEXT, type Tone } from './Panel'

/**
 * A headline figure, as at the top of an office dashboard: what is counted,
 * named first in plain words with its icon, then the number large enough to
 * read across a room, then a line of context.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  suffix,
  tone = 'default',
  detail,
  children,
  className
}: {
  icon: LucideIcon
  label: string
  value: string
  suffix?: string
  tone?: Tone
  /** A short line under the number: a course, a count, a target. */
  detail?: ReactNode
  /** A meter or chart drawn under the number. */
  children?: ReactNode
  className?: string
}) {
  return (
    <section className={cn('panel flex min-w-0 flex-col p-4 md:p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="pt-1 text-[1rem] leading-snug font-semibold text-ink-muted">{label}</p>
        <span className={cn('icon-tile size-10', tone === 'danger' && 'bg-danger-wash text-danger')}>
          <Icon size={19} strokeWidth={2.1} />
        </span>
      </div>
      <p className={cn('readout mt-3 flex flex-wrap items-baseline gap-x-1.5 text-[2.25rem] md:text-[2.5rem]', TONE_TEXT[tone])}>
        {value}
        {suffix ? <span className="text-[1rem] font-semibold tracking-normal text-ink-muted">{suffix}</span> : null}
      </p>
      {detail ? <p className="mt-2 line-clamp-2 text-[0.975rem] leading-snug text-ink-muted">{detail}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}
